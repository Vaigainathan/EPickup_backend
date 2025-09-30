const { body, validationResult } = require('express-validator');
const sanitizeHtml = require('sanitize-html');
const validator = require('validator');

/**
 * Sanitize input data to prevent XSS attacks
 */
const sanitizeInput = (req, res, next) => {
  const sanitizeObject = (obj) => {
    if (typeof obj === 'string') {
      return sanitizeHtml(obj, {
        allowedTags: [],
        allowedAttributes: {}
      });
    }
    if (typeof obj === 'object' && obj !== null) {
      const sanitized = {};
      for (const key in obj) {
        sanitized[key] = sanitizeObject(obj[key]);
      }
      return sanitized;
    }
    return obj;
  };

  req.body = sanitizeObject(req.body);
  req.query = sanitizeObject(req.query);
  req.params = sanitizeObject(req.params);
  next();
};

/**
 * Validate phone number format
 */
const validatePhoneNumber = (field) => {
  return body(field)
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number')
    .custom((value) => {
      if (!validator.isMobilePhone(value, 'en-IN')) {
        throw new Error('Invalid phone number format');
      }
      return true;
    });
};

/**
 * Validate email format
 */
const validateEmail = (field) => {
  return body(field)
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail();
};

/**
 * Check validation results
 */
const checkValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: errors.array()
      },
      timestamp: new Date().toISOString()
    });
  }
  next();
};

module.exports = {
  sanitizeInput,
  validatePhoneNumber,
  validateEmail,
  checkValidation
};