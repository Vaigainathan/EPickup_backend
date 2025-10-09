/**
 * Mock Payment Service for PhonePe Integration
 * 
 * ⚠️ TESTING MODE ONLY ⚠️
 * This service simulates PhonePe payment gateway for development/testing.
 * It maintains the EXACT same API contract as phonepeService.js
 * 
 * Purpose:
 * - Test complete payment flow without real PhonePe account
 * - Demo to clients in "sandbox mode"
 * - Validate business logic before production
 * 
 * Switching to Real PhonePe:
 * 1. Get PhonePe merchant credentials (business.phonepe.com)
 * 2. Set environment variables in Render
 * 3. System automatically switches to real PhonePe
 * 4. No code changes needed!
 * 
 * @author EPickup Team
 * @version 1.0.0
 */

const crypto = require('crypto');
const axios = require('axios');

class MockPaymentService {
  constructor() {
    // In-memory storage for pending payments
    // In production with real PhonePe, this would be handled by PhonePe servers
    this.pendingPayments = new Map();
    this.completedPayments = new Map();
    
    // Payment simulation settings
    this.AUTO_COMPLETE_DELAY = 2000; // 2 seconds to simulate payment processing
    this.SUCCESS_RATE = 100; // 100% success rate for testing
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎭 [MOCK_PAYMENT] Mock Payment Service initialized');
    console.log('🔔 [MOCK_PAYMENT] MODE: TESTING/SANDBOX');
    console.log('💡 [MOCK_PAYMENT] No real money will be charged');
    console.log('📝 [MOCK_PAYMENT] All transactions are simulated');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  /**
   * Create a mock payment (matches PhonePe's createPayment API)
   * 
   * This method has the SAME signature as phonepeService.createPayment()
   * Ensures drop-in replacement with no code changes needed
   * 
   * @param {Object} params - Payment parameters
   * @param {string} params.transactionId - Unique transaction ID
   * @param {string} params.merchantTransactionId - Merchant transaction ID (same as transactionId)
   * @param {string} params.merchantUserId - User ID (driver ID)
   * @param {number} params.amount - Amount in INR
   * @param {string} params.mobileNumber - User's mobile number
   * @param {string} params.callbackUrl - Webhook callback URL
   * @param {string} params.redirectUrl - Deep link redirect URL
   * @returns {Promise<Object>} Payment response matching PhonePe's structure
   */
  async createPayment({
    transactionId,
    merchantTransactionId,
    merchantUserId,
    amount,
    customerId, // Legacy param, maps to merchantUserId
    mobileNumber,
    customerPhone, // Legacy param, maps to mobileNumber
    callbackUrl,
    redirectUrl,
    bookingId // Optional, for reference
  }) {
    try {
      // Normalize parameters (handle legacy params)
      const normalizedParams = {
        transactionId: transactionId || merchantTransactionId,
        merchantTransactionId: merchantTransactionId || transactionId,
        merchantUserId: merchantUserId || customerId,
        amount: parseFloat(amount),
        mobileNumber: mobileNumber || customerPhone || '+919999999999',
        callbackUrl: callbackUrl || `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/payments/phonepe/callback`,
        redirectUrl: redirectUrl || 'epickup://payment/callback',
        bookingId: bookingId || 'wallet-topup'
      };

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🎭 [MOCK_PAYMENT] Creating mock payment');
      console.log('📝 [MOCK_PAYMENT] Transaction ID:', normalizedParams.merchantTransactionId);
      console.log('💰 [MOCK_PAYMENT] Amount: ₹' + normalizedParams.amount);
      console.log('👤 [MOCK_PAYMENT] User ID:', normalizedParams.merchantUserId);
      console.log('📱 [MOCK_PAYMENT] Mobile:', normalizedParams.mobileNumber);
      console.log('🔗 [MOCK_PAYMENT] Callback URL:', normalizedParams.callbackUrl);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Validate amount
      if (normalizedParams.amount < 1 || normalizedParams.amount > 100000) {
        throw new Error('Amount must be between ₹1 and ₹100,000');
      }

      // Store payment as pending
      const paymentData = {
        ...normalizedParams,
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        mockPaymentUrl: `mock-payment://simulator?tid=${normalizedParams.merchantTransactionId}&amt=${normalizedParams.amount}`,
        gatewayResponse: null
      };

      this.pendingPayments.set(normalizedParams.merchantTransactionId, paymentData);

      console.log('✅ [MOCK_PAYMENT] Payment created successfully');
      console.log('🎭 [MOCK_PAYMENT] Simulating payment processing...');
      console.log(`⏱️  [MOCK_PAYMENT] Auto-completing in ${this.AUTO_COMPLETE_DELAY / 1000} seconds`);

      // Auto-complete payment after delay (simulates user paying)
      setTimeout(async () => {
        await this.simulatePaymentSuccess(normalizedParams.merchantTransactionId, normalizedParams.callbackUrl);
      }, this.AUTO_COMPLETE_DELAY);

      // Return response matching PhonePe's structure EXACTLY
      return {
        success: true,
        code: 'PAYMENT_INITIATED',
        message: 'Payment initiated successfully',
        data: {
          transactionId: normalizedParams.transactionId,
          merchantTransactionId: normalizedParams.merchantTransactionId,
          paymentUrl: paymentData.mockPaymentUrl, // In real PhonePe, this is their payment page URL
          merchantId: 'MOCK_MERCHANT_EPICKUP',
          amount: normalizedParams.amount * 100, // Convert to paise (PhonePe uses paise)
          state: 'PENDING',
          responseCode: 'SUCCESS'
        }
      };

    } catch (error) {
      console.error('❌ [MOCK_PAYMENT] Error creating payment:', error.message);
      return {
        success: false,
        code: 'PAYMENT_ERROR',
        message: error.message,
        data: null
      };
    }
  }

  /**
   * Simulate successful payment and trigger webhook callback
   * This mimics PhonePe's behavior when a payment completes
   * 
   * @param {string} transactionId - Transaction ID
   * @param {string} callbackUrl - Webhook URL to notify
   */
  async simulatePaymentSuccess(transactionId, callbackUrl) {
    try {
      const payment = this.pendingPayments.get(transactionId);
      
      if (!payment) {
        console.error('❌ [MOCK_PAYMENT] Payment not found:', transactionId);
        return;
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🎉 [MOCK_PAYMENT] Simulating payment SUCCESS');
      console.log('📝 [MOCK_PAYMENT] Transaction ID:', transactionId);
      console.log('💰 [MOCK_PAYMENT] Amount: ₹' + payment.amount);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Update payment status
      payment.status = 'SUCCESS';
      payment.completedAt = new Date().toISOString();
      this.pendingPayments.set(transactionId, payment);
      this.completedPayments.set(transactionId, payment);

      // Create callback payload matching PhonePe's webhook structure
      const callbackPayload = {
        success: true,
        code: 'PAYMENT_SUCCESS',
        message: 'Your payment is successful.',
        data: {
          merchantId: 'MOCK_MERCHANT_EPICKUP',
          merchantTransactionId: transactionId,
          transactionId: `MOCK_TXN_${Date.now()}`,
          amount: payment.amount * 100, // In paise
          state: 'COMPLETED',
          responseCode: 'SUCCESS',
          paymentInstrument: {
            type: 'UPI', // Simulate UPI payment
            utr: `MOCK${Date.now()}`, // Mock UTR number
            cardType: null,
            pgTransactionId: `PG_${Date.now()}`,
            bankTransactionId: `BANK_${Date.now()}`,
            pgAuthorizationCode: `AUTH_${Date.now()}`,
            arn: null,
            bankId: 'MOCKBANK'
          }
        }
      };

      console.log('📤 [MOCK_PAYMENT] Sending webhook callback to backend...');
      console.log('🔗 [MOCK_PAYMENT] Callback URL:', callbackUrl);

      // Generate mock checksum (PhonePe uses SHA256 + salt)
      const checksumString = JSON.stringify(callbackPayload.data) + '/pg/v1/status' + 'MOCK_SALT_KEY_XYZ123';
      const checksum = crypto.createHash('sha256').update(checksumString).digest('hex') + '###1';

      // Trigger webhook callback to backend
      try {
        const response = await axios.post(callbackUrl, callbackPayload, {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': checksum, // PhonePe sends checksum for verification
            'User-Agent': 'PhonePe-Mock-Webhook/1.0'
          },
          timeout: 10000
        });

        if (response.status === 200) {
          console.log('✅ [MOCK_PAYMENT] Webhook callback successful');
          console.log('📊 [MOCK_PAYMENT] Backend response:', response.data);
        } else {
          console.warn('⚠️ [MOCK_PAYMENT] Webhook returned non-200 status:', response.status);
        }
      } catch (webhookError) {
        console.error('❌ [MOCK_PAYMENT] Webhook callback failed:', {
          error: webhookError.message,
          code: webhookError.code,
          response: webhookError.response?.data
        });
        
        // Mark payment as completed even if webhook fails
        // Backend will retry or handle via polling
        console.log('ℹ️  [MOCK_PAYMENT] Payment marked as completed (webhook failed, but payment successful)');
      }

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ [MOCK_PAYMENT] Payment processing complete');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    } catch (error) {
      console.error('❌ [MOCK_PAYMENT] Error in payment simulation:', error);
    }
  }

  /**
   * Verify payment status (matches PhonePe's verifyPayment API)
   * 
   * @param {string} merchantTransactionId - Transaction ID to verify
   * @returns {Promise<Object>} Payment status matching PhonePe's structure
   */
  async verifyPayment(merchantTransactionId) {
    try {
      console.log('🔍 [MOCK_PAYMENT] Verifying payment status:', merchantTransactionId);

      const payment = this.pendingPayments.get(merchantTransactionId) || 
                      this.completedPayments.get(merchantTransactionId);
      
      if (!payment) {
        console.log('❌ [MOCK_PAYMENT] Payment not found');
        return {
          success: false,
          code: 'PAYMENT_NOT_FOUND',
          message: 'Payment transaction not found',
          data: null
        };
      }

      const response = {
        success: payment.status === 'SUCCESS',
        code: payment.status === 'SUCCESS' ? 'PAYMENT_SUCCESS' : 'PAYMENT_PENDING',
        message: payment.status === 'SUCCESS' ? 'Payment completed successfully' : 'Payment is pending',
        data: {
          merchantId: 'MOCK_MERCHANT_EPICKUP',
          merchantTransactionId,
          transactionId: `MOCK_TXN_${merchantTransactionId}`,
          amount: payment.amount * 100,
          state: payment.status === 'SUCCESS' ? 'COMPLETED' : 'PENDING',
          responseCode: payment.status === 'SUCCESS' ? 'SUCCESS' : 'PENDING',
          paymentInstrument: payment.status === 'SUCCESS' ? {
            type: 'UPI',
            utr: `MOCK${Date.now()}`
          } : null
        }
      };

      console.log('✅ [MOCK_PAYMENT] Status:', payment.status);
      return response;

    } catch (error) {
      console.error('❌ [MOCK_PAYMENT] Error verifying payment:', error.message);
      return {
        success: false,
        code: 'VERIFICATION_ERROR',
        message: error.message,
        data: null
      };
    }
  }

  /**
   * Handle payment callback (matches PhonePe's handlePaymentCallback)
   * This is called by the webhook endpoint when PhonePe sends callback
   * 
   * @param {Object} callbackData - Callback payload from PhonePe webhook
   * @returns {Promise<Object>} Processed callback result
   */
  async handlePaymentCallback(callbackData) {
    try {
      console.log('📥 [MOCK_PAYMENT] Handling payment callback');
      console.log('📝 [MOCK_PAYMENT] Callback data:', JSON.stringify(callbackData, null, 2));

      if (!callbackData || !callbackData.data) {
        throw new Error('Invalid callback data structure');
      }

      const { merchantTransactionId, state, amount } = callbackData.data;

      if (!merchantTransactionId) {
        throw new Error('Missing merchantTransactionId in callback data');
      }

      // Update payment record
      const payment = this.pendingPayments.get(merchantTransactionId);
      if (payment) {
        payment.status = state === 'COMPLETED' ? 'SUCCESS' : 'FAILED';
        payment.callbackReceivedAt = new Date().toISOString();
        payment.gatewayResponse = callbackData;
        
        if (state === 'COMPLETED') {
          this.completedPayments.set(merchantTransactionId, payment);
        }
        
        this.pendingPayments.set(merchantTransactionId, payment);
        
        console.log('✅ [MOCK_PAYMENT] Payment record updated');
      } else {
        console.warn('⚠️  [MOCK_PAYMENT] Payment not found in pending list (might be already processed)');
      }

      // ✅ CRITICAL FIX: Process the wallet top-up (add points to Firestore)
      if (state === 'COMPLETED') {
        console.log('💰 [MOCK_PAYMENT] Processing wallet top-up in Firestore...');
        try {
          await this.processWalletTopupPayment(merchantTransactionId);
          console.log('✅ [MOCK_PAYMENT] Wallet top-up processed successfully');
        } catch (walletError) {
          console.error('❌ [MOCK_PAYMENT] Failed to process wallet top-up:', walletError.message);
        }
      }

      console.log('✅ [MOCK_PAYMENT] Callback processed successfully');

      return {
        success: state === 'COMPLETED',
        transactionId: merchantTransactionId,
        amount: amount / 100, // Convert from paise to INR
        state,
        message: state === 'COMPLETED' ? 'Payment successful' : 'Payment failed',
        code: state === 'COMPLETED' ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED'
      };

    } catch (error) {
      console.error('❌ [MOCK_PAYMENT] Error handling callback:', error.message);
      throw error;
    }
  }

  /**
   * Process wallet top-up payment (adds points to Firestore wallet)
   * This mimics the real PhonePe service's processWalletTopupPayment method
   * 
   * @param {string} transactionId - Transaction ID
   */
  async processWalletTopupPayment(transactionId) {
    try {
      console.log(`💰 [MOCK_PAYMENT] Processing wallet top-up: ${transactionId}`);
      
      const { getFirestore } = require('./firebase');
      const db = getFirestore();
      
      // Find wallet transaction record in driverTopUps collection
      const walletTransactionsSnapshot = await db.collection('driverTopUps')
        .where('phonepeTransactionId', '==', transactionId)
        .limit(1)
        .get();

      if (walletTransactionsSnapshot.empty) {
        console.error(`❌ [MOCK_PAYMENT] Wallet transaction not found: ${transactionId}`);
        return;
      }

      const walletTransactionDoc = walletTransactionsSnapshot.docs[0];
      const walletTransactionData = walletTransactionDoc.data();
      const driverId = walletTransactionData.driverId;

      console.log(`💰 [MOCK_PAYMENT] Found transaction for driver: ${driverId}`);

      // Update wallet transaction status
      await walletTransactionDoc.ref.update({
        status: 'completed',
        phonepePaymentId: transactionId,
        completedAt: new Date(),
        updatedAt: new Date()
      });

      // Add points to wallet using walletService
      const walletService = require('./walletService');
      const pointsResult = await walletService.addPoints(
        driverId,
        walletTransactionData.amount,
        walletTransactionData.paymentMethod || 'mock_payment',
        {
          transactionId,
          phonepeTransactionId: transactionId,
          originalTransaction: walletTransactionData,
          isMockPayment: true
        }
      );

      if (pointsResult.success) {
        // Update wallet transaction with points data
        await walletTransactionDoc.ref.update({
          pointsAwarded: pointsResult.data.pointsAdded,
          newPointsBalance: pointsResult.data.newBalance,
          updatedAt: new Date()
        });

        console.log(`✅ [MOCK_PAYMENT] Points added to wallet for driver ${driverId}: +${pointsResult.data.pointsAdded} points for ₹${walletTransactionData.amount}`);
        console.log(`💰 [MOCK_PAYMENT] New balance: ${pointsResult.data.newBalance} points`);
      } else {
        console.error(`❌ [MOCK_PAYMENT] Failed to add points: ${pointsResult.error}`);
      }

    } catch (error) {
      console.error('❌ [MOCK_PAYMENT] Error processing wallet top-up:', error);
      throw error;
    }
  }

  /**
   * Get payment statistics (for debugging/monitoring)
   * 
   * @returns {Object} Payment statistics
   */
  getStats() {
    return {
      pendingPayments: this.pendingPayments.size,
      completedPayments: this.completedPayments.size,
      totalPayments: this.pendingPayments.size + this.completedPayments.size,
      mode: 'MOCK/TESTING',
      autoCompleteDelay: this.AUTO_COMPLETE_DELAY,
      successRate: this.SUCCESS_RATE
    };
  }

  /**
   * Clear old completed payments (cleanup)
   * Prevents memory buildup in long-running processes
   * 
   * @param {number} ageInHours - Clear payments older than this many hours
   */
  cleanupOldPayments(ageInHours = 24) {
    const cutoffTime = Date.now() - (ageInHours * 60 * 60 * 1000);
    let cleaned = 0;

    for (const [txnId, payment] of this.completedPayments.entries()) {
      const paymentTime = new Date(payment.completedAt || payment.createdAt).getTime();
      if (paymentTime < cutoffTime) {
        this.completedPayments.delete(txnId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 [MOCK_PAYMENT] Cleaned up ${cleaned} old payments`);
    }

    return cleaned;
  }
}

// Export singleton instance (matches phonepeService.js pattern)
const mockPaymentService = new MockPaymentService();

// Auto-cleanup old payments every hour
setInterval(() => {
  mockPaymentService.cleanupOldPayments(24);
}, 60 * 60 * 1000);

module.exports = mockPaymentService;
