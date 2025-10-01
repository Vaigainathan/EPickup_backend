/**
 * Rate Limiting Middleware
 * Provides comprehensive rate limiting for different types of endpoints
 */

const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');

// General rate limiter for all endpoints
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
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
  max: 5, // limit each IP to 5 requests per windowMs
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
  max: 200, // limit each IP to 200 requests per windowMs
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
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // allow 50 requests per windowMs without delay
  delayMs: 500, // add 500ms delay per request after delayAfter
  maxDelayMs: 20000, // max delay of 20 seconds
  onLimitReached: (req) => {
    console.log(`Rate limit reached for IP: ${req.ip}`);
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

module.exports = {
  generalLimiter,
  authLimiter,
  adminLimiter,
  speedLimiter,
  bruteForceLimiter
};