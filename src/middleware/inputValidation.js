const { body, param, query, validationResult } = require('express-validator');
const errorHandlingService = require('../services/errorHandlingService');

/**
 * Input validation middleware for API endpoints
 * Provides comprehensive validation for all request types
 */

// Common validation schemas
const phoneValidation = body('phone')
  .isMobilePhone('en-IN')
  .withMessage('Invalid Indian phone number format');

const coordinatesValidation = (field) => body(`${field}.coordinates`)
  .isObject()
  .withMessage(`${field} coordinates must be an object`)
  .custom((value) => {
    if (!value.latitude || !value.longitude) {
      throw new Error(`${field} coordinates must have latitude and longitude`);
    }
    if (typeof value.latitude !== 'number' || typeof value.longitude !== 'number') {
      throw new Error(`${field} coordinates must be numbers`);
    }
    if (value.latitude < -90 || value.latitude > 90) {
      throw new Error(`${field} latitude must be between -90 and 90`);
    }
    if (value.longitude < -180 || value.longitude > 180) {
      throw new Error(`${field} longitude must be between -180 and 180`);
    }
    return true;
  });

const addressValidation = (field) => body(`${field}.address`)
  .isString()
  .isLength({ min: 5, max: 200 })
  .withMessage(`${field} address must be between 5 and 200 characters`);

const nameValidation = (field) => body(`${field}.name`)
  .isString()
  .isLength({ min: 2, max: 50 })
  .withMessage(`${field} name must be between 2 and 50 characters`);

// Validation middleware factory
const createValidationMiddleware = (validations) => {
  return async (req, res, next) => {
    try {
      // Run validations
      await Promise.all(validations.map(validation => validation.run(req)));
      
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Input validation failed',
            details: errors.array()
          },
          timestamp: new Date().toISOString()
        });
      }
      
      next();
    } catch (error) {
      console.error('Validation middleware error:', error);
      res.status(500).json({
        success: false,
        error: {
          code: 'VALIDATION_MIDDLEWARE_ERROR',
          message: 'Validation middleware failed',
          details: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  };
};

// Specific validation sets
const authValidation = {
  sendOTP: createValidationMiddleware([
    phoneValidation,
    body('name').optional().isString().isLength({ min: 2, max: 50 })
  ]),
  
  verifyOTP: createValidationMiddleware([
    phoneValidation,
    body('otp').isString().isLength({ min: 4, max: 6 }).withMessage('OTP must be 4-6 characters'),
    body('name').optional().isString().isLength({ min: 2, max: 50 })
  ]),
  
  checkUser: createValidationMiddleware([
    phoneValidation
  ])
};

const bookingValidation = {
  create: createValidationMiddleware([
    body('pickup').isObject().withMessage('Pickup location is required'),
    nameValidation('pickup'),
    addressValidation('pickup'),
    coordinatesValidation('pickup'),
    
    body('drop').isObject().withMessage('Drop location is required'),
    nameValidation('drop'),
    addressValidation('drop'),
    coordinatesValidation('drop'),
    
    body('weight').optional().isFloat({ min: 0.1, max: 50 }).withMessage('Weight must be between 0.1 and 50 kg'),
    body('description').optional().isString().isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
    body('fare').isObject().withMessage('Fare information is required'),
    body('fare.total').isFloat({ min: 0 }).withMessage('Fare total must be a positive number'),
    body('fare.currency').isString().isLength({ min: 3, max: 3 }).withMessage('Currency must be 3 characters')
  ]),
  
  updateStatus: createValidationMiddleware([
    param('id').isString().isLength({ min: 1 }).withMessage('Booking ID is required'),
    body('status').isIn(['pending', 'driver_assigned', 'accepted', 'driver_enroute', 
                        'driver_arrived', 'picked_up', 'in_transit', 'delivered', 
                        'completed', 'cancelled', 'rejected'])
      .withMessage('Invalid booking status'),
    body('cancellationReason').optional().isString().isLength({ max: 200 })
  ])
};

const driverValidation = {
  registerAvailability: createValidationMiddleware([
    body('location').isObject().withMessage('Location is required'),
    body('location.latitude').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
    body('location.longitude').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
    body('location.address').optional().isString().isLength({ max: 200 }),
    body('vehicleType').optional().isIn(['2_wheeler', '4_wheeler']).withMessage('Invalid vehicle type')
  ]),
  
  updateLocation: createValidationMiddleware([
    body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
    body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
    body('accuracy').optional().isFloat({ min: 0 }).withMessage('Accuracy must be positive'),
    body('address').optional().isString().isLength({ max: 200 })
  ]),
  
  setAvailability: createValidationMiddleware([
    body('isOnline').isBoolean().withMessage('isOnline must be boolean'),
    body('isAvailable').isBoolean().withMessage('isAvailable must be boolean')
  ]),
  
  acceptBooking: createValidationMiddleware([
    param('id').isString().isLength({ min: 1 }).withMessage('Booking ID is required')
  ]),
  
  getAvailableBookings: createValidationMiddleware([
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative'),
    query('radius').optional().isFloat({ min: 0.1, max: 50 }).withMessage('Radius must be between 0.1 and 50 km')
  ])
};

const userValidation = {
  updateProfile: createValidationMiddleware([
    body('name').optional().isString().isLength({ min: 2, max: 50 }),
    phoneValidation,
    body('userType').optional().isIn(['customer', 'driver']).withMessage('Invalid user type')
  ])
};

// Rate limiting validation
const rateLimitValidation = {
  otp: createValidationMiddleware([
    body('phone').custom(async (phone) => {
      const allowed = await errorHandlingService.checkRateLimit(
        `otp_${phone}`, 
        3, // 3 attempts
        5 * 60 * 1000 // 5 minutes
      );
      if (!allowed) {
        throw new Error('Too many OTP requests. Please try again later.');
      }
      return true;
    })
  ]),
  
  booking: createValidationMiddleware([
    body('customerId').custom(async (customerId) => {
      const allowed = await errorHandlingService.checkRateLimit(
        `booking_${customerId}`, 
        5, // 5 bookings
        60 * 60 * 1000 // 1 hour
      );
      if (!allowed) {
        throw new Error('Too many booking requests. Please try again later.');
      }
      return true;
    })
  ])
};

// Sanitization middleware
const sanitizeInput = (req, res, next) => {
  try {
    // Sanitize string inputs
    const sanitizeString = (str) => {
      if (typeof str === 'string') {
        return str.trim().replace(/[<>]/g, '');
      }
      return str;
    };

    // Recursively sanitize object
    const sanitizeObject = (obj) => {
      if (typeof obj === 'string') {
        return sanitizeString(obj);
      }
      if (Array.isArray(obj)) {
        return obj.map(sanitizeObject);
      }
      if (obj && typeof obj === 'object') {
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
          sanitized[key] = sanitizeObject(value);
        }
        return sanitized;
      }
      return obj;
    };

    // Sanitize request body
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }

    // Sanitize query parameters
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }

    next();
  } catch (error) {
    console.error('Sanitization error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SANITIZATION_ERROR',
        message: 'Input sanitization failed',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
};

// JWT validation middleware
const validateJWT = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_TOKEN',
          message: 'Authorization token is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Basic JWT format validation
    const parts = token.split('.');
    if (parts.length !== 3) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN_FORMAT',
          message: 'Invalid token format'
        },
        timestamp: new Date().toISOString()
      });
    }

    next();
  } catch (error) {
    console.error('JWT validation error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'JWT_VALIDATION_ERROR',
        message: 'JWT validation failed',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
};

module.exports = {
  authValidation,
  bookingValidation,
  driverValidation,
  userValidation,
  rateLimitValidation,
  sanitizeInput,
  validateJWT,
  createValidationMiddleware
};
