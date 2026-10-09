const express = require('express');
const multer = require('multer');
const router = express.Router();

const { authMiddleware, authenticateToken, requireRole } = require('../middleware/auth');
const { userRateLimiter } = require('../middleware/userRateLimiter');
const { getFirestore } = require('../services/firebase');
const { createMarketplaceOrder } = require('../services/marketplace/createCustomerOrder');
const { listCustomerOrders, getCustomerOrder } = require('../services/marketplace/customerOrderRead');
const { getCustomerDriverLocation } = require('../services/marketplace/customerDriverLocation');
const { submitCustomerUtr, submitBalanceUtr, cancelCustomerOrder } = require('../services/marketplace/customerOrderActions');
const { uploadPaymentEvidence, submitPaymentReport } = require('../services/marketplace/paymentEvidence');
const { submitCustomerUpi, acknowledgeRefund } = require('../services/marketplace/refunds');

const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }
});

const minuteLimiter = userRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  name: 'marketplace-order-create-minute'
});
const dayLimiter = userRateLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: 30,
  name: 'marketplace-order-create-day'
});
const listLimiter = userRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  name: 'marketplace-order-list-minute'
});
const detailLimiter = userRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  name: 'marketplace-order-detail-minute'
});
const utrLimiter = userRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  name: 'marketplace-order-utr-minute'
});
const cancelLimiter = userRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  name: 'marketplace-order-cancel-minute'
});
const balanceUtrLimiter = userRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  name: 'marketplace-order-balance-utr-minute'
});
const evidenceLimiter = userRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  name: 'marketplace-order-evidence-minute'
});
const reportLimiter = userRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  name: 'marketplace-order-report-minute'
});
const refundLimiter = userRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  name: 'marketplace-order-refund-minute'
});
const driverLocationLimiter = userRateLimiter({
  windowMs: 60000,
  max: 30,
  name: 'marketplace-order-driver-location-minute'
});

function handleEvidenceUpload(req, res, next) {
  evidenceUpload.single('file')(req, res, (err) => {
    if (err) {
      const limited = err.code === 'LIMIT_FILE_SIZE'
        || err.code === 'LIMIT_FILE_COUNT'
        || err.code === 'LIMIT_UNEXPECTED_FILE';
      return res.status(400).json({
        success: false,
        error: {
          code: 'FILE_INVALID',
          message: limited ? 'File must be 5MB or smaller' : 'File must be a jpg or png'
        }
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'FILE_INVALID',
          message: 'File must be a jpg or png'
        }
      });
    }
    return next();
  });
}

function sendError(res, error, fallbackMessage) {
  const status = error.status || 500;
  const errorBody = {
    code: error.code || 'INTERNAL_ERROR',
    message: status === 500 ? fallbackMessage : error.message
  };
  if (error.orderId !== undefined) {
    errorBody.orderId = error.orderId;
  }
  if (error.lines) {
    errorBody.lines = error.lines;
  }
  if (status === 500) {
    console.error('❌ [MARKETPLACE_ORDER]', error);
  }
  return res.status(status).json({
    success: false,
    error: errorBody
  });
}

router.post(
  '/marketplace-orders',
  authMiddleware,
  requireRole(['customer']),
  minuteLimiter,
  dayLimiter,
  async (req, res) => {
    try {
      const result = await createMarketplaceOrder({
        customerId: req.user.uid,
        idempotencyKey: req.get('Idempotency-Key'),
        body: req.body || {}
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return sendError(res, error, 'Failed to create marketplace order');
    }
  }
);

router.get(
  '/marketplace-orders',
  authenticateToken,
  requireRole(['customer']),
  listLimiter,
  async (req, res) => {
    try {
      const data = await listCustomerOrders(getFirestore(), req.user.uid, req.query || {});
      return res.json({ success: true, data });
    } catch (error) {
      return sendError(res, error, 'Failed to list marketplace orders');
    }
  }
);

router.post(
  '/marketplace-orders/:id/utr',
  authenticateToken,
  requireRole(['customer']),
  utrLimiter,
  async (req, res) => {
    try {
      const result = await submitCustomerUtr({
        customerId: req.user.uid,
        orderId: req.params.id,
        idempotencyKey: req.get('Idempotency-Key'),
        utr: req.body && req.body.utr
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return sendError(res, error, 'Failed to submit UTR');
    }
  }
);

router.post(
  '/marketplace-orders/:id/cancel',
  authenticateToken,
  requireRole(['customer']),
  cancelLimiter,
  async (req, res) => {
    try {
      const result = await cancelCustomerOrder({
        customerId: req.user.uid,
        orderId: req.params.id,
        idempotencyKey: req.get('Idempotency-Key')
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return sendError(res, error, 'Failed to cancel marketplace order');
    }
  }
);

router.post(
  '/marketplace-orders/:id/balance-utr',
  authenticateToken,
  requireRole(['customer']),
  balanceUtrLimiter,
  async (req, res) => {
    try {
      const result = await submitBalanceUtr({
        customerId: req.user.uid,
        orderId: req.params.id,
        idempotencyKey: req.get('Idempotency-Key'),
        utr: req.body && req.body.utr
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return sendError(res, error, 'Failed to submit balance UTR');
    }
  }
);

router.post(
  '/marketplace-orders/:id/evidence',
  authenticateToken,
  requireRole(['customer']),
  evidenceLimiter,
  handleEvidenceUpload,
  async (req, res) => {
    try {
      const result = await uploadPaymentEvidence({
        customerId: req.user.uid,
        orderId: req.params.id,
        idempotencyKey: req.get('Idempotency-Key'),
        file: req.file
      });
      return res.json({ success: true, data: { evidenceId: result.evidenceId } });
    } catch (error) {
      return sendError(res, error, 'Failed to upload evidence');
    }
  }
);

router.post(
  '/marketplace-orders/:id/payment-report',
  authenticateToken,
  requireRole(['customer']),
  reportLimiter,
  async (req, res) => {
    try {
      const result = await submitPaymentReport({
        customerId: req.user.uid,
        orderId: req.params.id,
        idempotencyKey: req.get('Idempotency-Key'),
        body: req.body || {}
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return sendError(res, error, 'Failed to submit payment report');
    }
  }
);

router.post(
  '/marketplace-orders/:id/refunds/:refundId/upi',
  authenticateToken,
  requireRole(['customer']),
  refundLimiter,
  async (req, res) => {
    try {
      const result = await submitCustomerUpi({
        customerId: req.user.uid,
        orderId: req.params.id,
        refundId: req.params.refundId,
        idempotencyKey: req.get('Idempotency-Key'),
        upiId: req.body && req.body.upiId,
        upiIdConfirm: req.body && req.body.upiIdConfirm,
        save: req.body && req.body.save === true
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return sendError(res, error, 'Failed to submit refund UPI');
    }
  }
);

router.post(
  '/marketplace-orders/:id/refunds/:refundId/ack',
  authenticateToken,
  requireRole(['customer']),
  refundLimiter,
  async (req, res) => {
    try {
      const result = await acknowledgeRefund({
        customerId: req.user.uid,
        orderId: req.params.id,
        refundId: req.params.refundId,
        received: req.body && req.body.received,
        idempotencyKey: req.get('Idempotency-Key')
      });
      return res.status(result.status).json(result.body);
    } catch (error) {
      return sendError(res, error, 'Failed to acknowledge refund');
    }
  }
);

router.get(
  '/marketplace-orders/:id/driver-location',
  authenticateToken,
  requireRole(['customer']),
  driverLocationLimiter,
  async (req, res) => {
    try {
      const data = await getCustomerDriverLocation(getFirestore(), req.user.uid, req.params.id);
      return res.json({ success: true, data });
    } catch (error) {
      return sendError(res, error, 'Failed to load driver location');
    }
  }
);

router.get(
  '/marketplace-orders/:id',
  authenticateToken,
  requireRole(['customer']),
  detailLimiter,
  async (req, res) => {
    try {
      const data = await getCustomerOrder(getFirestore(), req.user.uid, req.params.id);
      return res.json({ success: true, data });
    } catch (error) {
      return sendError(res, error, 'Failed to load marketplace order');
    }
  }
);

module.exports = router;
