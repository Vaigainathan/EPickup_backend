const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');
const { requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

/**
 * @route   GET /api/payments/methods
 * @desc    Get available payment methods for booking
 * @access  Private (Customer)
 */
router.get('/methods', [
  requireRole(['customer']),
  body('amount').isFloat({ min: 1 }).withMessage('Valid amount is required')
], async (req, res) => {
  try {
    const { amount } = req.query;
    const { uid } = req.user;

    if (!amount) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_AMOUNT',
          message: 'Amount is required'
        }
      });
    }

    const result = await paymentService.getPaymentMethodsForBooking(uid, parseFloat(amount));

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get payment methods'
      }
    });
  }
});

/**
 * @route   POST /api/payments/process
 * @desc    Process payment for booking
 * @access  Private (Customer)
 */
router.post('/process', [
  requireRole(['customer']),
  body('bookingId').notEmpty().withMessage('Booking ID is required'),
  body('amount').isFloat({ min: 1 }).withMessage('Valid amount is required'),
  body('paymentMethod').isIn(['cash', 'upi']).withMessage('Valid payment method is required'),
  body('customerPhone').optional().isMobilePhone('en-IN').withMessage('Valid phone number is required'),
  body('customerEmail').optional().isEmail().withMessage('Valid email is required'),
  body('customerName').optional().notEmpty().withMessage('Customer name is required'),
  body('redirectUrl').optional().isURL().withMessage('Valid redirect URL is required')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array().map(err => ({
            field: err.path,
            message: err.msg
          }))
        }
      });
    }

    const paymentData = {
      ...req.body,
      customerId: req.user.uid
    };

    const result = await paymentService.processPayment(paymentData);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to process payment'
      }
    });
  }
});

/**
 * @route   POST /api/payments/cash/complete
 * @desc    Complete cash payment (Driver only)
 * @access  Private (Driver)
 */
router.post('/cash/complete', [
  requireRole(['driver']),
  body('paymentId').notEmpty().withMessage('Payment ID is required')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array().map(err => ({
            field: err.path,
            message: err.msg
          }))
        }
      });
    }

    const { paymentId } = req.body;
    const { uid } = req.user;

    const result = await paymentService.completeCashPayment(paymentId, uid);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Cash payment completion error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to complete cash payment'
      }
    });
  }
});

/**
 * @route   POST /api/payments/phonepe/initiate
 * @desc    Initialize PhonePe payment
 * @access  Private (Customer)
 */
router.post('/phonepe/initiate', [
  requireRole(['customer']),
  body('bookingId').notEmpty().withMessage('Booking ID is required'),
  body('amount').isFloat({ min: 1 }).withMessage('Valid amount is required'),
  body('customerPhone').notEmpty().withMessage('Customer phone is required'),
  body('customerEmail').optional().isEmail().withMessage('Valid email is required'),
  body('customerName').optional().notEmpty().withMessage('Customer name is required'),
  body('redirectUrl').optional().isURL().withMessage('Valid redirect URL is required')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array().map(err => ({
            field: err.path,
            message: err.msg
          }))
        }
      });
    }

    const paymentData = {
      ...req.body,
      customerId: req.user.uid,
      paymentMethod: 'upi'
    };

    const result = await paymentService.processUPIPayment(paymentData);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Payment initiation error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to initiate payment'
      }
    });
  }
});

/**
 * @route   POST /api/payments/phonepe/verify
 * @desc    Verify PhonePe payment
 * @access  Private (Customer)
 */
router.post('/phonepe/verify', [
  requireRole(['customer']),
  body('transactionId').notEmpty().withMessage('Transaction ID is required')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array().map(err => ({
            field: err.path,
            message: err.msg
          }))
        }
      });
    }

    const { transactionId } = req.body;
    const result = await paymentService.verifyPhonePePayment(transactionId);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to verify payment'
      }
    });
  }
});

/**
 * @route   GET /api/payments/phonepe/status/:transactionId
 * @desc    Get PhonePe payment status
 * @access  Private (Customer)
 */
router.get('/phonepe/status/:transactionId', [
  requireRole(['customer'])
], async (req, res) => {
  try {
    const { transactionId } = req.params;

    const result = await paymentService.getPaymentStatus(transactionId);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Get payment status error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get payment status'
      }
    });
  }
});

/**
 * @route   POST /api/payments/phonepe/callback
 * @desc    PhonePe payment callback webhook
 * @access  Public (PhonePe webhook)
 */
router.post('/phonepe/callback', async (req, res) => {
  try {
    const webhookData = req.body;
    
    // Verify webhook signature
    const isValidSignature = paymentService.verifyWebhookSignature(webhookData);
    if (!isValidSignature) {
      console.error('Invalid webhook signature');
      return res.status(400).json({ success: false });
    }

    // Process webhook
    const result = await paymentService.processPhonePeWebhook(webhookData);
    
    if (result.success) {
      res.status(200).json({ success: true });
    } else {
      console.error('Webhook processing failed:', result.error);
      res.status(500).json({ success: false });
    }

  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ success: false });
  }
});

/**
 * @route   POST /api/payments/refund
 * @desc    Process payment refund
 * @access  Private (Customer, Admin)
 */
router.post('/refund', [
  requireRole(['customer', 'admin']),
  body('paymentId').notEmpty().withMessage('Payment ID is required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Valid refund amount is required'),
  body('reason').notEmpty().withMessage('Refund reason is required')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array().map(err => ({
            field: err.path,
            message: err.msg
          }))
        }
      });
    }

    const { paymentId, amount, reason } = req.body;

    // Check if user owns the payment (for customers)
    if (req.user.userType === 'customer') {
      const paymentRecord = await paymentService.getPaymentRecord(paymentId);
      if (!paymentRecord || paymentRecord.customerId !== req.user.uid) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'Access denied to this payment'
          }
        });
      }
    }

    const result = await paymentService.processRefund(paymentId, amount, reason);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Refund processing error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to process refund'
      }
    });
  }
});

/**
 * @route   GET /api/payments/transactions
 * @desc    Get payment transaction history
 * @access  Private (Customer, Admin)
 */
router.get('/transactions', [
  requireRole(['customer', 'admin'])
], async (req, res) => {
  try {
    const { uid, userType } = req.user;
    const { limit = 20, offset = 0, status, paymentMethod } = req.query;

    const filters = { limit: parseInt(limit), offset: parseInt(offset) };
    if (status) filters.status = status;
    if (paymentMethod) filters.paymentMethod = paymentMethod;

    // For customers, only show their transactions
    if (userType === 'customer') {
      filters.customerId = uid;
    }

    const result = await paymentService.getPaymentHistory(filters);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get payment history'
      }
    });
  }
});

/**
 * @route   GET /api/payments/transactions/:transactionId
 * @desc    Get specific payment transaction details
 * @access  Private (Customer, Admin)
 */
router.get('/transactions/:transactionId', [
  requireRole(['customer', 'admin'])
], async (req, res) => {
  try {
    const { transactionId } = req.params;
    const paymentRecord = await paymentService.getPaymentRecord(transactionId);

    if (!paymentRecord) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRANSACTION_NOT_FOUND',
          message: 'Transaction not found'
        }
      });
    }

    // Check access permissions
    if (req.user.role === 'customer' && paymentRecord.customerId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied to this transaction'
        }
      });
    }

    res.status(200).json({
      success: true,
      data: {
        transaction: paymentRecord
      }
    });

  } catch (error) {
    console.error('Get transaction details error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get transaction details'
      }
    });
  }
});

/**
 * @route   GET /api/payments/statistics
 * @desc    Get payment statistics
 * @access  Private (Admin)
 */
router.get('/statistics', [
  requireRole(['admin'])
], async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate ? new Date(req.query.startDate) : null,
      endDate: req.query.endDate ? new Date(req.query.endDate) : null,
      status: req.query.status
    };

    const result = await paymentService.getPaymentStatistics(filters);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Get payment statistics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get payment statistics'
      }
    });
  }
});

/**
 * @route   GET /api/payments/driver-payouts
 * @desc    Get driver payout records
 * @access  Private (Admin, Driver)
 */
router.get('/driver-payouts', [
  requireRole(['admin', 'driver'])
], async (req, res) => {
  try {
    const { getFirestore } = require('../services/firebase');
    const db = getFirestore();

    let query = db.collection('driverPayouts');

    // Apply filters based on user role
    if (req.user.role === 'driver') {
      query = query.where('driverId', '==', req.user.uid);
    }

    if (req.query.status) {
      query = query.where('status', '==', req.query.status);
    }

    if (req.query.startDate) {
      query = query.where('createdAt', '>=', new Date(req.query.startDate));
    }

    if (req.query.endDate) {
      query = query.where('createdAt', '<=', new Date(req.query.endDate));
    }

    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const snapshot = await query.orderBy('createdAt', 'desc').limit(limit).get();

    const payouts = [];
    snapshot.forEach(doc => {
      payouts.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.status(200).json({
      success: true,
      data: {
        payouts,
        total: payouts.length
      }
    });

  } catch (error) {
    console.error('Get driver payouts error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get driver payouts'
      }
    });
  }
});

/**
 * @route   POST /api/payments/driver-payouts/:payoutId/process
 * @desc    Process driver payout
 * @access  Private (Admin)
 */
router.post('/driver-payouts/:payoutId/process', [
  requireRole(['admin'])
], async (req, res) => {
  try {
    const { payoutId } = req.params;
    const { getFirestore } = require('../services/firebase');
    const db = getFirestore();

    // Get payout record
    const payoutRef = db.collection('driverPayouts').doc(payoutId);
    const payoutDoc = await payoutRef.get();

    if (!payoutDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'PAYOUT_NOT_FOUND',
          message: 'Payout record not found'
        }
      });
    }

    const payoutData = payoutDoc.data();

    if (payoutData.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAYOUT_STATUS',
          message: 'Payout is not in pending status'
        }
      });
    }

    // Update payout status to processed
    await payoutRef.update({
      status: 'processed',
      processedAt: new Date(),
      processedBy: req.user.uid
    });

    res.status(200).json({
      success: true,
      message: 'Payout processed successfully',
      data: {
        payoutId,
        status: 'processed'
      }
    });

  } catch (error) {
    console.error('Process driver payout error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to process driver payout'
      }
    });
  }
});

/**
 * @route   GET /api/payments/health
 * @desc    Payment service health check
 * @access  Public
 */
router.get('/health', async (req, res) => {
  try {
    // Basic health check
    res.status(200).json({
      success: true,
      message: 'Payment service is healthy',
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'EPickup Payment Service',
        version: '1.0.0'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Payment service health check failed',
      error: error.message
    });
  }
});

module.exports = router;
