const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');
const { requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

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
      customerId: req.user.uid
    };

    const result = await paymentService.initiatePhonePePayment(paymentData);

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
 * @route   POST /api/payments/phonepe/callback
 * @desc    PhonePe payment callback webhook
 * @access  Public (PhonePe webhook)
 */
router.post('/phonepe/callback', async (req, res) => {
  try {
    const webhookData = req.body;
    
    // Log webhook data for debugging
    console.log('PhonePe webhook received:', webhookData);

    const result = await paymentService.processPhonePeWebhook(webhookData);

    if (result.success) {
      res.status(200).json({ success: true });
    } else {
      console.error('Webhook processing failed:', result.error);
      res.status(400).json({ success: false });
    }

  } catch (error) {
    console.error('Webhook processing error:', error);
    res.status(500).json({ success: false });
  }
});

/**
 * @route   POST /api/payments/phonepe/refund-callback
 * @desc    PhonePe refund callback webhook
 * @access  Public (PhonePe webhook)
 */
router.post('/phonepe/refund-callback', async (req, res) => {
  try {
    const webhookData = req.body;
    
    console.log('PhonePe refund webhook received:', webhookData);

    // Process refund webhook
    // This would typically update refund status
    res.status(200).json({ success: true });

  } catch (error) {
    console.error('Refund webhook processing error:', error);
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
 * @route   GET /api/payments/wallet/balance
 * @desc    Get customer wallet balance
 * @access  Private (Customer)
 */
router.get('/wallet/balance', [
  requireRole(['customer'])
], async (req, res) => {
  try {
    const result = await paymentService.getWalletBalance(req.user.uid);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Get wallet balance error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get wallet balance'
      }
    });
  }
});

/**
 * @route   GET /api/payments/wallet/transactions
 * @desc    Get customer wallet transaction history
 * @access  Private (Customer)
 */
router.get('/wallet/transactions', [
  requireRole(['customer'])
], async (req, res) => {
  try {
    const filters = {
      type: req.query.type,
      startDate: req.query.startDate ? new Date(req.query.startDate) : null,
      endDate: req.query.endDate ? new Date(req.query.endDate) : null,
      limit: req.query.limit ? parseInt(req.query.limit) : 50
    };

    const result = await paymentService.getWalletTransactions(req.user.uid, filters);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Get wallet transactions error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get wallet transactions'
      }
    });
  }
});

/**
 * @route   POST /api/payments/wallet/add-money
 * @desc    Add money to customer wallet
 * @access  Private (Customer)
 */
router.post('/wallet/add-money', [
  requireRole(['customer']),
  body('amount').isFloat({ min: 1 }).withMessage('Valid amount is required'),
  body('paymentMethod').isIn(['phonepe', 'razorpay', 'stripe']).withMessage('Valid payment method is required')
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

    const { amount, paymentMethod } = req.body;

    // Initialize payment for wallet top-up
    const paymentData = {
      bookingId: `WALLET_TOPUP_${Date.now()}`,
      customerId: req.user.uid,
      amount: amount,
      customerPhone: req.user.phone,
      customerEmail: req.user.email,
      customerName: req.user.name,
      redirectUrl: `${process.env.FRONTEND_URL}/wallet/success`
    };

    let result;
    if (paymentMethod === 'phonepe') {
      result = await paymentService.initiatePhonePePayment(paymentData);
    } else {
      // Handle other payment methods
      result = {
        success: false,
        error: {
          code: 'PAYMENT_METHOD_NOT_SUPPORTED',
          message: 'Payment method not yet supported'
        }
      };
    }

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }

  } catch (error) {
    console.error('Add money to wallet error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to add money to wallet'
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
    const { getFirestore } = require('../services/firebase');
    const db = getFirestore();

    let query = db.collection('payments');

    // Apply filters based on user role
    if (req.user.role === 'customer') {
      query = query.where('customerId', '==', req.user.uid);
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

    const transactions = [];
    snapshot.forEach(doc => {
      transactions.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.status(200).json({
      success: true,
      data: {
        transactions,
        total: transactions.length
      }
    });

  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to get transactions'
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
