const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const shopCatalogueService = require('../services/shopCatalogueService');
const shopDashboardService = require('../services/shopDashboardService');
const shopSettingsService = require('../services/shopSettingsService');
const { handleDocumentUpload, pickDocumentFiles } = require('../middleware/shopDocumentUpload');

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
 */
router.get('/dashboard/stats', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const stats = await shopDashboardService.getStats(shopId);
    return res.json({ success: true, data: stats });
  });
});

/**
 * GET /api/shop/profile
 */
router.get('/profile', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const profile = await shopSettingsService.getProfile(shopId);
    return res.json({ success: true, data: profile });
  });
});

/**
 * PUT /api/shop/profile
 * Body: { currentPassword, shopName, shopType, address, location }
 */
router.put('/profile', authMiddleware, requireRole(['shop']), authLimiter, async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const data = await shopSettingsService.updateBusinessProfile(shopId, req.body || {});
    return res.json({ success: true, data, message: 'Business profile updated' });
  });
});

/**
 * PUT /api/shop/status
 * Body: { isOpen: boolean }
 */
router.put('/status', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const data = await shopDashboardService.setOpenStatus(shopId, req.body?.isOpen);
    return res.json({ success: true, data, message: 'Shop status updated' });
  });
});

/**
 * PUT /api/shop/documents/:type  (gst | fssai)
 */
router.put(
  '/documents/:type',
  authMiddleware,
  requireRole(['shop']),
  handleDocumentUpload,
  async (req, res) => {
    return withShop(req, res, async (shopId) => {
      const type = String(req.params.type || '').toLowerCase();
      if (!req.body) {
        req.body = {};
      }
      if (!req.body.documentType) {
        req.body.documentType = type;
      }
      const files = pickDocumentFiles(req);
      const data = await shopSettingsService.reuploadDocument(shopId, type, files, req.body || {});
      return res.json({ success: true, data, message: 'Document uploaded' });
    });
  }
);

/**
 * POST /api/shop/verify-upi
 * Body: { upiId } — post-approval, no onboarding lock.
 */
router.post('/verify-upi', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const data = await shopSettingsService.verifyUpi(shopId, req.body?.upiId);
    return res.json({ success: true, data, message: 'UPI ID verified' });
  });
});

/**
 * PUT /api/shop/bank-details
 * Body: onboarding bank fields + currentPassword
 */
router.put('/bank-details', authMiddleware, requireRole(['shop']), authLimiter, async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const data = await shopSettingsService.updateBankDetails(shopId, req.body || {});
    return res.json({ success: true, data, message: 'Bank details updated' });
  });
});

/**
 * POST /api/shop/deactivate
 */
router.post('/deactivate', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const data = await shopSettingsService.deactivate(shopId);
    return res.json({ success: true, data, message: 'Account deactivated' });
  });
});

/**
 * PUT /api/shop/account/profile
 * Body: { name, email }
 */
router.put('/account/profile', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const data = await shopSettingsService.updateAccountProfile(shopId, req.body || {});
    return res.json({ success: true, data, message: 'Account profile updated' });
  });
});

/**
 * PUT /api/shop/account/password
 * Body: { currentPassword, newPassword, confirmPassword }
 */
router.put('/account/password', authMiddleware, requireRole(['shop']), authLimiter, async (req, res) => {
  return withShop(req, res, async (shopId) => {
    const data = await shopSettingsService.updateAccountPassword(shopId, req.body || {});
    return res.json({ success: true, data, message: 'Password updated' });
  });
});

/**
 * GET /api/shop/payment-history
 * Honest empty until marketplaceOrders exists.
 */
router.get('/payment-history', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShop(req, res, async () => {
    const data = shopSettingsService.getPaymentHistory();
    return res.json({ success: true, data });
  });
});

module.exports = router;
