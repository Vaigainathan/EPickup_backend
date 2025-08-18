const express = require('express');
const { body, validationResult } = require('express-validator');
const { 
  createUser, 
  getUserByPhone, 
  createCustomToken,
  getFirestore,
  getAuth
} = require('../services/firebase');
const { requireRole } = require('../middleware/auth');
const { userRateLimit } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   POST /api/auth/send-verification-code
 * @desc    Send verification code to phone number using Firebase Phone Auth
 * @access  Public
 */
router.post('/send-verification-code', [
  body('phoneNumber')
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number'),
  body('recaptchaToken')
    .notEmpty()
    .withMessage('reCAPTCHA token is required'),
  body('isSignup')
    .optional()
    .isBoolean()
    .withMessage('isSignup must be a boolean')
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

    const { phoneNumber, recaptchaToken, isSignup = false } = req.body;

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

    // Store verification session in Firestore
    const db = getFirestore();
    const sessionRef = db.collection('phoneVerificationSessions').doc(phoneNumber);
    
    await sessionRef.set({
      phoneNumber,
      isSignup,
      recaptchaToken,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      status: 'pending'
    });

    // Note: In a real implementation, Firebase Phone Auth would handle the SMS sending
    // This endpoint just validates the request and stores the session
    // The actual SMS is sent by Firebase when the client calls the Firebase Phone Auth API

    res.status(200).json({
      success: true,
      message: 'Verification code request validated',
      data: {
        phoneNumber,
        isSignup,
        sessionId: phoneNumber,
        expiresIn: '10 minutes',
        nextStep: 'Use Firebase Phone Auth SDK on client to send verification code'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error processing verification request:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_REQUEST_ERROR',
        message: 'Failed to process verification request',
        details: 'An error occurred while processing your request. Please try again.'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/verify-phone
 * @desc    Verify phone number and authenticate user using Firebase Phone Auth
 * @access  Public
 */
router.post('/verify-phone', [
  body('phoneNumber')
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number'),
  body('firebaseIdToken')
    .notEmpty()
    .withMessage('Firebase ID token is required'),
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

    const { phoneNumber, firebaseIdToken, name, userType = 'customer' } = req.body;

    // Verify Firebase ID token
    const auth = getAuth();
    let decodedToken;
    
    try {
      decodedToken = await auth.verifyIdToken(firebaseIdToken);
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_FIREBASE_TOKEN',
          message: 'Invalid Firebase token',
          details: 'The provided Firebase token is invalid or expired.'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Verify phone number matches
    if (decodedToken.phone_number !== phoneNumber) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PHONE_MISMATCH',
          message: 'Phone number mismatch',
          details: 'The phone number in the token does not match the provided phone number.'
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
      const db = getFirestore();
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

      const db = getFirestore();
      await db.collection('users').doc(userRecord.uid).set(userData);
      user = userData;
      isNewUser = true;
    }

    // Create custom token for client
    const customToken = await createCustomToken(user.id, {
      userType: user.userType,
      phone: user.phone
    });

    // Clean up verification session
    try {
      const db = getFirestore();
      await db.collection('phoneVerificationSessions').doc(phoneNumber).delete();
    } catch (error) {
      console.warn('Failed to cleanup verification session:', error);
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
        token: customToken,
        isNewUser
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error verifying phone:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PHONE_VERIFICATION_ERROR',
        message: 'Failed to verify phone',
        details: 'An error occurred while verifying your phone number. Please try again.'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/auth/resend-verification-code
 * @desc    Resend verification code to phone number
 * @access  Public
 */
router.post('/resend-verification-code', [
  body('phoneNumber')
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number'),
  body('recaptchaToken')
    .notEmpty()
    .withMessage('reCAPTCHA token is required')
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
    const sessionRef = db.collection('phoneVerificationSessions').doc(phoneNumber);
    const sessionDoc = await sessionRef.get();

    if (!sessionDoc.exists) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_ACTIVE_SESSION',
          message: 'No active verification session',
          details: 'Please request a new verification code first.'
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
          message: 'Verification session expired',
          details: 'Your verification session has expired. Please request a new code.'
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

    res.status(200).json({
      success: true,
      message: 'Verification code resend request validated',
      data: {
        phoneNumber,
        sessionId: phoneNumber,
        expiresIn: '10 minutes',
        nextStep: 'Use Firebase Phone Auth SDK on client to resend verification code'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error resending verification code:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'RESEND_VERIFICATION_ERROR',
        message: 'Failed to resend verification code',
        details: 'An error occurred while processing your request. Please try again.'
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
    // In Firebase, tokens are stateless, so logout is handled client-side
    // You can add any server-side cleanup here if needed
    
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

module.exports = router;
