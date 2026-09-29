const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const customerMarketplaceService = require('../services/customerMarketplaceService');

function sendError(res, error) {
  const status = error.status || 500;
  if (status === 500) {
    console.error('❌ [CUSTOMER_MARKETPLACE]', error);
  }
  return res.status(status).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: status === 500 ? 'Failed to process marketplace request' : error.message
    }
  });
}

router.get('/categories', authMiddleware, requireRole(['customer']), async (req, res) => {
  try {
    const data = await customerMarketplaceService.listCategories(req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/shops', authMiddleware, requireRole(['customer']), async (req, res) => {
  try {
    const data = await customerMarketplaceService.listShops(req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/shops/:shopId/products', authMiddleware, requireRole(['customer']), async (req, res) => {
  try {
    const data = await customerMarketplaceService.listProducts(req.params.shopId, req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/shops/:shopId', authMiddleware, requireRole(['customer']), async (req, res) => {
  try {
    const data = await customerMarketplaceService.getShop(req.params.shopId, req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/products/:productId', authMiddleware, requireRole(['customer']), async (req, res) => {
  try {
    const data = await customerMarketplaceService.getProduct(req.params.productId);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/search', authMiddleware, requireRole(['customer']), async (req, res) => {
  try {
    const data = await customerMarketplaceService.search(req.query);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
