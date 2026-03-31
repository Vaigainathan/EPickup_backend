const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { authMiddleware } = require('../middleware/auth');
const { checkValidation } = require('../middleware/validation');
const { generalLimiter } = require('../middleware/rateLimit');

// Rate limiting for payment endpoints
const paymentRateLimit = generalLimiter;

/**
 * @route POST /api/payments/create
 * @desc Create payment request
 * @access Private (Customer/Driver)
 */
router.post('/create',
  authMiddleware,
  paymentRateLimit,
  body('amount').isNumeric().withMessage('Amount must be a number').isFloat({ min: 1 }).withMessage('Amount must be at least 1'),
  body('bookingId').isString().withMessage('Booking ID is required').notEmpty().withMessage('Booking ID cannot be empty'),
  body('customerPhone').isString().withMessage('Customer phone is required').notEmpty().withMessage('Customer phone cannot be empty'),
  body('customerEmail').optional().isEmail().withMessage('Invalid email format'),
  body('customerName').optional().isString().withMessage('Customer name must be a string'),
  checkValidation,
  async (req, res) => {
    try {
      // ⚠️ PhonePe payments deprecated - use /api/driver/wallet/top-up for Razorpay
      return res.status(410).json({
        success: false,
        message: 'PhonePe payment method is deprecated. Please use Razorpay wallet top-up.',
        error: {
          code: 'PAYMENT_METHOD_DEPRECATED',
          message: 'Use POST /api/driver/wallet/top-up for Razorpay payments'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Create payment error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: {
          code: 'PAYMENT_CREATION_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/payments/phonepe/initiate
 * @desc Initiate PhonePe payment
 * @access Private (Customer)
 */
router.post('/phonepe/initiate',
  authMiddleware,
  paymentRateLimit,
  body('bookingId').isString().withMessage('Booking ID is required').notEmpty().withMessage('Booking ID cannot be empty'),
  body('amount').isNumeric().withMessage('Amount must be a number').isFloat({ min: 1 }).withMessage('Amount must be at least 1'),
  body('customerPhone').isString().withMessage('Customer phone is required').notEmpty().withMessage('Customer phone cannot be empty'),
  body('customerEmail').optional().isEmail().withMessage('Invalid email format'),
  body('customerName').optional().isString().withMessage('Customer name must be a string'),
  body('redirectUrl').optional().isURL().withMessage('Invalid redirect URL format'),
  checkValidation,
  async (req, res) => {
    try {
      // ⚠️ PhonePe payments deprecated - use /api/driver/wallet/top-up for Razorpay
      return res.status(410).json({
        success: false,
        message: 'PhonePe payment method is deprecated. Please use Razorpay wallet top-up.',
        error: {
          code: 'PAYMENT_METHOD_DEPRECATED',
          message: 'Use POST /api/driver/wallet/top-up for Razorpay payments'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Initiate PhonePe payment error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: {
          code: 'PAYMENT_INITIATION_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route GET /api/payments/verify/:transactionId
 * @desc Verify payment status
 * @access Private (Customer/Driver)
 */
router.get('/verify/:transactionId',
  authMiddleware,
  async (req, res) => {
    try {
      // ⚠️ PhonePe payments deprecated - use /api/driver/wallet/verify-payment for Razorpay
      return res.status(410).json({
        success: false,
        message: 'PhonePe verification is deprecated. Please use Razorpay wallet verification endpoint.',
        error: {
          code: 'PAYMENT_METHOD_DEPRECATED',
          message: 'Use POST /api/driver/wallet/verify-payment for Razorpay verification'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Verify payment error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: {
          code: 'PAYMENT_VERIFICATION_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/payments/phonepe/callback
 * @desc Handle PhonePe payment callback
 * @access Public
 * 
 * NOTE: This route is registered in server.js directly to handle webhooks without auth.
 * This route handler is kept for reference but may not be reached due to route precedence.
 * The actual callback is handled in server.js:495
 */
// router.post('/phonepe/callback', ...) - DISABLED: Handled in server.js to avoid duplicate routes

/**
 * @route POST /api/payments/refund
 * @desc Process refund
 * @access Private (Admin/Customer)
 */
router.post('/refund',
  authMiddleware,
  paymentRateLimit,
  body('transactionId').isString().withMessage('Transaction ID is required').notEmpty().withMessage('Transaction ID cannot be empty'),
  body('refundAmount').isNumeric().withMessage('Refund amount must be a number').isFloat({ min: 1 }).withMessage('Refund amount must be at least 1'),
  body('refundReason').isString().withMessage('Refund reason is required').notEmpty().withMessage('Refund reason cannot be empty'),
  checkValidation,
  async (req, res) => {
    try {
      // ⚠️ PhonePe refunds deprecated - use admin support for Razorpay payment refunds
      return res.status(410).json({
        success: false,
        message: 'PhonePe refunds are deprecated. Please contact support for Razorpay payment refunds.',
        error: {
          code: 'PAYMENT_METHOD_DEPRECATED',
          message: 'PhonePe refunds no longer supported - contact admin support'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Process refund error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: {
          code: 'REFUND_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route GET /api/payments/methods
 * @desc Get available payment methods
 * @access Private (Customer/Driver)
 */
router.get('/methods',
  authMiddleware,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const userType = req.user.userType;

      console.log(`💳 Getting payment methods for ${userType}: ${userId}`);

      // Default payment methods available to all users
      const defaultMethods = {
        cash: {
          name: 'Cash on Delivery',
          code: 'cash',
          supported: true,
          description: 'Pay when your package is delivered',
          icon: 'cash-outline'
        },
        upi: {
          name: 'UPI Payment',
          code: 'upi',
          supported: true,
          description: 'Pay using UPI apps like PhonePe, Google Pay',
          icon: 'phone-portrait-outline'
        }
      };

      // For customers, check if they have saved payment methods
      let customerMethods = [];
      if (userType === 'customer') {
        try {
          const { getFirestore } = require('../services/firebase');
          const db = getFirestore();
          const customerDoc = await db.collection('users').doc(userId).get();
          
          if (customerDoc.exists) {
            const customerData = customerDoc.data();
            customerMethods = customerData.customer?.paymentMethods || [];
            console.log(`📋 Found ${customerMethods.length} saved payment methods for customer: ${userId}`);
          } else {
            console.warn(`⚠️ Customer document not found for user: ${userId}`);
          }
        } catch (error) {
          console.error(`❌ Error fetching customer payment methods for user ${userId}:`, error);
          // Continue with empty customer methods rather than failing
        }
      }

      const response = {
        success: true,
        data: {
          methods: defaultMethods,
          customerMethods: customerMethods,
          testingMode: process.env.NODE_ENV === 'development'
        },
        message: 'Payment methods retrieved successfully',
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Retrieved payment methods for ${userType}: ${userId}`);
      res.json(response);

    } catch (error) {
      console.error('❌ Error getting payment methods:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: {
          code: 'PAYMENT_METHODS_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route GET /api/payments/history
 * @desc Get payment history
 * @access Private (Customer/Driver)
 */
router.get('/history',
  authMiddleware,
  async (req, res) => {
    try {
      // ⚠️ PhonePe history deprecated - use Razorpay wallet transaction history
      return res.status(410).json({
        success: false,
        message: 'PhonePe payment history is no longer available. Please use the wallet section for transaction history.',
        error: {
          code: 'PAYMENT_METHOD_DEPRECATED',
          message: 'Use wallet transaction history for payment records'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get payment history error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: {
          code: 'PAYMENT_HISTORY_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route GET /api/payments/statistics
 * @desc Get payment statistics
 * @access Private (Admin)
 */
router.get('/statistics',
  authMiddleware,
  async (req, res) => {
    try {
      const userType = req.user.userType;
      
      if (userType !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          timestamp: new Date().toISOString()
        });
      }

      const { startDate, endDate } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: 'Start date and end date are required',
          timestamp: new Date().toISOString()
        });
      }

      // ⚠️ PhonePe statistics deprecated - use Razorpay wallet analytics
      return res.status(410).json({
        success: false,
        message: 'PhonePe payment statistics are no longer available. Please use Razorpay analytics.',
        error: {
          code: 'PAYMENT_METHOD_DEPRECATED',
          message: 'Use Razorpay dashboard for payment statistics'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get payment statistics error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: {
          code: 'PAYMENT_STATISTICS_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route GET /api/payments/:transactionId
 * @desc Get payment details
 * @access Private (Customer/Driver/Admin)
 */
router.get('/:transactionId',
  authMiddleware,
  async (req, res) => {
    try {
      // ⚠️ PhonePe payment details deprecated - use Razorpay wallet transaction endpoints
      return res.status(410).json({
        success: false,
        message: 'PhonePe payment details are no longer available.',
        error: {
          code: 'PAYMENT_METHOD_DEPRECATED',
          message: 'Use Razorpay wallet endpoints for transaction details'
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Get payment details error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: {
          code: 'PAYMENT_DETAILS_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/payments/confirm
 * @desc Confirm payment received by driver
 * @access Private (Driver only)
 */
router.post('/confirm',
  authMiddleware,
  paymentRateLimit,
  body('transactionId').isString().withMessage('Transaction ID is required').notEmpty().withMessage('Transaction ID cannot be empty'),
  body('bookingId').isString().withMessage('Booking ID is required').notEmpty().withMessage('Booking ID cannot be empty'),
  body('amount').isNumeric().withMessage('Amount must be a number').isFloat({ min: 1 }).withMessage('Amount must be at least 1'),
  body('paymentMethod').optional().isString().withMessage('Payment method must be a string'),
  body('notes').optional().isString().withMessage('Notes must be a string'),
  checkValidation,
  async (req, res) => {
    try {
      const { transactionId, bookingId, amount, paymentMethod = 'cash', notes } = req.body;
      const driverId = req.user.id;
      const db = require('../database/firestore').getFirestore();

      console.log('💰 [PAYMENT_CONFIRM] Confirming payment:', { transactionId, bookingId, amount, driverId });

      // Verify booking exists and driver is assigned
      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();

      if (!bookingDoc.exists) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'BOOKING_NOT_FOUND',
            message: 'Booking not found',
            details: 'Booking with this ID does not exist'
          },
          timestamp: new Date().toISOString()
        });
      }

      const bookingData = bookingDoc.data();

      // Check if driver is assigned to this booking
      if (bookingData.driverId !== driverId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'Access denied',
            details: 'You can only confirm payments for bookings assigned to you'
          },
          timestamp: new Date().toISOString()
        });
      }

      // ✅ FIX: Require money_collection status for payment confirmation (as per audit)
      if (bookingData.status !== 'money_collection') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_BOOKING_STATUS',
            message: 'Invalid booking status for payment confirmation',
            details: `Booking must be in money_collection status for payment confirmation. Current status: ${bookingData.status}`
          },
          timestamp: new Date().toISOString()
        });
      }

      // Create payment confirmation record
      const paymentRef = db.collection('payments').doc();
      await paymentRef.set({
        id: paymentRef.id,
        transactionId: transactionId,
        bookingId: bookingId,
        driverId: driverId,
        customerId: bookingData.customerId,
        amount: amount,
        paymentMethod: paymentMethod,
        status: 'confirmed',
        confirmedAt: new Date(),
        confirmedBy: driverId,
        notes: notes || null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // ✅ CRITICAL FIX: Use state machine to transition status if in money_collection
      const bookingStateMachine = require('../services/bookingStateMachine');
      
      if (bookingData.status === 'money_collection') {
        // Transition to completed using state machine
        await bookingStateMachine.transitionBooking(
          bookingId,
          'completed',
          {
            payment: {
              confirmed: true,
              confirmedAt: new Date(),
              confirmedBy: driverId,
              amount: amount,
              method: paymentMethod,
              transactionId: transactionId,
              notes: notes || null
            }
          },
          {
            userId: driverId,
            userType: 'driver',
            driverId: driverId
          }
        );
      } else {
        // Just update payment fields if not in money_collection
        await bookingRef.update({
          'payment.confirmed': true,
          'payment.confirmedAt': new Date(),
          'payment.confirmedBy': driverId,
          'payment.amount': amount,
          'payment.method': paymentMethod,
          'payment.transactionId': transactionId,
          'payment.notes': notes || null,
          updatedAt: new Date()
        });
      }

      // Update trip tracking
      const tripTrackingRef = db.collection('tripTracking').doc(bookingId);
      await tripTrackingRef.set({
        tripId: bookingId,
        bookingId: bookingId,
        driverId: driverId,
        customerId: bookingData.customerId,
        paymentConfirmed: true,
        paymentConfirmedAt: new Date(),
        lastUpdated: new Date()
      }, { merge: true });

      console.log('✅ [PAYMENT_CONFIRM] Payment confirmed successfully:', transactionId);

      // ✅ CRITICAL FIX: Notify customer about payment completion
      try {
        const notificationService = require('../services/notificationService');
        await notificationService.sendNotificationToUser(bookingData.customerId, {
          title: 'Payment Completed',
          body: `Your payment of ₹${amount} has been collected successfully.`,
          data: {
            type: 'payment_completed',
            bookingId: bookingId,
            amount: amount,
            paymentMethod: paymentMethod
          }
        });
        console.log('✅ [PAYMENT_CONFIRM] Customer notification sent');
      } catch (notificationError) {
        console.warn('⚠️ [PAYMENT_CONFIRM] Failed to send customer notification:', notificationError);
        // Don't fail the payment confirmation if notification fails
      }

      res.status(200).json({
        success: true,
        message: 'Payment confirmed successfully',
        data: {
          transactionId: transactionId,
          bookingId: bookingId,
          amount: amount,
          paymentMethod: paymentMethod,
          confirmedAt: new Date().toISOString(),
          confirmedBy: driverId
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ [PAYMENT_CONFIRM] Error confirming payment:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'PAYMENT_CONFIRMATION_ERROR',
          message: 'Failed to confirm payment',
          details: 'An error occurred while confirming payment'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

module.exports = router;
