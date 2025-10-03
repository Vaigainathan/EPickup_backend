const { getFirestore } = require('./firebase');
const axios = require('axios');
const crypto = require('crypto');
const phonepeConfig = require('./phonepeConfigService');

/**
 * Payment Service for EPickup delivery platform
 * Handles PhonePe integration and payment processing
 */
class PaymentService {
  constructor() {
    // Use centralized PhonePe configuration
    this.phonepeConfig = phonepeConfig.getConfig();
    
    console.log('🔧 Payment Service initialized with PhonePe config:', {
      merchantId: this.phonepeConfig.merchantId,
      baseUrl: this.phonepeConfig.baseUrl,
      saltIndex: this.phonepeConfig.saltIndex
    });
    
    // Commission rates
    this.commissionRates = {
      platformFee: 0.15, // 15% platform fee
      driverPayout: 0.85, // 85% goes to driver
      taxRate: 0.18 // 18% GST
    };

    // Supported payment methods
    this.supportedPaymentMethods = {
      cash: {
        name: 'Cash on Delivery',
        code: 'cash',
        description: 'Pay in cash to the driver',
        requiresPrePayment: false,
        supported: true
      },
      upi: {
        name: 'UPI Payment',
        code: 'upi',
        description: 'Pay using UPI apps (PhonePe, Google Pay, etc.)',
        requiresPrePayment: true,
        supported: true,
        gateway: 'phonepe'
      },
    };
  }

  get db() {
    return getFirestore();
  }

  /**
   * Get supported payment methods
   * @returns {Object} Supported payment methods
   */
  getSupportedPaymentMethods() {
    return this.supportedPaymentMethods;
  }

  /**
   * Validate payment method
   * @param {string} paymentMethod - Payment method code
   * @returns {Object} Validation result
   */
  validatePaymentMethod(paymentMethod) {
    const method = this.supportedPaymentMethods[paymentMethod];
    if (!method) {
      return {
        isValid: false,
        error: 'Unsupported payment method'
      };
    }
    
    if (!method.supported) {
      return {
        isValid: false,
        error: method.reason || 'Payment method not available'
      };
    }

    return {
      isValid: true,
      method
    };
  }

  /**
   * Process payment based on method
   * @param {Object} paymentData - Payment information
   * @returns {Object} Payment processing result
   */
  async processPayment(paymentData) {
    try {
      const { paymentMethod, ...data } = paymentData;
      
      // Validate payment method
      const validation = this.validatePaymentMethod(paymentMethod);
      if (!validation.isValid) {
        throw new Error(validation.error);
      }

      // Process based on payment method
      switch (paymentMethod) {
        case 'cash':
          return await this.processCashPayment(data);
        case 'upi':
          return await this.processUPIPayment(data);
        default:
          throw new Error('Unsupported payment method');
      }
    } catch (error) {
      console.error('Payment processing error:', error);
      return {
        success: false,
        error: {
          code: 'PAYMENT_PROCESSING_ERROR',
          message: 'Failed to process payment',
          details: error.message
        }
      };
    }
  }

  /**
   * Process cash on delivery payment
   * @param {Object} paymentData - Payment data
   * @returns {Object} Payment result
   */
  async processCashPayment(paymentData) {
    try {
      const { bookingId, customerId, amount } = paymentData;

      // Create payment record
      const paymentRecord = {
        id: `CASH_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        bookingId,
        customerId,
        amount,
        currency: 'INR',
        paymentMethod: 'cash',
        status: 'pending',
        paymentDetails: {
          type: 'cash_on_delivery',
          collectedBy: 'driver',
          collectedAt: null
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Save payment record
      await this.createPaymentRecord(paymentRecord);

      return {
        success: true,
        message: 'Cash payment setup successfully',
        data: {
          paymentId: paymentRecord.id,
          status: 'pending',
          paymentMethod: 'cash',
          amount,
          currency: 'INR',
          instructions: 'Pay the amount to the driver upon delivery'
        }
      };
    } catch (error) {
      throw new Error(`Cash payment processing failed: ${error.message}`);
    }
  }

  /**
   * Process UPI payment using PhonePe
   * @param {Object} paymentData - Payment data
   * @returns {Object} Payment result
   */
  async processUPIPayment(paymentData) {
    try {
      const {
        bookingId,
        customerId,
        amount,
        customerPhone,
        redirectUrl = null
      } = paymentData;

      // Validate payment data
      const validation = this.validatePaymentData(paymentData);
      if (!validation.isValid) {
        throw new Error(`Payment validation failed: ${validation.errors.join(', ')}`);
      }

      // Generate unique transaction ID
      const transactionId = `UPI_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create payment payload for PhonePe
      const payload = {
        merchantId: this.phonepeConfig.merchantId,
        merchantTransactionId: transactionId,
        amount: Math.round(amount * 100), // Convert to paise
        redirectUrl: redirectUrl || phonepeConfig.getRedirectUrl(),
        redirectMode: 'POST',
        callbackUrl: phonepeConfig.getCallbackUrl(),
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
        `${phonepeConfig.getBaseUrl()}/pg/v1/pay`,
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
          paymentMethod: 'upi',
          status: 'initiated',
          paymentDetails: {
            type: 'upi',
            gateway: 'phonepe',
            phonepeResponse: response.data,
            paymentUrl: response.data.data.instrumentResponse.redirectInfo.url
          },
          createdAt: new Date(),
          updatedAt: new Date()
        };

        await this.createPaymentRecord(paymentRecord);

        return {
          success: true,
          message: 'UPI payment initiated successfully',
          data: {
            paymentId: transactionId,
            status: 'initiated',
            paymentMethod: 'upi',
            amount,
            currency: 'INR',
            paymentUrl: response.data.data.instrumentResponse.redirectInfo.url,
            transactionId
          }
        };
      } else {
        throw new Error('PhonePe payment initiation failed');
      }
    } catch (error) {
      throw new Error(`UPI payment processing failed: ${error.message}`);
    }
  }

  /**
   * Complete cash payment (called by driver)
   * @param {string} paymentId - Payment ID
   * @param {string} driverId - Driver ID
   * @returns {Object} Payment completion result
   */
  async completeCashPayment(paymentId, driverId) {
    try {
      const paymentRecord = await this.getPaymentRecord(paymentId);
      if (!paymentRecord) {
        throw new Error('Payment record not found');
      }

      if (paymentRecord.status !== 'pending') {
        throw new Error('Payment is not in pending status');
      }

      if (paymentRecord.paymentMethod !== 'cash') {
        throw new Error('Payment is not a cash payment');
      }

      // Update payment record
      const updatedPayment = {
        ...paymentRecord,
        status: 'completed',
        paymentDetails: {
          ...paymentRecord.paymentDetails,
          collectedBy: driverId,
          collectedAt: new Date()
        },
        completedAt: new Date(),
        updatedAt: new Date()
      };

      await this.updatePaymentRecord(paymentId, updatedPayment);

      return {
        success: true,
        message: 'Cash payment completed successfully',
        data: {
          paymentId,
          status: 'completed',
          amount: paymentRecord.amount,
          collectedBy: driverId,
          collectedAt: new Date()
        }
      };
    } catch (error) {
      throw new Error(`Cash payment completion failed: ${error.message}`);
    }
  }

  /**
   * Get payment methods for booking
   * @param {string} customerId - Customer ID
   * @param {number} amount - Payment amount
   * @returns {Object} Available payment methods
   */
  async getPaymentMethodsForBooking(customerId, amount) {
    try {
      const availableMethods = { ...this.supportedPaymentMethods };

      return {
        success: true,
        data: {
          paymentMethods: availableMethods,
          amount
        }
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'PAYMENT_METHODS_ERROR',
          message: 'Failed to get payment methods',
          details: error.message
        }
      };
    }
  }

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
   * @param {string} payload - Base64 encoded payload
   * @returns {string} Checksum
   */
  generatePhonePeChecksum(payload) {
    const string = payload + '/pg/v1/pay' + phonepeConfig.getSaltKey();
    const sha256 = crypto.createHash('sha256').update(string).digest('hex');
    return sha256 + '###' + phonepeConfig.getSaltIndex();
  }

  /**
   * Verify PhonePe webhook signature
   * @param {Object} webhookData - Webhook data
   * @returns {boolean} Signature validity
   */
  verifyWebhookSignature(webhookData) {
    try {
      const { merchantTransactionId } = webhookData;
      const string = `/pg/v1/status/${phonepeConfig.getMerchantId()}/${merchantTransactionId}` + phonepeConfig.getSaltKey();
      const sha256 = crypto.createHash('sha256').update(string).digest('hex');
      const checksum = sha256 + '###' + phonepeConfig.getSaltIndex();
      
      return checksum === webhookData.checksum;
    } catch (error) {
      console.error('Webhook signature verification error:', error);
      return false;
    }
  }

  /**
   * Process PhonePe webhook
   * @param {Object} webhookData - Webhook data
   * @returns {Object} Processing result
   */
  async processPhonePeWebhook(webhookData) {
    try {
      const { merchantTransactionId, status } = webhookData;
      
      // Get payment record
      const paymentRecord = await this.getPaymentRecord(merchantTransactionId);
      if (!paymentRecord) {
        throw new Error('Payment record not found');
      }

      // Update payment status
      const updatedPayment = {
        ...paymentRecord,
        status: this.mapPhonePeStatus(status),
        paymentDetails: {
          ...paymentRecord.paymentDetails,
          phonepeWebhook: webhookData,
          processedAt: new Date()
        },
        updatedAt: new Date()
      };

      if (status === 'PAYMENT_SUCCESS') {
        updatedPayment.completedAt = new Date();
        
        // Update booking payment status if booking exists
        await this.updateBookingPaymentStatus(paymentRecord.bookingId, 'completed', merchantTransactionId);
        
        // Send payment success notification
        await this.sendPaymentSuccessNotification(paymentRecord.customerId, paymentRecord.bookingId, merchantTransactionId);
      } else if (status === 'PAYMENT_ERROR' || status === 'PAYMENT_CANCELLED') {
        // Update booking payment status to failed
        await this.updateBookingPaymentStatus(paymentRecord.bookingId, 'failed', merchantTransactionId);
      }

      await this.updatePaymentRecord(merchantTransactionId, updatedPayment);

      return {
        success: true,
        message: 'Webhook processed successfully'
      };
    } catch (error) {
      console.error('Webhook processing error:', error);
      return {
        success: false,
        error: {
          code: 'WEBHOOK_PROCESSING_ERROR',
          message: 'Failed to process webhook',
          details: error.message
        }
      };
    }
  }

  /**
   * Update booking payment status
   * @param {string} bookingId - Booking ID
   * @param {string} status - Payment status
   * @param {string} transactionId - Transaction ID
   */
  async updateBookingPaymentStatus(bookingId, status, transactionId) {
    try {
      const bookingRef = this.db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();
      
      if (bookingDoc.exists) {
        const updateData = {
          paymentStatus: status,
          paymentTransactionId: transactionId,
          updatedAt: new Date()
        };

        if (status === 'completed') {
          updateData.status = 'confirmed'; // Move booking to confirmed status
        }

        await bookingRef.update(updateData);
        console.log(`✅ Updated booking ${bookingId} payment status to ${status}`);
      }
    } catch (error) {
      console.error('Error updating booking payment status:', error);
    }
  }

  /**
   * Send payment success notification
   * @param {string} customerId - Customer ID
   * @param {string} bookingId - Booking ID
   * @param {string} transactionId - Transaction ID
   */
  async sendPaymentSuccessNotification(customerId, bookingId, transactionId) {
    try {
      const notificationService = require('./notificationService');
      
      await notificationService.sendToUser(customerId, {
        type: 'payment_success',
        title: 'Payment Successful!',
        body: 'Your payment has been processed successfully. Your booking is now confirmed.',
        data: {
          bookingId,
          transactionId,
          type: 'payment_success'
        }
      });
      
      console.log(`✅ Sent payment success notification to customer ${customerId}`);
    } catch (error) {
      console.error('Error sending payment success notification:', error);
    }
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
      'PAYMENT_CANCELLED': 'cancelled'
    };
    return statusMap[phonepeStatus] || 'pending';
  }

  /**
   * Create payment record in database
   * @param {Object} paymentRecord - Payment record
   */
  async createPaymentRecord(paymentRecord) {
    try {
      await this.db.collection('payments').doc(paymentRecord.id).set(paymentRecord);
    } catch (error) {
      console.error('Error creating payment record:', error);
      throw new Error('Failed to create payment record');
    }
  }

  /**
   * Get payment record from database
   * @param {string} paymentId - Payment ID
   * @returns {Object|null} Payment record
   */
  async getPaymentRecord(paymentId) {
    try {
      const doc = await this.db.collection('payments').doc(paymentId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Error getting payment record:', error);
      return null;
    }
  }

  /**
   * Get payment status by transaction ID
   * @param {string} transactionId - Transaction ID
   * @returns {Object} Payment status result
   */
  async getPaymentStatus(transactionId) {
    try {
      const paymentRecord = await this.getPaymentRecord(transactionId);
      
      if (!paymentRecord) {
        return {
          success: false,
          error: {
            code: 'PAYMENT_NOT_FOUND',
            message: 'Payment record not found'
          }
        };
      }

      return {
        success: true,
        data: {
          transactionId,
          status: paymentRecord.status,
          amount: paymentRecord.amount,
          bookingId: paymentRecord.bookingId,
          customerId: paymentRecord.customerId,
          createdAt: paymentRecord.createdAt,
          completedAt: paymentRecord.completedAt,
          paymentDetails: paymentRecord.paymentDetails
        }
      };
    } catch (error) {
      console.error('Error getting payment status:', error);
      return {
        success: false,
        error: {
          code: 'GET_PAYMENT_STATUS_ERROR',
          message: 'Failed to get payment status'
        }
      };
    }
  }

  /**
   * Update payment record in database
   * @param {string} paymentId - Payment ID
   * @param {Object} updateData - Update data
   */
  async updatePaymentRecord(paymentId, updateData) {
    try {
      await this.db.collection('payments').doc(paymentId).update(updateData);
    } catch (error) {
      console.error('Error updating payment record:', error);
      throw new Error('Failed to update payment record');
    }
  }

  /**
   * Get payment history
   * @param {Object} filters - Filter options
   * @returns {Object} Payment history
   */
  async getPaymentHistory(filters = {}) {
    try {
      let query = this.db.collection('payments');
      
      if (filters.customerId) {
        query = query.where('customerId', '==', filters.customerId);
      }
      
      if (filters.status) {
        query = query.where('status', '==', filters.status);
      }
      
      if (filters.paymentMethod) {
        query = query.where('paymentMethod', '==', filters.paymentMethod);
      }

      query = query.orderBy('createdAt', 'desc');
      
      if (filters.limit) {
        query = query.limit(filters.limit);
      }
      
      if (filters.offset) {
        query = query.offset(filters.offset);
      }

      const snapshot = await query.get();
      const payments = [];
      
      snapshot.forEach(doc => {
        payments.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return {
        success: true,
        data: {
          payments,
          total: payments.length
        }
      };
    } catch (error) {
      console.error('Error getting payment history:', error);
      return {
        success: false,
        error: {
          code: 'PAYMENT_HISTORY_ERROR',
          message: 'Failed to get payment history',
          details: error.message
        }
      };
    }
  }

  /**
   * Process refund
   * @param {string} paymentId - Payment ID
   * @param {number} amount - Refund amount
   * @param {string} reason - Refund reason
   * @returns {Object} Refund result
   */
  async processRefund(paymentId, amount, reason) {
    try {
      const paymentRecord = await this.getPaymentRecord(paymentId);
      if (!paymentRecord) {
        throw new Error('Payment record not found');
      }

      if (paymentRecord.status !== 'completed') {
        throw new Error('Payment is not completed');
      }

      if (amount > paymentRecord.amount) {
        throw new Error('Refund amount cannot exceed payment amount');
      }

      // Create refund record
      const refundRecord = {
        id: `REFUND_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        paymentId,
        customerId: paymentRecord.customerId,
        amount,
        reason,
        status: 'pending',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      await this.db.collection('refunds').doc(refundRecord.id).set(refundRecord);

      return {
        success: true,
        message: 'Refund initiated successfully',
        data: {
          refundId: refundRecord.id,
          amount,
          status: 'pending'
        }
      };
    } catch (error) {
      console.error('Refund processing error:', error);
      return {
        success: false,
        error: {
          code: 'REFUND_PROCESSING_ERROR',
          message: 'Failed to process refund',
          details: error.message
        }
      };
    }
  }
}

module.exports = new PaymentService();
