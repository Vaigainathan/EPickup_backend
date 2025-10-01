const express = require('express');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const jwt = require('jsonwebtoken');
const router = express.Router();

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

    // Verify Firebase ID token
    const auth = getAuth();
    const db = getFirestore();
    
    let decodedToken, userRecord, customClaims;
    
    try {
      // Validate token format before verification
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

      // Verify the Firebase ID token
      decodedToken = await auth.verifyIdToken(idToken);
      
      // Validate token expiration
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
      
      // Check if user has admin custom claims
      customClaims = decodedToken.customClaims || {};
      if (customClaims.userType !== 'admin' && customClaims.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'INSUFFICIENT_PRIVILEGES',
            message: 'This account does not have admin privileges'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Get user record for additional info
      userRecord = await auth.getUser(decodedToken.uid);
      
    } catch (authError) {
      console.error('Firebase Auth verification error:', authError);
      
      // Handle specific Firebase Auth errors
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

    // Create or get admin user in database
    const adminId = decodedToken.uid; // Use Firebase UID as admin ID
    
    // Check if admin user already exists
    const existingAdminQuery = await db.collection('users')
      .where('uid', '==', adminId)
      .where('userType', '==', 'admin')
      .limit(1)
      .get();

    let adminUser;
    if (!existingAdminQuery.empty) {
      adminUser = existingAdminQuery.docs[0].data();
      adminUser.id = existingAdminQuery.docs[0].id;
      
      // Update last login
      await db.collection('users').doc(adminId).update({
        lastLogin: new Date(),
        updatedAt: new Date()
      });
    } else {
      // Create new admin user
      const adminUserData = {
        id: adminId,
        uid: adminId,
        email: userRecord.email,
        name: userRecord.displayName || 'Admin User',
        userType: 'admin',
        role: customClaims.role || 'super_admin',
        permissions: customClaims.permissions || ['all'],
        isActive: true,
        isVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastLogin: new Date()
      };

      const adminRef = db.collection('users').doc(adminId);
      await adminRef.set(adminUserData);
      adminUser = adminUserData;
    }

    // Generate JWT token
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
        role: adminUser.role,
        permissions: adminUser.permissions
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Admin login successful',
      data: {
        user: {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name,
          role: adminUser.role,
          permissions: adminUser.permissions
        },
        token: token
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

    // Verify JWT token
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

    // Get admin user data
    const db = getFirestore();
    const adminDoc = await db.collection('users').doc(decoded.userId).get();
    
    if (!adminDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ADMIN_NOT_FOUND',
          message: 'Admin user not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const adminData = adminDoc.data();

    res.json({
      success: true,
      message: 'Token verified successfully',
      data: {
        user: {
          id: adminData.id,
          email: adminData.email,
          name: adminData.name,
          role: adminData.role,
          permissions: adminData.permissions
        }
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
