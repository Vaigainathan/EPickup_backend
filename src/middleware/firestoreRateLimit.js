const firestoreSessionService = require('../services/firestoreSessionService');

/**
 * Firestore-based Rate Limiting Middleware
 * Replaces Redis-based rate limiting with Firestore
 */

/**
 * Create a rate limiter using Firestore
 * @param {Object} options - Rate limiting options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum requests per window
 * @param {string} options.message - Error message when limit exceeded
 * @param {boolean} options.skipSuccessfulRequests - Skip counting successful requests
 * @param {boolean} options.skipFailedRequests - Skip counting failed requests
 */
const createFirestoreRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, // 100 requests per window
    message = 'Too many requests from this IP, please try again later.',
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator = (req) => req.ip, // Default: use IP address
    skip = () => false // Function to skip rate limiting
  } = options;

  return async (req, res, next) => {
    try {
      // Skip if skip function returns true
      if (skip(req)) {
        return next();
      }

      // Generate rate limit key
      const key = `rate_limit:${keyGenerator(req)}`;
      const windowSeconds = Math.floor(windowMs / 1000);

      // Check rate limit
      const result = await firestoreSessionService.checkRateLimit(key, max, windowSeconds);

      if (!result.success) {
        console.error('Rate limit check failed:', result.error);
        // If rate limiting fails, allow the request (fail open)
        return next();
      }

      if (!result.allowed) {
        // Rate limit exceeded
        const resetTime = result.resetTime || new Date(Date.now() + windowMs);
        const retryAfter = Math.ceil((resetTime - new Date()) / 1000);

        res.set({
          'Retry-After': retryAfter,
          'X-RateLimit-Limit': max,
          'X-RateLimit-Remaining': result.remaining || 0,
          'X-RateLimit-Reset': Math.ceil(resetTime.getTime() / 1000)
        });

        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: message,
            details: `Rate limit exceeded. Try again in ${retryAfter} seconds.`
          },
          retryAfter,
          timestamp: new Date().toISOString()
        });
      }

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': max,
        'X-RateLimit-Remaining': result.remaining || 0,
        'X-RateLimit-Reset': Math.ceil((Date.now() + windowMs) / 1000)
      });

      // Track request success/failure if needed
      if (!skipSuccessfulRequests || !skipFailedRequests) {
        req.rateLimitInfo = {
          limit: max,
          remaining: result.remaining,
          resetTime: new Date(Date.now() + windowMs)
        };
      }

      next();
    } catch (error) {
      console.error('Rate limiting middleware error:', error);
      // If rate limiting fails, allow the request (fail open)
      next();
    }
  };
};

/**
 * User-specific rate limiting
 * @param {Object} options - Rate limiting options
 */
const createUserRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 50, // 50 requests per window per user
    message = 'Too many requests from this user, please try again later.'
  } = options;

  return createFirestoreRateLimit({
    ...options,
    max,
    windowMs,
    message,
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise fall back to IP
      return req.user ? `user:${req.user.uid}` : `ip:${req.ip}`;
    },
    skip: (req) => !req.user // Skip if user is not authenticated
  });
};

/**
 * Endpoint-specific rate limiting
 * @param {string} endpoint - Endpoint identifier
 * @param {Object} options - Rate limiting options
 */
const createEndpointRateLimit = (endpoint, options = {}) => {
  const {
    windowMs = 5 * 60 * 1000, // 5 minutes
    max = 20, // 20 requests per window per endpoint
    message = `Too many requests to ${endpoint}, please try again later.`
  } = options;

  return createFirestoreRateLimit({
    ...options,
    max,
    windowMs,
    message,
    keyGenerator: (req) => {
      const userKey = req.user ? `user:${req.user.uid}` : `ip:${req.ip}`;
      return `endpoint:${endpoint}:${userKey}`;
    }
  });
};

/**
 * Authentication rate limiting (for login attempts)
 * @param {Object} options - Rate limiting options
 */
const createAuthRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 5, // 5 login attempts per window
    message = 'Too many authentication attempts, please try again later.'
  } = options;

  return createFirestoreRateLimit({
    ...options,
    max,
    windowMs,
    message,
    keyGenerator: (req) => {
      // Use phone number or IP for auth rate limiting
      const phoneNumber = req.body?.phoneNumber || req.body?.phone;
      return phoneNumber ? `auth:${phoneNumber}` : `auth:ip:${req.ip}`;
    }
  });
};

/**
 * OTP rate limiting (for OTP requests)
 * @param {Object} options - Rate limiting options
 */
const createOTPRateLimit = (options = {}) => {
  const {
    windowMs = 60 * 1000, // 1 minute
    max = 3, // 3 OTP requests per minute
    message = 'Too many OTP requests, please wait before requesting another OTP.'
  } = options;

  return createFirestoreRateLimit({
    ...options,
    max,
    windowMs,
    message,
    keyGenerator: (req) => {
      const phoneNumber = req.body?.phoneNumber || req.body?.phone;
      return phoneNumber ? `otp:${phoneNumber}` : `otp:ip:${req.ip}`;
    }
  });
};

/**
 * File upload rate limiting
 * @param {Object} options - Rate limiting options
 */
const createUploadRateLimit = (options = {}) => {
  const {
    windowMs = 60 * 60 * 1000, // 1 hour
    max = 10, // 10 uploads per hour
    message = 'Too many file uploads, please try again later.'
  } = options;

  return createFirestoreRateLimit({
    ...options,
    max,
    windowMs,
    message,
    keyGenerator: (req) => {
      const userKey = req.user ? `user:${req.user.uid}` : `ip:${req.ip}`;
      return `upload:${userKey}`;
    }
  });
};

module.exports = {
  createFirestoreRateLimit,
  createUserRateLimit,
  createEndpointRateLimit,
  createAuthRateLimit,
  createOTPRateLimit,
  createUploadRateLimit
};
