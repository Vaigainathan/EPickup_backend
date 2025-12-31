/**
 * Rate Limiting Middleware
 * Provides comprehensive rate limiting for different types of endpoints
 */

const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

// General rate limiter for all endpoints
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 5000 : 2000, // Much higher limits for mobile apps
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later'
    },
    timestamp: new Date().toISOString()
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting for certain IPs (e.g., localhost during development)
  skip: (req) => {
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isLocalhost = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
    return isDevelopment && isLocalhost;
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP, please try again later'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Strict rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 200 : 5, // Much more lenient for development
  message: {
    success: false,
    error: {
      code: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts, please try again later'
    },
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts, please try again later'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Admin-specific rate limiter
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 10000 : 3000, // Higher limits for admin dashboard
  message: {
    success: false,
    error: {
      code: 'ADMIN_RATE_LIMIT_EXCEEDED',
      message: 'Too many admin requests, please try again later'
    },
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for localhost in development
  skip: (req) => {
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isLocalhost = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
    return isDevelopment && isLocalhost;
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'ADMIN_RATE_LIMIT_EXCEEDED',
        message: 'Too many admin requests, please try again later'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Speed limiter for gradual slowdown
// ✅ CRITICAL FIX: Increased thresholds to prevent premature rate limiting
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: process.env.NODE_ENV === 'development' ? 5000 : 2000, // ✅ Increased from 500 to 2000 for driver app
  delayMs: () => 100, // ✅ Reduced delay from 200ms to 100ms
  maxDelayMs: 2000, // ✅ Reduced max delay from 5s to 2s
  skipSuccessfulRequests: true, // ✅ Skip successful requests to avoid blocking polling
  skipFailedRequests: false,
  // Skip speed limiting for localhost in development
  skip: (req) => {
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isLocalhost = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
    return isDevelopment && isLocalhost;
  }
});

// Light rate limiter for signup endpoints (lenient to allow legitimate signups)
const lightRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 1000 : 100, // Lenient limits for signup
  message: {
    success: false,
    error: {
      code: 'LIGHT_RATE_LIMIT_EXCEEDED',
      message: 'Too many signup attempts, please try again later'
    },
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for localhost in development
  skip: (req) => {
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isLocalhost = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
    return isDevelopment && isLocalhost;
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'LIGHT_RATE_LIMIT_EXCEEDED',
        message: 'Too many signup attempts, please try again later'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Brute force protection for login attempts
const bruteForceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // limit each IP to 3 login attempts per windowMs
  message: {
    success: false,
    error: {
      code: 'BRUTE_FORCE_PROTECTION',
      message: 'Too many failed login attempts, please try again later'
    },
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'BRUTE_FORCE_PROTECTION',
        message: 'Too many failed login attempts, please try again later'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// ✅ CRITICAL FIX: Lenient rate limiter for booking status updates
// Booking status updates are critical operations that should not be rate limited aggressively
// Drivers need to update status frequently during active trips (arrived, picked_up, etc.)
const bookingStatusLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: process.env.NODE_ENV === 'development' ? 1000 : 100, // ✅ Very lenient: 100 status updates per minute (was hitting limit with 20)
  message: {
    success: false,
    error: {
      code: 'BOOKING_STATUS_RATE_LIMIT_EXCEEDED',
      message: 'Too many booking status updates. Please wait a moment and try again.',
      details: 'Rate limit exceeded for booking status updates. This is a temporary restriction.'
    },
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for localhost in development
  skip: (req) => {
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isLocalhost = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
    return isDevelopment && isLocalhost;
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'BOOKING_STATUS_RATE_LIMIT_EXCEEDED',
        message: 'Too many booking status updates. Please wait a moment and try again.',
        details: 'Rate limit exceeded for booking status updates. This is a temporary restriction.'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// ✅ CRITICAL FIX: Lenient rate limiter for tracking/booking data fetching
// Customer app polls booking status frequently during live tracking
const trackingDataLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute window
  max: process.env.NODE_ENV === 'development' ? 500 : 60, // ✅ 60 requests per minute for tracking (1 per second)
  message: {
    success: false,
    error: {
      code: 'TRACKING_DATA_RATE_LIMIT_EXCEEDED',
      message: 'Too many tracking requests. Please wait a moment.',
      details: 'Rate limit exceeded for tracking data requests. This is a temporary restriction.'
    },
    timestamp: new Date().toISOString()
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const isDevelopment = process.env.NODE_ENV === 'development';
    const isLocalhost = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1';
    return isDevelopment && isLocalhost;
  },
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'TRACKING_DATA_RATE_LIMIT_EXCEEDED',
        message: 'Too many tracking requests. Please wait a moment.',
        details: 'Rate limit exceeded for tracking data requests. This is a temporary restriction.'
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = {
  generalLimiter,
  authLimiter,
  adminLimiter,
  speedLimiter,
  lightRateLimit,
  bruteForceLimiter,
  bookingStatusLimiter,
  trackingDataLimiter
};