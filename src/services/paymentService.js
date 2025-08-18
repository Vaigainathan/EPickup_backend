const { getFirestore } = require('./firebase');
const axios = require('axios');
const crypto = require('crypto');

/**
 * Payment Service for EPickup delivery platform
 * Handles PhonePe integration, wallet operations, and payment processing
 */
class PaymentService {
  constructor() {
    this.phonepeConfig = {
      merchantId: process.env.PHONEPE_MERCHANT_ID,
      saltKey: process.env.PHONEPE_SALT_KEY,
      saltIndex: process.env.PHONEPE_SALT_INDEX,
      baseUrl: process.env.PHONEPE_BASE_URL || 'https://api.phonepe.com/apis/pg-sandbox',
      redirectUrl: process.env.PHONEPE_REDIRECT_URL || 'https://epickup-app.web.app/payment/callback'
    };
    
    // Commission rates
    this.commissionRates = {
      platformFee: 0.15, // 15% platform fee
      driverPayout: 0.85, // 85% goes to driver
      taxRate: 0.18 // 18% GST
    };
  }

  get db() {
    return getFirestore();
  }

  /**
   * Initialize PhonePe payment
   * @param {Object} paymentData - Payment information
   * @returns {Object} Payment initialization response
   */
  async initiatePhonePePayment(paymentData) {
    try {
      const {
        bookingId,
        customerId,
        amount,
        customerPhone,
        customerEmail,
        customerName,
        redirectUrl = null
      } = paymentData;

      // Validate payment data
      const validation = this.validatePaymentData(paymentData);
      if (!validation.isValid) {
        throw new Error(`Payment validation failed: ${validation.errors.join(', ')}`);
      }

      // Generate unique transaction ID
      const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create payment payload for PhonePe
      const payload = {
        merchantId: this.phonepeConfig.merchantId,
        merchantTransactionId: transactionId,
        amount: Math.round(amount * 100), // Convert to paise
        redirectUrl: redirectUrl || this.phonepeConfig.redirectUrl,
        redirectMode: 'POST',
        callbackUrl: `${process.env.BACKEND_URL}/api/payments/phonepe/callback`,
        merchantUserId: customerId,
        mobileNumber: customerPhone,
        paymentInstrument: {
          type: 'PAY_PAGE'
        }
      };

      // Generate checksum
      const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
      const checksum = this.generatePhonePeChecksum(base64Payload);

      // Make API call to PhonePe
      const response = await axios.post(
        `${this.phonepeConfig.baseUrl}/pg/v1/pay`,
        {
          request: base64Payload
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': checksum
          }
        }
      );

      if (response.data.success) {
        // Store payment record in database
        const paymentRecord = {
          id: transactionId,
          bookingId,
          customerId,
          amount,
          currency: 'INR',
          paymentMethod: 'phonepe',
          status: 'initiated',
          phonepeResponse: response.data,
          redirectUrl: response.data.data.instrumentResponse.redirectInfo.url,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await this.createPaymentRecord(paymentRecord);

        return {
          success: true,
          message: 'Payment initiated successfully',
          data: {
            transactionId,
            redirectUrl: response.data.data.instrumentResponse.redirectInfo.url,
            paymentUrl: response.data.data.instrumentResponse.redirectInfo.url
          }
        };
      } else {
        throw new Error('PhonePe payment initiation failed');
      }

    } catch (error) {
      console.error('Payment initiation error:', error);
      return {
        success: false,
        error: {
          code: 'PAYMENT_INITIATION_FAILED',
          message: error.message
        }
      };
    }
  }

  /**
   * Verify PhonePe payment
   * @param {string} transactionId - Transaction ID to verify
   * @returns {Object} Payment verification result
   */
  async verifyPhonePePayment(transactionId) {
    try {
      // Get payment record
      const paymentRecord = await this.getPaymentRecord(transactionId);
      if (!paymentRecord) {
        throw new Error('Payment record not found');
      }

      // Verify with PhonePe API
      const checksum = this.generatePhonePeChecksum(transactionId);
      const response = await axios.get(
        `${this.phonepeConfig.baseUrl}/pg/v1/status/${this.phonepeConfig.merchantId}/${transactionId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': checksum,
            'X-MERCHANT-ID': this.phonepeConfig.merchantId
          }
        }
      );

      if (response.data.success) {
        const phonepeData = response.data.data;
        const paymentStatus = this.mapPhonePeStatus(phonepeData.paymentInstrument.paymentTransaction.status);

        // Update payment record
        const updatedRecord = {
          ...paymentRecord,
          status: paymentStatus,
          phonepeVerification: phonepeData,
          verifiedAt: new Date(),
          updatedAt: new Date()
        };

        await this.updatePaymentRecord(transactionId, updatedRecord);

        // If payment successful, process wallet credit and driver payout
        if (paymentStatus === 'completed') {
          await this.processSuccessfulPayment(paymentRecord);
        }

        return {
          success: true,
          message: 'Payment verified successfully',
          data: {
            transactionId,
            status: paymentStatus,
            amount: paymentRecord.amount,
            phonepeData
          }
        };
      } else {
        throw new Error('PhonePe verification failed');
      }

    } catch (error) {
      console.error('Payment verification error:', error);
      return {
        success: false,
        error: {
          code: 'PAYMENT_VERIFICATION_FAILED',
          message: error.message
        }
      };
    }
  }

  /**
   * Process PhonePe webhook callback
   * @param {Object} webhookData - Webhook data from PhonePe
   * @returns {Object} Webhook processing result
   */
  async processPhonePeWebhook(webhookData) {
    try {
      const { merchantTransactionId, transactionId, amount, status } = webhookData;

      // Verify webhook authenticity
      if (!this.verifyWebhookSignature(webhookData)) {
        throw new Error('Invalid webhook signature');
      }

      // Get payment record
      const paymentRecord = await this.getPaymentRecord(merchantTransactionId);
      if (!paymentRecord) {
        throw new Error('Payment record not found');
      }

      // Update payment status
      const paymentStatus = this.mapPhonePeStatus(status);
      await this.updatePaymentRecord(merchantTransactionId, {
        status: paymentStatus,
        phonepeWebhook: webhookData,
        webhookReceivedAt: new Date(),
        updatedAt: new Date()
      });

      // Process successful payment
      if (paymentStatus === 'completed') {
        await this.processSuccessfulPayment(paymentRecord);
      }

      return {
        success: true,
        message: 'Webhook processed successfully',
        data: {
          transactionId: merchantTransactionId,
          status: paymentStatus
        }
      };

    } catch (error) {
      console.error('Webhook processing error:', error);
      return {
        success: false,
        error: {
          code: 'WEBHOOK_PROCESSING_FAILED',
          message: error.message
        }
      };
    }
  }

  /**
   * Process successful payment
   * @param {Object} paymentRecord - Payment record
   */
  async processSuccessfulPayment(paymentRecord) {
    try {
      const { bookingId, customerId, amount } = paymentRecord;

      // Get booking details
      const bookingRef = this.db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();
      
      if (!bookingDoc.exists) {
        throw new Error('Booking not found');
      }

      const bookingData = bookingDoc.data();

      // Calculate commission and driver payout
      const commission = amount * this.commissionRates.platformFee;
      const driverPayout = amount * this.commissionRates.driverPayout;
      const tax = amount * this.commissionRates.taxRate;

      // Update payment record with commission details
      await this.updatePaymentRecord(paymentRecord.id, {
        commission: {
          platformFee: commission,
          driverPayout: driverPayout,
          tax: tax,
          netAmount: amount - commission - tax
        },
        processedAt: new Date()
      });

      // Credit customer wallet
      await this.creditWallet(customerId, amount, `Payment for booking ${bookingId}`);

      // Update booking status
      await this.db.collection('bookings').doc(bookingId).update({
        'payment.status': 'completed',
        'payment.transactionId': paymentRecord.id,
        'payment.completedAt': new Date(),
        updatedAt: new Date()
      });

      // Create driver payout record
      if (bookingData.driverId) {
        await this.createDriverPayout(bookingData.driverId, driverPayout, bookingId);
      }

      console.log(`Payment processed successfully for booking ${bookingId}`);

    } catch (error) {
      console.error('Payment processing error:', error);
      throw error;
    }
  }

  /**
   * Credit customer wallet
   * @param {string} customerId - Customer ID
   * @param {number} amount - Amount to credit
   * @param {string} description - Transaction description
   * @returns {Object} Wallet credit result
   */
  async creditWallet(customerId, amount, description) {
    try {
      const walletRef = this.db.collection('wallets').doc(customerId);
      
      // Get current wallet balance
      const walletDoc = await walletRef.get();
      let currentBalance = 0;
      
      if (walletDoc.exists) {
        currentBalance = walletDoc.data().balance || 0;
      }

      const newBalance = currentBalance + amount;

      // Update wallet balance
      await walletRef.set({
        customerId,
        balance: newBalance,
        updatedAt: new Date()
      }, { merge: true });

      // Create wallet transaction record
      const transactionRef = this.db.collection('walletTransactions').doc();
      await transactionRef.set({
        id: transactionRef.id,
        walletId: customerId,
        type: 'credit',
        amount: amount,
        previousBalance: currentBalance,
        newBalance: newBalance,
        description: description,
        status: 'completed',
        createdAt: new Date()
      });

      return {
        success: true,
        message: 'Wallet credited successfully',
        data: {
          previousBalance: currentBalance,
          newBalance: newBalance,
          amount: amount
        }
      };

    } catch (error) {
      console.error('Wallet credit error:', error);
      throw error;
    }
  }

  /**
   * Debit customer wallet
   * @param {string} customerId - Customer ID
   * @param {number} amount - Amount to debit
   * @param {string} description - Transaction description
   * @returns {Object} Wallet debit result
   */
  async debitWallet(customerId, amount, description) {
    try {
      const walletRef = this.db.collection('wallets').doc(customerId);
      
      // Get current wallet balance
      const walletDoc = await walletRef.get();
      if (!walletDoc.exists) {
        throw new Error('Wallet not found');
      }

      const currentBalance = walletDoc.data().balance || 0;
      
      if (currentBalance < amount) {
        throw new Error('Insufficient wallet balance');
      }

      const newBalance = currentBalance - amount;

      // Update wallet balance
      await walletRef.update({
        balance: newBalance,
        updatedAt: new Date()
      });

      // Create wallet transaction record
      const transactionRef = this.db.collection('walletTransactions').doc();
      await transactionRef.set({
        id: transactionRef.id,
        walletId: customerId,
        type: 'debit',
        amount: amount,
        previousBalance: currentBalance,
        newBalance: newBalance,
        description: description,
        status: 'completed',
        createdAt: new Date()
      });

      return {
        success: true,
        message: 'Wallet debited successfully',
        data: {
          previousBalance: currentBalance,
          newBalance: newBalance,
          amount: amount
        }
      };

    } catch (error) {
      console.error('Wallet debit error:', error);
      throw error;
    }
  }

  /**
   * Get wallet balance
   * @param {string} customerId - Customer ID
   * @returns {Object} Wallet balance information
   */
  async getWalletBalance(customerId) {
    try {
      const walletRef = this.db.collection('wallets').doc(customerId);
      const walletDoc = await walletRef.get();
      
      if (!walletDoc.exists) {
        return {
          success: true,
          data: {
            balance: 0,
            currency: 'INR',
            lastUpdated: null
          }
        };
      }

      const walletData = walletDoc.data();
      return {
        success: true,
        data: {
          balance: walletData.balance || 0,
          currency: 'INR',
          lastUpdated: walletData.updatedAt
        }
      };

    } catch (error) {
      console.error('Get wallet balance error:', error);
      return {
        success: false,
        error: {
          code: 'WALLET_BALANCE_ERROR',
          message: error.message
        }
      };
    }
  }

  /**
   * Get wallet transaction history
   * @param {string} customerId - Customer ID
   * @param {Object} filters - Filter options
   * @returns {Object} Transaction history
   */
  async getWalletTransactions(customerId, filters = {}) {
    try {
      let query = this.db.collection('walletTransactions')
        .where('walletId', '==', customerId)
        .orderBy('createdAt', 'desc');

      // Apply filters
      if (filters.type) {
        query = query.where('type', '==', filters.type);
      }

      if (filters.startDate) {
        query = query.where('createdAt', '>=', filters.startDate);
      }

      if (filters.endDate) {
        query = query.where('createdAt', '<=', filters.endDate);
      }

      const snapshot = await query.limit(filters.limit || 50).get();
      const transactions = [];

      snapshot.forEach(doc => {
        transactions.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return {
        success: true,
        data: {
          transactions,
          total: transactions.length
        }
      };

    } catch (error) {
      console.error('Get wallet transactions error:', error);
      return {
        success: false,
        error: {
          code: 'WALLET_TRANSACTIONS_ERROR',
          message: error.message
        }
      };
    }
  }

  /**
   * Process refund
   * @param {string} paymentId - Payment ID to refund
   * @param {number} amount - Refund amount
   * @param {string} reason - Refund reason
   * @returns {Object} Refund processing result
   */
  async processRefund(paymentId, amount, reason) {
    try {
      // Get payment record
      const paymentRecord = await this.getPaymentRecord(paymentId);
      if (!paymentRecord) {
        throw new Error('Payment record not found');
      }

      if (paymentRecord.status !== 'completed') {
        throw new Error('Payment must be completed to process refund');
      }

      if (amount > paymentRecord.amount) {
        throw new Error('Refund amount cannot exceed payment amount');
      }

      // Process PhonePe refund
      const refundPayload = {
        merchantId: this.phonepeConfig.merchantId,
        merchantTransactionId: paymentId,
        merchantUserId: paymentRecord.customerId,
        originalTransactionId: paymentId,
        amount: Math.round(amount * 100), // Convert to paise
        callbackUrl: `${process.env.BACKEND_URL}/api/payments/phonepe/refund-callback`
      };

      const base64Payload = Buffer.from(JSON.stringify(refundPayload)).toString('base64');
      const checksum = this.generatePhonePeChecksum(base64Payload);

      const response = await axios.post(
        `${this.phonepeConfig.baseUrl}/pg/v1/refund`,
        {
          request: base64Payload
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-VERIFY': checksum
          }
        }
      );

      if (response.data.success) {
        // Create refund record
        const refundRef = this.db.collection('refunds').doc();
        await refundRef.set({
          id: refundRef.id,
          paymentId: paymentId,
          customerId: paymentRecord.customerId,
          amount: amount,
          reason: reason,
          status: 'initiated',
          phonepeRefundId: response.data.data.refundId,
          createdAt: new Date()
        });

        // Debit customer wallet
        await this.debitWallet(paymentRecord.customerId, amount, `Refund for payment ${paymentId}`);

        return {
          success: true,
          message: 'Refund initiated successfully',
          data: {
            refundId: refundRef.id,
            amount: amount,
            status: 'initiated'
          }
        };
      } else {
        throw new Error('PhonePe refund failed');
      }

    } catch (error) {
      console.error('Refund processing error:', error);
      return {
        success: false,
        error: {
          code: 'REFUND_PROCESSING_FAILED',
          message: error.message
        }
      };
    }
  }

  /**
   * Create driver payout record
   * @param {string} driverId - Driver ID
   * @param {number} amount - Payout amount
   * @param {string} bookingId - Associated booking ID
   */
  async createDriverPayout(driverId, amount, bookingId) {
    try {
      const payoutRef = this.db.collection('driverPayouts').doc();
      await payoutRef.set({
        id: payoutRef.id,
        driverId: driverId,
        bookingId: bookingId,
        amount: amount,
        status: 'pending',
        type: 'delivery_payout',
        createdAt: new Date(),
        processedAt: null
      });

      console.log(`Driver payout record created for driver ${driverId}`);
    } catch (error) {
      console.error('Create driver payout error:', error);
      throw error;
    }
  }

  /**
   * Get payment statistics
   * @param {Object} filters - Filter options
   * @returns {Object} Payment statistics
   */
  async getPaymentStatistics(filters = {}) {
    try {
      let query = this.db.collection('payments');

      if (filters.startDate) {
        query = query.where('createdAt', '>=', filters.startDate);
      }

      if (filters.endDate) {
        query = query.where('createdAt', '<=', filters.endDate);
      }

      if (filters.status) {
        query = query.where('status', '==', filters.status);
      }

      const snapshot = await query.get();
      let totalAmount = 0;
      let totalTransactions = 0;
      let successfulTransactions = 0;
      let failedTransactions = 0;

      snapshot.forEach(doc => {
        const payment = doc.data();
        totalTransactions++;
        totalAmount += payment.amount || 0;
        
        if (payment.status === 'completed') {
          successfulTransactions++;
        } else if (payment.status === 'failed') {
          failedTransactions++;
        }
      });

      return {
        success: true,
        data: {
          totalAmount: Math.round(totalAmount * 100) / 100,
          totalTransactions,
          successfulTransactions,
          failedTransactions,
          successRate: totalTransactions > 0 ? (successfulTransactions / totalTransactions) * 100 : 0
        }
      };

    } catch (error) {
      console.error('Get payment statistics error:', error);
      return {
        success: false,
        error: {
          code: 'PAYMENT_STATISTICS_ERROR',
          message: error.message
        }
      };
    }
  }

  // Helper methods

  /**
   * Validate payment data
   * @param {Object} paymentData - Payment data to validate
   * @returns {Object} Validation result
   */
  validatePaymentData(paymentData) {
    const errors = [];
    const { bookingId, customerId, amount, customerPhone } = paymentData;

    if (!bookingId) errors.push('Booking ID is required');
    if (!customerId) errors.push('Customer ID is required');
    if (!amount || amount <= 0) errors.push('Valid amount is required');
    if (!customerPhone) errors.push('Customer phone is required');

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Generate PhonePe checksum
   * @param {string} payload - Payload to generate checksum for
   * @returns {string} Generated checksum
   */
  generatePhonePeChecksum(payload) {
    const string = payload + '/pg/v1/pay' + this.phonepeConfig.saltKey;
    const sha256 = crypto.createHash('sha256').update(string).digest('hex');
    return sha256 + '###' + this.phonepeConfig.saltIndex;
  }

  /**
   * Map PhonePe status to internal status
   * @param {string} phonepeStatus - PhonePe status
   * @returns {string} Internal status
   */
  mapPhonePeStatus(phonepeStatus) {
    const statusMap = {
      'PAYMENT_SUCCESS': 'completed',
      'PAYMENT_ERROR': 'failed',
      'PAYMENT_PENDING': 'pending',
      'PAYMENT_DECLINED': 'failed',
      'PAYMENT_CANCELLED': 'cancelled'
    };

    return statusMap[phonepeStatus] || 'unknown';
  }

  /**
   * Verify webhook signature
   * @param {Object} webhookData - Webhook data
   * @returns {boolean} Signature verification result
   */
  verifyWebhookSignature(webhookData) {
    // Implement webhook signature verification logic
    // This is a placeholder - implement based on PhonePe's webhook security requirements
    return true;
  }

  /**
   * Create payment record in database
   * @param {Object} paymentRecord - Payment record to create
   */
  async createPaymentRecord(paymentRecord) {
    try {
      await this.db.collection('payments').doc(paymentRecord.id).set(paymentRecord);
    } catch (error) {
      console.error('Create payment record error:', error);
      throw error;
    }
  }

  /**
   * Get payment record from database
   * @param {string} transactionId - Transaction ID
   * @returns {Object|null} Payment record
   */
  async getPaymentRecord(transactionId) {
    try {
      const doc = await this.db.collection('payments').doc(transactionId).get();
      return doc.exists ? doc.data() : null;
    } catch (error) {
      console.error('Get payment record error:', error);
      throw error;
    }
  }

  /**
   * Update payment record in database
   * @param {string} transactionId - Transaction ID
   * @param {Object} updateData - Data to update
   */
  async updatePaymentRecord(transactionId, updateData) {
    try {
      await this.db.collection('payments').doc(transactionId).update(updateData);
    } catch (error) {
      console.error('Update payment record error:', error);
      throw error;
    }
  }
}

module.exports = new PaymentService();
