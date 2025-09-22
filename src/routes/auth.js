const express = require('express');
const router = express.Router();
const msg91Service = require('../services/msg91Service');
const authService = require('../services/authService');
const JWTService = require('../services/jwtService');
const jwtService = new JWTService(); // Create instance
const { validateRequest } = require('../middleware/validation');
const { rateLimit } = require('../middleware/rateLimit');
const { env } = require('../config');

// Rate limiting configuration
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many authentication requests from this IP, please try again later.'
});

const otpRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // limit each IP to 10 OTP requests per windowMs
  message: 'Too many OTP requests from this IP, please try again later.'
});

/**
 * @route POST /api/auth/check-user
 * @desc Check if user exists by phone number
 * @access Public
 */
router.post('/check-user',
  authRateLimit,
  validateRequest({
    body: {
      phoneNumber: { type: 'string', required: true, minLength: 10, maxLength: 15 },
      userType: { type: 'string', required: false, enum: ['customer', 'driver'] }
    }
  }),
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

/**
 * @route POST /api/auth/send-otp
 * @desc Send OTP to phone number
 * @access Public
 */
router.post('/send-otp', 
  otpRateLimit,
  validateRequest({
    body: {
      phoneNumber: { type: 'string', required: true, minLength: 10, maxLength: 15 },
      isSignup: { type: 'boolean', required: false },
      userType: { type: 'string', required: false, enum: ['customer', 'driver'] },
      options: { type: 'object', required: false }
    }
  }),
  async (req, res) => {
    try {
      const { phoneNumber, isSignup = false, userType = 'customer', options = {} } = req.body;

      console.log(`📱 Sending OTP to ${phoneNumber} (signup: ${isSignup}, userType: ${userType})`);

      // Send OTP via MSG91
      const result = await msg91Service.sendOTP(phoneNumber, options);

      if (!result.success) {
        console.error('❌ OTP send failed:', result);
        return res.status(400).json({
          success: false,
          message: 'Failed to send OTP',
          error: {
            code: 'OTP_SEND_FAILED',
            message: result.message || 'Failed to send OTP'
          }
        });
      }

      // Log OTP sending for audit
      await authService.logAuthAttempt({
        phoneNumber,
        action: 'send_otp',
        success: true,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      console.log(`✅ OTP sent successfully to ${phoneNumber}`);

      res.json({
        success: true,
        message: 'OTP sent successfully',
        data: {
          sessionId: result.sid,
          expiresIn: result.expiresIn,
          channel: result.channel
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Send OTP error:', error);

      // Log failed attempt
      await authService.logAuthAttempt({
        phoneNumber: req.body.phoneNumber,
        action: 'send_otp',
        success: false,
        error: error.message,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(400).json({
        success: false,
        message: error.message || 'Failed to send OTP',
        error: {
          code: 'OTP_SEND_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/auth/verify-otp
 * @desc Verify OTP and authenticate user
 * @access Public
 */
router.post('/verify-otp',
  otpRateLimit,
  validateRequest({
    body: {
      phoneNumber: { type: 'string', required: true, minLength: 10, maxLength: 15 },
      otp: { type: 'string', required: true, minLength: 6, maxLength: 6 },
      verificationSid: { type: 'string', required: false },
      name: { type: 'string', required: false, maxLength: 100 },
      userType: { type: 'string', required: false, enum: ['customer', 'driver'] }
    }
  }),
  async (req, res) => {
    try {
      const { phoneNumber, otp, verificationSid, name, userType = 'customer' } = req.body;

      console.log(`🔐 Verifying OTP for ${phoneNumber}`);
      console.log(`📝 Request body:`, { phoneNumber, otp, verificationSid, name, userType });

      // Verify OTP via MSG91
      const verificationResult = await msg91Service.verifyOTP(phoneNumber, otp, verificationSid);

      if (!verificationResult.success) {
        console.error('❌ OTP verification failed:', verificationResult);
        
        // Log failed verification
        await authService.logAuthAttempt({
          phoneNumber,
          action: 'verify_otp',
          success: false,
          error: 'Invalid OTP',
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });

        return res.status(400).json({
          success: false,
          message: 'Invalid OTP code',
          error: {
            code: 'INVALID_OTP',
            message: 'The OTP code you entered is invalid or has expired'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Simplified user handling logic
      const userExists = await authService.userExists(phoneNumber, userType);
      
      console.log(`📊 User exists check: ${userExists}, Name provided: ${!!name}, UserType: ${userType}`);
      
      let user, isNewUser = false;
      
      if (userExists) {
        // User exists - handle login
        console.log(`🔐 Login attempt for existing ${userType} user: ${phoneNumber}`);
        
        if (name) {
          // User exists but trying to signup - duplicate signup attempt
          console.log(`❌ Duplicate signup attempt for existing ${userType} user: ${phoneNumber}`);
          
          await authService.logAuthAttempt({
            phoneNumber,
            action: 'duplicate_signup',
            success: false,
            error: `${userType} user already exists`,
            ip: req.ip,
            userAgent: req.get('User-Agent')
          });

          return res.status(409).json({
            success: false,
            message: `A ${userType} account with this phone number already exists. Please login instead.`,
            error: {
              code: 'USER_ALREADY_EXISTS',
              message: `${userType} account already exists`
            },
            timestamp: new Date().toISOString()
          });
        }
        
        // Get existing user
        user = await authService.getUserByPhone(phoneNumber, userType);
        isNewUser = false;
        
      } else {
        // User doesn't exist - handle signup
        // For new users, generate a default name if not provided
        const userName = name || `User_${phoneNumber.slice(-4)}`;
        
        console.log(`📝 New signup attempt: ${phoneNumber}`);
        
        // Create new user
        const result = await authService.getOrCreateUser(phoneNumber, {
          name: userName,
          userType: userType
        });
        user = result.user;
        isNewUser = true;
      }

      // Mark user as verified after successful OTP verification
      if (!user.isVerified) {
        console.log(`🔐 Marking user as verified: ${phoneNumber}`);
        await authService.updateUser(user.id, {
          isVerified: true,
          phoneVerified: true,
          updatedAt: new Date()
        });
        user.isVerified = true;
        user.phoneVerified = true;
      }

      // Generate JWT token pair
      const tokenData = jwtService.generateTokenPair({
        userId: user.id,
        phone: user.phone,
        userType: user.userType
      });

      // Log successful authentication
      await authService.logAuthAttempt({
        phoneNumber,
        action: isNewUser ? 'signup' : 'login',
        success: true,
        userId: user.id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      console.log(`✅ OTP verification successful for ${phoneNumber} - ${isNewUser ? 'New user' : 'Existing user'} - Verified: ${user.isVerified}`);

      return res.json({
        success: true,
        message: isNewUser ? 'Account created successfully' : 'Login successful',
        data: {
          user: {
            id: user.id,
            name: user.name,
            phone: user.phone,
            userType: user.userType,
            isVerified: user.isVerified,
            phoneVerified: user.phoneVerified,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
          },
          token: tokenData.accessToken,
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          isNewUser: isNewUser,
          expiresIn: '7d',
          refreshExpiresIn: '30d'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Verify OTP error:', error);

      // Log failed attempt
      await authService.logAuthAttempt({
        phoneNumber: req.body.phoneNumber,
        action: 'verify_otp',
        success: false,
        error: error.message,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(400).json({
        success: false,
        message: error.message || 'Failed to verify OTP',
        error: {
          code: 'OTP_VERIFY_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/auth/verify-widget-otp
 * @desc Verify OTP that was already verified by MSG91 Widget and authenticate user
 * @access Public
 */
router.post('/verify-widget-otp',
  otpRateLimit,
  validateRequest({
    body: {
      phoneNumber: { type: 'string', required: true, minLength: 10, maxLength: 15 },
      name: { type: 'string', required: false, maxLength: 100 },
      userType: { type: 'string', required: false, enum: ['customer', 'driver'] },
      widgetToken: { type: 'string', required: false } // JWT token from MSG91 widget
    }
  }),
  async (req, res) => {
    try {
      const { phoneNumber, name, userType = 'customer', widgetToken } = req.body;

      console.log(`🔐 Creating user session for widget-verified OTP: ${phoneNumber}`);
      console.log(`📝 Request body:`, { phoneNumber, name, userType, hasWidgetToken: !!widgetToken });

      // If widget token is provided, verify it with MSG91
      if (widgetToken) {
        console.log('🔐 Verifying MSG91 widget token...');
        const tokenVerification = await msg91Service.verifyWidgetToken(widgetToken);
        
        if (!tokenVerification.success) {
          console.error('❌ Widget token verification failed:', tokenVerification);
          return res.status(400).json({
            success: false,
            message: 'Invalid widget token',
            error: {
              code: 'INVALID_WIDGET_TOKEN',
              message: 'The widget token is invalid or expired'
            },
            timestamp: new Date().toISOString()
          });
        }
        
        console.log('✅ Widget token verified successfully');
      } else {
        console.log('⚠️ No widget token provided, proceeding without verification (for testing)');
      }

      // Since OTP was already verified by MSG91 Widget, we can proceed directly to user creation
      // Simplified user handling logic
      const userExists = await authService.userExists(phoneNumber, userType);
      
      console.log(`📊 User exists check: ${userExists}, Name provided: ${!!name}, UserType: ${userType}`);
      
      let user, isNewUser = false;
      
      if (userExists) {
        // User exists - handle login
        console.log(`🔐 Login attempt for existing ${userType} user: ${phoneNumber}`);
        
        if (name) {
          // User exists but trying to signup - duplicate signup attempt
          console.log(`❌ Duplicate signup attempt for existing ${userType} user: ${phoneNumber}`);
          
          await authService.logAuthAttempt({
            phoneNumber,
            action: 'duplicate_signup',
            success: false,
            error: `${userType} user already exists`,
            ip: req.ip,
            userAgent: req.get('User-Agent')
          });

          return res.status(409).json({
            success: false,
            message: `A ${userType} account with this phone number already exists. Please login instead.`,
            error: {
              code: 'USER_ALREADY_EXISTS',
              message: `${userType} account already exists`
            },
            timestamp: new Date().toISOString()
          });
        }
        
        // Get existing user
        user = await authService.getUserByPhone(phoneNumber, userType);
        isNewUser = false;
        
      } else {
        // User doesn't exist - handle signup
        // For new users, generate a default name if not provided
        const userName = name || `User_${phoneNumber.slice(-4)}`;
        
        console.log(`📝 New signup attempt: ${phoneNumber}`);
        
        // Create new user
        const result = await authService.getOrCreateUser(phoneNumber, {
          name: userName,
          userType: userType
        });
        user = result.user;
        isNewUser = true;
      }

      // Mark user as verified after successful OTP verification
      if (!user.isVerified) {
        console.log(`🔐 Marking user as verified (widget): ${phoneNumber}`);
        await authService.updateUser(user.id, {
          isVerified: true,
          phoneVerified: true,
          updatedAt: new Date()
        });
        user.isVerified = true;
        user.phoneVerified = true;
      }

      // Generate JWT token
      const token = jwtService.generateAccessToken({
        userId: user.id,
        phone: user.phone,
        userType: user.userType
      });

      // Log successful authentication
      await authService.logAuthAttempt({
        phoneNumber,
        action: isNewUser ? 'signup' : 'login',
        success: true,
        userId: user.id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      console.log(`✅ Widget-verified OTP authentication successful for ${phoneNumber} - ${isNewUser ? 'New user' : 'Existing user'} - Verified: ${user.isVerified}`);

      return res.json({
        success: true,
        message: isNewUser ? 'Account created successfully' : 'Login successful',
        data: {
          user: {
            id: user.id,
            name: user.name,
            phone: user.phone,
            userType: user.userType,
            isVerified: user.isVerified,
            phoneVerified: user.phoneVerified,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
          },
          token: token,
          accessToken: token, // Keep both for backward compatibility
          isNewUser: isNewUser,
          expiresIn: '7d'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Verify widget OTP error:', error);

      // Log failed attempt
      await authService.logAuthAttempt({
        phoneNumber: req.body.phoneNumber,
        action: 'verify_widget_otp',
        success: false,
        error: error.message,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(400).json({
        success: false,
        message: error.message || 'Failed to verify widget OTP',
        error: {
          code: 'WIDGET_OTP_VERIFY_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

/**
 * @route POST /api/auth/resend-otp
 * @desc Resend OTP to phone number
 * @access Public
 */
router.post('/resend-otp',
  otpRateLimit,
  validateRequest({
    body: {
      phoneNumber: { type: 'string', required: true, minLength: 10, maxLength: 15 },
      options: { type: 'object', required: false }
    }
  }),
  async (req, res) => {
    try {
      const { phoneNumber, options = {} } = req.body;

      console.log(`📱 Resending OTP to ${phoneNumber}`);

      // Resend OTP via MSG91
      const result = await msg91Service.resendOTP(phoneNumber, options);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: 'Failed to resend OTP',
          error: {
            code: 'OTP_RESEND_FAILED',
            message: result.message || 'Failed to resend OTP'
          }
        });
      }

      // Log resend attempt
      await authService.logAuthAttempt({
        phoneNumber,
        action: 'resend_otp',
        success: true,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.json({
        success: true,
        message: 'OTP resent successfully',
        data: {
          sessionId: result.sid,
          expiresIn: result.expiresIn,
          channel: result.channel
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Resend OTP error:', error);

      // Log failed attempt
      await authService.logAuthAttempt({
        phoneNumber: req.body.phoneNumber,
        action: 'resend_otp',
        success: false,
        error: error.message,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      res.status(400).json({
        success: false,
        message: error.message || 'Failed to resend OTP',
        error: {
          code: 'OTP_RESEND_ERROR',
          message: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
);

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
  validateRequest({
    body: {
      name: { type: 'string', required: false, maxLength: 100 },
      email: { type: 'string', required: false, format: 'email' },
      profilePicture: { type: 'string', required: false }
    }
  }),
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
    const msg91Health = await msg91Service.getHealthStatus();
    
    res.json({
      success: true,
      message: 'Authentication service is healthy',
      data: {
        msg91: msg91Health,
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

/**
 * @route GET /api/auth/msg91-status
 * @desc Check MSG91 service status and configuration
 * @access Public
 */
router.get('/msg91-status', async (req, res) => {
  try {
    const msg91Health = await msg91Service.getHealthStatus();
    const msg91Config = env.getMsg91Config();
    
    // Debug environment variables
    const debugEnv = {
      MSG91_ENABLED: process.env.MSG91_ENABLED,
      MSG91_MOCK_MODE: process.env.MSG91_MOCK_MODE,
      MSG91_AUTH_KEY: process.env.MSG91_AUTH_KEY ? 'SET' : 'NOT SET',
      MSG91_SENDER_ID: process.env.MSG91_SENDER_ID ? 'SET' : 'NOT SET',
      MSG91_API_URL: process.env.MSG91_API_URL ? 'SET' : 'NOT SET',
      NODE_ENV: process.env.NODE_ENV
    };
    
    // Check if there are any issues
    const hasIssues = msg91Health.mockMode || msg91Health.errorCount > 0 || msg91Health.lastError;
    const status = hasIssues ? 'warning' : 'healthy';
    
    console.log(`📊 MSG91 Status Check - Status: ${status}, Mock Mode: ${msg91Health.mockMode}, Error Count: ${msg91Health.errorCount}`);
    
    res.json({
      success: true,
      message: 'MSG91 status retrieved successfully',
      data: {
        status: status,
        health: msg91Health,
        config: {
          enabled: env.isMsg91Enabled(),
          hasAuthKey: !!msg91Config.authKey,
          hasSenderId: !!msg91Config.senderId,
          hasApiUrl: !!msg91Config.apiUrl,
          mockMode: msg91Config.mockMode
        },
        debug: debugEnv,
        issues: hasIssues ? {
          mockMode: msg91Health.mockMode,
          errorCount: msg91Health.errorCount,
          lastError: msg91Health.lastError
        } : null,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ MSG91 status check error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to check MSG91 status',
      error: {
        code: 'MSG91_STATUS_ERROR',
        message: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route GET /api/auth/mock-otp-status
 * @desc Check mock OTP service status and get active OTPs
 * @access Public
 */
router.get('/mock-otp-status', async (req, res) => {
  try {
    const mockOTPService = require('../services/mockOTPService');
    const status = mockOTPService.getStatus();
    const activeOTPs = mockOTPService.getActiveOTPs();
    
    console.log(`🧪 Mock OTP Status Check - Enabled: ${status.enabled}, Active OTPs: ${status.activeOTPs}`);
    
    res.json({
      success: true,
      message: 'Mock OTP status retrieved successfully',
      data: {
        status: status,
        activeOTPs: activeOTPs,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Mock OTP status check error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to check mock OTP status',
      error: {
        code: 'MOCK_OTP_STATUS_ERROR',
        message: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route POST /api/auth/refresh
 * @desc Refresh access token using refresh token
 * @access Public
 */
router.post('/refresh',
  authRateLimit,
  validateRequest({
    body: {
      refreshToken: { type: 'string', required: true }
    }
  }),
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

module.exports = router;
