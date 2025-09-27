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
 * Generic request validation middleware
 * @param {Object} validationRules - Validation rules for different parts of request
 * @returns {Function} Middleware function
 */
const validateRequest = (validationRules = {}) => {
  return (req, res, next) => {
    const errors = [];

    // Validate body if rules provided
    if (validationRules.body) {
      const bodyResult = validationService.validateInput(req.body, validationRules.body);
      if (!bodyResult.isValid) {
        errors.push(...bodyResult.errors.map(error => ({ field: 'body', message: error })));
      }
    }

    // Validate query if rules provided
    if (validationRules.query) {
      const queryResult = validationService.validateInput(req.query, validationRules.query);
      if (!queryResult.isValid) {
        errors.push(...queryResult.errors.map(error => ({ field: 'query', message: error })));
      }
    }

    // Validate params if rules provided
    if (validationRules.params) {
      const paramsResult = validationService.validateInput(req.params, validationRules.params);
      if (!paramsResult.isValid) {
        errors.push(...paramsResult.errors.map(error => ({ field: 'params', message: error })));
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