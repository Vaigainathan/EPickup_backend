const { validationResult } = require('express-validator');

/**
 * Generic request validation middleware
 */
const validateRequest = (schema) => {
  return (req, res, next) => {
    // Simple validation based on schema
    const errors = [];
    
    if (schema.body) {
      for (const [field, rules] of Object.entries(schema.body)) {
        const value = req.body[field];
        
        if (rules.required && (value === undefined || value === null || value === '')) {
          errors.push({
            field,
            message: `${field} is required`,
            value
          });
        } else if (value !== undefined && value !== null) {
          if (rules.type && typeof value !== rules.type) {
            errors.push({
              field,
              message: `${field} must be of type ${rules.type}`,
              value
            });
          }
          
          if (rules.minLength && value.length < rules.minLength) {
            errors.push({
              field,
              message: `${field} must be at least ${rules.minLength} characters long`,
              value
            });
          }
          
          if (rules.maxLength && value.length > rules.maxLength) {
            errors.push({
              field,
              message: `${field} must be no more than ${rules.maxLength} characters long`,
              value
            });
          }
          
          if (rules.enum && !rules.enum.includes(value)) {
            errors.push({
              field,
              message: `${field} must be one of: ${rules.enum.join(', ')}`,
              value
            });
          }
        }
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: errors,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    next();
  };
};

/**
 * Validate coordinates
 */
const validateCoordinates = (req, res, next) => {
  const { latitude, longitude } = req.body;
  
  if (latitude === undefined || longitude === undefined) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_COORDINATES',
        message: 'Latitude and longitude are required',
        timestamp: new Date().toISOString()
      }
    });
  }

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_COORDINATES',
        message: 'Latitude and longitude must be numbers',
        timestamp: new Date().toISOString()
      }
    });
  }

  if (latitude < -90 || latitude > 90) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_LATITUDE',
        message: 'Latitude must be between -90 and 90',
        timestamp: new Date().toISOString()
      }
    });
  }

  if (longitude < -180 || longitude > 180) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_LONGITUDE',
        message: 'Longitude must be between -180 and 180',
        timestamp: new Date().toISOString()
      }
    });
  }

  next();
};

/**
 * Validate phone number format
 */
const validatePhoneNumber = (req, res, next) => {
  const { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_PHONE',
        message: 'Phone number is required',
        timestamp: new Date().toISOString()
      }
    });
  }

  // Indian phone number format: +91XXXXXXXXXX or 91XXXXXXXXXX or XXXXXXXXXX
  const phoneRegex = /^(\+?91|0)?[6-9]\d{9}$/;
  
  if (!phoneRegex.test(phone)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_PHONE',
        message: 'Please provide a valid Indian phone number',
        timestamp: new Date().toISOString()
      }
    });
  }

  next();
};

/**
 * Validate amount (positive number)
 */
const validateAmount = (req, res, next) => {
  const { amount } = req.body;
  
  if (amount === undefined) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_AMOUNT',
        message: 'Amount is required',
        timestamp: new Date().toISOString()
      }
    });
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_AMOUNT',
        message: 'Amount must be a positive number',
        timestamp: new Date().toISOString()
      }
    });
  }

  if (amount > 100000) { // Max amount limit
    return res.status(400).json({
      success: false,
      error: {
        code: 'AMOUNT_TOO_HIGH',
        message: 'Amount cannot exceed ₹100,000',
        timestamp: new Date().toISOString()
      }
    });
  }

  next();
};

/**
 * Validate file upload
 */
const validateFileUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'NO_FILE_PROVIDED',
        message: 'No file provided',
        timestamp: new Date().toISOString()
      }
    });
  }

  const { file } = req;
  const maxSize = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024; // 10MB default

  if (file.size > maxSize) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: `File size exceeds maximum limit of ${Math.round(maxSize / (1024 * 1024))}MB`,
        timestamp: new Date().toISOString()
      }
    });
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  
  if (!allowedTypes.includes(file.mimetype)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_FILE_TYPE',
        message: 'Invalid file type. Only JPEG, PNG, WebP, and PDF files are allowed',
        timestamp: new Date().toISOString()
      }
    });
  }

  next();
};

/**
 * Validate pagination parameters
 */
const validatePagination = (req, res, next) => {
  const { limit, offset } = req.query;
  
  if (limit !== undefined) {
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_LIMIT',
          message: 'Limit must be a number between 1 and 100',
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  if (offset !== undefined) {
    const offsetNum = parseInt(offset);
    if (isNaN(offsetNum) || offsetNum < 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_OFFSET',
          message: 'Offset must be a non-negative number',
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  next();
};

/**
 * Validate date range
 */
const validateDateRange = (req, res, next) => {
  const { startDate, endDate } = req.query;
  
  if (startDate) {
    const start = new Date(startDate);
    if (isNaN(start.getTime())) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_START_DATE',
          message: 'Start date must be a valid date',
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  if (endDate) {
    const end = new Date(endDate);
    if (isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_END_DATE',
          message: 'End date must be a valid date',
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start >= end) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DATE_RANGE',
          message: 'Start date must be before end date',
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  next();
};

module.exports = {
  validateRequest,
  validateCoordinates,
  validatePhoneNumber,
  validateAmount,
  validateFileUpload,
  validatePagination,
  validateDateRange
};
