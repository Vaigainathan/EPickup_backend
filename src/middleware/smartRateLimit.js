const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

/**
 * Smart Rate Limiting Middleware for Multi-User Mobile Apps
 * 
 * This middleware handles different scenarios:
 * 1. Individual users (by phone number + user type)
 * 2. Shared networks (by IP with shorter windows)
 * 3. Development vs Production environments
 * 4. Different user types (driver, customer, admin)
 */

/**
 * Create a smart rate limiter for authentication endpoints
 * @param {Object} options - Configuration options
 */
const createSmartAuthRateLimit = (options = {}) => {
  const {
    windowMs = 5 * 60 * 1000, // 5 minutes
    maxPerIP = 200, // Per IP per window (for shared networks)
    skipSuccessfulRequests = true,
    skipFailedRequests = false,
  } = options;

  return rateLimit({
    windowMs,
    max: process.env.NODE_ENV === 'development' ? maxPerIP * 5 : maxPerIP,
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
    
    // ✅ CRITICAL FIX: Smart key generation for multi-user scenarios
    keyGenerator: (req) => {
      const phoneNumber = req.body?.phoneNumber || req.body?.phone;
      const requestUserType = req.body?.userType || 'unknown';
      
      // ✅ CRITICAL FIX: Use phone number + user type for individual user limiting
      if (phoneNumber) {
        const key = `auth:${requestUserType}:${phoneNumber}`;
        console.log(`🔑 [SMART_RATE_LIMIT] User-specific key: ${key}`);
        return key;
      }
      
      // ✅ CRITICAL FIX: For IP-based limiting, include user type for better isolation
      const key = `auth:ip:${req.ip}:${requestUserType}`;
      console.log(`🔑 [SMART_RATE_LIMIT] IP-based key: ${key}`);
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
      const phoneNumber = req.body?.phoneNumber || req.body?.phone;
      const requestUserType = req.body?.userType || 'unknown';
      
      console.warn('⚠️ [SMART_RATE_LIMIT] Rate limit exceeded:', {
        phone: phoneNumber,
        userType: requestUserType,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        timestamp: new Date().toISOString()
      });
      
      res.status(429).json({
        success: false,
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many authentication attempts. Please wait a few minutes and try again.',
          retryAfter: Math.ceil(windowMs / 1000),
          details: {
            phone: phoneNumber ? 'User-specific limit exceeded' : 'IP-based limit exceeded',
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
    
    // ✅ CRITICAL FIX: Use same key generation as rate limiter
    keyGenerator: (req) => {
      const phoneNumber = req.body?.phoneNumber || req.body?.phone;
      const requestUserType = req.body?.userType || 'unknown';
      
      if (phoneNumber) {
        return `slowdown:${requestUserType}:${phoneNumber}`;
      }
      
      return `slowdown:ip:${req.ip}:${requestUserType}`;
    },
    
    skip: (req) => {
      const isDevelopment = process.env.NODE_ENV === 'development';
      const isLocalhost = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
      return isDevelopment && isLocalhost;
    },
    
    handler: (req, res, options) => {
      const phoneNumber = req.body?.phoneNumber || req.body?.phone;
      const requestUserType = req.body?.userType || 'unknown';
      
      console.warn('🐌 [PROGRESSIVE_SLOWDOWN] Slow down activated:', {
        phone: phoneNumber,
        userType: requestUserType,
        ip: req.ip,
        delayMs: options.delayMs,
        timestamp: new Date().toISOString()
      });
      
      // Continue with the request after logging
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please slow down',
          retryAfter: Math.ceil(options.windowMs / 1000)
        },
        timestamp: new Date().toISOString()
      });
    }
  });
};

/**
 * Firebase token verification specific rate limiter
 * More lenient for legitimate authentication attempts
 */
const firebaseTokenVerifyLimiter = createSmartAuthRateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxPerUser: 100, // 100 attempts per user per 5 minutes
  maxPerIP: 500, // 500 attempts per IP per 5 minutes (for shared networks)
  userType: 'all',
  skipSuccessfulRequests: true, // Don't count successful authentications
  skipFailedRequests: false, // Count failed attempts
});

/**
 * OTP verification specific rate limiter
 * More strict for OTP attempts
 */
const otpVerifyLimiter = createSmartAuthRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxPerUser: 10, // 10 OTP attempts per user per 15 minutes
  maxPerIP: 50, // 50 OTP attempts per IP per 15 minutes
  userType: 'all',
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
  maxPerIP: 20, // 20 login attempts per IP per 15 minutes
  userType: 'all',
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
