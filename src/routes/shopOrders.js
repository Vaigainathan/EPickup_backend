const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const shopCatalogueService = require('../services/shopCatalogueService');
const shopOrderService = require('../services/shopOrderService');

function sendError(res, error) {
  const status = error.status || 500;
  if (status === 500) {
    console.error('❌ [SHOP_ORDERS]', error);
  }
  return res.status(status).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: status === 500 ? 'Failed to process order request' : error.message
    }
  });
}

async function withShop(req, res, handler) {
  try {
    const shopId = await shopCatalogueService.requireShopId(req.user?.uid);
    return await handler(shopId);
  } catch (error) {
    return sendError(res, error);
  }
}

function sendTransition(res, result, successMessage) {
  if (result.alreadyProcessed) {
    const body = {
      success: true,
      message: 'Already processed',
      data: { order: result.order }
    };
    if (result.extra && result.extra.refundRequired !== undefined) {
      body.data.refundRequired = result.extra.refundRequired;
    }
    return res.json(body);
  }

  const body = {
    success: true,
    data: { order: result.order },
    message: successMessage
  };
  if (result.extra && result.extra.refundRequired !== undefined) {
    body.data.refundRequired = result.extra.refundRequired;
  }
  return res.json(body);
}

router.get('/', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const orders = await shopOrderService.listOrders(shopId, req.query.status);
    return res.json({ success: true, data: { orders } });
  });
});

router.get('/:id', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const order = await shopOrderService.getOrder(shopId, req.params.id);
    return res.json({ success: true, data: { order } });
  });
});

/**
 * POST /api/shop/orders/:id/confirm-payment
 * Body amount and confirmedByShopUid are ignored. Shop uid comes from the token.
 */
router.post('/:id/confirm-payment', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const result = await shopOrderService.confirmPayment(shopId, req.params.id);
    return sendTransition(res, result, 'Payment confirmed');
  });
});

router.post('/:id/reject', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const result = await shopOrderService.rejectOrder(shopId, req.params.id);
    return sendTransition(res, result, 'Order rejected');
  });
});

router.post('/:id/mark-ready', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const result = await shopOrderService.markReady(shopId, req.params.id);
    return sendTransition(res, result, 'Order marked ready');
  });
});

router.post('/:id/confirm-handover', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const result = await shopOrderService.confirmHandover(shopId, req.params.id, req.body || {});
    return sendTransition(res, result, 'Handover confirmed');
  });
});

router.post('/:id/cancel', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const result = await shopOrderService.cancelOrder(shopId, req.params.id, req.body || {});
    return sendTransition(res, result, 'Order cancelled');
  });
});

router.post('/:id/refund-sent', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const result = await shopOrderService.refundSent(shopId, req.params.id);
    return sendTransition(res, result, 'Refund marked sent');
  });
});

module.exports = router;
