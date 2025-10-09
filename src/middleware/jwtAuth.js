const jwtService = require('../services/jwtService'); // Use singleton instance
const { getFirestore } = require('../services/firebase');

class JWTAuthMiddleware {
  constructor() {
    this.jwtService = jwtService; // Use singleton instance
  }

  /**
   * Main authentication middleware
   * Verifies JWT token and adds user info to request
   */
  authenticate = async (req, res, next) => {
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

      // Validate token format
      if (!this.jwtService.isValidTokenFormat(token)) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN_FORMAT',
            message: 'Invalid token format',
            details: 'Token format is not valid'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Check if token is blacklisted
      const isBlacklisted = await this.jwtService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'TOKEN_BLACKLISTED',
            message: 'Token is blacklisted',
            details: 'This token has been invalidated. Please login again.'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Verify JWT token
      const decodedToken = this.jwtService.verifyToken(token);
      
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

      // Check token type
      if (decodedToken.type !== 'access') {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN_TYPE',
            message: 'Invalid token type',
            details: 'Access token required, refresh token provided'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Get user data from Firestore
      const db = getFirestore();
      const userDoc = await db.collection('users').doc(decodedToken.userId).get();
      
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
        uid: decodedToken.userId,
        phone: decodedToken.phone,
        userType: decodedToken.userType,
        ...userData
      };

      // Add token info for potential use
      req.token = {
        issuedAt: decodedToken.iat,
        expiresAt: decodedToken.exp,
        type: decodedToken.type
      };

      next();
    } catch (error) {
      console.error('JWT Authentication error:', error);
      
      if (error.message === 'Token expired') {
        return res.status(401).json({
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Token expired',
            details: 'Your access token has expired. Please use refresh token to get a new one.'
          },
          timestamp: new Date().toISOString()
        });
      }

      if (error.message === 'Invalid token') {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid access token',
            details: 'The provided token is invalid'
          },
          timestamp: new Date().toISOString()
        });
      }

      return res.status(500).json({
        success: false,
        error: {
          code: 'AUTHENTICATION_ERROR',
          message: 'Authentication failed',
          details: 'An error occurred during authentication'
        },
        timestamp: new Date().toISOString()
      });
    }
  };

  /**
   * Optional authentication middleware
   * Adds user info if token is valid, but doesn't require it
   */
  optionalAuth = async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // No token provided, continue without user info
        req.user = null;
        req.token = null;
        return next();
      }

      // Try to authenticate, but don't fail if invalid
      const token = authHeader.substring(7);
      
      if (!this.jwtService.isValidTokenFormat(token)) {
        req.user = null;
        req.token = null;
        return next();
      }

      try {
        const decodedToken = this.jwtService.verifyToken(token);
        
        if (decodedToken && decodedToken.type === 'access') {
          const db = getFirestore();
          const userDoc = await db.collection('users').doc(decodedToken.userId).get();
          
          if (userDoc.exists) {
            const userData = userDoc.data();
            req.user = {
              uid: decodedToken.userId,
              phone: decodedToken.phone,
              userType: decodedToken.userType,
              ...userData
            };
            req.token = {
              issuedAt: decodedToken.iat,
              expiresAt: decodedToken.exp,
              type: decodedToken.type
            };
          }
        }
      } catch (tokenError) {
        // Token is invalid, but that's okay for optional auth
        console.log('Optional auth token validation failed:', tokenError.message);
      }

      next();
    } catch (error) {
      console.error('Optional authentication error:', error);
      req.user = null;
      req.token = null;
      next();
    }
  };

  /**
   * Role-based access control middleware
   * @param {string|Array} allowedRoles - Role(s) allowed to access
   */
  requireRole = (allowedRoles) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
            details: 'You must be logged in to access this resource'
          },
          timestamp: new Date().toISOString()
        });
      }

      const userRole = req.user.userType;
      const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

      if (!roles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'Access denied',
            details: `This resource requires one of the following roles: ${roles.join(', ')}`
          },
          timestamp: new Date().toISOString()
        });
      }

      next();
    };
  };

  /**
   * Ownership verification middleware
   * Ensures user can only access their own resources
   * @param {string} resourceIdField - Field name containing resource ID
   * @param {string} resourceCollection - Firestore collection name
   */
  requireOwnership = (resourceIdField = 'id', resourceCollection = 'users') => {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
            details: 'You must be logged in to access this resource'
          },
          timestamp: new Date().toISOString()
        });
      }

      const resourceId = req.params[resourceIdField] || req.body[resourceIdField];
      
      if (!resourceId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_RESOURCE_ID',
            message: 'Resource ID required',
            details: `Resource ID field '${resourceIdField}' is required`
          },
          timestamp: new Date().toISOString()
        });
      }

      try {
        const db = getFirestore();
        const resourceDoc = await db.collection(resourceCollection).doc(resourceId).get();
        
        if (!resourceDoc.exists) {
          return res.status(404).json({
            success: false,
            error: {
              code: 'RESOURCE_NOT_FOUND',
              message: 'Resource not found',
              details: 'The requested resource does not exist'
            },
            timestamp: new Date().toISOString()
          });
        }

        const resourceData = resourceDoc.data();
        
        // Check if user owns the resource
        if (resourceData.userId !== req.user.uid && resourceData.uid !== req.user.uid) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'ACCESS_DENIED',
              message: 'Access denied',
              details: 'You can only access your own resources'
            },
            timestamp: new Date().toISOString()
          });
        }

        // Add resource data to request for use in route handlers
        req.resource = resourceData;
        next();
      } catch (error) {
        console.error('Ownership verification error:', error);
        return res.status(500).json({
          success: false,
          error: {
            code: 'OWNERSHIP_VERIFICATION_ERROR',
            message: 'Ownership verification failed',
            details: 'An error occurred while verifying resource ownership'
          },
          timestamp: new Date().toISOString()
        });
      }
    };
  };

  /**
   * Rate limiting middleware for authentication attempts
   * @param {number} maxAttempts - Maximum attempts allowed
   * @param {number} windowMs - Time window in milliseconds
   */
  authRateLimit = (maxAttempts = 5, windowMs = 15 * 60 * 1000) => {
    const attempts = new Map();

    return (req, res, next) => {
      const ip = req.ip || req.connection.remoteAddress;
      const now = Date.now();
      
      // Clean up old attempts
      if (attempts.has(ip)) {
        const userAttempts = attempts.get(ip);
        userAttempts.attempts = userAttempts.attempts.filter(
          timestamp => now - timestamp < windowMs
        );
        
        if (userAttempts.attempts.length === 0) {
          attempts.delete(ip);
        }
      }

      // Check if user has exceeded limit
      if (attempts.has(ip) && attempts.get(ip).attempts.length >= maxAttempts) {
        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many authentication attempts',
            details: `Please wait ${Math.ceil(windowMs / 60000)} minutes before trying again`
          },
          timestamp: new Date().toISOString()
        });
      }

      // Record this attempt
      if (!attempts.has(ip)) {
        attempts.set(ip, { attempts: [] });
      }
      attempts.get(ip).attempts.push(now);

      next();
    };
  };
}

// Create singleton instance
const jwtAuthMiddleware = new JWTAuthMiddleware();

module.exports = jwtAuthMiddleware;
