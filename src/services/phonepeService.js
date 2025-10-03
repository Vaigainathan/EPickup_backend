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
            paymentUrl: response.data.data.instrumentResponse.redirectInfo.url,
            merchantId: this.config.merchantId,
            amount: amountInPaise
          }
        };
      } else {
        throw new Error(response.data.message || 'Payment creation failed');
      }
    }, {
      context: 'Create PhonePe payment',
      maxRetries: 2
    });
  }

  /**
   * Verify payment status
   * @param {string} transactionId - Transaction ID
   * @returns {Object} Payment verification result
   */
  async verifyPayment(transactionId) {
    return errorHandlingService.executeWithRetry(async () => {
      const payload = {
        merchantId: this.config.merchantId,
        merchantTransactionId: transactionId
      };

      const payloadString = JSON.stringify(payload);
      const checksum = this.generateChecksum(payloadString);

      const response = await axios.get(
        `${phonepeConfig.getBaseUrl()}/pg/v1/status/${phonepeConfig.getMerchantId()}/${transactionId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': `${checksum}###${this.config.saltIndex}`,
            'accept': 'application/json'
          }
        }
      );

      if (response.data.success) {
        const paymentData = response.data.data;
        
        // Update payment record in Firestore
        await this.updatePaymentStatus(transactionId, {
          status: paymentData.state,
          paymentId: paymentData.paymentId,
          responseCode: paymentData.responseCode,
          responseMessage: paymentData.responseMessage,
          updatedAt: new Date()
        });

        return {
          success: true,
          data: {
            transactionId,
            status: paymentData.state,
            paymentId: paymentData.paymentId,
            responseCode: paymentData.responseCode,
            responseMessage: paymentData.responseMessage
          }
        };
      } else {
        throw new Error(response.data.message || 'Payment verification failed');
      }
    }, {
      context: 'Verify PhonePe payment',
      maxRetries: 2
    });
  }

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

      // Update booking status based on payment status
      if (state === 'COMPLETED') {
        await this.updateBookingPaymentStatus(merchantTransactionId, 'PAID');
        
        // Check if this is a wallet top-up payment
        if (merchantTransactionId.startsWith('WALLET_')) {
          await this.processWalletTopupPayment(merchantTransactionId, amount);
        }
      } else if (state === 'FAILED') {
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
   * Process wallet top-up payment
   * @param {string} transactionId - Transaction ID
   * @param {number} amount - Amount in paise
   */
  async processWalletTopupPayment(transactionId, amount) {
    try {
      console.log(`💰 Processing wallet top-up payment: ${transactionId}`);
      
      // Find wallet transaction record
      const walletTransactionsSnapshot = await this.db.collection('driverWalletTransactions')
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

      // Update driver wallet balance
      const userRef = this.db.collection('users').doc(driverId);
      const userDoc = await userRef.get();
      
      if (userDoc.exists) {
        const userData = userDoc.data();
        const currentBalance = userData.driver?.wallet?.balance || 0;
        const newBalance = currentBalance + walletTransactionData.amount;

        await userRef.update({
          'driver.wallet.balance': newBalance,
          'driver.wallet.lastUpdated': new Date(),
          updatedAt: new Date()
        });

        // Update wallet transaction with final balance
        await walletTransactionDoc.ref.update({
          newBalance: newBalance,
          updatedAt: new Date()
        });

        console.log(`✅ Wallet top-up completed for driver ${driverId}: +${walletTransactionData.amount} INR (New balance: ${newBalance} INR)`);

        // Send notification to driver
        await this.sendWalletTopupNotification(driverId, walletTransactionData.amount, newBalance);
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
      const walletTransactionsSnapshot = await this.db.collection('driverWalletTransactions')
        .where('phonepeTransactionId', '==', transactionId)
        .limit(1)
        .get();

      if (!walletTransactionsSnapshot.empty) {
        const walletTransactionDoc = walletTransactionsSnapshot.docs[0];
        await walletTransactionDoc.ref.update({
          status: status,
          updatedAt: new Date()
        });

        console.log(`✅ Updated wallet transaction ${transactionId} status to ${status}`);
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
