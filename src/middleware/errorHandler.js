const { validationResult } = require('express-validator');

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('Error:', err);

  // Default error response
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'Something went wrong';
  let details = null;

  // Handle validation errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = Object.values(err.errors).map(e => e.message);
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorCode = 'INVALID_TOKEN';
    message = 'Invalid token';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = 'TOKEN_EXPIRED';
    message = 'Token expired';
  }

  // Handle Firebase errors
  if (err.code === 'auth/user-not-found') {
    statusCode = 404;
    errorCode = 'USER_NOT_FOUND';
    message = 'User not found';
  }

  if (err.code === 'auth/invalid-credential') {
    statusCode = 401;
    errorCode = 'INVALID_CREDENTIALS';
    message = 'Invalid credentials';
  }

  // Handle rate limiting errors
  if (err.status === 429) {
    statusCode = 429;
    errorCode = 'RATE_LIMIT_EXCEEDED';
    message = 'Too many requests';
    details = `Rate limit exceeded. Try again in ${err.retryAfter || '15 minutes'}`;
  }

  // Handle file upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    errorCode = 'FILE_TOO_LARGE';
    message = 'File too large';
    details = `Maximum file size is ${process.env.MAX_FILE_SIZE || '10MB'}`;
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    statusCode = 400;
    errorCode = 'INVALID_FILE_FIELD';
    message = 'Invalid file field';
  }

  // Handle database errors
  if (err.code === 'permission-denied') {
    statusCode = 403;
    errorCode = 'ACCESS_DENIED';
    message = 'Access denied';
  }

  if (err.code === 'not-found') {
    statusCode = 404;
    errorCode = 'RESOURCE_NOT_FOUND';
    message = 'Resource not found';
  }

  // Handle business logic errors
  if (err.code === 'INSUFFICIENT_BALANCE') {
    statusCode = 400;
    errorCode = 'INSUFFICIENT_BALANCE';
    message = 'Insufficient wallet balance';
  }

  if (err.code === 'DRIVER_NOT_AVAILABLE') {
    statusCode = 400;
    errorCode = 'DRIVER_NOT_AVAILABLE';
    message = 'No drivers available in your area';
  }

  if (err.code === 'BOOKING_CANCELLED') {
    statusCode = 400;
    errorCode = 'BOOKING_CANCELLED';
    message = 'This booking has been cancelled';
  }

  // Handle network errors
  if (err.code === 'ECONNREFUSED') {
    statusCode = 503;
    errorCode = 'SERVICE_UNAVAILABLE';
    message = 'Service temporarily unavailable';
  }

  if (err.code === 'ETIMEDOUT') {
    statusCode = 504;
    errorCode = 'GATEWAY_TIMEOUT';
    message = 'Request timeout';
  }

  // Send error response
  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: message,
      details: details || err.message,
      timestamp: new Date().toISOString()
    }
  });
};

/**
 * Async error wrapper for route handlers
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Validation error handler
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: errors.array().map(err => ({
          field: err.path,
          message: err.msg,
          value: err.value
        })),
        timestamp: new Date().toISOString()
      }
    });
  }
  next();
};

module.exports = {
  errorHandler,
  asyncHandler,
  handleValidationErrors
};
