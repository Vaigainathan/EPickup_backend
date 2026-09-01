const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const shopCatalogueService = require('../services/shopCatalogueService');
const shopDashboardService = require('../services/shopDashboardService');

function sendError(res, error) {
  const status = error.status || 500;
  if (status === 500) {
    console.error('❌ [SHOP]', error);
  }
  return res.status(status).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: status === 500 ? 'Failed to process shop request' : error.message
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

/**
 * GET /api/shop/dashboard/stats
 * Placeholder zeros until marketplaceOrders exists.
 */
router.get('/dashboard/stats', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async () => {
    const stats = shopDashboardService.getStats();
    return res.json({ success: true, data: stats });
  });
});

/**
 * GET /api/shop/profile
 * Real fields from users/{uid}.shop: shopName, shopType, isOpen.
 */
router.get('/profile', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const profile = await shopDashboardService.getProfile(shopId);
    return res.json({ success: true, data: profile });
  });
});

/**
 * PUT /api/shop/status
 * Body: { isOpen: boolean } — shop-owned daily open/close toggle.
 */
router.put('/status', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const data = await shopDashboardService.setOpenStatus(shopId, req.body?.isOpen);
    return res.json({ success: true, data, message: 'Shop status updated' });
  });
});

module.exports = router;
