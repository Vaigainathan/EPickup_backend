const express = require('express');
const admin = require('firebase-admin');
const router = express.Router();

const { authMiddleware, requireRole } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const { getFirestore } = require('../services/firebase');
const passwordService = require('../services/passwordService');
const jwtService = require('../services/jwtService');
const roleBasedAuthService = require('../services/roleBasedAuthService');
const { normalizePhoneNumber } = require('../utils/phoneUtils');

const INVALID_LOGIN_MESSAGE = 'Invalid phone number or password';

function loginUnauthorized(res) {
  return res.status(401).json({
    success: false,
    error: {
      code: 'INVALID_CREDENTIALS',
      message: INVALID_LOGIN_MESSAGE
    }
  });
}

/**
 * Set shop password after Firebase OTP + token exchange.
 * POST /api/shop/auth/set-password
 */
router.post('/set-password', authMiddleware, requireRole(['shop']), async (req, res) => {
  try {
    const password = req.body?.password || req.body?.newPassword;
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

    if (!password || typeof password !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PASSWORD',
          message: 'Password is required'
        }
      });
    }

    const validation = passwordService.validatePasswordStrength(password);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'WEAK_PASSWORD',
          message: `Password validation failed: ${validation.errors.join(', ')}`
        }
      });
    }

    const db = getFirestore();
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

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

    if (userData.isActive === false) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'USER_INACTIVE',
          message: 'Account deactivated'
        }
      });
    }

    const passwordHash = await passwordService.hashPassword(password);
    const now = admin.firestore.FieldValue.serverTimestamp();

    await userRef.update({
      passwordHash,
      hasPassword: true,
      passwordSetAt: now,
      updatedAt: now
    });

    return res.json({
      success: true,
      message: 'Password set successfully'
    });
  } catch (error) {
    console.error('❌ [SHOP_AUTH] set-password error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to set password'
      }
    });
  }
});

/**
 * Shop login with phone + password (permanent login path).
 * POST /api/shop/auth/login
 */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const rawPhone = req.body?.phone || req.body?.phoneNumber;
    const password = req.body?.password;

    if (!rawPhone || !password) {
      return loginUnauthorized(res);
    }

    const phone = normalizePhoneNumber(String(rawPhone));
    if (!phone) {
      return loginUnauthorized(res);
    }

    const roleBasedUID = roleBasedAuthService.generateRoleSpecificUID(phone, 'shop');
    const db = getFirestore();
    const userDoc = await db.collection('users').doc(roleBasedUID).get();

    if (!userDoc.exists) {
      return loginUnauthorized(res);
    }

    const userData = userDoc.data() || {};
    if (userData.userType !== 'shop' || !userData.passwordHash) {
      return loginUnauthorized(res);
    }

    if (userData.isActive === false) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'USER_INACTIVE',
          message: 'Account deactivated'
        }
      });
    }

    const passwordValid = await passwordService.verifyPassword(password, userData.passwordHash);
    if (!passwordValid) {
      return loginUnauthorized(res);
    }

    const displayName = userData.name || phone;
    const backendToken = jwtService.generateAccessToken({
      userId: roleBasedUID,
      userType: 'shop',
      phone,
      metadata: {
        email: userData.email || null,
        name: displayName,
        originalUID: userData.originalFirebaseUID || null
      }
    });

    const refreshToken = jwtService.generateRefreshToken({
      userId: roleBasedUID,
      userType: 'shop',
      phone,
      metadata: {
        email: userData.email || null,
        originalUID: userData.originalFirebaseUID || null
      }
    });

    return res.json({
      success: true,
      data: {
        token: backendToken,
        refreshToken,
        user: {
          uid: roleBasedUID,
          originalUID: userData.originalFirebaseUID || null,
          email: userData.email || null,
          phone_number: userData.phone || phone,
          name: displayName,
          userType: 'shop'
        }
      },
      message: 'Login successful'
    });
  } catch (error) {
    console.error('❌ [SHOP_AUTH] login error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to login'
      }
    });
  }
});

module.exports = router;
