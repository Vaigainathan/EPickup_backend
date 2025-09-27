/**
 * Enhanced Error Handler Middleware
 * Provides comprehensive error handling for Express routes
 */

const errorHandlingService = require('../services/errorHandlingService');

/**
 * Enhanced error handler middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const errorHandler = (err, req, res) => {
  // Log the error
  console.error('🚨 [ERROR_HANDLER] Unhandled error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });

  // Handle different types of errors
  let statusCode = err.statusCode || err.status || 500;
  const errorResponse = errorHandlingService.handleApiError(err, {
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.uid,
    userType: req.user?.userType
  });

  // Override status code if set by error handling service
  if (errorResponse.statusCode) {
    statusCode = errorResponse.statusCode;
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
};

/**
 * Async error wrapper
 * Wraps async route handlers to catch errors
 * @param {Function} fn - Async function to wrap
 * @returns {Function} Wrapped function
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Validation error handler
 * Handles validation errors from express-validator
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const handleValidationErrors = (req, res, next) => {
  const errors = req.validationErrors();
  if (errors) {
    const error = new Error('Validation failed');
    error.name = 'ValidationError';
    error.details = errors;
    error.statusCode = 400;
    return next(error);
  }
  next();
};

/**
 * Rate limit error handler
 * Handles rate limit exceeded errors
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const handleRateLimitError = (req, res, next) => {
  if (req.rateLimit) {
    const error = new Error('Rate limit exceeded');
    error.name = 'RateLimitError';
    error.statusCode = 429;
    error.retryAfter = req.rateLimit.resetTime;
    return next(error);
  }
  next();
};

/**
 * Database error handler
 * Handles database connection and query errors
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const handleDatabaseError = (err, req, res, next) => {
  if (err.code && ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND'].includes(err.code)) {
    const dbError = errorHandlingService.handleDatabaseError(err);
    return next(dbError);
  }
  next(err);
};

/**
 * External API error handler
 * Handles errors from external API calls
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const handleExternalApiError = (err, req, res, next) => {
  if (err.isAxiosError || err.response || err.request) {
    const service = req.externalService || 'External API';
    const apiError = errorHandlingService.handleExternalApiError(err, service);
    return next(apiError);
  }
  next(err);
};

/**
 * 404 handler
 * Handles requests to non-existent routes
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const handle404 = (req, res, next) => {
  const error = new Error(`Route ${req.originalUrl} not found`);
  error.name = 'NotFoundError';
  error.statusCode = 404;
  next(error);
};

/**
 * Request timeout handler
 * Handles request timeout errors
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const handleTimeout = (req, res, next) => {
  req.setTimeout(30000, () => {
    const error = new Error('Request timeout');
    error.name = 'TimeoutError';
    error.statusCode = 408;
    next(error);
  });
  next();
};

/**
 * Error recovery middleware
 * Attempts to recover from certain types of errors
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const errorRecovery = async (err, req, res, next) => {
  // Only attempt recovery for certain error types
  if (err.name === 'ServiceUnavailableError' && err.code === 'ECONNREFUSED') {
    try {
      // Wait a bit and retry
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // This would need to be implemented per route
      // For now, just pass the error along
      next(err);
      } catch {
      next(err);
    }
  } else {
    next(err);
  }
};

/**
 * Error monitoring middleware
 * Monitors error patterns and sends alerts
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const errorMonitoring = (err, req, res, next) => {
  // Log error for monitoring
  errorHandlingService.logError(err, {
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.uid,
    userType: req.user?.userType,
    timestamp: new Date().toISOString()
  });
  
  next(err);
};

/**
 * Graceful shutdown handler
 * Handles graceful shutdown of the application
 * @param {Object} server - Express server instance
 * @param {Object} options - Shutdown options
 */
const gracefulShutdown = (server, options = {}) => {
  const { timeout = 10000, signals = ['SIGTERM', 'SIGINT'] } = options;
  
  const shutdown = (signal) => {
    console.log(`🛑 [GRACEFUL_SHUTDOWN] Received ${signal}, shutting down gracefully...`);
    
    server.close(() => {
      console.log('✅ [GRACEFUL_SHUTDOWN] Server closed successfully');
      process.exit(0);
    });
    
    // Force close after timeout
    setTimeout(() => {
      console.error('❌ [GRACEFUL_SHUTDOWN] Forced shutdown after timeout');
      process.exit(1);
    }, timeout);
  };
  
  signals.forEach(signal => {
    process.on(signal, () => shutdown(signal));
  });
};

module.exports = {
  errorHandler,
  asyncHandler,
  handleValidationErrors,
  handleRateLimitError,
  handleDatabaseError,
  handleExternalApiError,
  handle404,
  handleTimeout,
  errorRecovery,
  errorMonitoring,
  gracefulShutdown
};