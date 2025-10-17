/**
 * Rate Limiting Middleware
 * 
 * Prevents API abuse by limiting requests per user/IP
 * with configurable windows and limits.
 */

const rateLimit = require('express-rate-limit');

// Optional Redis support - only use if available
let RedisStore = null;
let Redis = null;

try {
  RedisStore = require('rate-limit-redis');
  Redis = require('redis');
} catch {
  console.log('Redis packages not available, using memory store only');
}

// Create Redis client for rate limiting (optional)
let redisClient = null;
if (Redis) {
  try {
    redisClient = Redis.createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      retry_strategy: () => 1000
    });
    
    redisClient.on('error', (err) => {
      console.warn('Redis connection failed, using memory store for rate limiting:', err.message);
      redisClient = null;
    });
  } catch {
    console.warn('Redis not available, using memory store for rate limiting');
  }
}

/**
 * Create rate limiter with Redis store if available, memory store otherwise
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

  if (redisClient && RedisStore) {
    defaultOptions.store = new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
    });
  }

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
 */
const moderateRateLimit = createRateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: process.env.NODE_ENV === 'development' ? 1000 : 300, // Increased for mobile apps
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
 */
const documentStatusRateLimit = createRateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === 'development' ? 200 : 60, // Much higher for document polling
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