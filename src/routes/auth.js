const express = require('express');
const { body, validationResult } = require('express-validator');
const authService = require('../services/authService');
const passwordService = require('../services/passwordService');
const emailService = require('../services/emailService');
const auditService = require('../services/auditService');
const sessionService = require('../services/sessionService');
const { requireRole } = require('../middleware/auth');
const { userRateLimit } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   POST /api/auth/send-otp
 * @desc    Send OTP to phone number for authentication
 * @access  Public
 */
router.post('/send-otp', [
  body('phoneNumber')
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number'),
  body('isSignup')
    .optional()
    .isBoolean()
    .withMessage('isSignup must be a boolean'),
  body('recaptchaToken')
    .optional()
    .isString()
    .withMessage('reCAPTCHA token must be a string')
], async (req, res) => {
  try {
    // Check validation errors
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

    const { phoneNumber, isSignup = false, recaptchaToken } = req.body;

    // Check if user already exists
    const existingUser = await getUserByPhone(phoneNumber);
    
    if (isSignup && existingUser) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'USER_EXISTS',
          message: 'User already exists',
          details: 'A user with this phone number is already registered. Please login instead.'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!isSignup && !existingUser) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'No user found with this phone number. Please sign up first.'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Store OTP session in Firestore
    const db = getFirestore();
    const sessionRef = db.collection('otpSessions').doc(phoneNumber);
    
    const sessionData = {
      phoneNumber,
      isSignup,
      recaptchaToken,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      status: 'pending',
      resendCount: 0,
      attempts: 0,
      maxAttempts: 3
    };

    await sessionRef.set(sessionData);

    // In production, this would trigger Firebase Phone Auth
    // For now, we'll simulate OTP generation
    const mockOTP = process.env.NODE_ENV === 'development' ? '123456' : null;

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      data: {
        phoneNumber,
        isSignup,
        sessionId: phoneNumber,
        expiresIn: '10 minutes',
        resendCount: 0,
        maxResends: 3,
        ...(mockOTP && { debugOTP: mockOTP }) // Only include in development
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error sending OTP:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'OTP_SEND_ERROR',
        message: 'Failed to send OTP',
        details: 'An error occurred while sending OTP. Please try again.'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/verify-otp
 * @desc    Verify OTP and authenticate user
 * @access  Public
 */
router.post('/verify-otp', [
  body('phoneNumber')
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number'),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('OTP must be exactly 6 digits'),
  body('firebaseIdToken')
    .optional()
    .isString()
    .withMessage('Firebase ID token must be a string'),
  body('name')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('userType')
    .optional()
    .isIn(['customer', 'driver'])
    .withMessage('User type must be either customer or driver')
], async (req, res) => {
  try {
    // Check validation errors
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

    const { phoneNumber, otp, firebaseIdToken, name, userType = 'customer' } = req.body;

    // Verify OTP session
    const db = getFirestore();
    const sessionRef = db.collection('otpSessions').doc(phoneNumber);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_ACTIVE_SESSION',
          message: 'No active OTP session',
          details: 'Please request a new OTP first.'
        },
        timestamp: new Date().toISOString()
      });
    }

    const sessionData = sessionDoc.data();

    // Check if session has expired
    if (new Date() > sessionData.expiresAt.toDate()) {
      await sessionRef.delete();
      return res.status(400).json({
        success: false,
        error: {
          code: 'SESSION_EXPIRED',
          message: 'OTP session expired',
          details: 'Your OTP session has expired. Please request a new OTP.'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check attempt limit
    if (sessionData.attempts >= sessionData.maxAttempts) {
      await sessionRef.delete();
      return res.status(429).json({
        success: false,
        error: {
          code: 'MAX_ATTEMPTS_EXCEEDED',
          message: 'Maximum attempts exceeded',
          details: 'You have exceeded the maximum verification attempts. Please request a new OTP.'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update attempt count
    await sessionRef.update({
      attempts: sessionData.attempts + 1
    });

    // Verify OTP (in production, this would verify against Firebase)
    let isValidOTP = false;
    
    if (process.env.NODE_ENV === 'development' && otp === '123456') {
      isValidOTP = true;
    } else if (firebaseIdToken) {
      try {
        // Verify Firebase ID token
        const decodedToken = await verifyIdToken(firebaseIdToken);
        if (decodedToken.phone_number === phoneNumber) {
          isValidOTP = true;
        }
      } catch (error) {
        console.error('Firebase token verification failed:', error);
      }
    }

    if (!isValidOTP) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OTP',
          message: 'Invalid OTP',
          details: 'The OTP you entered is incorrect. Please try again.'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if user exists
    const existingUser = await getUserByPhone(phoneNumber);
    let user;
    let isNewUser = false;

    if (existingUser) {
      // User exists, get user data from Firestore
      const userDoc = await db.collection('users').doc(existingUser.uid).get();
      
      if (userDoc.exists) {
        user = userDoc.data();
        user.id = existingUser.uid;
      } else {
        // User exists in Auth but not in Firestore, create Firestore document
        user = {
          id: existingUser.uid,
          phone: phoneNumber,
          name: existingUser.displayName || 'User',
          userType: 'customer', // Default type
          isVerified: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        
        await db.collection('users').doc(existingUser.uid).set(user);
      }
    } else {
      // Create new user
      if (!name) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'NAME_REQUIRED',
            message: 'Name required for new users',
            details: 'Please provide a name for new user registration'
          },
          timestamp: new Date().toISOString()
        });
      }

      // Create user in Firebase Auth (if not already created by Phone Auth)
      let userRecord;
      try {
        userRecord = await createUser(phoneNumber, {
          displayName: name,
          phoneNumber: phoneNumber
        });
      } catch (error) {
        if (error.code === 'auth/phone-number-already-exists') {
          // User was created by Phone Auth, get the existing user
          userRecord = await getUserByPhone(phoneNumber);
        } else {
          throw error;
        }
      }

      // Create user document in Firestore
      const userData = {
        id: userRecord.uid,
        phone: phoneNumber,
        name: name,
        userType: userType,
        isVerified: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Add user type specific data
      if (userType === 'customer') {
        userData.customer = {
          wallet: {
            balance: 0,
            currency: 'INR'
          },
          savedAddresses: [],
          preferences: {
            vehicleType: '2_wheeler',
            maxWeight: 10,
            paymentMethod: 'cash'
          }
        };
      } else if (userType === 'driver') {
        userData.driver = {
          vehicleDetails: {
            type: 'motorcycle',
            model: '',
            number: '',
            color: ''
          },
          documents: {
            drivingLicense: null,
            profilePhoto: null,
            aadhaarCard: null,
            bikeInsurance: null,
            rcBook: null
          },
          verificationStatus: 'pending',
          isOnline: false,
          rating: 0,
          totalTrips: 0,
          earnings: {
            total: 0,
            thisMonth: 0,
            thisWeek: 0
          },
          availability: {
            workingHours: {
              start: '09:00',
              end: '18:00'
            },
            workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
            isAvailable: false
          }
        };
      }

      await db.collection('users').doc(userRecord.uid).set(userData);
      user = userData;
      isNewUser = true;
    }

    // Create custom token for client
    const customToken = await createCustomToken(user.id, {
      userType: user.userType,
      phone: user.phone
    });

    // Clean up OTP session
    try {
      await sessionRef.delete();
    } catch (error) {
      console.warn('Failed to cleanup OTP session:', error);
    }

    res.status(200).json({
      success: true,
      message: isNewUser ? 'User registered successfully' : 'Login successful',
      data: {
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          userType: user.userType,
          isVerified: user.isVerified
        },
        accessToken: customToken,  // ✅ Match frontend expectation
        refreshToken: null,        // ✅ Add refresh token placeholder
        expiresIn: 3600,          // ✅ Add expiration time (1 hour)
        isNewUser
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'OTP_VERIFICATION_ERROR',
        message: 'Failed to verify OTP',
        details: 'An error occurred while verifying OTP. Please try again.'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/resend-otp
 * @desc    Resend OTP to phone number
 * @access  Public
 */
router.post('/resend-otp', [
  body('phoneNumber')
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number'),
  body('recaptchaToken')
    .optional()
    .isString()
    .withMessage('reCAPTCHA token must be a string')
], async (req, res) => {
  try {
    // Check validation errors
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

    const { phoneNumber, recaptchaToken } = req.body;

    // Check if there's an existing session
    const db = getFirestore();
    const sessionRef = db.collection('otpSessions').doc(phoneNumber);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_ACTIVE_SESSION',
          message: 'No active OTP session',
          details: 'Please request a new OTP first.'
        },
        timestamp: new Date().toISOString()
      });
    }

    const sessionData = sessionDoc.data();

    // Check if session has expired
    if (new Date() > sessionData.expiresAt.toDate()) {
      await sessionRef.delete();
      return res.status(400).json({
        success: false,
        error: {
          code: 'SESSION_EXPIRED',
          message: 'OTP session expired',
          details: 'Your OTP session has expired. Please request a new OTP.'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check resend limit (max 3 resends per session)
    if (sessionData.resendCount >= 3) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RESEND_LIMIT_EXCEEDED',
          message: 'Resend limit exceeded',
          details: 'You have exceeded the maximum number of resend attempts. Please request a new OTP.'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update session with new recaptcha token and extend expiry
    await sessionRef.update({
      recaptchaToken,
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      resendCount: (sessionData.resendCount || 0) + 1
    });

    // In production, this would trigger Firebase Phone Auth resend
    const mockOTP = process.env.NODE_ENV === 'development' ? '123456' : null;

    res.status(200).json({
      success: true,
      message: 'OTP resent successfully',
      data: {
        phoneNumber,
        sessionId: phoneNumber,
        expiresIn: '10 minutes',
        resendCount: (sessionData.resendCount || 0) + 1,
        maxResends: 3,
        ...(mockOTP && { debugOTP: mockOTP }) // Only include in development
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error resending OTP:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'OTP_RESEND_ERROR',
        message: 'Failed to resend OTP',
        details: 'An error occurred while resending OTP. Please try again.'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/refresh-token
 * @desc    Refresh authentication token
 * @access  Private
 */
router.post('/refresh-token', requireRole(['customer', 'driver']), async (req, res) => {
  try {
    const { uid, userType } = req.user;

    // Create new custom token
    const customToken = await createCustomToken(uid, {
      userType,
      phone: req.user.phone
    });

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        token: customToken
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TOKEN_REFRESH_ERROR',
        message: 'Failed to refresh token',
        details: 'An error occurred while refreshing token. Please try again.'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (client-side token invalidation)
 * @access  Private
 */
router.post('/logout', requireRole(['customer', 'driver']), async (req, res) => {
  try {
    const { uid } = req.user;
    
    // In Firebase, tokens are stateless, so logout is handled client-side
    // You can add any server-side cleanup here if needed
    
    // Optionally, you can track logout events
    const db = getFirestore();
    await db.collection('userSessions').doc(uid).delete();
    
    res.status(200).json({
      success: true,
      message: 'Logout successful',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGOUT_ERROR',
        message: 'Logout failed',
        details: 'An error occurred during logout. Please try again.'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile', requireRole(['customer', 'driver']), async (req, res) => {
  try {
    const { uid } = req.user;

    const db = getFirestore();
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'User profile not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();

    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        user: userData
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting profile:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_RETRIEVAL_ERROR',
        message: 'Failed to retrieve profile',
        details: 'An error occurred while retrieving profile. Please try again.'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/auth/profile
 * @desc    Update current user profile
 * @access  Private
 */
router.put('/profile', [
  requireRole(['customer', 'driver']),
  body('name')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email address')
], async (req, res) => {
  try {
    // Check validation errors
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

    const { uid } = req.user;
    const { name, email } = req.body;

    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);

    const updateData = {
      updatedAt: new Date()
    };

    if (name) updateData.name = name;
    if (email) updateData.email = email;

    await userRef.update(updateData);

    // Get updated user data
    const updatedDoc = await userRef.get();
    const userData = updatedDoc.data();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: userData
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_UPDATE_ERROR',
        message: 'Failed to update profile',
        details: 'An error occurred while updating profile. Please try again.'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/validate-session
 * @desc    Validate current session and return user info
 * @access  Private
 */
router.post('/validate-session', requireRole(['customer', 'driver']), async (req, res) => {
  try {
    const { uid } = req.user;

    const db = getFirestore();
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'User profile not found'
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

    res.status(200).json({
      success: true,
      message: 'Session validated successfully',
      data: {
        user: {
          id: userData.id,
          name: userData.name,
          phone: userData.phone,
          userType: userData.userType,
          isVerified: userData.isVerified,
          isActive: userData.isActive
        },
        sessionValid: true
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error validating session:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_VALIDATION_ERROR',
        message: 'Failed to validate session',
        details: 'An error occurred while validating session. Please try again.'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/set-password
 * @desc    Set password for user account
 * @access  Private
 */
router.post('/set-password', [
  requireRole(['customer', 'driver']),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
], async (req, res) => {
  try {
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

    const { uid } = req.user;
    const { password } = req.body;

    await passwordService.setPassword(uid, password);

    // Log the action
    await auditService.logPasswordChange(uid, true, {
      action: 'set_password',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(200).json({
      success: true,
      message: 'Password set successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error setting password:', error);
    
    // Log the failed attempt
    await auditService.logPasswordChange(req.user?.uid, false, {
      action: 'set_password',
      error: error.message,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'PASSWORD_SET_ERROR',
        message: error.message,
        details: 'Failed to set password'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.post('/change-password', [
  requireRole(['customer', 'driver']),
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
], async (req, res) => {
  try {
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

    const { uid } = req.user;
    const { currentPassword, newPassword } = req.body;

    await passwordService.changePassword(uid, currentPassword, newPassword);

    // Log the action
    await auditService.logPasswordChange(uid, true, {
      action: 'change_password',
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error changing password:', error);
    
    // Log the failed attempt
    await auditService.logPasswordChange(req.user?.uid, false, {
      action: 'change_password',
      error: error.message,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'PASSWORD_CHANGE_ERROR',
        message: error.message,
        details: 'Failed to change password'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Send password reset email
 * @access  Public
 */
router.post('/forgot-password', [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
], async (req, res) => {
  try {
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

    const { email } = req.body;
    const db = getFirestore();

    // Find user by email
    const usersQuery = await db
      .collection('users')
      .where('email', '==', email)
      .limit(1)
      .get();

    if (usersQuery.empty) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'No user found with this email address'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userDoc = usersQuery.docs[0];
    const userId = userDoc.id;

    // Send password reset email
    await emailService.sendPasswordResetVerification(userId, email);

    // Log the action
    await auditService.logPasswordReset(userId, true, {
      action: 'forgot_password',
      email,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(200).json({
      success: true,
      message: 'Password reset email sent successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error sending password reset email:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PASSWORD_RESET_ERROR',
        message: 'Failed to send password reset email',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password using token
 * @access  Public
 */
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
], async (req, res) => {
  try {
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

    const { token, newPassword } = req.body;

    await emailService.resetPasswordWithToken(token, newPassword);

    res.status(200).json({
      success: true,
      message: 'Password reset successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PASSWORD_RESET_ERROR',
        message: error.message,
        details: 'Failed to reset password'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/verify-email
 * @desc    Verify email using token
 * @access  Public
 */
router.post('/verify-email', [
  body('token').notEmpty().withMessage('Verification token is required')
], async (req, res) => {
  try {
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

    const { token } = req.body;

    const verificationData = await emailService.verifyEmailToken(token);
    await emailService.verifyEmail(verificationData.userId, token);

    res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error verifying email:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EMAIL_VERIFICATION_ERROR',
        message: error.message,
        details: 'Failed to verify email'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/resend-email-verification
 * @desc    Resend email verification
 * @access  Private
 */
router.post('/resend-email-verification', [
  requireRole(['customer', 'driver']),
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email address')
], async (req, res) => {
  try {
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

    const { uid } = req.user;
    const { email } = req.body;

    await emailService.sendVerificationEmail(email, await emailService.createVerificationRecord(uid, email));

    res.status(200).json({
      success: true,
      message: 'Email verification sent successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error resending email verification:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EMAIL_VERIFICATION_ERROR',
        message: 'Failed to send email verification',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/change-phone
 * @desc    Change phone number with OTP verification
 * @access  Private
 */
router.post('/change-phone', [
  requireRole(['customer', 'driver']),
  body('newPhoneNumber')
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number'),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('OTP must be 6 digits')
], async (req, res) => {
  try {
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

    const { uid } = req.user;
    const { newPhoneNumber, otp } = req.body;

    // Verify OTP (this would integrate with your existing OTP verification)
    const otpValid = await authService.verifyOTP(newPhoneNumber, otp, false);
    
    if (!otpValid.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OTP',
          message: 'Invalid OTP',
          details: 'The OTP provided is invalid or expired'
        },
        timestamp: new Date().toISOString()
      });
    }

    const db = getFirestore();
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data();
    const oldPhone = userData.phone;

    // Update phone number
    await userRef.update({
      phone: newPhoneNumber,
      phoneVerified: true,
      updatedAt: new Date()
    });

    // Log the action
    await auditService.logPhoneChange(uid, oldPhone, newPhoneNumber, true, {
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(200).json({
      success: true,
      message: 'Phone number changed successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error changing phone number:', error);
    
    // Log the failed attempt
    await auditService.logPhoneChange(req.user?.uid, null, req.body.newPhoneNumber, false, {
      error: error.message,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'PHONE_CHANGE_ERROR',
        message: 'Failed to change phone number',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/auth/sessions
 * @desc    Get user sessions
 * @access  Private
 */
router.get('/sessions', requireRole(['customer', 'driver']), async (req, res) => {
  try {
    const { uid } = req.user;
    const sessions = await sessionService.getUserSessions(uid);

    res.status(200).json({
      success: true,
      message: 'Sessions retrieved successfully',
      data: {
        sessions
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting sessions:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SESSIONS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve sessions',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   DELETE /api/auth/sessions/:sessionId
 * @desc    Invalidate specific session
 * @access  Private
 */
router.delete('/sessions/:sessionId', requireRole(['customer', 'driver']), async (req, res) => {
  try {
    const { uid } = req.user;
    const { sessionId } = req.params;

    await sessionService.invalidateSession(sessionId);

    res.status(200).json({
      success: true,
      message: 'Session invalidated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error invalidating session:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_INVALIDATION_ERROR',
        message: 'Failed to invalidate session',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/logout-all-devices
 * @desc    Logout from all devices
 * @access  Private
 */
router.post('/logout-all-devices', requireRole(['customer', 'driver']), async (req, res) => {
  try {
    const { uid } = req.user;
    const currentSessionId = req.headers['x-session-id']; // You'll need to pass this in headers

    const invalidatedCount = await sessionService.invalidateAllUserSessions(uid, currentSessionId);

    // Log the action
    await auditService.logLogout(uid, {
      action: 'logout_all_devices',
      invalidatedSessions: invalidatedCount,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(200).json({
      success: true,
      message: 'Logged out from all devices successfully',
      data: {
        invalidatedSessions: invalidatedCount
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error logging out from all devices:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGOUT_ALL_ERROR',
        message: 'Failed to logout from all devices',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
