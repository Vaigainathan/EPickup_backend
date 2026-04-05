const crypto = require('crypto');
const Razorpay = require('razorpay');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

/**
 * RazorpayOrdersService - Native Checkout SDK for Android
 * 
 * Uses Razorpay Orders API to create orders that can be opened
 * with native Razorpay Checkout modal on Android/iOS.
 * 
 * This provides better UX than Payment Links as the modal
 * stays inside the app rather than redirecting to browser.
 */
class RazorpayOrdersService {
  constructor() {
    this.db = getFirestore();
    this.instance = null;
  }

  isConfigured() {
    return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
  }

  getInstance() {
    if (!this.isConfigured()) {
      throw new Error('Razorpay is not configured');
    }

    if (!this.instance) {
      this.instance = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });
    }

    return this.instance;
  }

  /**
   * Verify payment signature (CRITICAL for security)
   * 
   * Signature verification ensures:
   * 1. Payment is authentic (from Razorpay)
   * 2. Amount wasn't tampered with
   * 3. Order ID wasn't switched
   */
  verifyPaymentSignature(orderId, paymentId, signature) {
    try {
      if (!orderId || !paymentId || !signature) {
        console.warn('❌ [RAZORPAY] Missing signature components');
        return false;
      }

      const secret = process.env.RAZORPAY_KEY_SECRET;
      if (!secret) {
        console.warn('❌ [RAZORPAY] RAZORPAY_KEY_SECRET not configured');
        return false;
      }

      // Signature = HMAC-SHA256(orderId|paymentId, secret)
      const payload = `${orderId}|${paymentId}`;
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const isValid = expectedSignature === signature;

      if (isValid) {
        console.log('✅ [RAZORPAY] Signature verified successfully');
      } else {
        console.warn('⚠️ [RAZORPAY] Signature verification failed (tokens might be tampered)');
        console.warn('   Expected:', expectedSignature);
        console.warn('   Received:', signature);
      }

      return isValid;
    } catch (error) {
      console.error('❌ [RAZORPAY] Signature verification error:', error.message);
      return false;
    }
  }

  /**
   * Create order for wallet top-up
   * 
   * Orders API is required for native Checkout SDK.
   * Returns orderId which frontend passes to RazorpayCheckout.open()
   */
  async createWalletTopupOrder({ transactionId, driverId, amount }) {
    try {
      const rzp = this.getInstance();
      const amountInPaise = Math.round(Number(amount) * 100);

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📋 [RAZORPAY_ORDERS] Creating order for wallet top-up');
      console.log('   Amount:', amount, '(', amountInPaise, 'paise)');
      console.log('   Driver:', driverId);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Create order
      const order = await rzp.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: transactionId,
        payment_capture: 1, // Auto-capture enabled
        notes: {
          transactionId,
          driverId,
          purpose: 'driver_wallet_topup'
        }
      });

      console.log('✅ [RAZORPAY_ORDERS] Order created successfully');
      console.log('   Order ID:', order.id);
      console.log('   Receipt:', order.receipt);

      return {
        success: true,
        data: {
          orderId: order.id,
          amount: order.amount,
          currency: order.currency,
          receipt: order.receipt,
          createdAt: new Date(order.created_at * 1000).toISOString(),
          // ✅ CRITICAL: Include public key so frontend can use it
          key: process.env.RAZORPAY_KEY_ID,
          // ✅ Gateway info for frontend
          gateway: 'razorpay',
          isSDK: true,
          isNativeCheckout: true
        }
      };
    } catch (error) {
      console.error('❌ [RAZORPAY_ORDERS] Order creation failed:', error.message);
      return {
        success: false,
        error: error.message || 'Failed to create Razorpay order'
      };
    }
  }

  /**
   * Get order status from Razorpay
   * Used for verification and checking payment status
   */
  async getOrderStatus(orderId) {
    try {
      const rzp = this.getInstance();
      const order = await rzp.orders.fetch(orderId);

      return {
        success: true,
        data: {
          orderId: order.id,
          amount: order.amount,
          status: order.status, // created, attempted, paid
          amountPaid: order.amount_paid || 0,
          amountDue: order.amount_due || 0,
          createdAt: new Date(order.created_at * 1000).toISOString()
        }
      };
    } catch (error) {
      console.error('❌ [RAZORPAY_ORDERS] Failed to fetch order status:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process wallet top-up payment (called after payment verification)
   * 
   * ✅ ATOMIC TRANSACTION ensuring:
   * 1. Signature is verified
   * 2. Payment ID is authenticated
   * 3. Driver wallet is updated (isolated per driverId)
   * 4. Audit trail created (admin visibility)
   * 5. Revenue record created (company tracking)
   * 6. All or nothing - no partial updates
   */
  async processWalletTopupPayment(transactionId, paymentData, requestingDriverId = null) {
    try {
      const { razorpayPaymentId, razorpayOrderId, razorpaySignature } = paymentData;

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('💳 [RAZORPAY_ORDERS] Processing wallet payment (ATOMIC)');
      console.log('   Transaction:', transactionId);
      console.log('   Payment ID:', razorpayPaymentId);
      console.log('   Order ID:', razorpayOrderId);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // ✅ VERIFY SIGNATURE before processing (CRITICAL for security)
      const isSignatureValid = this.verifyPaymentSignature(
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      );

      if (!isSignatureValid) {
        console.error('❌ [RAZORPAY_ORDERS] Signature verification failed - payment rejected');
        return {
          success: false,
          error: 'Payment signature verification failed - transaction rejected'
        };
      }

      // Get order details from Razorpay to confirm amount
      const orderStatus = await this.getOrderStatus(razorpayOrderId);
      if (!orderStatus.success) {
        console.error('❌ [RAZORPAY_ORDERS] Could not verify order status');
        return orderStatus;
      }

      // Get payment details from Razorpay
      const rzp = this.getInstance();
      const payment = await rzp.payments.fetch(razorpayPaymentId);

      console.log('✅ [RAZORPAY_ORDERS] Payment verified from Razorpay');
      console.log('   Status:', payment.status);
      console.log('   Amount:', payment.amount, 'paise');

      // ✅ NEW: Get transaction data (BEFORE transaction, not inside)
      const topupDocBeforeTransaction = await this.db.collection('driverTopUps').doc(transactionId).get();
      if (!topupDocBeforeTransaction.exists) {
        console.error('❌ [RAZORPAY_ORDERS] Transaction not found');
        return {
          success: false,
          error: 'Transaction not found'
        };
      }

      const topupData = topupDocBeforeTransaction.data();
      const driverId = topupData.driverId;
      const amount = topupData.amount;

      // ✅ USER ISOLATION: Verify requestingDriverId matches transaction driverId
      if (requestingDriverId && requestingDriverId !== driverId) {
        console.error('❌ [RAZORPAY_ORDERS] USER ISOLATION VIOLATION - Driver attempting to verify another driver\'s payment', {
          requestingDriverId,
          transactionDriverId: driverId,
          transactionId
        });
        return {
          success: false,
          error: 'UNAUTHORIZED: Cannot verify another driver\'s payment'
        };
      }

      // ✅ Calculate points (1 INR = 1 point for top-up)
      const pointsAwarded = Math.round(amount);

      console.log('💰 [RAZORPAY_ORDERS] ATOMIC TRANSACTION: Updating wallet');
      console.log('   Driver ID:', driverId);
      console.log('   Amount:', amount);
      console.log('   Points:', pointsAwarded);

      // ✅ CRITICAL: Use ATOMIC TRANSACTION for all updates
      const topupRef = this.db.collection('driverTopUps').doc(transactionId);
      const walletRef = this.db.collection('driverPointsWallets').doc(driverId);
      const auditRef = this.db.collection('walletTransactions').doc();
      const revenueRef = this.db.collection('companyRevenue').doc();
      const adminAuditRef = this.db.collection('adminAuditLog').doc();

      // Use transaction to ensure atomicity across all collections
      const result = await this.db.runTransaction(async (transaction) => {
        // Step 1: Get current wallet state (read within transaction)
        const currentWalletDoc = await transaction.get(walletRef);
        let currentBalance = 0;
        let currentTotalEarned = 0;

        if (currentWalletDoc.exists) {
          const walletData = currentWalletDoc.data();
          currentBalance = walletData.pointsBalance || 0;
          currentTotalEarned = walletData.totalPointsEarned || 0;
        }

        const newBalance = currentBalance + pointsAwarded;
        const newTotalEarned = currentTotalEarned + pointsAwarded;

        // Step 2: Update driverTopUps transaction status
        transaction.update(topupRef, {
          status: 'completed',
          razorpayPaymentId: razorpayPaymentId,
          razorpayOrderId: razorpayOrderId,
          razorpaySignatureVerified: true,
          pointsAwarded: pointsAwarded,
          newPointsBalance: newBalance,
          processedAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        });

        console.log('✅ [RAZORPAY_ORDERS] Step 1: Transaction record updated');

        // Step 3: Update or create wallet (atomic increment)
        if (!currentWalletDoc.exists) {
          // Create new wallet if doesn't exist
          console.log('🆕 [RAZORPAY_ORDERS] Creating new wallet for driver:', driverId);
          transaction.set(walletRef, {
            driverId,
            pointsBalance: pointsAwarded,
            totalPointsEarned: pointsAwarded,
            totalPointsSpent: 0,
            status: 'active',
            requiresTopUp: false,
            lastUpdated: Timestamp.now(),
            createdAt: Timestamp.now(),
            createdByPayment: transactionId
          });
        } else {
          // Update existing wallet atomically
          console.log('📊 [RAZORPAY_ORDERS] Updating existing wallet:', {
            previousBalance: currentBalance,
            pointsAwarded,
            newBalance
          });

          transaction.update(walletRef, {
            pointsBalance: newBalance,
            totalPointsEarned: newTotalEarned,
            status: 'active',
            requiresTopUp: false,
            lastUpdated: Timestamp.now()
          });
        }

        console.log('✅ [RAZORPAY_ORDERS] Step 2: Wallet updated atomically');

        // Step 4: Create audit transaction record (for admin/driver visibility)
        transaction.set(auditRef, {
          driverId,
          type: 'topup',
          sourceType: 'razorpay_payment',
          amount: amount,
          pointsAwarded: pointsAwarded,
          previousBalance: currentBalance,
          newBalance: newBalance,
          transactionId: transactionId,
          razorpayPaymentId: razorpayPaymentId,
          razorpayOrderId: razorpayOrderId,
          status: 'completed',
          processedAt: Timestamp.now(),
          createdAt: Timestamp.now()
        });

        console.log('✅ [RAZORPAY_ORDERS] Step 3: Audit transaction created');

        // Step 5: Create company revenue record (admin dashboard visibility)
        transaction.set(revenueRef, {
          source: 'driver_wallet_topup',
          amount: amount,
          currency: 'INR',
          status: 'completed',
          driverId,
          razorpayPaymentId: razorpayPaymentId,
          razorpayOrderId: razorpayOrderId,
          transactionId: transactionId,
          processedAt: Timestamp.now(),
          createdAt: Timestamp.now()
        });

        console.log('✅ [RAZORPAY_ORDERS] Step 4: Revenue record created');

        // Step 6: Create admin audit log (for compliance & tracking)
        transaction.set(adminAuditRef, {
          event: 'wallet_topup_completed',
          driverId,
          amount: amount,
          pointsAwarded: pointsAwarded,
          transactionId: transactionId,
          razorpayPaymentId: razorpayPaymentId,
          details: {
            previousBalance: currentBalance,
            newBalance: newBalance,
            paymentStatus: payment.status,
            signatureVerified: true
          },
          timestamp: Timestamp.now(),
          createdAt: Timestamp.now()
        });

        console.log('✅ [RAZORPAY_ORDERS] Step 5: Admin audit log created');

        return {
          previousBalance: currentBalance,
          newBalance: newBalance,
          pointsAwarded: pointsAwarded
        };
      });

      console.log('✅ [RAZORPAY_ORDERS] ATOMIC TRANSACTION COMPLETE - All updates committed');

      // ✅ Step 6: Invalidate cache after successful transaction
      try {
        const cachingService = require('./cachingService');
        await cachingService.delete(`wallet:balance:${driverId}`, 'memory');
        await cachingService.invalidatePattern(`wallet:full:${driverId}:`, 'memory');
        await cachingService.delete(`wallet:transactions:count:${driverId}`, 'memory');
        console.log('✅ [RAZORPAY_ORDERS] Cache invalidated for driver:', driverId);
      } catch (cacheError) {
        console.warn('⚠️ [RAZORPAY_ORDERS] Cache invalidation failed (non-critical):', cacheError.message);
      }

      // ✅ Step 7: Emit real-time wallet update to driver
      try {
        const socketService = require('./socket');
        socketService.emitWalletUpdate(driverId, {
          balance: result.newBalance,
          previousBalance: result.previousBalance,
          transaction: {
            id: transactionId,
            type: 'credit',
            amount: pointsAwarded,
            paymentMethod: 'razorpay',
            status: 'completed',
            createdAt: new Date().toISOString()
          }
        });
        console.log('✅ [RAZORPAY_ORDERS] Wallet update emitted to driver:', driverId);
      } catch (socketError) {
        console.error('⚠️ [RAZORPAY_ORDERS] Socket emit failed (non-critical):', socketError.message);
      }

      return {
        success: true,
        status: 'completed',
        data: {
          transactionId,
          orderId: razorpayOrderId,
          paymentId: razorpayPaymentId,
          status: 'completed',
          driverId,
          amount: payment.amount / 100,
          pointsAwarded: pointsAwarded,
          newBalance: result.newBalance,
          previousBalance: result.previousBalance,
          processedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      console.error('❌ [RAZORPAY_ORDERS] Payment processing failed:', error);
      
      // Log error for monitoring but don't expose internal details
      return {
        success: false,
        error: error.message || 'Payment processing failed',
        transactionId,
        code: 'PAYMENT_PROCESSING_ERROR'
      };
    }
  }

  /**
   * Verify wallet top-up status
   * Called by frontend after SDK closes to get actual payment status
   * 
   * ✅ USER ISOLATION: Validates that requesting driver owns the transaction
   */
  async verifyWalletTopupStatus(transactionId, paymentData, requestingDriverId = null) {
    try {
      console.log('🔍 [RAZORPAY_ORDERS] Verifying wallet payment status');
      console.log('   Transaction:', transactionId);
      console.log('   Requesting Driver:', requestingDriverId || 'N/A');

      // Get transaction from database
      const topupDoc = await this.db.collection('driverTopUps').doc(transactionId).get();

      if (!topupDoc.exists) {
        console.warn('⚠️ [RAZORPAY_ORDERS] Transaction not found');
        return {
          success: false,
          status: 'not_found',
          error: 'Transaction not found'
        };
      }

      const topup = topupDoc.data();
      const transactionDriverId = topup.driverId;

      // ✅ USER ISOLATION: Verify requesting driver owns this transaction
      if (requestingDriverId && requestingDriverId !== transactionDriverId) {
        console.error('❌ [RAZORPAY_ORDERS] USER ISOLATION VIOLATION - Driver verifying another driver\'s payment', {
          requestingDriverId,
          transactionDriverId,
          transactionId
        });
        return {
          success: false,
          error: 'UNAUTHORIZED: Cannot verify another driver\'s payment'
        };
      }

      // If already completed, return that status
      if (topup.status === 'completed') {
        console.log('✅ [RAZORPAY_ORDERS] Payment already verified as completed');
        return {
          success: true,
          status: 'completed',
          data: {
            transactionId,
            status: 'completed',
            amount: topup.amount,
            driverId: transactionDriverId,
            pointsAwarded: topup.pointsAwarded || topup.amount,
            newBalance: topup.newPointsBalance || 0,
            processedAt: topup.processedAt
          }
        };
      }

      // If payment data provided (from frontend), process it
      if (paymentData && paymentData.razorpayPaymentId) {
        const processResult = await this.processWalletTopupPayment(transactionId, paymentData, requestingDriverId);
        return processResult;
      }

      // Otherwise, check pending status
      console.log('⏳ [RAZORPAY_ORDERS] Payment status is pending');
      return {
        success: true,
        status: 'pending',
        data: {
          transactionId,
          status: 'pending',
          driverId: transactionDriverId
        }
      };
    } catch (error) {
      console.error('❌ [RAZORPAY_ORDERS] Failed to verify wallet payment:', error);
      return {
        success: false,
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Handle Razorpay webhook callback
   * Called when Razorpay sends payment status updates
   */
  async handlePaymentCallback(event, payload) {
    try {
      console.log('📩 [RAZORPAY_ORDERS] Webhook received:', event);

      const orderId = payload.order?.entity?.receipt; // Receipt is our transactionId
      const paymentId = payload.payment?.entity?.id;
      const paymentStatus = payload.payment?.entity?.status;

      if (!orderId) {
        console.warn('⚠️ [RAZORPAY_ORDERS] Order ID not in webhook - cannot process');
        return { success: false, error: 'Order ID missing' };
      }

      console.log('   Order/Receipt:', orderId);
      console.log('   Payment ID:', paymentId);
      console.log('   Status:', paymentStatus);

      // Handle different webhook events
      switch (event) {
        case 'payment.authorized':
          // Payment successful - update wallet
          console.log('✅ [RAZORPAY_ORDERS] Payment authorized webhook');
          return await this.processWalletTopupPayment(orderId, {
            razorpayPaymentId: paymentId,
            razorpayOrderId: payload.order?.entity?.id,
            razorpaySignature: null // Webhook already authenticated
          });

        case 'payment.failed':
          // Payment failed - mark transaction as failed
          console.log('❌ [RAZORPAY_ORDERS] Payment failed webhook');
          await this.db.collection('driverTopUps').doc(orderId).update({
            status: 'failed',
            failureReason: 'Payment failed',
            updatedAt: Timestamp.now()
          });
          return { success: true };

        default:
          console.log('⚠️ [RAZORPAY_ORDERS] Unhandled webhook event:', event);
          return { success: true };
      }
    } catch (error) {
      console.error('❌ [RAZORPAY_ORDERS] Webhook processing error:', error);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
module.exports = new RazorpayOrdersService();
