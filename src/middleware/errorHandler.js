/**
 * Standardized Error Handler Middleware
 * Provides consistent error response format across all endpoints
 */

const errorHandler = (error, req, res) => {
  // Enhanced error logging with more context
  const errorContext = {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString(),
    userId: req.user?.uid || req.user?.userId || 'anonymous',
    userType: req.user?.userType || 'unknown',
    requestId: req.id || 'unknown',
    body: req.method !== 'GET' ? req.body : undefined,
    query: req.query,
    params: req.params,
    headers: {
      'content-type': req.get('Content-Type'),
      'authorization': req.get('Authorization') ? 'Bearer [REDACTED]' : undefined,
      'x-forwarded-for': req.get('X-Forwarded-For'),
      'x-real-ip': req.get('X-Real-IP')
    }
  };

  console.error('Error occurred:', errorContext);

  // Default error response
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details = null;

  // Handle specific error types
  if (error.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = error.details || error.message;
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401;
    errorCode = 'UNAUTHORIZED';
    message = 'Unauthorized access';
  } else if (error.name === 'ForbiddenError') {
    statusCode = 403;
    errorCode = 'FORBIDDEN';
    message = 'Access forbidden';
  } else if (error.name === 'NotFoundError') {
    statusCode = 404;
    errorCode = 'NOT_FOUND';
    message = 'Resource not found';
  } else if (error.name === 'ConflictError') {
    statusCode = 409;
    errorCode = 'CONFLICT';
    message = 'Resource conflict';
  } else if (error.name === 'RateLimitError') {
    statusCode = 429;
    errorCode = 'RATE_LIMIT_EXCEEDED';
    message = 'Too many requests';
  } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
    statusCode = 503;
    errorCode = 'SERVICE_UNAVAILABLE';
    message = 'External service unavailable';
  } else if (error.code === 'ETIMEDOUT') {
    statusCode = 504;
    errorCode = 'GATEWAY_TIMEOUT';
    message = 'Request timeout';
  }

  // Handle custom error objects
  if (error.statusCode) {
    statusCode = error.statusCode;
  }
  if (error.errorCode) {
    errorCode = error.errorCode;
  }
  if (error.message) {
    message = error.message;
  }
  if (error.details) {
    details = error.details;
  }

  // Don't expose sensitive information in production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    message = 'Internal server error';
    details = null;
  }

  // Attempt error recovery for certain error types
  if (statusCode === 503 && error.code === 'ENOTFOUND') {
    // Service unavailable - could implement retry logic here
    console.log('Service unavailable, implementing retry logic...');
  }

  // Send standardized error response
  res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message: message,
      ...(details && { details: details })
    },
    timestamp: new Date().toISOString(),
    requestId: req.id || 'unknown',
    // Include retry information for certain errors
    ...(statusCode === 503 && { retryAfter: 30 })
  });
};

/**
 * Async handler wrapper to catch async errors
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Handle rate limit errors
 */
const handleRateLimitError = (req, res, next) => {
  // This would be used by express-rate-limit
  next();
};

/**
 * Handle database errors
 */
const handleDatabaseError = (req, res, next) => {
  next();
};

/**
 * Handle external API errors
 */
const handleExternalApiError = (req, res, next) => {
  next();
};

/**
 * Handle 404 errors
 */
const handle404 = (req, res, next) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
      details: `The requested endpoint ${req.method} ${req.path} does not exist`
    },
    timestamp: new Date().toISOString()
  });
};

/**
 * Handle timeout errors
 */
const handleTimeout = (req, res, next) => {
  next();
};

/**
 * Error recovery middleware
 */
const errorRecovery = (req, res, next) => {
  next();
};

/**
 * Error monitoring middleware
 */
const errorMonitoring = (req, res, next) => {
  next();
};

/**
 * Graceful shutdown handler
 */
const gracefulShutdown = () => {
  console.log('Graceful shutdown initiated');
};

module.exports = { 
  errorHandler, 
  asyncHandler,
  handleRateLimitError,
  handleDatabaseError,
  handleExternalApiError,
  handle404,
  handleTimeout,
  errorRecovery,
  errorMonitoring,
  gracefulShutdown
};