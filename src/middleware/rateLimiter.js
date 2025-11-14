/**
 * Rate Limiting Middleware
 * 
 * Prevents API abuse by limiting requests per user/IP
 * with configurable windows and limits.
 * 
 * Uses in-memory store (no Redis dependency)
 */

const rateLimit = require('express-rate-limit');

// ✅ REMOVED: Redis support - using in-memory store only
// This is simpler, faster for single-instance deployments, and has no external dependencies
console.log('✅ [RATE_LIMITER] Using in-memory store for rate limiting');

/**
 * Create rate limiter with in-memory store
 */
function createRateLimiter(options = {}) {
  const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: process.env.NODE_ENV === 'development' ? 5000 : 2000, // Much higher limits for mobile apps
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP, please try again later.',
        details: 'Rate limit exceeded. Please wait before making more requests.'
      },
      timestamp: new Date().toISOString()
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip rate limiting for health checks and localhost in development
      const isHealthCheck = req.path === '/health' || req.path === '/api/health';
      const isDevelopment = process.env.NODE_ENV === 'development';
      const isLocalhost = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
      return isHealthCheck || (isDevelopment && isLocalhost);
    },
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise IP
      return req.user?.uid || req.ip;
    },
    ...options
  };

  // ✅ REMOVED: Redis store - using in-memory store (default)
  // In-memory store is perfect for single-instance deployments
  // No external dependencies, faster, and simpler

  return rateLimit(defaultOptions);
}

/**
 * Strict rate limiter for sensitive endpoints
 */
const strictRateLimit = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: {
    success: false,
    error: {
      code: 'STRICT_RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please slow down.',
      details: 'This endpoint has strict rate limiting. Please wait before retrying.'
    },
    timestamp: new Date().toISOString()
  }
});

/**
 * Moderate rate limiter for regular endpoints
 * ✅ CRITICAL FIX: Increased limits for driver app
 */
const moderateRateLimit = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: process.env.NODE_ENV === 'development' ? 2000 : 800, // ✅ Increased from 300 to 800 for driver app
  message: {
    success: false,
    error: {
      code: 'MODERATE_RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please try again in a few minutes.',
      details: 'Rate limit exceeded. Please wait before making more requests.'
    },
    timestamp: new Date().toISOString()
  }
});

/**
 * Light rate limiter for frequently accessed endpoints
 */
const lightRateLimit = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'development' ? 500 : 150, // Increased for mobile apps
  message: {
    success: false,
    error: {
      code: 'LIGHT_RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please slow down slightly.',
      details: 'Rate limit exceeded. Please wait a moment before retrying.'
    },
    timestamp: new Date().toISOString()
  }
});

/**
 * Document status specific rate limiter
 * More lenient since it's polled frequently
 * ✅ CRITICAL FIX: Increased limits for driver app
 */
const documentStatusRateLimit = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'development' ? 500 : 200, // ✅ Increased from 60 to 200 for driver app
  message: {
    success: false,
    error: {
      code: 'DOCUMENT_STATUS_RATE_LIMIT_EXCEEDED',
      message: 'Too many document status requests. Please wait before checking again.',
      details: 'Document status endpoint has rate limiting. Please wait before retrying.'
    },
    timestamp: new Date().toISOString()
  }
});

/**
 * Custom rate limiter for specific endpoints
 */
function customRateLimit(windowMs, max, message) {
  return createRateLimiter({
    windowMs,
    max,
    message: {
      success: false,
      error: {
        code: 'CUSTOM_RATE_LIMIT_EXCEEDED',
        message: message || 'Rate limit exceeded',
        details: 'Custom rate limit exceeded. Please wait before retrying.'
      },
      timestamp: new Date().toISOString()
    }
  });
}

module.exports = {
  createRateLimiter,
  strictRateLimit,
  moderateRateLimit,
  lightRateLimit,
  documentStatusRateLimit,
  customRateLimit
};