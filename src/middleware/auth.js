const jwt = require('jsonwebtoken');
const { getFirestore } = require('../services/firebase');

/**
 * Authentication middleware
 * Verifies JWT token and adds user info to request
 */
const authMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Access token required',
          details: 'Please provide a valid Bearer token in the Authorization header'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Extract token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Check if token is malformed before verification
    if (!token || token.length < 10) {
      console.error('JWT verification failed: jwt malformed - token too short or empty');
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or malformed token'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Verify JWT token
    const secret = process.env.JWT_SECRET || 'your-secret-key';
    let decodedToken;
    
    try {
      decodedToken = jwt.verify(token, secret, {
        issuer: 'epickup-app',
        audience: 'epickup-users'
      });
    } catch (verifyError) {
      // If verification fails with issuer/audience, try without them
      try {
        decodedToken = jwt.verify(token, secret);
      } catch (fallbackError) {
        console.error('JWT verification failed:', verifyError.message, 'Fallback failed:', fallbackError.message);
        
        // Handle specific JWT errors
        if (verifyError.name === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            error: {
              code: 'TOKEN_EXPIRED',
              message: 'Token has expired. Please login again.'
            },
            timestamp: new Date().toISOString()
          });
        } else if (verifyError.name === 'JsonWebTokenError') {
          return res.status(401).json({
            success: false,
            error: {
              code: 'INVALID_TOKEN',
              message: 'Invalid token format'
            },
            timestamp: new Date().toISOString()
          });
        }
        
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTHENTICATION_FAILED',
            message: 'Authentication failed'
          },
          timestamp: new Date().toISOString()
        });
      }
    }
    
    if (!decodedToken) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid access token',
          details: 'The provided token is invalid or has expired'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get user data from Firestore
    const db = getFirestore();
    const userId = decodedToken.userId || decodedToken.uid;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid access token',
          details: 'Token does not contain valid user ID'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'User account does not exist in the system'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();

    // Check if user is active
    if (!userData.isActive) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'USER_INACTIVE',
          message: 'Account deactivated',
          details: 'Your account has been deactivated. Please contact support.'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Add user info to request
    req.user = {
      uid: userId,
      phone: decodedToken.phone,
      userType: userData.userType,
      ...userData
    };

    // Add token info for potential use
    req.token = {
      issuedAt: decodedToken.iat,
      expiresAt: decodedToken.exp,
      authTime: decodedToken.auth_time
    };

    next();
  } catch (error) {
    console.error('Authentication error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Token expired',
          details: 'Your access token has expired. Please login again.'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_REVOKED',
          message: 'Token revoked',
          details: 'Your access token has been revoked. Please login again.'
        },
        timestamp: new Date().toISOString()
      });
    }

    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed',
        details: 'An error occurred during authentication. Please try again.'
      },
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Admin authentication middleware
 * Handles admin JWT token authentication
 */
const adminAuthMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Access token required',
          details: 'Please provide a valid Bearer token in the Authorization header'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Extract token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify JWT token
    const secret = process.env.JWT_SECRET || 'your-secret-key';
    let decodedToken;
    
    try {
      decodedToken = jwt.verify(token, secret, {
        issuer: 'epickup-app',
        audience: 'epickup-users'
      });
    } catch (verifyError) {
      // If verification fails with issuer/audience, try without them
      try {
        decodedToken = jwt.verify(token, secret);
      } catch (fallbackError) {
        console.error('Admin JWT verification failed:', verifyError.message, 'Fallback failed:', fallbackError.message);
        
        // Handle specific JWT errors
        if (verifyError.name === 'TokenExpiredError') {
          return res.status(401).json({
            success: false,
            error: {
              code: 'TOKEN_EXPIRED',
              message: 'Token has expired. Please login again.'
            },
            timestamp: new Date().toISOString()
          });
        } else if (verifyError.name === 'JsonWebTokenError') {
          return res.status(401).json({
            success: false,
            error: {
              code: 'INVALID_TOKEN',
              message: 'Invalid token format'
            },
            timestamp: new Date().toISOString()
          });
        }
        
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTHENTICATION_FAILED',
            message: 'Authentication failed'
          },
          timestamp: new Date().toISOString()
        });
      }
    }
    
    if (!decodedToken) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid access token',
          details: 'The provided token is invalid or has expired'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if this is an admin token
    if (decodedToken.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
          details: 'This resource requires admin privileges'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Set user info in request
    req.user = {
      uid: decodedToken.userId,
      id: decodedToken.userId,
      userType: decodedToken.userType,
      role: decodedToken.role,
      email: decodedToken.email,
      name: decodedToken.name || 'Admin User',
      permissions: ['all']
    };

    next();
  } catch (error) {
    console.error('Admin auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'AUTHENTICATION_ERROR',
        message: 'Authentication failed'
      },
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Role-based authorization middleware
 * @param {Array<string>} allowedRoles - Array of allowed user types
 */
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
          details: 'Please login to access this resource'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!allowedRoles.includes(req.user.userType)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
          details: `This resource requires one of the following roles: ${allowedRoles.join(', ')}`
        },
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

/**
 * Customer-only middleware
 */
const requireCustomer = requireRole(['customer']);

/**
 * Driver-only middleware
 */
const requireDriver = requireRole(['driver']);

/**
 * Admin-only middleware
 */
const requireAdmin = requireRole(['admin']);

/**
 * Optional authentication middleware
 * Similar to authMiddleware but doesn't fail if no token is provided
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No token provided, continue without authentication
      req.user = null;
      req.token = null;
      return next();
    }

    // Try to authenticate
    const token = authHeader.substring(7);
    const decodedToken = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    
    if (decodedToken) {
      const db = getFirestore();
      const userDoc = await db.collection('users').doc(decodedToken.uid).get();
      
      if (userDoc.exists) {
        const userData = userDoc.data();
        req.user = {
          uid: decodedToken.uid,
          phone: decodedToken.phone_number,
          userType: userData.userType,
          ...userData
        };
        req.token = {
          issuedAt: decodedToken.iat,
          expiresAt: decodedToken.exp,
          authTime: decodedToken.auth_time
        };
      }
    }

    next();
  } catch (error) {
    // Authentication failed, but continue without user info
    console.warn('Optional authentication failed:', error.message);
    req.user = null;
    req.token = null;
    next();
  }
};

/**
 * Check if user owns the resource
 * @param {string} resourceIdField - Field name containing the resource ID
 * @param {string} resourceCollection - Collection name for the resource
 */
const requireOwnership = (resourceIdField = 'id', resourceCollection = 'users') => {
  return async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
        details: 'Please login to access this resource'
      },
      timestamp: new Date().toISOString()
    });
  }

    // Admin users can access any resource
    if (req.user.userType === 'admin') {
      return next();
    }

    try {
      const resourceId = req.params[resourceIdField] || req.body[resourceIdField];
      if (!resourceId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_RESOURCE_ID',
            message: 'Resource ID is required',
            details: `Resource ID field '${resourceIdField}' is missing`
          },
          timestamp: new Date().toISOString()
        });
      }

      // Get the resource from database to check ownership
      const { getFirestore } = require('../services/firebase');
      const db = getFirestore();
      const resourceDoc = await db.collection(resourceCollection).doc(resourceId).get();

      if (!resourceDoc.exists) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: 'Resource not found',
            details: 'The specified resource does not exist'
          },
          timestamp: new Date().toISOString()
        });
      }

      const resourceData = resourceDoc.data();
      const resourceOwnerId = resourceData.customerId || resourceData.userId || resourceData.uid;

      // Check if user owns the resource
      if (req.user.uid !== resourceOwnerId) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Access denied',
            details: 'You can only access your own resources'
          },
          timestamp: new Date().toISOString()
        });
      }

      next();
    } catch (error) {
      console.error('Error checking resource ownership:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to verify resource ownership',
          details: 'An error occurred while checking resource permissions'
        },
        timestamp: new Date().toISOString()
      });
    }
  };
};

/**
 * Rate limiting for specific user actions
 * @param {number} maxAttempts - Maximum attempts allowed
 * @param {number} windowMs - Time window in milliseconds
 */
const userRateLimit = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
  const attempts = new Map();

  return (req, res, next) => {
    if (!req.user) {
      return next();
    }

    const userId = req.user.uid;
    const now = Date.now();
    const userAttempts = attempts.get(userId) || { count: 0, resetTime: now + windowMs };

    // Reset counter if window has passed
    if (now > userAttempts.resetTime) {
      userAttempts.count = 0;
      userAttempts.resetTime = now + windowMs;
    }

    // Check if user has exceeded limit
    if (userAttempts.count >= maxAttempts) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many attempts',
          details: `You have exceeded the maximum attempts. Please try again in ${Math.ceil((userAttempts.resetTime - now) / 1000 / 60)} minutes.`
        },
        timestamp: new Date().toISOString()
      });
    }

    // Increment attempt counter
    userAttempts.count++;
    attempts.set(userId, userAttempts);

    next();
  };
};

module.exports = {
  authenticateToken: authMiddleware,
  authMiddleware,
  adminAuthMiddleware,
  requireRole,
  requireCustomer,
  requireDriver,
  requireAdmin,
  optionalAuth,
  requireOwnership,
  userRateLimit
};
