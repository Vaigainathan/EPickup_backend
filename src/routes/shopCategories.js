const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const shopCatalogueService = require('../services/shopCatalogueService');

function sendError(res, error) {
  const status = error.status || 500;
  if (status === 500) {
    console.error('❌ [SHOP_CATEGORIES]', error);
  }
  return res.status(status).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: status === 500 ? 'Failed to process category request' : error.message
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

router.get('/', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const categories = await shopCatalogueService.listCategories(shopId);
    return res.json({ success: true, data: { categories } });
  });
});

router.post('/', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const category = await shopCatalogueService.createCategory(shopId, req.body || {});
    return res.status(201).json({ success: true, data: { category }, message: 'Category created' });
  });
});

router.delete('/:id', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const result = await shopCatalogueService.deleteCategory(shopId, req.params.id);
    return res.json({ success: true, data: result, message: 'Category deleted' });
  });
});

module.exports = router;
