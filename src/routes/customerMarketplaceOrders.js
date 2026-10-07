const express = require('express');
const router = express.Router();

const { authMiddleware, authenticateToken, requireRole } = require('../middleware/auth');
const { userRateLimiter } = require('../middleware/userRateLimiter');
const { getFirestore } = require('../services/firebase');
const { createMarketplaceOrder } = require('../services/marketplace/createCustomerOrder');
const { listCustomerOrders, getCustomerOrder } = require('../services/marketplace/customerOrderRead');
const { submitCustomerUtr, submitBalanceUtr, cancelCustomerOrder } = require('../services/marketplace/customerOrderActions');

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
