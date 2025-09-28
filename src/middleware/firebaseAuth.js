const firebaseAuthService = require('../services/firebaseAuthService');

/**
 * Firebase Authentication Middleware
 * Verifies Firebase ID tokens and adds user info to request
 */
const firebaseAuthMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Firebase ID token required',
          details: 'Please provide a valid Firebase ID token in the Authorization header'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Extract token
    const idToken = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify Firebase ID token
    const decodedToken = await firebaseAuthService.verifyIdToken(idToken);
    
    if (!decodedToken) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid Firebase ID token',
          details: 'The provided token is invalid or has expired'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get user data from Firestore
    const userData = await firebaseAuthService.getUserByUid(decodedToken.uid);
    
    if (!userData) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found in database',
          details: 'User account not found in Firestore'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Add user info to request
    req.user = {
      id: userData.id,
      uid: decodedToken.uid,
      email: userData.email,
      phone: userData.phone,
      name: userData.name,
      userType: userData.userType,
      isVerified: userData.isVerified,
      photoURL: userData.photoURL,
      firebaseToken: decodedToken
    };

    // Add token info for debugging
    req.tokenInfo = {
      issuedAt: new Date(decodedToken.iat * 1000).toISOString(),
      expiresAt: new Date(decodedToken.exp * 1000).toISOString(),
      authTime: new Date(decodedToken.auth_time * 1000).toISOString(),
      provider: decodedToken.firebase?.sign_in_provider || 'unknown'
    };

    console.log('✅ Firebase authentication successful:', {
      uid: decodedToken.uid,
      userType: userData.userType,
      email: userData.email,
      phone: userData.phone
    });

    next();
  } catch (error) {
    console.error('❌ Firebase authentication failed:', error.message);
    
    // Handle specific Firebase Auth errors
    if (error.message.includes('expired')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Firebase ID token has expired',
          details: 'Please login again to get a new token'
        },
        timestamp: new Date().toISOString()
      });
    } else if (error.message.includes('revoked')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_REVOKED',
          message: 'Firebase ID token has been revoked',
          details: 'Please login again'
        },
        timestamp: new Date().toISOString()
      });
    } else if (error.message.includes('Invalid token')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid Firebase ID token format',
          details: 'Please provide a valid Firebase ID token'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    return res.status(401).json({
      success: false,
      error: {
        code: 'AUTHENTICATION_FAILED',
        message: 'Firebase authentication failed',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Firebase Admin Authentication Middleware
 * Verifies Firebase ID tokens for admin users only
 */
const firebaseAdminAuthMiddleware = async (req, res, next) => {
  try {
    // First verify the Firebase ID token
    await firebaseAuthMiddleware(req, res, async () => {
      // Check if user is admin
      if (req.user.userType !== 'admin') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Admin access required',
            details: 'This endpoint requires admin privileges'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Get admin role
      const role = await firebaseAuthService.getUserRole(req.user.uid);
      req.user.role = role;

      // Check if admin role is valid
      if (role === 'pending') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'PENDING_APPROVAL',
            message: 'Admin account pending approval',
            details: 'Your admin account is pending approval from a super admin'
          },
          timestamp: new Date().toISOString()
        });
      }

      console.log('✅ Firebase admin authentication successful:', {
        uid: req.user.uid,
        role: role,
        email: req.user.email
      });

      next();
    });
  } catch (error) {
    console.error('❌ Firebase admin authentication failed:', error.message);
    return res.status(401).json({
      success: false,
      error: {
        code: 'AUTHENTICATION_FAILED',
        message: 'Admin authentication failed',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Firebase Driver Authentication Middleware
 * Verifies Firebase ID tokens for driver users only
 */
const firebaseDriverAuthMiddleware = async (req, res, next) => {
  try {
    // First verify the Firebase ID token
    await firebaseAuthMiddleware(req, res, async () => {
      // Check if user is driver
      if (req.user.userType !== 'driver') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Driver access required',
            details: 'This endpoint requires driver privileges'
          },
          timestamp: new Date().toISOString()
        });
      }

      console.log('✅ Firebase driver authentication successful:', {
        uid: req.user.uid,
        email: req.user.email,
        phone: req.user.phone
      });

      next();
    });
  } catch (error) {
    console.error('❌ Firebase driver authentication failed:', error.message);
    return res.status(401).json({
      success: false,
      error: {
        code: 'AUTHENTICATION_FAILED',
        message: 'Driver authentication failed',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Firebase Customer Authentication Middleware
 * Verifies Firebase ID tokens for customer users only
 */
const firebaseCustomerAuthMiddleware = async (req, res, next) => {
  try {
    // First verify the Firebase ID token
    await firebaseAuthMiddleware(req, res, async () => {
      // Check if user is customer
      if (req.user.userType !== 'customer') {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Customer access required',
            details: 'This endpoint requires customer privileges'
          },
          timestamp: new Date().toISOString()
        });
      }

      console.log('✅ Firebase customer authentication successful:', {
        uid: req.user.uid,
        email: req.user.email,
        phone: req.user.phone
      });

      next();
    });
  } catch (error) {
    console.error('❌ Firebase customer authentication failed:', error.message);
    return res.status(401).json({
      success: false,
      error: {
        code: 'AUTHENTICATION_FAILED',
        message: 'Customer authentication failed',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  firebaseAuthMiddleware,
  firebaseAdminAuthMiddleware,
  firebaseDriverAuthMiddleware,
  firebaseCustomerAuthMiddleware
};
