const rateLimit = require('express-rate-limit');

/**
 * Create a rate limiter with trust proxy configuration
 * @param {Object} options - Rate limit options
 * @returns {Function} Express rate limiter middleware
 */
function createRateLimit(options = {}) {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000, // 15 minutes default
    max: options.max || 100, // limit each IP to 100 requests per windowMs default
    message: options.message || 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    // Trust proxy for proper IP detection behind reverse proxy
    trustProxy: true,
    ...options
  });
}

module.exports = {
  rateLimit: createRateLimit,
  createRateLimit
};
