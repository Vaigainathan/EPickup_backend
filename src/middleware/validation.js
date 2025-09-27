const validationService = require('../services/validationService');

/**
 * API Validation Middleware
 * Provides comprehensive request validation
 */

/**
 * Validate request body against schema
 * @param {Object} schema - Joi schema
 * @param {Object} options - Validation options
 * @returns {Function} Middleware function
 */
const validateBody = (schema, options = {}) => {
  return (req, res, next) => {
    const result = validationService.validate(req.body, schema, options);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: result.errors
        },
        timestamp: new Date().toISOString()
      });
    }

    req.body = result.data;
    next();
  };
};

/**
 * Validate request query parameters
 * @param {Object} schema - Joi schema
 * @param {Object} options - Validation options
 * @returns {Function} Middleware function
 */
const validateQuery = (schema, options = {}) => {
  return (req, res, next) => {
    const result = validationService.validate(req.query, schema, options);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Query validation failed',
          details: result.errors
        },
        timestamp: new Date().toISOString()
      });
    }

    req.query = result.data;
    next();
  };
};

/**
 * Validate request parameters
 * @param {Object} schema - Joi schema
 * @param {Object} options - Validation options
 * @returns {Function} Middleware function
 */
const validateParams = (schema, options = {}) => {
  return (req, res, next) => {
    const result = validationService.validate(req.params, schema, options);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Parameter validation failed',
          details: result.errors
        },
        timestamp: new Date().toISOString()
      });
    }

    req.params = result.data;
    next();
  };
};

/**
 * Validate file upload
 * @param {Array} allowedTypes - Allowed MIME types
 * @param {number} maxSize - Maximum file size in bytes
 * @returns {Function} Middleware function
 */
const validateFileUpload = (allowedTypes = ['image/jpeg', 'image/png', 'image/webp'], maxSize = 5 * 1024 * 1024) => {
  return (req, res, next) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'File is required',
          details: 'No file provided in request'
        },
        timestamp: new Date().toISOString()
      });
    }

    const result = validationService.validateFileUpload(req.file, allowedTypes, maxSize);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'File validation failed',
          details: result.error
        },
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

/**
 * Validate authentication request
 * @returns {Function} Middleware function
 */
const validateAuth = () => {
  return (req, res, next) => {
    const result = validationService.validateAuth(req.body);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Authentication validation failed',
          details: result.errors
        },
        timestamp: new Date().toISOString()
      });
    }

    req.body = result.data;
    next();
  };
};

/**
 * Validate user registration
 * @returns {Function} Middleware function
 */
const validateUserRegistration = () => {
  return (req, res, next) => {
    const result = validationService.validateUserRegistration(req.body);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'User registration validation failed',
          details: result.errors
        },
        timestamp: new Date().toISOString()
      });
    }

    req.body = result.data;
    next();
  };
};

/**
 * Validate booking creation
 * @returns {Function} Middleware function
 */
const validateBookingCreation = () => {
  return (req, res, next) => {
    const result = validationService.validateBookingCreation(req.body);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Booking creation validation failed',
          details: result.errors
        },
        timestamp: new Date().toISOString()
      });
    }

    req.body = result.data;
    next();
  };
};

/**
 * Validate driver location update
 * @returns {Function} Middleware function
 */
const validateDriverLocation = () => {
  return (req, res, next) => {
    const result = validationService.validateDriverLocation(req.body);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Driver location validation failed',
          details: result.error
        },
        timestamp: new Date().toISOString()
      });
    }

    req.body = result.data;
    next();
  };
};

/**
 * Validate payment data
 * @returns {Function} Middleware function
 */
const validatePayment = () => {
  return (req, res, next) => {
    const result = validationService.validatePayment(req.body);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Payment validation failed',
          details: result.errors
        },
        timestamp: new Date().toISOString()
      });
    }

    req.body = result.data;
    next();
  };
};

/**
 * Validate pagination parameters
 * @returns {Function} Middleware function
 */
const validatePagination = () => {
  return (req, res, next) => {
    const result = validationService.validatePagination(req.query);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Pagination validation failed',
          details: result.errors
        },
        timestamp: new Date().toISOString()
      });
    }

    req.query = result.data;
    next();
  };
};

/**
 * Validate date range
 * @returns {Function} Middleware function
 */
const validateDateRange = () => {
  return (req, res, next) => {
    const result = validationService.validateDateRange(req.query);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Date range validation failed',
          details: result.errors
        },
        timestamp: new Date().toISOString()
      });
    }

    req.query = result.data;
    next();
  };
};

/**
 * Sanitize request body
 * @returns {Function} Middleware function
 */
const sanitizeBody = () => {
  return (req, res, next) => {
    if (req.body && typeof req.body === 'object') {
      req.body = sanitizeObject(req.body);
    }
    next();
  };
};

/**
 * Sanitize object recursively
 * @param {Object} obj - Object to sanitize
 * @returns {Object} Sanitized object
 */
const sanitizeObject = (obj) => {
  if (typeof obj !== 'object' || obj === null) {
    return typeof obj === 'string' ? validationService.sanitizeString(obj) : obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = sanitizeObject(value);
  }
  return sanitized;
};

/**
 * Validate search query
 * @returns {Function} Middleware function
 */
const validateSearchQuery = () => {
  return (req, res, next) => {
    const { q } = req.query;
    
    if (!q) {
      return next();
    }

    const result = validationService.validateSearchQuery(q);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Search query validation failed',
          details: result.errors
        },
        timestamp: new Date().toISOString()
      });
    }

    req.query.q = result.data;
    next();
  };
};

/**
 * Validate coordinates
 * @param {string} fieldName - Field name containing coordinates
 * @returns {Function} Middleware function
 */
const validateCoordinates = (fieldName = 'coordinates') => {
  return (req, res, next) => {
    const coordinates = req.body[fieldName];
    
    if (!coordinates) {
      return next();
    }

    const result = validationService.validate(coordinates, validationService.schemas.coordinates);
    
    if (!result.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Coordinates validation failed',
          details: result.errors
        },
        timestamp: new Date().toISOString()
      });
    }

    req.body[fieldName] = result.data;
    next();
  };
};

/**
 * Simple validation function for basic field validation
 * @param {any} value - Value to validate
 * @param {Object} rules - Validation rules
 * @returns {Object} Validation result
 */
const validateField = (value, rules) => {
  const errors = [];

  if (rules.required && (value === undefined || value === null || value === '')) {
    errors.push('This field is required');
    return { isValid: false, errors };
  }

  if (value !== undefined && value !== null) {
    if (rules.type && typeof value !== rules.type) {
      errors.push(`Must be of type ${rules.type}`);
    }
    
    if (rules.minLength && value.length < rules.minLength) {
      errors.push(`Must be at least ${rules.minLength} characters`);
    }
    
    if (rules.maxLength && value.length > rules.maxLength) {
      errors.push(`Must be no more than ${rules.maxLength} characters`);
    }
    
    if (rules.pattern && !rules.pattern.test(value)) {
      errors.push('Invalid format');
    }
    
    if (rules.min && value < rules.min) {
      errors.push(`Must be at least ${rules.min}`);
    }
    
    if (rules.max && value > rules.max) {
      errors.push(`Must be no more than ${rules.max}`);
    }

    if (rules.enum && !rules.enum.includes(value)) {
      errors.push(`Must be one of: ${rules.enum.join(', ')}`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Generic request validation middleware
 * @param {Object} validationRules - Validation rules for different parts of request
 * @returns {Function} Middleware function
 */
const validateRequest = (validationRules = {}) => {
  return (req, res, next) => {
    const errors = [];

    // Validate body if rules provided
    if (validationRules.body) {
      for (const [field, rules] of Object.entries(validationRules.body)) {
        const result = validateField(req.body[field], rules);
        if (!result.isValid) {
          errors.push(...result.errors.map(error => ({ field: `body.${field}`, message: error })));
        }
      }
    }

    // Validate query if rules provided
    if (validationRules.query) {
      for (const [field, rules] of Object.entries(validationRules.query)) {
        const result = validateField(req.query[field], rules);
        if (!result.isValid) {
          errors.push(...result.errors.map(error => ({ field: `query.${field}`, message: error })));
        }
      }
    }

    // Validate params if rules provided
    if (validationRules.params) {
      for (const [field, rules] of Object.entries(validationRules.params)) {
        const result = validateField(req.params[field], rules);
        if (!result.isValid) {
          errors.push(...result.errors.map(error => ({ field: `params.${field}`, message: error })));
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: errors
        },
        timestamp: new Date().toISOString()
      });
    }

    next();
  };
};

module.exports = {
  validateRequest,
  validateBody,
  validateQuery,
  validateParams,
  validateFileUpload,
  validateAuth,
  validateUserRegistration,
  validateBookingCreation,
  validateDriverLocation,
  validatePayment,
  validatePagination,
  validateDateRange,
  sanitizeBody,
  validateSearchQuery,
  validateCoordinates
};