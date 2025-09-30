const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const JWTService = require('../services/jwtService');
const jwtService = new JWTService(); // Create instance
const firebaseAuthService = require('../services/firebaseAuthService');
const { body, validationResult } = require('express-validator');
const { authLimiter } = require('../middleware/rateLimit');
const { sanitizeInput } = require('../middleware/validation');
// Using Firebase Auth for authentication

// Rate limiting configuration
const authRateLimit = authLimiter;

// Validation helper function
const checkValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: errors.array()
      },
      timestamp: new Date().toISOString()
    });
  }
  next();
};

// const otpRateLimit = rateLimit({
//   windowMs: 5 * 60 * 1000, // 5 minutes
//   max: 10, // limit each IP to 10 OTP requests per windowMs
//   message: 'Too many OTP requests from this IP, please try again later.'
// }); // Removed - MSG91 endpoints deprecated

/**
 * @route POST /api/auth/check-user
 * @desc Check if user exists by phone number
 * @access Public
 */
router.post('/check-user',
  authRateLimit,
  sanitizeInput,
  body('phoneNumber').isString().withMessage('Phone number is required').isLength({ min: 10, max: 15 }).withMessage('Phone number must be between 10 and 15 characters'),
  body('userType').optional().isIn(['customer', 'driver']).withMessage('User type must be customer or driver'),
  checkValidation,
  async (req, res) => {
    try {
      const { phoneNumber, userType = 'customer' } = req.body;

      console.log(`🔍 Checking if user exists: ${phoneNumber} (type: ${userType})`);

      // Check if user exists in database with specific user type
      const userExists = await authService.userExists(phoneNumber, userType);
      
      let userData = null;
      const isCorrectUserType = userExists; // If user exists with the correct type, then it's correct
      
      if (userExists) {
        // Get user data
        const user = await authService.getUserByPhone(phoneNumber, userType);
        userData = user;
        
        console.log(`📊 User found: ${user.userType}, Expected: ${userType}, Match: ${isCorrectUserType}`);
      }

      console.log(`✅ User existence check completed for ${phoneNumber}: exists=${userExists}, correctType=${isCorrectUserType}`);

      res.json({
        success: true,
        message: userExists ? (isCorrectUserType ? 'User exists with correct type' : 'User exists but wrong type') : 'User not found',
        data: {
          exists: userExists,
          userId: userData?.id || null,
          userType: userData?.userType || null,
          isCorrectUserType: isCorrectUserType,
          phoneNumber
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Check user error:', error);

      res.status(400).json({
        success: false,
        message: error.message || 'Failed to check user existence',
        error: {
          code: 'USER_CHECK_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// OTP authentication handled by Firebase Auth

/**
 * @route POST /api/auth/validate-session
 * @desc Validate current session and return user data
 * @access Private
 */
router.post('/validate-session',
  authRateLimit,
  async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'No token provided',
          error: {
            code: 'NO_TOKEN',
            message: 'Authentication token is required'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Verify JWT token
      const decoded = jwtService.verifyToken(token);
      if (!decoded) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token',
          error: {
            code: 'INVALID_TOKEN',
            message: 'Authentication token is invalid or expired'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Get user data
      const user = await authService.getUserById(decoded.userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found',
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User account not found'
          },
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        message: 'Session validated successfully',
        data: {
          user: {
            id: user.id,
            phone: user.phone,
            name: user.name,
            userType: user.userType,
            isVerified: user.isVerified,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Validate session error:', error);

      res.status(401).json({
        success: false,
        message: 'Session validation failed',
        error: {
          code: 'SESSION_VALIDATION_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route PUT /api/auth/profile
 * @desc Update user profile
 * @access Private
 */
router.put('/profile',
  authRateLimit,
  body('name').optional().isString().withMessage('Name must be a string').isLength({ max: 100 }).withMessage('Name cannot exceed 100 characters'),
  body('email').optional().isEmail().withMessage('Invalid email format'),
  body('profilePicture').optional().isString().withMessage('Profile picture must be a string'),
  checkValidation,
  async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'No token provided',
          error: {
            code: 'NO_TOKEN',
            message: 'Authentication token is required'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Verify JWT token
      const decoded = jwtService.verifyToken(token);
      if (!decoded) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token',
          error: {
            code: 'INVALID_TOKEN',
            message: 'Authentication token is invalid or expired'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Update user profile
      const updatedUser = await authService.updateUser(decoded.userId, {
        ...req.body,
        updatedAt: new Date()
      });

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: {
            id: updatedUser.id,
            phone: updatedUser.phone,
            name: updatedUser.name,
            email: updatedUser.email,
            userType: updatedUser.userType,
            isVerified: updatedUser.isVerified,
            profilePicture: updatedUser.profilePicture,
            createdAt: updatedUser.createdAt,
            updatedAt: updatedUser.updatedAt
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Update profile error:', error);

      res.status(400).json({
        success: false,
        message: 'Failed to update profile',
        error: {
          code: 'PROFILE_UPDATE_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/auth/logout
 * @desc Logout user and invalidate token
 * @access Private
 */
router.post('/logout',
  authRateLimit,
  async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      if (token) {
        // Add token to blacklist (optional)
        await jwtService.blacklistToken(token);
      }

      res.json({
        success: true,
        message: 'Logout successful',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Logout error:', error);

      res.status(500).json({
        success: false,
        message: 'Logout failed',
        error: {
          code: 'LOGOUT_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route GET /api/auth/health
 * @desc Get authentication service health status
 * @access Public
 */
router.get('/health', async (req, res) => {
  try {
    // Authentication handled by Firebase Auth
    const authHealth = { status: 'active', message: 'Using Firebase Auth' };
    
    res.json({
      success: true,
      message: 'Authentication service is healthy',
      data: {
        auth: authHealth,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Health check error:', error);

    res.status(500).json({
      success: false,
      message: 'Authentication service health check failed',
      error: {
        code: 'HEALTH_CHECK_ERROR',
        message: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Authentication status handled by Firebase Auth


/**
 * @route POST /api/auth/validate-token
 * @desc Validate JWT token (for debugging)
 * @access Public
 */
router.post('/validate-token',
  authRateLimit,
  body('token').isString().withMessage('Token is required').isLength({ min: 10 }).withMessage('Token must be at least 10 characters'),
  checkValidation,
  async (req, res) => {
    try {
      const { token } = req.body;
      
      // Debug token format
      const tokenParts = token.split('.');
      const tokenInfo = {
        length: token.length,
        parts: tokenParts.length,
        preview: token.substring(0, 30) + '...',
        isValidFormat: tokenParts.length === 3
      };
      
      try {
        const decoded = jwtService.verifyToken(token);
        return res.status(200).json({
          success: true,
          message: 'Token is valid',
          tokenInfo,
          decoded: {
            userId: decoded.userId,
            userType: decoded.userType,
            phone: decoded.phone,
            exp: decoded.exp,
            iat: decoded.iat
          }
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Token validation failed',
          tokenInfo,
          error: error.message
        });
      }
    } catch (error) {
      console.error('Token validation error:', error);
      return res.status(500).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Token validation failed'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/auth/refresh
 * @desc Refresh access token using refresh token
 * @access Public
 */
router.post('/refresh',
  authRateLimit,
  body('refreshToken').isString().withMessage('Refresh token is required').notEmpty().withMessage('Refresh token cannot be empty'),
  checkValidation,
  async (req, res) => {
    try {
      const { refreshToken } = req.body;

      console.log('🔄 Token refresh request received');

      // Refresh the access token
      const tokenData = jwtService.refreshAccessToken(refreshToken);

      console.log('✅ Token refreshed successfully');

      res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          expiresIn: tokenData.expiresIn,
          refreshExpiresIn: tokenData.refreshExpiresIn
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Token refresh error:', error);

      res.status(401).json({
        success: false,
        message: 'Token refresh failed',
        error: {
          code: 'TOKEN_REFRESH_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/auth/firebase/verify-token
 * @desc Verify Firebase ID token and return user data
 * @access Public
 */
router.post('/firebase/verify-token',
  authRateLimit,
  body('idToken').isString().withMessage('ID token is required').notEmpty().withMessage('ID token cannot be empty'),
  body('userType').optional().isIn(['customer', 'driver', 'admin']).withMessage('User type must be customer, driver, or admin'),
  checkValidation,
  async (req, res) => {
    try {
      const { idToken, userType } = req.body;

      console.log('🔐 Verifying Firebase ID token...');

      // Verify Firebase ID token
      const decodedToken = await firebaseAuthService.verifyIdToken(idToken);
      
      // Get user data from Firestore
      const userData = await firebaseAuthService.getUserByUid(decodedToken.uid, userType);
      
      if (!userData) {
        // If user doesn't exist, create them
        console.log('👤 User not found in Firestore, creating new user...');
        const newUserData = await firebaseAuthService.createOrUpdateUser(
          decodedToken, 
          {}, 
          userType || 'customer'
        );
        
        return res.json({
          success: true,
          message: 'Firebase token verified and user created',
          data: {
            user: newUserData,
            token: {
              uid: decodedToken.uid,
              email: decodedToken.email,
              phone_number: decodedToken.phone_number,
              auth_time: new Date(decodedToken.auth_time * 1000).toISOString(),
              expires_at: new Date(decodedToken.exp * 1000).toISOString()
            }
          },
          timestamp: new Date().toISOString()
        });
      }

      // Return existing user data
      res.json({
        success: true,
        message: 'Firebase token verified successfully',
        data: {
          user: userData,
          token: {
            uid: decodedToken.uid,
            email: decodedToken.email,
            phone_number: decodedToken.phone_number,
            auth_time: new Date(decodedToken.auth_time * 1000).toISOString(),
            expires_at: new Date(decodedToken.exp * 1000).toISOString()
          }
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Firebase token verification error:', error);
      
      res.status(401).json({
        success: false,
        message: 'Firebase token verification failed',
        error: {
          code: 'FIREBASE_VERIFICATION_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/auth/firebase/create-user
 * @desc Create or update user in Firestore after Firebase authentication
 * @access Public
 */
router.post('/firebase/create-user',
  authRateLimit,
  body('idToken').isString().withMessage('ID token is required').notEmpty().withMessage('ID token cannot be empty'),
  body('userType').isIn(['customer', 'driver', 'admin']).withMessage('User type must be customer, driver, or admin'),
  body('additionalData').optional().isObject().withMessage('Additional data must be an object'),
  checkValidation,
  async (req, res) => {
    try {
      const { idToken, userType, additionalData = {} } = req.body;

      console.log(`👤 Creating/updating ${userType} user in Firestore...`);

      // Verify Firebase ID token
      const decodedToken = await firebaseAuthService.verifyIdToken(idToken);
      
      // Create or update user in Firestore
      const userData = await firebaseAuthService.createOrUpdateUser(
        decodedToken, 
        additionalData, 
        userType
      );

      res.json({
        success: true,
        message: `${userType} user created/updated successfully`,
        data: {
          user: userData
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error(`❌ Error creating/updating user:`, error);
      
      res.status(500).json({
        success: false,
        message: `Failed to create/update user`,
        error: {
          code: 'USER_CREATION_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/auth/firebase/revoke-session
 * @desc Revoke Firebase user session (sign out)
 * @access Private (requires Firebase auth)
 */
router.post('/firebase/revoke-session',
  authRateLimit,
  async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Firebase ID token required'
          },
          timestamp: new Date().toISOString()
        });
      }

      const idToken = authHeader.substring(7);
      const decodedToken = await firebaseAuthService.verifyIdToken(idToken);
      
      // Revoke user session
      await firebaseAuthService.revokeUserSession(decodedToken.uid);

      res.json({
        success: true,
        message: 'User session revoked successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Error revoking user session:', error);
      
      res.status(500).json({
        success: false,
        message: 'Failed to revoke user session',
        error: {
          code: 'SESSION_REVOKE_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/auth/admin/login
 * @desc Admin login with email/password
 * @access Public
 */
router.post('/admin/login',
  authRateLimit,
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isString().withMessage('Password is required').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  checkValidation,
  async (req, res) => {
    try {
      const { email, password } = req.body;

      console.log(`🔐 Admin login attempt: ${email}`);

      // Check if this is a valid admin email
      const adminEmails = ['admin@epickup.com', 'superadmin@epickup.com'];
      if (!adminEmails.includes(email)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ADMIN_ACCESS_DENIED',
            message: 'Access denied. Admin email not authorized.'
          },
          timestamp: new Date().toISOString()
        });
      }

      // For now, use a simple password check (in production, use proper authentication)
      const adminPassword = 'EpickupAdmin2024!'; // More secure password
      if (password !== adminPassword) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Create admin user data
      const adminUser = {
        uid: `admin_${Date.now()}`,
        email: email,
        name: 'Admin User',
        displayName: 'Admin User',
        role: 'super_admin',
        permissions: ['all'],
        lastLogin: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        isEmailVerified: true
      };

      // Generate JWT token
      const token = jwtService.generateToken({
        uid: adminUser.uid,
        email: adminUser.email,
        role: adminUser.role,
        userType: 'admin'
      });

      console.log(`✅ Admin login successful: ${email}`);

      res.status(200).json({
        success: true,
        message: 'Admin login successful',
        data: {
          user: adminUser,
          token: token,
          expiresIn: '24h'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Admin login error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Internal server error during admin login'
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

module.exports = router;
