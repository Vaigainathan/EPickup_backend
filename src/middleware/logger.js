/**
 * Structured Logging Middleware
 * Provides consistent, structured logging across the application
 */

const winston = require('winston');

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'epickup-backend' },
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    
    // Write error logs to file
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // Write all logs to file
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Request logging middleware
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Log request
  logger.info('Request started', {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.uid || 'anonymous',
    userType: req.user?.userType || 'unknown',
    requestId: req.id || 'unknown'
  });
  
  // Override res.end to log response
  const originalEnd = res.end;
  res.end = function(chunk, encoding) {
    const duration = Date.now() - startTime;
    
    logger.info('Request completed', {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userId: req.user?.uid || 'anonymous',
      userType: req.user?.userType || 'unknown',
      requestId: req.id || 'unknown'
    });
    
    originalEnd.call(this, chunk, encoding);
  };
  
  next();
};

// Error logging middleware
const errorLogger = (error, req, res, next) => {
  logger.error('Request error', {
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code
    },
    method: req.method,
    url: req.url,
    ip: req.ip,
    userId: req.user?.uid || 'anonymous',
    userType: req.user?.userType || 'unknown',
    requestId: req.id || 'unknown'
  });
  
  next(error);
};

// Security event logging
const securityLogger = {
  loginAttempt: (req, success, reason) => {
    logger.warn('Login attempt', {
      event: 'login_attempt',
      success,
      reason,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      email: req.body?.email || 'unknown'
    });
  },
  
  unauthorizedAccess: (req, resource) => {
    logger.warn('Unauthorized access attempt', {
      event: 'unauthorized_access',
      resource,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.uid || 'anonymous'
    });
  },
  
  rateLimitExceeded: (req, limit) => {
    logger.warn('Rate limit exceeded', {
      event: 'rate_limit_exceeded',
      limit,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
  }
};

// Performance logging
const performanceLogger = {
  slowQuery: (query, duration) => {
    logger.warn('Slow query detected', {
      event: 'slow_query',
      query: query.substring(0, 100) + '...',
      duration: `${duration}ms`
    });
  },
  
  highMemoryUsage: (usage) => {
    logger.warn('High memory usage', {
      event: 'high_memory_usage',
      usage: `${usage}MB`
    });
  }
};

module.exports = {
  logger,
  requestLogger,
  errorLogger,
  securityLogger,
  performanceLogger
};
