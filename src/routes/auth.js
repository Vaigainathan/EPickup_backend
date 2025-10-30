const express = require('express');
const axios = require('axios');
const { 
  firebaseTokenVerifyLimiter, 
  createProgressiveSlowDown 
} = require('../middleware/smartRateLimit');
const router = express.Router();

// ✅ CRITICAL FIX: Use smart rate limiter for Firebase token verification
// This handles multiple users properly with user-specific and IP-based limiting

/**
 * Check if phone number exists in the system
 * POST /api/auth/check-phone
 */
router.post('/check-phone', async (req, res) => {
  try {
    const { phoneNumber, userType } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is required'
      });
    }

    console.log('🔍 [AUTH] Checking phone number:', phoneNumber, 'for userType:', userType || 'any');

    // Import Firebase Admin SDK service
    const firebaseAuthService = require('../services/firebaseAuthService');
    
    try {
      // Check if user exists in Firebase Auth by phone number
      const userRecord = await firebaseAuthService.getUserByPhoneNumber(phoneNumber);
      
      if (userRecord) {
        console.log('✅ [AUTH] Phone number exists in Firebase Auth:', userRecord.uid);
        
        // Check if user exists in Firestore with the specific userType
        const { getFirestore } = require('firebase-admin/firestore');
        const db = getFirestore();
        
        // Query users collection for this phone number
        const usersSnapshot = await db.collection('users')
          .where('phone', '==', phoneNumber)
          .get();
        
        if (!usersSnapshot.empty) {
          // Check if user has the requested userType
          const users = usersSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          
          console.log('📊 [AUTH] Found users with phone:', users.length);
          
          // If userType specified, check if any user matches
          if (userType) {
            const matchingUser = users.find(u => {
              // Check various userType field names
              return u.userType === userType || 
                     u.role === userType || 
                     (userType === 'driver' && u.driver) ||
                     (userType === 'customer' && !u.driver && u.role !== 'admin');
            });
            
            if (matchingUser) {
              return res.json({
                success: true,
                exists: true,
                userType: userType,
                message: 'Phone number registered for this user type'
              });
            } else {
              return res.json({
                success: true,
                exists: false,
                registered: true,
                userType: userType,
                message: 'Phone number registered but not for this user type'
              });
            }
          }
          
          // No specific userType requested, phone exists
          return res.json({
            success: true,
            exists: true,
            message: 'Phone number is registered'
          });
        }
        
        // Phone exists in Firebase Auth but not in Firestore
        console.log('⚠️ [AUTH] Phone in Firebase Auth but not in Firestore');
        return res.json({
          success: true,
          exists: false,
          message: 'Phone number can be used for signup'
        });
      } else {
        // userRecord is null - user not found in Firebase Auth
        console.log('✅ [AUTH] Phone number not found - available for signup');
        return res.json({
          success: true,
          exists: false,
          message: 'Phone number available for signup'
        });
      }
    } catch (getUserError) {
      // User not found in Firebase Auth
      if (getUserError.code === 'auth/user-not-found') {
        console.log('✅ [AUTH] Phone number not found (error) - available for signup');
        return res.json({
          success: true,
          exists: false,
          message: 'Phone number available for signup'
        });
      }
      
      // Other errors
      console.error('❌ [AUTH] Error checking user:', getUserError);
      throw getUserError;
    }

  } catch (error) {
    console.error('❌ [AUTH] Phone check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during phone check'
    });
  }
});

/**
 * Verify reCAPTCHA token
 * POST /api/auth/verify-recaptcha
 */
router.post('/verify-recaptcha', async (req, res) => {
  try {
    const { token, timestamp } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: 'reCAPTCHA token is required'
      });
    }

    // Verify token with Google reCAPTCHA API
    const secretKey = process.env.RECAPTCHA_SECRET_KEY;
    
    if (!secretKey) {
      console.error('❌ RECAPTCHA_SECRET_KEY not found in environment variables');
      return res.status(500).json({
        success: false,
        error: 'reCAPTCHA configuration error'
      });
    }
    
    const response = await axios.post('https://www.google.com/recaptcha/api/siteverify', {
      secret: secretKey,
      response: token,
      remoteip: req.ip || req.connection.remoteAddress
    });

    const { success, score, action, challenge_ts, hostname, 'error-codes': errorCodes } = response.data;

    console.log('🔍 reCAPTCHA verification result:', {
      success,
      score,
      action,
      hostname,
      timestamp: challenge_ts,
      clientTimestamp: timestamp,
      ip: req.ip || req.connection.remoteAddress
    });

    // For admin dashboard, require score >= 0.5 (moderate security)
    const isScoreValid = success && score >= 0.5;

    if (isScoreValid) {
      console.log(`✅ reCAPTCHA verification successful (score: ${score}, action: ${action})`);
      return res.json({
        success: true,
        score,
        action,
        hostname,
        timestamp: challenge_ts
      });
    } else {
      console.log(`❌ reCAPTCHA verification failed (score: ${score}, errors: ${errorCodes})`);
      return res.status(400).json({
        success: false,
        score: score || 0,
        error: `reCAPTCHA verification failed. Score: ${score || 0}, Errors: ${errorCodes?.join(', ') || 'Unknown error'}`
      });
    }

  } catch (error) {
    console.error('❌ reCAPTCHA verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during reCAPTCHA verification'
    });
  }
});

/**
 * Verify Firebase ID token and exchange for backend JWT
 * POST /api/auth/firebase/verify-token
 */
router.post('/firebase/verify-token', firebaseTokenVerifyLimiter, createProgressiveSlowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 20, // Start slowing after 20 attempts
  delayMs: 100, // Initial delay
  maxDelayMs: 2000, // Maximum delay
}), async (req, res) => {
  try {
    const { idToken, userType, name } = req.body;

    if (!idToken) {
      console.error('❌ [FIREBASE_AUTH] No ID token provided');
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_ID_TOKEN',
          message: 'Firebase ID token is required'
        }
      });
    }

    console.log('🔐 [FIREBASE_AUTH] Verifying Firebase ID token...');
    // Normalize and validate userType; never allow undefined to slip through
    const normalizedType = (userType || '').toString().trim().toLowerCase();
    const allowedTypes = new Set(['customer', 'driver', 'admin']);
    let finalUserType = allowedTypes.has(normalizedType) ? normalizedType : undefined;
    // Optional hints from headers
    const headerAppType = (req.headers['x-app-type'] || '').toString().trim().toLowerCase();
    if (!finalUserType) {
      if (headerAppType.includes('driver')) finalUserType = 'driver';
      else if (headerAppType.includes('admin')) finalUserType = 'admin';
      else if (headerAppType.includes('customer')) finalUserType = 'customer';
    }
    // Safe default
    if (!finalUserType) finalUserType = 'customer';
    console.log('🔐 [FIREBASE_AUTH] User type:', finalUserType);
    console.log('🔐 [FIREBASE_AUTH] Token length:', idToken.length);

    // Import Firebase Admin SDK service
    const firebaseAuthService = require('../services/firebaseAuthService');
    
    // Verify the Firebase ID token
    let decodedToken;
    try {
      decodedToken = await firebaseAuthService.verifyIdToken(idToken);
    } catch (verifyError) {
      console.error('❌ [FIREBASE_AUTH] Token verification failed:', verifyError.message);
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: verifyError.message || 'Invalid Firebase ID token'
        }
      });
    }
    
    if (!decodedToken) {
      console.error('❌ [FIREBASE_AUTH] Decoded token is null');
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid Firebase ID token'
        }
      });
    }

    console.log('✅ [FIREBASE_AUTH] Firebase token verified:', {
      uid: decodedToken.uid,
      email: decodedToken.email,
      phone_number: decodedToken.phone_number,
      userType: finalUserType
    });

    // Get or create role-specific user with role-based UID
    const roleBasedAuthService = require('../services/roleBasedAuthService');
    const roleBasedUser = await roleBasedAuthService.getOrCreateRoleSpecificUser(
      decodedToken,
      finalUserType,
      { name: name || decodedToken.name || decodedToken.email || decodedToken.phone_number }
    );
    
    const roleBasedUID = roleBasedUser.id || roleBasedUser.uid;
    console.log('✅ [FIREBASE_AUTH] Role-based user created/retrieved:', {
      roleBasedUID,
      userType: finalUserType,
      originalUID: decodedToken.uid
    });

    // Set Firebase custom claims with role-based UID
    try {
      const appTypeMap = { customer: 'customer_app', driver: 'driver_app', admin: 'admin_dashboard' };
      await firebaseAuthService.setCustomClaims(decodedToken.uid, {
        roleBasedUID: roleBasedUID,
        userType: finalUserType,
        role: finalUserType,
        phone: decodedToken.phone_number,
        appType: appTypeMap[finalUserType] || 'customer_app',
        verified: true,
        createdAt: Date.now()
      });
      console.log('✅ [FIREBASE_AUTH] Custom claims set successfully');
    } catch (claimsError) {
      console.error('⚠️ [FIREBASE_AUTH] Failed to set custom claims:', claimsError.message);
      // Continue anyway - user can still use the app
    }

    // Generate backend JWT token with role-based UID
    const jwtService = require('../services/jwtService');
    const backendToken = jwtService.generateAccessToken({
      userId: roleBasedUID, // Use role-based UID instead of Firebase UID
      userType: finalUserType,
      phone: decodedToken.phone_number,
      metadata: {
        email: decodedToken.email,
        name: name || decodedToken.name || decodedToken.email || decodedToken.phone_number,
        originalUID: decodedToken.uid
      }
    });

    const refreshToken = jwtService.generateRefreshToken({
      userId: roleBasedUID, // Use role-based UID instead of Firebase UID
      userType: finalUserType,
      phone: decodedToken.phone_number,
      metadata: {
        email: decodedToken.email,
        originalUID: decodedToken.uid
      }
    });

    console.log('✅ [FIREBASE_AUTH] Backend JWT token generated');

    return res.json({
      success: true,
      data: {
        token: backendToken,
        refreshToken: refreshToken,
        user: {
          uid: roleBasedUID, // Return role-based UID to frontend
          originalUID: decodedToken.uid, // Include original for reference
          email: decodedToken.email,
          phone_number: decodedToken.phone_number,
          name: name || decodedToken.name || decodedToken.email || decodedToken.phone_number,
          userType: finalUserType
        }
      },
      message: 'Token exchange successful'
    });

  } catch (error) {
    console.error('❌ [FIREBASE_AUTH] Token verification error:', error);
    console.error('❌ [FIREBASE_AUTH] Error stack:', error.stack);
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error during token verification: ' + (error.message || 'Unknown error')
      }
    });
  }
});

/**
 * Refresh JWT token using refresh token
 * POST /api/auth/refresh
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REFRESH_TOKEN',
          message: 'Refresh token is required'
        }
      });
    }

    console.log('🔄 [AUTH] Refreshing JWT token...');

    // Import JWT service
    const jwtService = require('../services/jwtService');
    
    // Verify refresh token
    const decoded = jwtService.verifyRefreshToken(refreshToken);
    
    // decoded is validated by verifyRefreshToken, no need for null check
    console.log('✅ [AUTH] Refresh token verified:', {
      userId: decoded.userId,
      userType: decoded.userType
    });

    // Generate new access token - preserve role-based UID from refresh token
    const newAccessToken = jwtService.generateAccessToken({
      userId: decoded.userId, // This is the role-based UID
      userType: decoded.userType,
      phone: decoded.phone,
      metadata: decoded.metadata || {}
    });

    // Generate new refresh token - preserve role-based UID from refresh token
    const newRefreshToken = jwtService.generateRefreshToken({
      userId: decoded.userId, // This is the role-based UID
      userType: decoded.userType,
      phone: decoded.phone
    });

    console.log('✅ [AUTH] JWT token refreshed successfully');

    res.status(200).json({
      success: true,
      data: {
        token: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: 604800 // 7 days
      },
      message: 'Token refreshed successfully'
    });

  } catch (error) {
    console.error('❌ [AUTH] Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REFRESH_ERROR',
        message: 'Failed to refresh token'
      }
    });
  }
});

module.exports = router;