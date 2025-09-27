const express = require('express');
const router = express.Router();
const phonepeService = require('../services/phonepeService');
const { authMiddleware } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { rateLimit } = require('../middleware/rateLimit');

// Rate limiting for payment endpoints
const paymentRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // limit each IP to 50 payment requests per windowMs
  message: 'Too many payment requests from this IP, please try again later.'
});

/**
 * @route POST /api/payments/create
 * @desc Create payment request
 * @access Private (Customer/Driver)
 */
router.post('/create',
  authMiddleware,
  paymentRateLimit,
  validateRequest({
    body: {
      amount: { type: 'number', required: true, min: 1 },
      bookingId: { type: 'string', required: true },
      customerPhone: { type: 'string', required: true },
      customerEmail: { type: 'string', required: false },
      customerName: { type: 'string', required: false }
    }
  }),
  async (req, res) => {
    try {
      const { amount, bookingId, customerPhone, customerEmail, customerName } = req.body;
      const userId = req.user.id;

      // Generate unique transaction ID
      const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const paymentData = {
        transactionId,
        amount,
        customerId: userId,
        bookingId,
        customerPhone,
        customerEmail,
        customerName: customerName || req.user.name
      };

      const result = await phonepeService.createPayment(paymentData);

      if (result.success) {
        res.json({
          success: true,
          message: 'Payment created successfully',
          data: result.data,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Payment creation failed',
          error: result.error,
          timestamp: new Date().toISOString()
        });
      }
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
  validateRequest({
    body: {
      bookingId: { type: 'string', required: true },
      amount: { type: 'number', required: true, min: 1 },
      customerPhone: { type: 'string', required: true },
      customerEmail: { type: 'string', required: false },
      customerName: { type: 'string', required: false },
      redirectUrl: { type: 'string', required: false }
    }
  }),
  async (req, res) => {
    try {
      const { 
        bookingId, 
        amount, 
        customerPhone, 
        customerEmail, 
        customerName,
        redirectUrl 
      } = req.body;
      const userId = req.user.id;

      // Generate unique transaction ID
      const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const paymentData = {
        transactionId,
        amount,
        customerId: userId,
        bookingId,
        customerPhone,
        customerEmail,
        customerName: customerName || req.user.name,
        redirectUrl
      };

      const result = await phonepeService.createPayment(paymentData);

      if (result.success) {
        res.json({
          success: true,
          message: 'Payment initiated successfully',
          data: result.data,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Payment initiation failed',
          error: result.error,
          timestamp: new Date().toISOString()
        });
      }
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
      const { transactionId } = req.params;
      const userId = req.user.id;

      // Get payment record first to verify ownership
      const payment = await phonepeService.getPayment(transactionId);
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
          timestamp: new Date().toISOString()
        });
      }

      if (payment.customerId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          timestamp: new Date().toISOString()
        });
      }

      const result = await phonepeService.verifyPayment(transactionId);

      if (result.success) {
        res.json({
          success: true,
          message: 'Payment verification successful',
          data: result.data,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Payment verification failed',
          error: result.error,
          timestamp: new Date().toISOString()
        });
      }
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
 */
router.post('/phonepe/callback',
  async (req, res) => {
    try {
      const result = await phonepeService.handlePaymentCallback(req.body);

      if (result.success) {
        res.json({
          success: true,
          message: 'Callback processed successfully',
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Callback processing failed',
          error: result.error,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Payment callback error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error',
        error: {
          code: 'CALLBACK_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/payments/refund
 * @desc Process refund
 * @access Private (Admin/Customer)
 */
router.post('/refund',
  authMiddleware,
  paymentRateLimit,
  validateRequest({
    body: {
      transactionId: { type: 'string', required: true },
      refundAmount: { type: 'number', required: true, min: 1 },
      refundReason: { type: 'string', required: true }
    }
  }),
  async (req, res) => {
    try {
      const { transactionId, refundAmount, refundReason } = req.body;
      const userId = req.user.id;
      const userType = req.user.userType;

      // Check if user can process refund
      if (userType !== 'admin') {
        // For customers, check if they own the payment
        const payment = await phonepeService.getPayment(transactionId);
        if (!payment || payment.customerId !== userId) {
          return res.status(403).json({
            success: false,
            message: 'Access denied',
            timestamp: new Date().toISOString()
          });
        }
      }

      const refundData = {
        transactionId,
        refundAmount,
        refundReason,
        refundedBy: userId
      };

      const result = await phonepeService.processRefund(refundData);

      if (result.success) {
        res.json({
          success: true,
          message: 'Refund processed successfully',
          data: result.data,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Refund processing failed',
          error: result.error,
          timestamp: new Date().toISOString()
        });
      }
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
 * @route GET /api/payments/history
 * @desc Get payment history
 * @access Private (Customer/Driver)
 */
router.get('/history',
  authMiddleware,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const limit = parseInt(req.query.limit) || 20;

      const payments = await phonepeService.getCustomerPayments(userId, limit);

      res.json({
        success: true,
        message: 'Payment history retrieved successfully',
        data: {
          payments,
          total: payments.length
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

      const result = await phonepeService.getPaymentStatistics(startDate, endDate);

      if (result.success) {
        res.json({
          success: true,
          message: 'Payment statistics retrieved successfully',
          data: result.data,
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(400).json({
          success: false,
          message: 'Failed to get payment statistics',
          error: result.error,
          timestamp: new Date().toISOString()
        });
      }
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
      const { transactionId } = req.params;
      const userId = req.user.id;
      const userType = req.user.userType;

      const payment = await phonepeService.getPayment(transactionId);
      
      if (!payment) {
        return res.status(404).json({
          success: false,
          message: 'Payment not found',
          timestamp: new Date().toISOString()
        });
      }

      // Check access permissions
      if (userType !== 'admin' && payment.customerId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        message: 'Payment details retrieved successfully',
        data: payment,
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

module.exports = router;
