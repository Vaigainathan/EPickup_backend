const express = require('express');
const router = express.Router();
const twilioService = require('../services/twilioService');
const authService = require('../services/authService');
const jwtService = require('../services/jwtService');
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
      options: { type: 'object', required: false }
    }
  }),
  async (req, res) => {
    try {
      const { phoneNumber, isSignup = false, options = {} } = req.body;

      console.log(`📱 Sending OTP to ${phoneNumber} (signup: ${isSignup})`);

      // Send OTP via Twilio
      const result = await twilioService.sendOTP(phoneNumber, options);

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

      // Verify OTP via Twilio
      const verificationResult = await twilioService.verifyOTP(phoneNumber, otp, verificationSid);

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

      // Check if this is a signup attempt and user already exists
      const userExists = await authService.userExists(phoneNumber);
      
      if (userExists && name) {
        // User exists but trying to signup with name - this is a duplicate signup attempt
        console.log(`❌ Duplicate signup attempt for existing user: ${phoneNumber}`);
        
        // Log failed signup attempt
        await authService.logAuthAttempt({
          phoneNumber,
          action: 'duplicate_signup',
          success: false,
          error: 'User already exists',
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });

        return res.status(409).json({
          success: false,
          message: 'An account with this phone number already exists. Please login instead.',
          error: {
            code: 'USER_ALREADY_EXISTS',
            message: 'An account with this phone number already exists'
          },
          timestamp: new Date().toISOString()
        });
      }

      // If user exists but no name provided, this is a login attempt
      if (userExists && !name) {
        console.log(`🔐 Login attempt for existing user: ${phoneNumber}`);
        
        // Get existing user
        const existingUser = await authService.getUserByPhone(phoneNumber);
        
        // Generate JWT token for existing user
        const token = jwtService.generateAccessToken({
          userId: existingUser.id,
          phone: existingUser.phone,
          userType: existingUser.userType
        });

        // Log successful login
        await authService.logAuthAttempt({
          phoneNumber,
          action: 'login',
          success: true,
          userId: existingUser.id,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });

        return res.json({
          success: true,
          message: 'Login successful',
          data: {
            user: {
              id: existingUser.id,
              name: existingUser.name,
              phone: existingUser.phone,
              userType: existingUser.userType,
              isVerified: existingUser.isVerified
            },
            token: token,
            isNewUser: false
          },
          timestamp: new Date().toISOString()
        });
      }

      // If user doesn't exist and no name provided, this is invalid
      if (!userExists && !name) {
        console.log(`❌ Login attempt for non-existent user: ${phoneNumber}`);
        
        await authService.logAuthAttempt({
          phoneNumber,
          action: 'login',
          success: false,
          error: 'User not found',
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });

        return res.status(404).json({
          success: false,
          message: 'No account found with this phone number. Please sign up first.',
          error: {
            code: 'USER_NOT_FOUND',
            message: 'No account found with this phone number'
          },
          timestamp: new Date().toISOString()
        });
      }

      // If user doesn't exist and name is provided, this is a new signup
      if (!userExists && name) {
        console.log(`📝 New signup attempt: ${phoneNumber}`);
        
        // Create new user
        const { user, isNewUser } = await authService.getOrCreateUser(phoneNumber, {
          name: name,
          userType: userType
        });

        // Generate JWT token
        const token = jwtService.generateAccessToken({
          userId: user.id,
          phone: user.phone,
          userType: user.userType
        });

        // Log successful signup
        await authService.logAuthAttempt({
          phoneNumber,
          action: 'signup',
          success: true,
          userId: user.id,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });

        return res.json({
          success: true,
          message: 'Account created successfully',
          data: {
            user: {
              id: user.id,
              name: user.name,
              phone: user.phone,
              userType: user.userType,
              isVerified: user.isVerified
            },
            token: token,
            isNewUser: true
          },
          timestamp: new Date().toISOString()
        });
      }



      // Log successful authentication
      await authService.logAuthAttempt({
        phoneNumber,
        action: 'verify_otp',
        success: true,
        userId: user.id,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });

      console.log(`✅ OTP verification successful for ${phoneNumber}`);

      res.json({
        success: true,
        message: isNewUser ? 'Account created and verified successfully' : 'Login successful',
        data: {
          user: {
            id: user.id,
            phone: user.phone,
            name: user.name,
            userType: user.userType,
            isVerified: user.isVerified,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
          },
          accessToken: token,
          isNewUser,
          expiresIn: '7d'
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

      // Resend OTP via Twilio
      const result = await twilioService.resendOTP(phoneNumber, options);

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
    const twilioHealth = await twilioService.getHealthStatus();
    
    res.json({
      success: true,
      message: 'Authentication service is healthy',
      data: {
        twilio: twilioHealth,
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
 * @route GET /api/auth/twilio-status
 * @desc Check Twilio service status and configuration
 * @access Public
 */
router.get('/twilio-status', async (req, res) => {
  try {
    const twilioHealth = await twilioService.getHealthStatus();
    const twilioConfig = env.getTwilioConfig();
    
    // Debug environment variables
    const debugEnv = {
      TWILIO_ENABLED: process.env.TWILIO_ENABLED,
      TWILIO_MOCK_MODE: process.env.TWILIO_MOCK_MODE,
      TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ? 'SET' : 'NOT SET',
      TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ? 'SET' : 'NOT SET',
      TWILIO_VERIFY_SERVICE_SID: process.env.TWILIO_VERIFY_SERVICE_SID ? 'SET' : 'NOT SET',
      NODE_ENV: process.env.NODE_ENV
    };
    
    // Check if there are any issues
    const hasIssues = twilioHealth.mockMode || twilioHealth.errorCount > 0 || twilioHealth.lastError;
    const status = hasIssues ? 'warning' : 'healthy';
    
    console.log(`📊 Twilio Status Check - Status: ${status}, Mock Mode: ${twilioHealth.mockMode}, Error Count: ${twilioHealth.errorCount}`);
    
    res.json({
      success: true,
      message: 'Twilio status retrieved successfully',
      data: {
        status: status,
        health: twilioHealth,
        config: {
          enabled: env.isTwilioEnabled(),
          hasAccountSid: !!twilioConfig.accountSid,
          hasAuthToken: !!twilioConfig.authToken,
          hasVerifyServiceSid: !!twilioConfig.verifyServiceSid,
          mockMode: twilioConfig.mockMode
        },
        debug: debugEnv,
        issues: hasIssues ? {
          mockMode: twilioHealth.mockMode,
          errorCount: twilioHealth.errorCount,
          lastError: twilioHealth.lastError
        } : null,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Twilio status check error:', error);

    res.status(500).json({
      success: false,
      message: 'Failed to check Twilio status',
      error: {
        code: 'TWILIO_STATUS_ERROR',
        message: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
