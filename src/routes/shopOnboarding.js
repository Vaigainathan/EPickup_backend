const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const shopOnboardingService = require('../services/shopOnboardingService');
const shopPlacesRoutes = require('./shopPlaces');
const { handleDocumentUpload, pickDocumentFiles } = require('../middleware/shopDocumentUpload');

function sendError(res, error) {
  const status = error.status || 500;
  const body = {
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: status === 500 ? 'Failed to process onboarding request' : error.message
    }
  };
  if (error.steps) {
    body.error.steps = error.steps;
  }
  if (status === 500) {
    console.error('❌ [SHOP_ONBOARDING]', error);
  }
  return res.status(status).json(body);
}

async function withShopUser(req, res, handler) {
  try {
    const userId = req.user?.uid;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Access token required'
        }
      });
    }
    return await handler(userId);
  } catch (error) {
    return sendError(res, error);
  }
}

router.use(shopPlacesRoutes);

/**
 * GET /api/shop/onboarding/status
 */
router.get('/status', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShopUser(req, res, async (userId) => {
    const data = await shopOnboardingService.getStatus(userId);
    return res.json({ success: true, data });
  });
});

/**
 * POST /api/shop/onboarding/business-details
 * Body: { shopName, shopType, address, latitude, longitude }
 */
router.post('/business-details', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShopUser(req, res, async (userId) => {
    const data = await shopOnboardingService.saveBusinessDetails(userId, req.body || {});
    return res.json({ success: true, data, message: 'Business details saved' });
  });
});

/**
 * POST /api/shop/onboarding/documents
 * JSON: { gstUrl, fssaiUrl, fssaiExpiryDate? }
 * or multipart fields gst / fssai plus optional URLs
 */
router.post(
  '/documents',
  authMiddleware,
  requireRole(['shop']),
  handleDocumentUpload,
  async (req, res) => {
    return withShopUser(req, res, async (userId) => {
      const files = pickDocumentFiles(req);
      const data = await shopOnboardingService.saveDocuments(userId, req.body || {}, files);
      return res.json({ success: true, data, message: 'Documents saved' });
    });
  }
);

/**
 * POST /api/shop/onboarding/verify-upi
 * Body: { upiId }
 */
router.post('/verify-upi', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShopUser(req, res, async (userId) => {
    const data = await shopOnboardingService.verifyUpi(userId, req.body?.upiId);
    return res.json({ success: true, data, message: 'UPI ID verified' });
  });
});

/**
 * POST /api/shop/onboarding/bank-details
 * Body: { accountHolderName, bankName, accountNumber, ifsc, upiId }
 * Requires a prior successful verify-upi for the same UPI ID.
 */
router.post('/bank-details', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShopUser(req, res, async (userId) => {
      const data = await shopOnboardingService.saveBankDetails(userId, req.body || {});
      return res.json({ success: true, data, message: 'Bank details saved' });
  });
});

/**
 * POST /api/shop/onboarding/submit
 */
router.post('/submit', authMiddleware, requireRole(['shop']), async (req, res) => {
  return withShopUser(req, res, async (userId) => {
    const data = await shopOnboardingService.submit(userId);
    return res.json({ success: true, data, message: 'Application submitted for review' });
  });
});

module.exports = router;
