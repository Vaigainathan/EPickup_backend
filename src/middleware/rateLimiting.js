const rateLimit = require('express-rate-limit');
const Redis = require('ioredis');

/**
 * Rate Limiting Middleware
 * Provides comprehensive rate limiting for different endpoints
 */
class RateLimitingService {
  constructor() {
    this.redis = null;
    this.initializeRedis();
  }

  /**
   * Initialize Redis connection for distributed rate limiting
   */
  initializeRedis() {
    try {
      if (process.env.REDIS_URL) {
        this.redis = new Redis(process.env.REDIS_URL, {
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
          lazyConnect: true
        });
        console.log('✅ Redis connected for rate limiting');
      } else {
        console.warn('⚠️ Redis not configured, using memory-based rate limiting');
      }
    } catch (error) {
      console.error('❌ Redis connection failed:', error);
      this.redis = null;
    }
  }

  /**
   * Create rate limiter with Redis store if available
   * @param {Object} options - Rate limiting options
   * @returns {Function} Rate limiting middleware
   */
  createRateLimiter(options) {
    const defaultOptions = {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each IP to 100 requests per windowMs
      message: {
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests',
          details: 'Rate limit exceeded. Please try again later.'
        },
        timestamp: new Date().toISOString()
      },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => {
        // Skip rate limiting for admin users
        return req.user && req.user.userType === 'admin';
      }
    };

    const rateLimiterOptions = { ...defaultOptions, ...options };

    // Use Redis store if available
    if (this.redis) {
      const RedisStore = require('rate-limit-redis');
      rateLimiterOptions.store = new RedisStore({
        sendCommand: (...args) => this.redis.call(...args)
      });
    }

    return rateLimit(rateLimiterOptions);
  }

  /**
   * Authentication rate limiter (strict)
   */
  getAuthRateLimiter() {
    return this.createRateLimiter({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 attempts per 15 minutes
      message: {
        success: false,
        error: {
          code: 'AUTH_RATE_LIMIT_EXCEEDED',
          message: 'Too many authentication attempts',
          details: 'Please wait 15 minutes before trying again.'
        },
        timestamp: new Date().toISOString()
      },
      skipSuccessfulRequests: true // Don't count successful requests
    });
  }

  /**
   * OTP rate limiter (very strict)
   */
  getOTPRateLimiter() {
    return this.createRateLimiter({
      windowMs: 5 * 60 * 1000, // 5 minutes
      max: 3, // 3 OTP requests per 5 minutes
      message: {
        success: false,
        error: {
          code: 'OTP_RATE_LIMIT_EXCEEDED',
          message: 'Too many OTP requests',
          details: 'Please wait 5 minutes before requesting another OTP.'
        },
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * General API rate limiter
   */
  getGeneralRateLimiter() {
    return this.createRateLimiter({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // 1000 requests per 15 minutes
      message: {
        success: false,
        error: {
          code: 'API_RATE_LIMIT_EXCEEDED',
          message: 'API rate limit exceeded',
          details: 'Too many requests. Please try again later.'
        },
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Booking creation rate limiter
   */
  getBookingRateLimiter() {
    return this.createRateLimiter({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 10, // 10 bookings per hour per user
      message: {
        success: false,
        error: {
          code: 'BOOKING_RATE_LIMIT_EXCEEDED',
          message: 'Too many booking requests',
          details: 'You can create maximum 10 bookings per hour.'
        },
        timestamp: new Date().toISOString()
      },
      keyGenerator: (req) => {
        // Rate limit per user instead of per IP
        return req.user ? `booking:${req.user.uid}` : `booking:${req.ip}`;
      }
    });
  }

  /**
   * File upload rate limiter
   */
  getFileUploadRateLimiter() {
    return this.createRateLimiter({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 20, // 20 file uploads per hour
      message: {
        success: false,
        error: {
          code: 'FILE_UPLOAD_RATE_LIMIT_EXCEEDED',
          message: 'Too many file uploads',
          details: 'You can upload maximum 20 files per hour.'
        },
        timestamp: new Date().toISOString()
      },
      keyGenerator: (req) => {
        return req.user ? `upload:${req.user.uid}` : `upload:${req.ip}`;
      }
    });
  }

  /**
   * WebSocket rate limiter
   */
  getWebSocketRateLimiter() {
    return this.createRateLimiter({
      windowMs: 60 * 1000, // 1 minute
      max: 100, // 100 WebSocket events per minute
      message: {
        success: false,
        error: {
          code: 'WEBSOCKET_RATE_LIMIT_EXCEEDED',
          message: 'Too many WebSocket events',
          details: 'Please reduce the frequency of your requests.'
        },
        timestamp: new Date().toISOString()
      },
      keyGenerator: (req) => {
        return req.user ? `websocket:${req.user.uid}` : `websocket:${req.ip}`;
      }
    });
  }

  /**
   * Admin operations rate limiter
   */
  getAdminRateLimiter() {
    return this.createRateLimiter({
      windowMs: 60 * 1000, // 1 minute
      max: 200, // 200 admin operations per minute
      message: {
        success: false,
        error: {
          code: 'ADMIN_RATE_LIMIT_EXCEEDED',
          message: 'Too many admin operations',
          details: 'Please reduce the frequency of your admin operations.'
        },
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Custom rate limiter for specific endpoints
   * @param {Object} options - Custom options
   * @returns {Function} Rate limiting middleware
   */
  getCustomRateLimiter(options) {
    return this.createRateLimiter(options);
  }

  /**
   * Check if Redis is available
   * @returns {boolean} True if Redis is available
   */
  isRedisAvailable() {
    return this.redis !== null;
  }

  /**
   * Get rate limit info for a key
   * @param {string} key - Rate limit key
   * @returns {Object} Rate limit information
   */
  async getRateLimitInfo(key) {
    if (!this.redis) {
      return null;
    }

    try {
      const info = await this.redis.hgetall(`rate_limit:${key}`);
      return {
        count: parseInt(info.count) || 0,
        resetTime: parseInt(info.resetTime) || 0,
        remaining: Math.max(0, (parseInt(info.max) || 0) - (parseInt(info.count) || 0))
      };
    } catch (error) {
      console.error('Error getting rate limit info:', error);
      return null;
    }
  }

  /**
   * Reset rate limit for a key
   * @param {string} key - Rate limit key
   * @returns {boolean} True if reset successful
   */
  async resetRateLimit(key) {
    if (!this.redis) {
      return false;
    }

    try {
      await this.redis.del(`rate_limit:${key}`);
      return true;
    } catch (error) {
      console.error('Error resetting rate limit:', error);
      return false;
    }
  }
}

// Create singleton instance
const rateLimitingService = new RateLimitingService();

// Export individual rate limiters for easy use
module.exports = {
  rateLimitingService,
  authRateLimiter: rateLimitingService.getAuthRateLimiter(),
  otpRateLimiter: rateLimitingService.getOTPRateLimiter(),
  generalRateLimiter: rateLimitingService.getGeneralRateLimiter(),
  bookingRateLimiter: rateLimitingService.getBookingRateLimiter(),
  fileUploadRateLimiter: rateLimitingService.getFileUploadRateLimiter(),
  webSocketRateLimiter: rateLimitingService.getWebSocketRateLimiter(),
  adminRateLimiter: rateLimitingService.getAdminRateLimiter()
};
