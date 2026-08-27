const express = require('express');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const { getFirestore } = require('../services/firebase');

function isFilled(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasLocation(location) {
  if (!location) {
    return false;
  }
  const lat = location.latitude;
  const lng = location.longitude;
  return typeof lat === 'number' && Number.isFinite(lat)
    && typeof lng === 'number' && Number.isFinite(lng);
}

function inferSteps(shop, shopProfile) {
  const documents = shopProfile.documents || {};
  const bank = shopProfile.bank || {};

  const businessDetails = isFilled(shop.shopName)
    && isFilled(shop.shopType)
    && isFilled(shopProfile.address)
    && hasLocation(shopProfile.location);

  const documentsComplete = isFilled(documents.gstUrl)
    && isFilled(documents.fssaiUrl);

  const hasAccountNumber = isFilled(bank.accountNumberEncrypted)
    || isFilled(bank.accountNumberLast4);

  const bankDetails = isFilled(bank.accountHolderName)
    && isFilled(bank.bankName)
    && hasAccountNumber
    && isFilled(bank.ifsc)
    && isFilled(bank.upiId)
    && bank.upiVerified === true;

  return {
    businessDetails,
    documents: documentsComplete,
    bankDetails
  };
}

/**
 * Shop onboarding progress for resume / routing after login.
 * GET /api/shop/onboarding/status
 */
router.get('/status', authMiddleware, requireRole(['shop']), async (req, res) => {
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

    const db = getFirestore();
    const userRef = db.collection('users').doc(userId);
    const shopRef = db.collection('shops').doc(userId);

    const [userDoc, shopDoc] = await Promise.all([
      userRef.get(),
      shopRef.get()
    ]);

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }

    const userData = userDoc.data() || {};
    if (userData.userType !== 'shop') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'This resource requires shop role'
        }
      });
    }

    const shop = userData.shop || {};
    const shopProfile = shopDoc.exists ? (shopDoc.data() || {}) : {};

    const approvalStatus = shop.approvalStatus || 'pending';
    const rejectionReason = shop.rejectionReason ?? null;
    const submitted = shop.submitted === true || shopProfile.submitted === true;

    if (shop.submitted === undefined) {
      await userRef.update({
        'shop.submitted': false
      });
    }

    return res.json({
      success: true,
      data: {
        approvalStatus,
        rejectionReason,
        submitted,
        steps: inferSteps(shop, shopProfile)
      }
    });
  } catch (error) {
    console.error('❌ [SHOP_ONBOARDING] status error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to load onboarding status'
      }
    });
  }
});

module.exports = router;
