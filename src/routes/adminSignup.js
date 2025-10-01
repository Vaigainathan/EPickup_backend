const express = require('express');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const router = express.Router();

/**
 * @route   POST /api/admin/signup
 * @desc    Create new admin user (for signup flow)
 * @access  Public (but requires valid Firebase ID token)
 */
router.post('/', async (req, res) => {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Authorization header missing or invalid format'
        },
        timestamp: new Date().toISOString()
      });
    }

    const idToken = authHeader.split(' ')[1];
    if (!idToken) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Firebase ID token not provided'
        },
        timestamp: new Date().toISOString()
      });
    }

    console.log('🔐 Verifying Firebase ID token for admin signup...');

    // Verify Firebase ID token
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
      console.log('✅ Firebase ID token verified successfully');
      console.log(`📋 User UID: ${decodedToken.uid}`);
      console.log(`📋 User Email: ${decodedToken.email}`);
      console.log(`📋 Custom Claims:`, decodedToken);
    } catch (tokenError) {
      console.error('❌ Firebase ID token verification failed:', tokenError);
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid Firebase ID token provided.',
          details: tokenError.message
        },
        timestamp: new Date().toISOString()
      });
    }

    const { displayName } = req.body;
    
    // Force all admins to be super_admin (only one role needed)
    const adminRole = 'super_admin';
    
    if (!displayName) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'Display name is required'
        }
      });
    }

    const db = getFirestore();
    
    // Check if admin already exists
    const existingAdmin = await db.collection('adminUsers').doc(decodedToken.uid).get();
    
    if (existingAdmin.exists) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ADMIN_EXISTS',
          message: 'Admin user already exists'
        }
      });
    }

    // All admins get full permissions (only super_admin role)
    const getDefaultPermissions = () => {
      return ['all']; // All admins have complete access
    };

    // Create admin user data
    const adminData = {
      uid: decodedToken.uid, // Use Firebase UID directly
      id: decodedToken.uid,
      email: decodedToken.email,
      displayName: displayName,
      role: adminRole,
      permissions: getDefaultPermissions(),
      isActive: true,
      isEmailVerified: decodedToken.email_verified || false,
      accountStatus: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };

    console.log('📝 Creating admin user document...');

    // Create admin user document in Firestore
    await db.collection('adminUsers').doc(decodedToken.uid).set(adminData);
    
    console.log('📝 Setting custom claims on Firebase user...');

    // Set custom claims on Firebase user
    await admin.auth().setCustomUserClaims(decodedToken.uid, {
      userType: 'admin',
      role: adminRole,
      permissions: getDefaultPermissions()
    });

    console.log('✅ Admin user created and custom claims set successfully');

    res.json({
      success: true,
      message: 'Admin user created successfully',
      data: adminData
    });

  } catch (error) {
    console.error('❌ Admin signup failed:', error);
    
    let errorCode = 'SIGNUP_FAILED';
    let errorMessage = 'Admin signup failed';
    
    if (error.code === 'auth/id-token-expired') {
      errorCode = 'TOKEN_EXPIRED';
      errorMessage = 'Firebase ID token has expired. Please refresh and try again.';
    } else if (error.code === 'auth/invalid-id-token') {
      errorCode = 'INVALID_TOKEN';
      errorMessage = 'Invalid Firebase ID token provided.';
    } else if (error.code === 'auth/user-not-found') {
      errorCode = 'USER_NOT_FOUND';
      errorMessage = 'User not found in Firebase Authentication.';
    }

    return res.status(500).json({
      success: false,
      error: {
        code: errorCode,
        message: errorMessage,
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
