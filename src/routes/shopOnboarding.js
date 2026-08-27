const express = require('express');
const multer = require('multer');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const shopOnboardingService = require('../services/shopOnboardingService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const DOCUMENT_FIELDS = [
  { name: 'gst', maxCount: 1 },
  { name: 'fssai', maxCount: 1 },
  { name: 'gstDocument', maxCount: 1 },
  { name: 'fssaiDocument', maxCount: 1 },
  { name: 'gstFile', maxCount: 1 },
  { name: 'fssaiFile', maxCount: 1 },
  { name: 'document', maxCount: 1 }
];

function firstFile(files, names) {
  if (!files) {
    return undefined;
  }
  for (const name of names) {
    if (files[name]?.[0]) {
      return files[name][0];
    }
  }
  return undefined;
}

function pickDocumentFiles(req) {
  const files = req.files || {};
  const documentType = String(req.body?.documentType || '').toLowerCase();
  const single = firstFile(files, ['document']);

  let gst = firstFile(files, ['gst', 'gstDocument', 'gstFile']);
  let fssai = firstFile(files, ['fssai', 'fssaiDocument', 'fssaiFile']);

  if (single && documentType === 'gst' && !gst) {
    gst = single;
  }
  if (single && documentType === 'fssai' && !fssai) {
    fssai = single;
  }

  return { gst, fssai };
}

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
  (req, res, next) => {
    upload.fields(DOCUMENT_FIELDS)(req, res, (err) => {
      if (err) {
        const isLimit = err.code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({
          success: false,
          error: {
            code: isLimit ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR',
            message: isLimit ? 'File must be 5MB or smaller' : 'Failed to upload document'
          }
        });
      }
      next();
    });
  },
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
