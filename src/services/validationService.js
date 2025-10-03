const Joi = require('joi');

/**
 * Comprehensive Input Validation Service
 * Provides server-side validation for all API endpoints
 */
class ValidationService {
  constructor() {
    this.schemas = this.initializeSchemas();
  }

  /**
   * Initialize all validation schemas
   */
  initializeSchemas() {
    return {
      // Phone number validation (Indian format)
      phone: Joi.string()
        .pattern(/^\+91[6-9][0-9]{9}$/)
        .required()
        .messages({
          'string.pattern.base': 'Phone number must be a valid Indian mobile number (+91XXXXXXXXXX)',
          'any.required': 'Phone number is required'
        }),

      // Email validation
      email: Joi.string()
        .email({ tlds: { allow: false } })
        .optional()
        .messages({
          'string.email': 'Email must be a valid email address'
        }),

      // Coordinate validation
      coordinates: Joi.object({
        latitude: Joi.number()
          .min(-90)
          .max(90)
          .required()
          .messages({
            'number.min': 'Latitude must be between -90 and 90',
            'number.max': 'Latitude must be between -90 and 90',
            'any.required': 'Latitude is required'
          }),
        longitude: Joi.number()
          .min(-180)
          .max(180)
          .required()
          .messages({
            'number.min': 'Longitude must be between -180 and 180',
            'number.max': 'Longitude must be between -180 and 180',
            'any.required': 'Longitude is required'
          })
      }).required(),

      // Address validation
      address: Joi.object({
        street: Joi.string().min(5).max(200).required(),
        city: Joi.string().min(2).max(50).required(),
        state: Joi.string().min(2).max(50).required(),
        pincode: Joi.string().pattern(/^[1-9][0-9]{5}$/).required(),
        coordinates: this.schemas?.coordinates || Joi.object().required()
      }).required(),

      // User type validation
      userType: Joi.string()
        .valid('customer', 'driver', 'admin')
        .required()
        .messages({
          'any.only': 'User type must be customer, driver, or admin',
          'any.required': 'User type is required'
        }),

      // Booking status validation
      bookingStatus: Joi.string()
        .valid('pending', 'driver_assigned', 'accepted', 'driver_enroute', 
               'driver_arrived', 'picked_up', 'in_transit', 'delivered', 
               'completed', 'cancelled', 'rejected')
        .required()
        .messages({
          'any.only': 'Invalid booking status',
          'any.required': 'Booking status is required'
        }),

      // Driver status validation
      driverStatus: Joi.string()
        .valid('available', 'busy', 'offline', 'enroute', 'arrived')
        .required()
        .messages({
          'any.only': 'Invalid driver status',
          'any.required': 'Driver status is required'
        }),

      // Weight validation
      weight: Joi.number()
        .min(0.1)
        .max(50)
        .required()
        .messages({
          'number.min': 'Weight must be at least 0.1 kg',
          'number.max': 'Weight must not exceed 50 kg',
          'any.required': 'Weight is required'
        }),

      // Price validation
      price: Joi.number()
        .min(0)
        .max(10000)
        .required()
        .messages({
          'number.min': 'Price must be non-negative',
          'number.max': 'Price must not exceed ₹10,000',
          'any.required': 'Price is required'
        }),

      // File upload validation
      fileUpload: Joi.object({
        fieldname: Joi.string().required(),
        originalname: Joi.string().required(),
        mimetype: Joi.string().valid(
          'image/jpeg', 'image/png', 'image/webp', 'application/pdf'
        ).required(),
        size: Joi.number().max(5 * 1024 * 1024).required() // 5MB max
      }).required(),

      // Pagination validation
      pagination: Joi.object({
        page: Joi.number().min(1).default(1),
        limit: Joi.number().min(1).max(100).default(20),
        sortBy: Joi.string().optional(),
        sortOrder: Joi.string().valid('asc', 'desc').default('desc')
      }),

      // Date range validation
      dateRange: Joi.object({
        startDate: Joi.date().iso().optional(),
        endDate: Joi.date().iso().min(Joi.ref('startDate')).optional()
      })
    };
  }

  /**
   * Validate request data against schema
   * @param {Object} data - Data to validate
   * @param {Object} schema - Joi schema to validate against
   * @param {Object} options - Validation options
   * @returns {Object} Validation result
   */
  validate(data, schema, options = {}) {
    const defaultOptions = {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true
    };

    const validationOptions = { ...defaultOptions, ...options };
    const { error, value } = schema.validate(data, validationOptions);

    if (error) {
      return {
        isValid: false,
        errors: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        })),
        data: null
      };
    }

    return {
      isValid: true,
      errors: [],
      data: value
    };
  }

  /**
   * Validate authentication request
   * @param {Object} data - Authentication data
   * @returns {Object} Validation result
   */
  validateAuth(data) {
    const schema = Joi.object({
      phone: this.schemas.phone,
      otp: Joi.string().length(6).pattern(/^[0-9]{6}$/).optional(),
      userType: this.schemas.userType
    });

    return this.validate(data, schema);
  }

  /**
   * Validate user registration
   * @param {Object} data - User registration data
   * @returns {Object} Validation result
   */
  validateUserRegistration(data) {
    const schema = Joi.object({
      phone: this.schemas.phone,
      userType: this.schemas.userType,
      name: Joi.string().min(2).max(50).required(),
      email: this.schemas.email,
      address: Joi.object({
        street: Joi.string().min(5).max(200).optional(),
        city: Joi.string().min(2).max(50).optional(),
        state: Joi.string().min(2).max(50).optional(),
        pincode: Joi.string().pattern(/^[1-9][0-9]{5}$/).optional(),
        coordinates: this.schemas.coordinates.optional()
      }).optional()
    });

    return this.validate(data, schema);
  }

  /**
   * Validate booking creation
   * @param {Object} data - Booking data
   * @returns {Object} Validation result
   */
  validateBookingCreation(data) {
    const schema = Joi.object({
      pickup: Joi.object({
        address: Joi.string().min(10).max(500).required(),
        coordinates: this.schemas.coordinates,
        contactName: Joi.string().min(2).max(50).required(),
        contactPhone: this.schemas.phone
      }).required(),
      drop: Joi.object({
        address: Joi.string().min(10).max(500).required(),
        coordinates: this.schemas.coordinates,
        contactName: Joi.string().min(2).max(50).required(),
        contactPhone: this.schemas.phone
      }).required(),
      weight: this.schemas.weight,
      description: Joi.string().max(500).optional(),
      scheduledTime: Joi.date().iso().min('now').optional(),
      specialInstructions: Joi.string().max(1000).optional()
    });

    return this.validate(data, schema);
  }

  /**
   * Validate driver location update
   * @param {Object} data - Location data
   * @returns {Object} Validation result
   */
  validateDriverLocation(data) {
    const schema = Joi.object({
      currentLocation: this.schemas.coordinates,
      isOnline: Joi.boolean().optional(),
      isAvailable: Joi.boolean().optional(),
      workingHours: Joi.object({
        startTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(),
        endTime: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required()
      }).optional(),
      workingDays: Joi.array().items(
        Joi.string().valid('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
      ).min(1).max(7).optional()
    });

    return this.validate(data, schema);
  }

  /**
   * Validate payment data
   * @param {Object} data - Payment data
   * @returns {Object} Validation result
   */
  validatePayment(data) {
    const schema = Joi.object({
      amount: this.schemas.price,
      currency: Joi.string().valid('INR').default('INR'),
      paymentMethod: Joi.string().valid('upi', 'wallet').required(),
      paymentId: Joi.string().min(1).max(100).required(),
      bookingId: Joi.string().min(1).max(100).required()
    });

    return this.validate(data, schema);
  }

  /**
   * Validate file upload
   * @param {Object} file - File object
   * @param {Array} allowedTypes - Allowed MIME types
   * @param {number} maxSize - Maximum file size in bytes
   * @returns {Object} Validation result
   */
  validateFileUpload(file, allowedTypes = ['image/jpeg', 'image/png', 'image/webp'], maxSize = 5 * 1024 * 1024) {
    if (!file) {
      return {
        isValid: false,
        errors: [{ field: 'file', message: 'File is required' }],
        data: null
      };
    }

    const errors = [];

    // Check file type
    if (!allowedTypes.includes(file.mimetype)) {
      errors.push({
        field: 'mimetype',
        message: `File type ${file.mimetype} is not allowed. Allowed types: ${allowedTypes.join(', ')}`
      });
    }

    // Check file size
    if (file.size > maxSize) {
      errors.push({
        field: 'size',
        message: `File size ${file.size} bytes exceeds maximum allowed size of ${maxSize} bytes`
      });
    }

    // Check file name
    if (!file.originalname || file.originalname.length < 1) {
      errors.push({
        field: 'originalname',
        message: 'File name is required'
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      data: errors.length === 0 ? file : null
    };
  }

  /**
   * Sanitize string input
   * @param {string} input - Input string
   * @returns {string} Sanitized string
   */
  sanitizeString(input) {
    if (typeof input !== 'string') {
      return input;
    }

    return input
      .trim()
      .replace(/[<>]/g, '') // Remove potential HTML tags
      .replace(/['"]/g, '') // Remove quotes
      .replace(/[;]/g, '') // Remove semicolons
      .substring(0, 1000); // Limit length
  }

  /**
   * Validate and sanitize search query
   * @param {string} query - Search query
   * @returns {Object} Validation result
   */
  validateSearchQuery(query) {
    if (!query || typeof query !== 'string') {
      return {
        isValid: false,
        errors: [{ field: 'query', message: 'Search query is required' }],
        data: null
      };
    }

    const sanitized = this.sanitizeString(query);
    
    if (sanitized.length < 2) {
      return {
        isValid: false,
        errors: [{ field: 'query', message: 'Search query must be at least 2 characters long' }],
        data: null
      };
    }

    return {
      isValid: true,
      errors: [],
      data: sanitized
    };
  }

  /**
   * Validate pagination parameters
   * @param {Object} params - Pagination parameters
   * @returns {Object} Validation result
   */
  validatePagination(params) {
    return this.validate(params, this.schemas.pagination);
  }

  /**
   * Validate date range
   * @param {Object} params - Date range parameters
   * @returns {Object} Validation result
   */
  validateDateRange(params) {
    return this.validate(params, this.schemas.dateRange);
  }
}

// Create singleton instance
const validationService = new ValidationService();

module.exports = validationService;
