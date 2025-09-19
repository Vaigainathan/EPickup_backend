const rateLimit = require('express-rate-limit');

// Rate limiting for document verification
const documentVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many document verification requests, please try again later.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for admin operations
const adminOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many admin requests, please try again later.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for document access
const documentAccessLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // Limit each IP to 50 document access requests per windowMs
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many document access requests, please try again later.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  documentVerificationLimiter,
  adminOperationsLimiter,
  documentAccessLimiter
};
