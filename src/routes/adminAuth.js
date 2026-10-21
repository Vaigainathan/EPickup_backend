const express = require('express');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { normalizeAdminRole } = require('../constants/adminRoles');
const { evaluateAdminAccess } = require('../services/adminLoginService');

function formatAdminAuthUser(adminData, { id, email, name, role }) {
  const source = adminData && typeof adminData === 'object' ? adminData : {};
  return {
    id,
    email,
    name,
    role,
    isActive: source.isActive !== false,
    emailVerified: source.isEmailVerified === true,
    accountStatus: source.accountStatus || 'active'
  };
}

/**
 * @route   POST /api/admin/auth/login
 * @desc    Admin login with email and password
 * @access  Public
 */
router.post('/login', async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_ID_TOKEN',
          message: 'Firebase ID token is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    const auth = getAuth();
    const db = getFirestore();

    let decodedToken;
    let userRecord;
    let access;

    try {
      if (!idToken || typeof idToken !== 'string' || idToken.length < 10) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN_FORMAT',
            message: 'Invalid token format'
          },
          timestamp: new Date().toISOString()
        });
      }

      decodedToken = await auth.verifyIdToken(idToken);

      if (decodedToken.exp < Date.now() / 1000) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Token has expired'
          },
          timestamp: new Date().toISOString()
        });
      }

      const customClaims = decodedToken.customClaims || {};

      const [adminUsersDoc, usersDoc] = await Promise.all([
        db.collection('adminUsers').doc(decodedToken.uid).get(),
        db.collection('users').doc(decodedToken.uid).get()
      ]);

      access = evaluateAdminAccess({
        customClaims,
        adminUsersDoc,
        usersDoc
      });

      if (!access.allowed) {
        if (access.inactive) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'ADMIN_INACTIVE',
              message: 'This admin account is disabled'
            },
            timestamp: new Date().toISOString()
          });
        }

        return res.status(403).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_PRIVILEGES',
            message: 'This account does not have admin privileges.'
          },
          timestamp: new Date().toISOString()
        });
      }

      userRecord = await auth.getUser(decodedToken.uid);
    } catch (authError) {
      console.error('Firebase Auth verification error:', authError);

      let errorCode = 'INVALID_TOKEN';
      let errorMessage = 'Invalid or expired Firebase ID token';

      if (authError.code === 'auth/id-token-expired') {
        errorCode = 'TOKEN_EXPIRED';
        errorMessage = 'Token has expired';
      } else if (authError.code === 'auth/id-token-revoked') {
        errorCode = 'TOKEN_REVOKED';
        errorMessage = 'Token has been revoked';
      } else if (authError.code === 'auth/invalid-id-token') {
        errorCode = 'INVALID_TOKEN_FORMAT';
        errorMessage = 'Invalid token format';
      }

      return res.status(401).json({
        success: false,
        error: {
          code: errorCode,
          message: errorMessage
        },
        timestamp: new Date().toISOString()
      });
    }

    const adminId = decodedToken.uid;
    const adminUserData = access.adminUserData;

    const adminUser = {
      id: adminUserData.id || adminUserData.uid || adminId,
      uid: adminId,
      email: adminUserData.email || userRecord.email,
      name: adminUserData.name || adminUserData.displayName || userRecord.displayName || 'Admin User',
      userType: 'admin',
      role: normalizeAdminRole(adminId, adminUserData.role),
      isActive: adminUserData.isActive !== false,
      createdAt: adminUserData.createdAt || new Date(),
      updatedAt: new Date(),
      lastLogin: new Date()
    };

    try {
      await Promise.all([
        db.collection('users').doc(adminId).set({
          lastLogin: new Date(),
          updatedAt: new Date(),
          userType: 'admin',
          role: adminUser.role
        }, { merge: true }),
        db.collection('adminUsers').doc(adminId).set({
          lastLogin: new Date(),
          updatedAt: new Date(),
          role: adminUser.role
        }, { merge: true })
      ]);
    } catch (error) {
      console.error('⚠️ [ADMIN LOGIN] Error updating last login:', error);
    }

    const adminCustomClaims = {
      userType: 'admin',
      role: adminUser.role,
      roleBasedUID: adminId,
      phone: userRecord.phone_number,
      appType: 'admin',
      verified: true
    };

    try {
      await auth.setCustomUserClaims(adminId, adminCustomClaims);
    } catch (claimsError) {
      console.error('❌ Failed to set custom claims for admin:', claimsError);
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        error: {
          message: 'JWT_SECRET environment variable is required',
          code: 'JWT_SECRET_MISSING'
        }
      });
    }

    const token = jwt.sign(
      {
        userId: adminUser.uid,
        email: adminUser.email,
        userType: 'admin',
        role: adminUser.role
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Admin login successful',
      data: {
        user: formatAdminAuthUser(adminUserData, {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role
        }),
        token
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGIN_ERROR',
        message: 'Failed to login admin user',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/auth/verify-token
 * @desc    Verify admin token and get user info
 * @access  Private (Admin)
 */
router.post('/verify-token', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'NO_TOKEN',
          message: 'No token provided'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        error: {
          message: 'JWT_SECRET environment variable is required',
          code: 'JWT_SECRET_MISSING'
        }
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || decoded.userType !== 'admin') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid admin token'
        },
        timestamp: new Date().toISOString()
      });
    }

    const db = getFirestore();
    const userId = decoded.userId;
    const adminDoc = await db.collection('adminUsers').doc(userId).get();
    const userDoc = adminDoc.exists ? null : await db.collection('users').doc(userId).get();
    const adminData = adminDoc.exists ? adminDoc.data() : (userDoc?.exists ? userDoc.data() : null);

    if (!adminData) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ADMIN_NOT_FOUND',
          message: 'Admin user not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (adminData.isActive === false || adminData.accountStatus === 'inactive') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ADMIN_INACTIVE',
          message: 'This admin account is disabled'
        },
        timestamp: new Date().toISOString()
      });
    }

    const role = normalizeAdminRole(userId, decoded.role || adminData.role);

    res.json({
      success: true,
      message: 'Token verified successfully',
      data: {
        user: formatAdminAuthUser(adminData, {
          id: adminData.id || userId,
          email: adminData.email,
          name: adminData.name || adminData.displayName,
          role
        })
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({
      success: false,
      error: {
        code: 'TOKEN_VERIFICATION_FAILED',
        message: 'Failed to verify token',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
