const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const { userRateLimiter } = require('../middleware/userRateLimiter');
const { createMarketplaceOrder } = require('../services/marketplace/createCustomerOrder');

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

function sendError(res, error) {
  const status = error.status || 500;
  const errorBody = {
    code: error.code || 'INTERNAL_ERROR',
    message: status === 500 ? 'Failed to create marketplace order' : error.message
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
      return sendError(res, error);
    }
  }
);

module.exports = router;
