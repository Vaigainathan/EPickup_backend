const express = require('express');
const axios = require('axios');
const router = express.Router();

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
router.post('/firebase/verify-token', async (req, res) => {
  try {
    const { idToken, userType, name } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        error: 'Firebase ID token is required'
      });
    }

    console.log('🔐 [FIREBASE_AUTH] Verifying Firebase ID token...');

    // Import Firebase Admin SDK service
    const firebaseAuthService = require('../services/firebaseAuthService');
    
    // Verify the Firebase ID token
    const decodedToken = await firebaseAuthService.verifyIdToken(idToken);
    
    if (!decodedToken) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Firebase ID token'
      });
    }

    console.log('✅ [FIREBASE_AUTH] Firebase token verified:', {
      uid: decodedToken.uid,
      email: decodedToken.email,
      userType: userType || 'admin'
    });

    // Generate backend JWT token
    const jwtService = require('../services/jwtService');
    const backendToken = jwtService.generateToken({
      uid: decodedToken.uid,
      email: decodedToken.email,
      userType: userType || 'admin',
      name: name || decodedToken.name || decodedToken.email
    });

    const refreshToken = jwtService.generateRefreshToken({
      uid: decodedToken.uid,
      email: decodedToken.email,
      userType: userType || 'admin'
    });

    console.log('✅ [FIREBASE_AUTH] Backend JWT token generated');

    return res.json({
      success: true,
      data: {
        token: backendToken,
        refreshToken: refreshToken,
        user: {
          uid: decodedToken.uid,
          email: decodedToken.email,
          name: name || decodedToken.name || decodedToken.email,
          userType: userType || 'admin'
        }
      },
      message: 'Token exchange successful'
    });

  } catch (error) {
    console.error('❌ [FIREBASE_AUTH] Token verification error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error during token verification'
    });
  }
});

module.exports = router;