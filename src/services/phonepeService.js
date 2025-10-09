const crypto = require('crypto');
const axios = require('axios');
const { getFirestore } = require('./firebase');
const errorHandlingService = require('./errorHandlingService');
const monitoringService = require('./monitoringService');
const phonepeConfig = require('./phonepeConfigService');

/**
 * PhonePe Payment Service for EPickup
 * Handles payment creation, confirmation, and webhook processing
 */
class PhonePeService {
  constructor() {
    this.db = getFirestore();
    
    // Use centralized PhonePe configuration
    this.config = phonepeConfig.getConfig();
    
    // Log configuration for debugging
    phonepeConfig.logConfig();
  }

  /**
   * Generate PhonePe checksum
   * @param {string} payload - Payload to hash
   * @returns {string} Checksum
   */
  generateChecksum(payload) {
    const hash = crypto.createHash('sha256');
    hash.update(payload + this.config.saltKey);
    return hash.digest('hex');
  }

  /**
   * Verify PhonePe checksum
   * @param {string} payload - Payload to verify
   * @param {string} checksum - Checksum to verify
   * @returns {boolean} Verification result
   */
  verifyChecksum(payload, checksum) {
    const expectedChecksum = this.generateChecksum(payload);
    return expectedChecksum === checksum;
  }

  /**
   * Create payment request
   * @param {Object} paymentData - Payment data
   * @returns {Object} Payment creation result
   */
  async createPayment(paymentData) {
    return errorHandlingService.executeWithRetry(async () => {
      const {
        transactionId,
        amount,
        customerId,
        bookingId,
        customerPhone
      } = paymentData;

      // Validate required fields
      if (!transactionId || !amount || !customerId || !bookingId) {
        throw new Error('Missing required payment fields');
      }

      // Convert amount to paise (PhonePe expects amount in paise)
      const amountInPaise = Math.round(amount * 100);

      // Create payment payload
      const payload = {
        merchantId: this.config.merchantId,
        merchantTransactionId: transactionId,
        merchantUserId: customerId,
        amount: amountInPaise,
        redirectUrl: phonepeConfig.getRedirectUrl(),
        redirectMode: 'POST',
        callbackUrl: phonepeConfig.getCallbackUrl(),
        mobileNumber: customerPhone,
        paymentInstrument: {
          type: 'PAY_PAGE'
        }
      };

      // Generate checksum
      const payloadString = JSON.stringify(payload);
      const checksum = this.generateChecksum(payloadString);

      // Create request payload
      const requestPayload = {
        request: Buffer.from(payloadString).toString('base64')
      };

      // Log PhonePe API call details for debugging
      console.log('📱 [PHONEPE] Creating payment with configuration:');
      console.log('  Merchant ID:', this.config.merchantId);
      console.log('  Salt Index:', this.config.saltIndex);
      console.log('  Base URL:', phonepeConfig.getBaseUrl());
      console.log('  Transaction ID:', transactionId);
      console.log('  Amount (paise):', amountInPaise);
      console.log('  Callback URL:', phonepeConfig.getCallbackUrl());
      console.log('  Checksum:', checksum.substring(0, 20) + '...');

      // Make API call to PhonePe
      const response = await axios.post(
        `${phonepeConfig.getBaseUrl()}/pg/v1/pay`,
        requestPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': `${checksum}###${this.config.saltIndex}`,
            'accept': 'application/json'
          }
        }
      );

      console.log('✅ [PHONEPE] Payment API response:', {
        success: response.data.success,
        code: response.data.code,
        message: response.data.message
      });

      if (response.data.success) {
        // Store payment record in Firestore
        await this.storePaymentRecord({
          transactionId,
          bookingId,
          customerId,
          amount,
          amountInPaise,
          status: 'PENDING',
          paymentGateway: 'PHONEPE',
          paymentUrl: response.data.data.instrumentResponse.redirectInfo.url,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        await monitoringService.logPayment('payment_created', {
          transactionId,
          bookingId,
          amount,
          customerId
        });

        return {
          success: true,
          data: {
            transactionId,
            merchantTransactionId: transactionId, // ADDED: Backend expects this field
            paymentUrl: response.data.data.instrumentResponse.redirectInfo.url,
            merchantId: this.config.merchantId,
            amount: amountInPaise
          }
        };
      } else {
        console.error('❌ [PHONEPE] Payment creation failed:', {
          success: response.data.success,
          code: response.data.code,
          message: response.data.message,
          data: response.data.data
        });
        throw new Error(response.data.message || 'Payment creation failed');
      }
    }, {
      context: 'Create PhonePe payment',
      maxRetries: 2
    }).catch(error => {
      // Log detailed PhonePe error response
      if (error.response) {
        console.error('❌ [PHONEPE] Payment API error response:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          headers: {
            'x-request-backend-time': error.response.headers['x-request-backend-time'],
            'x-response-backend-time': error.response.headers['x-response-backend-time']
          }
        });
        
        // Log PhonePe specific error details
        if (error.response.data) {
          console.error('❌ [PHONEPE] PhonePe error details:', {
            success: error.response.data.success,
            code: error.response.data.code,
            message: error.response.data.message,
            data: error.response.data.data
          });
        }
      }
      
      console.error('❌ [PHONEPE] Payment API error summary:', {
        message: error.message,
        code: error.code,
        config: {
          merchantId: this.config.merchantId,
          saltKey: this.config.saltKey ? `${this.config.saltKey.substring(0, 10)}...` : 'NOT_SET',
          saltIndex: this.config.saltIndex,
          baseUrl: phonepeConfig.getBaseUrl()
        }
      });
      throw error;
    });
  }

  // Note: verifyPayment function moved to line 468 to avoid duplication

  /**
   * Handle payment callback/webhook
   * @param {Object} callbackData - Callback data from PhonePe
   * @returns {Object} Callback processing result
   */
  async handlePaymentCallback(callbackData) {
    try {
      const { response } = callbackData;
      const decodedResponse = JSON.parse(Buffer.from(response, 'base64').toString());
      
      const {
        merchantId,
        merchantTransactionId,
        transactionId,
        amount,
        state,
        responseCode,
        responseMessage
      } = decodedResponse;

      // Verify the callback
      if (merchantId !== phonepeConfig.getMerchantId()) {
        throw new Error('Invalid merchant ID in callback');
      }

      // Update payment record
      await this.updatePaymentStatus(merchantTransactionId, {
        status: state,
        paymentId: transactionId,
        responseCode,
        responseMessage,
        updatedAt: new Date()
      });

      // Verify payment with PhonePe before processing
      const verificationResult = await this.verifyPayment(merchantTransactionId);
      
      if (!verificationResult.success) {
        console.error(`❌ Payment verification failed for: ${merchantTransactionId}`);
        return {
          success: false,
          error: 'Payment verification failed'
        };
      }
      
      const verifiedState = verificationResult.data.state;
      
      // Update booking status based on verified payment status
      if (verifiedState === 'COMPLETED') {
        await this.updateBookingPaymentStatus(merchantTransactionId, 'PAID');
        
        // Check if this is a wallet top-up payment
        if (merchantTransactionId.startsWith('WALLET_')) {
          await this.processWalletTopupPayment(merchantTransactionId, amount);
        }
      } else if (verifiedState === 'FAILED') {
        await this.updateBookingPaymentStatus(merchantTransactionId, 'FAILED');
        
        // Update wallet transaction status if it's a wallet top-up
        if (merchantTransactionId.startsWith('WALLET_')) {
          await this.updateWalletTransactionStatus(merchantTransactionId, 'failed');
        }
      }

      await monitoringService.logPayment('payment_callback_processed', {
        transactionId: merchantTransactionId,
        status: state,
        amount
      });

      return {
        success: true,
        message: 'Payment callback processed successfully'
      };
    } catch (error) {
      console.error('Payment callback error:', error);
      return {
        success: false,
        error: {
          code: 'CALLBACK_ERROR',
          message: 'Failed to process payment callback',
          details: error.message
        }
      };
    }
  }

  /**
   * Process refund
   * @param {Object} refundData - Refund data
   * @returns {Object} Refund processing result
   */
  async processRefund(refundData) {
    return errorHandlingService.executeWithRetry(async () => {
      const {
        transactionId,
        refundAmount,
        refundReason,
        refundedBy
      } = refundData;

      const amountInPaise = Math.round(refundAmount * 100);

      const payload = {
        merchantId: phonepeConfig.getMerchantId(),
        merchantUserId: refundedBy,
        originalTransactionId: transactionId,
        merchantRefundId: `REF_${transactionId}_${Date.now()}`,
        amount: amountInPaise,
        callbackUrl: phonepeConfig.getCallbackUrl()
      };

      const payloadString = JSON.stringify(payload);
      const checksum = this.generateChecksum(payloadString);

      const response = await axios.post(
        `${phonepeConfig.getBaseUrl()}/pg/v1/refund`,
        {
          request: Buffer.from(payloadString).toString('base64')
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': `${checksum}###${this.config.saltIndex}`,
            'accept': 'application/json'
          }
        }
      );

      if (response.data.success) {
        // Store refund record
        await this.storeRefundRecord({
          originalTransactionId: transactionId,
          refundTransactionId: response.data.data.merchantRefundId,
          amount: refundAmount,
          reason: refundReason,
          refundedBy,
          status: 'PENDING',
          createdAt: new Date()
        });

        return {
          success: true,
          data: {
            refundTransactionId: response.data.data.merchantRefundId,
            amount: refundAmount
          }
        };
      } else {
        throw new Error(response.data.message || 'Refund processing failed');
      }
    }, {
      context: 'Process PhonePe refund',
      maxRetries: 2
    });
  }

  /**
   * Store payment record in Firestore
   * @param {Object} paymentData - Payment data
   */
  async storePaymentRecord(paymentData) {
    try {
      await this.db.collection('payments').doc(paymentData.transactionId).set(paymentData);
    } catch (error) {
      console.error('Store payment record error:', error);
      throw error;
    }
  }

  /**
   * Update payment status in Firestore
   * @param {string} transactionId - Transaction ID
   * @param {Object} updateData - Update data
   */
  async updatePaymentStatus(transactionId, updateData) {
    try {
      await this.db.collection('payments').doc(transactionId).update(updateData);
    } catch (error) {
      console.error('Update payment status error:', error);
      throw error;
    }
  }

  /**
   * Update booking payment status
   * @param {string} transactionId - Transaction ID
   * @param {string} paymentStatus - Payment status
   */
  async updateBookingPaymentStatus(transactionId, paymentStatus) {
    try {
      // Find booking by transaction ID
      const paymentDoc = await this.db.collection('payments').doc(transactionId).get();
      if (!paymentDoc.exists) {
        throw new Error('Payment record not found');
      }

      const paymentData = paymentDoc.data();
      const bookingId = paymentData.bookingId;

      // Update booking payment status
      await this.db.collection('bookings').doc(bookingId).update({
        paymentStatus,
        paymentUpdatedAt: new Date(),
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Update booking payment status error:', error);
      throw error;
    }
  }

  /**
   * Store refund record in Firestore
   * @param {Object} refundData - Refund data
   */
  async storeRefundRecord(refundData) {
    try {
      await this.db.collection('refunds').doc(refundData.refundTransactionId).set(refundData);
    } catch (error) {
      console.error('Store refund record error:', error);
      throw error;
    }
  }

  /**
   * Get payment by transaction ID
   * @param {string} transactionId - Transaction ID
   * @returns {Object|null} Payment data
   */
  async getPayment(transactionId) {
    try {
      const doc = await this.db.collection('payments').doc(transactionId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Get payment error:', error);
      return null;
    }
  }

  /**
   * Get payments by customer ID
   * @param {string} customerId - Customer ID
   * @param {number} limit - Limit
   * @returns {Array} Payments array
   */
  async getCustomerPayments(customerId, limit = 20) {
    try {
      const snapshot = await this.db.collection('payments')
        .where('customerId', '==', customerId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Get customer payments error:', error);
      return [];
    }
  }

  /**
   * Verify payment status with PhonePe
   * @param {string} merchantTransactionId - Merchant transaction ID
   * @returns {Object} Payment verification result
   */
  async verifyPayment(merchantTransactionId) {
    try {
      console.log(`🔍 Verifying payment status for: ${merchantTransactionId}`);
      
      const payload = {
        merchantId: this.config.merchantId,
        merchantTransactionId: merchantTransactionId,
        merchantUserId: 'EPICKUP_USER'
      };
      
      const payloadString = JSON.stringify(payload);
      const checksum = this.generateChecksum(payloadString);
      
      const response = await axios.get(
        `${phonepeConfig.getBaseUrl()}/pg/v1/status/${this.config.merchantId}/${merchantTransactionId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': `${checksum}###${this.config.saltIndex}`,
            'X-MERCHANT-ID': this.config.merchantId
          }
        }
      );
      
      if (response.data.success) {
        const decodedResponse = JSON.parse(Buffer.from(response.data.data, 'base64').toString());
        return {
          success: true,
          data: decodedResponse
        };
      } else {
        return {
          success: false,
          error: 'Payment verification failed'
        };
      }
    } catch (error) {
      console.error('Payment verification error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Process wallet top-up payment
   * @param {string} transactionId - Transaction ID
   * @param {number} amount - Amount in paise
   */
  // eslint-disable-next-line no-unused-vars
  async processWalletTopupPayment(transactionId, amount) {
    // Note: amount parameter is kept for future validation logic
    try {
      console.log(`💰 Processing wallet top-up payment: ${transactionId}`);
      
      // Find wallet transaction record in driverTopUps collection
      const walletTransactionsSnapshot = await this.db.collection('driverTopUps')
        .where('phonepeTransactionId', '==', transactionId)
        .limit(1)
        .get();

      if (walletTransactionsSnapshot.empty) {
        console.error(`❌ Wallet transaction not found for PhonePe transaction: ${transactionId}`);
        return;
      }

      const walletTransactionDoc = walletTransactionsSnapshot.docs[0];
      const walletTransactionData = walletTransactionDoc.data();
      const driverId = walletTransactionData.driverId;

      // Update wallet transaction status
      await walletTransactionDoc.ref.update({
        status: 'completed',
        phonepePaymentId: transactionId,
        completedAt: new Date(),
        updatedAt: new Date()
      });

      // Convert real money to points using points service
      const pointsService = require('./walletService');
      const pointsResult = await pointsService.addPoints(
        driverId,
        walletTransactionData.amount,
        walletTransactionData.paymentMethod || 'phonepe',
        {
          transactionId,
          phonepeTransactionId: transactionId,
          originalTransaction: walletTransactionData
        }
      );

      if (pointsResult.success) {
        // Update wallet transaction with points data
        await walletTransactionDoc.ref.update({
          pointsAwarded: pointsResult.data.pointsAdded,
          newPointsBalance: pointsResult.data.newBalance,
          updatedAt: new Date()
        });

        console.log(`✅ Points top-up completed for driver ${driverId}: +${pointsResult.data.pointsAdded} points for ₹${walletTransactionData.amount}`);

        // Send notification to driver
        await this.sendWalletTopupNotification(driverId, walletTransactionData.amount, pointsResult.data.newBalance);
      } else {
        console.error(`❌ Failed to convert top-up to points: ${pointsResult.error}`);
      }

    } catch (error) {
      console.error('Error processing wallet top-up payment:', error);
    }
  }

  /**
   * Update wallet transaction status
   * @param {string} transactionId - Transaction ID
   * @param {string} status - New status
   */
  async updateWalletTransactionStatus(transactionId, status) {
    try {
      console.log(`📝 Updating wallet transaction status: ${transactionId} -> ${status}`);
      
      const walletTransactionSnapshot = await this.db.collection('driverTopUps')
        .where('phonepeTransactionId', '==', transactionId)
        .limit(1)
        .get();

      if (!walletTransactionSnapshot.empty) {
        const walletTransactionDoc = walletTransactionSnapshot.docs[0];
        await walletTransactionDoc.ref.update({
          status: status,
          updatedAt: new Date()
        });
        console.log(`✅ Wallet transaction status updated: ${transactionId} -> ${status}`);
      } else {
        console.error(`❌ Wallet transaction not found for status update: ${transactionId}`);
      }
    } catch (error) {
      console.error('Error updating wallet transaction status:', error);
    }
  }

  /**
   * Send wallet top-up notification to driver
   * @param {string} driverId - Driver ID
   * @param {number} amount - Amount added
   * @param {number} newBalance - New wallet balance
   */
  async sendWalletTopupNotification(driverId, amount, newBalance) {
    try {
      const notificationService = require('./notificationService');
      
      await notificationService.sendToUser(driverId, {
        type: 'wallet_topup_success',
        title: 'Wallet Top-up Successful!',
        body: `₹${amount} has been added to your wallet. New balance: ₹${newBalance}`,
        data: {
          amount: amount,
          newBalance: newBalance,
          type: 'wallet_topup_success'
        }
      });
      
      console.log(`✅ Sent wallet top-up notification to driver ${driverId}`);
    } catch (error) {
      console.error('Error sending wallet top-up notification:', error);
    }
  }

  /**
   * Get payment statistics
   * @param {string} startDate - Start date
   * @param {string} endDate - End date
   * @returns {Object} Payment statistics
   */
  async getPaymentStatistics(startDate, endDate) {
    try {
      const start = new Date(startDate);
      const end = new Date(endDate);

      const snapshot = await this.db.collection('payments')
        .where('createdAt', '>=', start)
        .where('createdAt', '<=', end)
        .get();

      const payments = snapshot.docs.map(doc => doc.data());
      
      const stats = {
        totalPayments: payments.length,
        totalAmount: payments.reduce((sum, payment) => sum + payment.amount, 0),
        successfulPayments: payments.filter(p => p.status === 'COMPLETED').length,
        failedPayments: payments.filter(p => p.status === 'FAILED').length,
        pendingPayments: payments.filter(p => p.status === 'PENDING').length,
        averageAmount: payments.length > 0 ? payments.reduce((sum, payment) => sum + payment.amount, 0) / payments.length : 0
      };

      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error('Get payment statistics error:', error);
      return {
        success: false,
        error: {
          code: 'STATISTICS_ERROR',
          message: 'Failed to get payment statistics',
          details: error.message
        }
      };
    }
  }
}

module.exports = new PhonePeService();
