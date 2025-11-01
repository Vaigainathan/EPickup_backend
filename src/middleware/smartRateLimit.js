const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

/**
 * Smart Rate Limiting Middleware for Multi-User Mobile Apps
 * 
 * This middleware handles different scenarios:
 * 1. Individual users (by userId/phone number + user type) - ✅ USER ISOLATION
 * 2. Shared networks (by IP with shorter windows) - Fallback only
 * 3. Development vs Production environments
 * 4. Different user types (driver, customer, admin)
 */

/**
 * ✅ CRITICAL FIX: Decode Firebase ID token to extract userId for user-specific rate limiting
 * This ensures user isolation - each user has their own rate limit bucket
 * @param {string} idToken - Firebase ID token (JWT)
 * @returns {Object|null} Decoded token payload or null if invalid
 */
function decodeTokenPayload(idToken) {
  try {
    if (!idToken || typeof idToken !== 'string') {
      return null;
    }
    
    // Firebase ID tokens are JWTs with 3 parts separated by dots
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    // Decode the payload (second part) without verification
    // We only need userId/phone, not full verification (that's done in route handler)
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch {
    // If decoding fails, return null (fallback to IP-based limiting)
    return null;
  }
}

/**
 * Create a smart rate limiter for authentication endpoints
 * @param {Object} options - Configuration options
 */
const createSmartAuthRateLimit = (options = {}) => {
  const {
    windowMs = 5 * 60 * 1000, // 5 minutes
    maxPerUser = 50, // Per user per window
    skipSuccessfulRequests = true,
    skipFailedRequests = false,
  } = options;

  // ✅ CRITICAL FIX: Use maxPerUser since we now have user-isolated keys
  // Each user gets their own rate limit bucket (via keyGenerator)
  // So maxPerUser is the actual limit per user, not total
  return rateLimit({
    windowMs,
    max: process.env.NODE_ENV === 'development' ? maxPerUser * 10 : maxPerUser,
    message: {
      success: false,
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many authentication attempts. Please wait a few minutes and try again.',
        retryAfter: Math.ceil(windowMs / 1000)
      },
      timestamp: new Date().toISOString()
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    skipFailedRequests,
    
    // ✅ CRITICAL FIX: User-isolated key generation for multi-user scenarios
    // Decode token to get userId for user-specific rate limiting
    keyGenerator: (req) => {
      const requestUserType = req.body?.userType || 'unknown';
      let userId = null;
      let phoneNumber = null;
      
      // ✅ CRITICAL FIX: For verify-token endpoint, decode idToken to get userId
      // This ensures user isolation - each user gets their own rate limit bucket
      if (req.body?.idToken) {
        const decodedToken = decodeTokenPayload(req.body.idToken);
        if (decodedToken) {
          userId = decodedToken.uid || decodedToken.user_id;
          phoneNumber = decodedToken.phone_number || decodedToken.phone;
        }
      }
      
      // Fallback to phone number from body (for OTP endpoints)
      if (!userId && !phoneNumber) {
        phoneNumber = req.body?.phoneNumber || req.body?.phone;
      }
      
      // ✅ CRITICAL FIX: Use userId for best user isolation
      if (userId) {
        const key = `auth:${requestUserType}:${userId}`;
        console.log(`🔑 [SMART_RATE_LIMIT] User-specific key (userId): ${key}`);
        return key;
      }
      
      // ✅ Fallback to phone number + user type
      if (phoneNumber) {
        const key = `auth:${requestUserType}:${phoneNumber}`;
        console.log(`🔑 [SMART_RATE_LIMIT] User-specific key (phone): ${key}`);
        return key;
      }
      
      // ✅ Last resort: IP-based limiting (with user type for better isolation)
      // This should rarely happen, but handles edge cases
      const key = `auth:ip:${req.ip}:${requestUserType}`;
      console.log(`⚠️ [SMART_RATE_LIMIT] IP-based key (no user identified): ${key}`);
      return key;
    },
    
    // ✅ CRITICAL FIX: Skip rate limiting for localhost in development
    skip: (req) => {
      const isDevelopment = process.env.NODE_ENV === 'development';
      const isLocalhost = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
      
      if (isDevelopment && isLocalhost) {
        console.log('⏭️ [SMART_RATE_LIMIT] Skipping rate limit for localhost in development');
        return true;
      }
      
      return false;
    },
    
    handler: (req, res) => {
      const requestUserType = req.body?.userType || 'unknown';
      let userId = null;
      let phoneNumber = null;
      
      // ✅ CRITICAL FIX: Extract userId from token for accurate reporting
      if (req.body?.idToken) {
        const decodedToken = decodeTokenPayload(req.body.idToken);
        if (decodedToken) {
          userId = decodedToken.uid || decodedToken.user_id;
          phoneNumber = decodedToken.phone_number || decodedToken.phone;
        }
      }
      
      if (!userId && !phoneNumber) {
        phoneNumber = req.body?.phoneNumber || req.body?.phone;
      }
      
      console.warn('⚠️ [SMART_RATE_LIMIT] Rate limit exceeded:', {
        userId: userId,
        phone: phoneNumber,
        userType: requestUserType,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        limitType: userId ? 'user-specific' : (phoneNumber ? 'phone-based' : 'IP-based'),
        timestamp: new Date().toISOString()
      });
      
      res.status(429).json({
        success: false,
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many authentication attempts. Please wait a few minutes and try again.',
          retryAfter: Math.ceil(windowMs / 1000),
          details: {
            limitType: userId ? 'User-specific limit exceeded' : (phoneNumber ? 'Phone-based limit exceeded' : 'IP-based limit exceeded'),
            userType: requestUserType,
            windowMs: windowMs
          }
        },
        timestamp: new Date().toISOString()
      });
    }
  });
};

/**
 * Create a progressive slow-down for repeated failed attempts
 * @param {Object} options - Configuration options
 */
const createProgressiveSlowDown = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    delayAfter = 10, // Start slowing after 10 attempts
    delayMs = 200, // Initial delay
    maxDelayMs = 5000, // Maximum delay
  } = options;

  return slowDown({
    windowMs,
    delayAfter: process.env.NODE_ENV === 'development' ? delayAfter * 10 : delayAfter,
    delayMs: () => delayMs,
    maxDelayMs,
    skipSuccessfulRequests: true,
    skipFailedRequests: false,
    
    // ✅ CRITICAL FIX: Use same user-isolated key generation as rate limiter
    keyGenerator: (req) => {
      const requestUserType = req.body?.userType || 'unknown';
      let userId = null;
      let phoneNumber = null;
      
      // ✅ Decode token to get userId for user isolation
      if (req.body?.idToken) {
        const decodedToken = decodeTokenPayload(req.body.idToken);
        if (decodedToken) {
          userId = decodedToken.uid || decodedToken.user_id;
          phoneNumber = decodedToken.phone_number || decodedToken.phone;
        }
      }
      
      if (!userId && !phoneNumber) {
        phoneNumber = req.body?.phoneNumber || req.body?.phone;
      }
      
      if (userId) {
        return `slowdown:${requestUserType}:${userId}`;
      }
      
      if (phoneNumber) {
        return `slowdown:${requestUserType}:${phoneNumber}`;
      }
      
      return `slowdown:ip:${req.ip}:${requestUserType}`;
    },
    
    skip: (req) => {
      const isDevelopment = process.env.NODE_ENV === 'development';
      const isLocalhost = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
      return isDevelopment && isLocalhost;
    }
  });
};

/**
 * Firebase token verification specific rate limiter
 * ✅ CRITICAL FIX: User-isolated rate limiting
 * Each user gets their own rate limit bucket, preventing one user's actions from affecting others
 */
const firebaseTokenVerifyLimiter = createSmartAuthRateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxPerUser: 30, // ✅ FIX: Reduced from 100 to 30 - 30 attempts per user per 5 minutes (prevents abuse while allowing legitimate refresh)
  skipSuccessfulRequests: true, // ✅ Don't count successful authentications (prevents legitimate refresh from hitting limit)
  skipFailedRequests: false, // Count failed attempts (to catch abuse)
});

/**
 * OTP verification specific rate limiter
 * More strict for OTP attempts
 */
const otpVerifyLimiter = createSmartAuthRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxPerUser: 10, // 10 OTP attempts per user per 15 minutes
  skipSuccessfulRequests: true,
  skipFailedRequests: false,
});

/**
 * Login attempt specific rate limiter
 * Most strict for login attempts
 */
const loginAttemptLimiter = createSmartAuthRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxPerUser: 5, // 5 login attempts per user per 15 minutes
  skipSuccessfulRequests: true,
  skipFailedRequests: false,
});

module.exports = {
  createSmartAuthRateLimit,
  createProgressiveSlowDown,
  firebaseTokenVerifyLimiter,
  otpVerifyLimiter,
  loginAttemptLimiter,
};
