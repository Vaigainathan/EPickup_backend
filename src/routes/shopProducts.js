const express = require('express');
const multer = require('multer');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const { fileUploadLimiter } = require('../middleware/rateLimit');
const shopCatalogueService = require('../services/shopCatalogueService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

function sendError(res, error) {
  const status = error.status || 500;
  if (status === 500) {
    console.error('❌ [SHOP_PRODUCTS]', error);
  }
  return res.status(status).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: status === 500 ? 'Failed to process product request' : error.message
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

function photoFromRequest(req) {
  return req.file || req.files?.photo?.[0] || req.files?.image?.[0] || null;
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function productPayload(req) {
  const body = req.body || {};
  return {
    ...body,
    variants: parseMaybeJson(body.variants)
  };
}

function handleMulter(req, res, next) {
  upload.single('photo')(req, res, (err) => {
    if (err) {
      const isLimit = err.code === 'LIMIT_FILE_SIZE';
      return res.status(400).json({
        success: false,
        error: {
          code: isLimit ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
          message: isLimit ? 'Photo must be 5MB or smaller' : 'Failed to upload photo'
        }
      });
    }
    next();
  });
}

router.get('/', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const products = await shopCatalogueService.listProducts(shopId, req.query.categoryId);
    return res.json({ success: true, data: { products } });
  });
});

router.put('/:id/stock', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const product = await shopCatalogueService.updateStock(shopId, req.params.id, req.body || {});
    return res.json({ success: true, data: { product }, message: 'Stock updated' });
  });
});

router.post('/', authMiddleware, requireRole(['shop']), fileUploadLimiter, handleMulter, async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const product = await shopCatalogueService.createProduct(
      shopId,
      productPayload(req),
      photoFromRequest(req)
    );
    return res.status(201).json({ success: true, data: { product }, message: 'Product created' });
  });
});

router.get('/:id', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const product = await shopCatalogueService.getProduct(shopId, req.params.id);
    return res.json({ success: true, data: { product } });
  });
});

router.put('/:id', authMiddleware, requireRole(['shop']), fileUploadLimiter, handleMulter, async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const product = await shopCatalogueService.updateProduct(
      shopId,
      req.params.id,
      productPayload(req),
      photoFromRequest(req)
    );
    return res.json({ success: true, data: { product }, message: 'Product updated' });
  });
});

router.delete('/:id', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const result = await shopCatalogueService.deleteProduct(shopId, req.params.id);
    return res.json({ success: true, data: result, message: 'Product deleted' });
  });
});

module.exports = router;
