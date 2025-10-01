const admin = require('firebase-admin');

/**
 * Firebase ID Token Authentication Middleware
 * Verifies Firebase ID tokens directly without JWT exchange
 */
const firebaseIdTokenAuth = async (req, res, next) => {
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

    console.log('🔐 Verifying Firebase ID token...');

    // Verify Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    console.log('✅ Firebase ID token verified successfully');
    console.log(`📋 User UID: ${decodedToken.uid}`);
    console.log(`📋 User Email: ${decodedToken.email}`);
    console.log(`📋 Custom Claims:`, decodedToken);

    // Check if user has admin role (from custom claims)
    if (!decodedToken.role || decodedToken.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'Super admin role required. User does not have admin permissions.'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if user type is admin
    if (decodedToken.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'Admin access required. User type must be admin.'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get user data from Firestore (adminUsers collection)
    const db = admin.firestore();
    const userDoc = await db.collection('adminUsers').doc(decodedToken.uid).get();
    
    if (!userDoc.exists) {
      console.log('⚠️ Admin user document not found in Firestore');
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Admin user profile not found. Please contact administrator.'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    
    // Create req.user object with Firebase data
    req.user = {
      // Firebase token data
      uid: decodedToken.uid,
      email: decodedToken.email,
      phone: decodedToken.phone_number,
      emailVerified: decodedToken.email_verified,
      
      // Custom claims
      role: decodedToken.role,
      permissions: decodedToken.permissions || [],
      userType: decodedToken.userType,
      
      // Firestore data
      id: userData.id || decodedToken.uid,
      displayName: userData.displayName || userData.name,
      createdAt: userData.createdAt,
      lastLogin: userData.lastLogin,
      isActive: userData.isActive !== false, // Default to true
      
      // Token metadata
      tokenIssuedAt: decodedToken.iat,
      tokenExpiresAt: decodedToken.exp,
      tokenAudience: decodedToken.aud,
      tokenIssuer: decodedToken.iss
    };

    console.log('✅ User authenticated successfully:', {
      uid: req.user.uid,
      email: req.user.email,
      role: req.user.role,
      userType: req.user.userType
    });

    next();

  } catch (error) {
    console.error('❌ Firebase ID token verification failed:', error);
    
    let errorCode = 'TOKEN_VERIFICATION_FAILED';
    let errorMessage = 'Token verification failed';
    
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

    return res.status(401).json({
      success: false,
      error: {
        code: errorCode,
        message: errorMessage,
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Role-based authorization middleware
 * Must be used after firebaseIdTokenAuth
 */
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.user.role}`
        },
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

/**
 * Permission-based authorization middleware
 * Must be used after firebaseIdTokenAuth
 */
const requirePermission = (requiredPermission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!req.user.permissions.includes(requiredPermission) && !req.user.permissions.includes('all')) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: `Access denied. Required permission: ${requiredPermission}`
        },
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

module.exports = {
  firebaseIdTokenAuth,
  requireRole,
  requirePermission
};
