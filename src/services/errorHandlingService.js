/**
 * Enhanced Error Handling Service
 * Provides comprehensive error handling, retry mechanisms, and logging
 */

const { getFirestore } = require('./firebase');
const notificationService = require('./notificationService');

class ErrorHandlingService {
  constructor() {
    this.db = getFirestore();
    this.retryConfig = {
      maxRetries: 3,
      baseDelay: 1000, // 1 second
      maxDelay: 10000, // 10 seconds
      backoffMultiplier: 2
    };
    this.errorThresholds = {
      critical: 5, // 5 errors in 1 minute
      warning: 10, // 10 errors in 5 minutes
      info: 20 // 20 errors in 10 minutes
    };
  }

  /**
   * Execute function with retry logic
   * @param {Function} fn - Function to execute
   * @param {Object} options - Retry options
   * @returns {Promise} Result of function execution
   */
  async executeWithRetry(fn, options = {}) {
    const config = { ...this.retryConfig, ...options };
    // let lastError;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const result = await fn();
        if (attempt > 0) {
          console.log(`✅ [ERROR_HANDLING] Operation succeeded on attempt ${attempt + 1}`);
        }
        return result;
      } catch (error) {
        // lastError = error;
        
        if (attempt === config.maxRetries) {
          console.error(`❌ [ERROR_HANDLING] Operation failed after ${config.maxRetries + 1} attempts:`, error);
          await this.logError(error, { attempts: attempt + 1, operation: fn.name });
          throw error;
        }
        
        const delay = this.calculateDelay(attempt, config);
        console.warn(`⚠️ [ERROR_HANDLING] Attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
        
        await this.sleep(delay);
      }
    }
  }

  /**
   * Execute Firestore transaction with retry logic
   * @param {Function} transactionFn - Transaction function that receives a Firestore transaction object
   * @param {Object} options - Retry options and context
   * @returns {Promise} Result of transaction execution
   */
  async executeTransactionWithRetry(transactionFn, options = {}) {
    const config = { ...this.retryConfig, ...options };
    const db = this.db;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const result = await db.runTransaction(async (transaction) => {
          return await transactionFn(transaction);
        });
        
        if (attempt > 0) {
          console.log(`✅ [ERROR_HANDLING] Transaction succeeded on attempt ${attempt + 1}`);
        }
        return result;
      } catch (error) {
        // Firestore transactions can fail due to contention - retry these
        const isRetryableError = 
          error.code === 10 || // ABORTED - transaction conflict
          error.code === 8 || // RESOURCE_EXHAUSTED - rate limit
          error.message?.includes('transaction') ||
          error.message?.includes('concurrent');
        
        if (attempt === config.maxRetries || !isRetryableError) {
          console.error(`❌ [ERROR_HANDLING] Transaction failed after ${attempt + 1} attempts:`, error);
          await this.logError(error, { 
            attempts: attempt + 1, 
            operation: 'executeTransactionWithRetry',
            context: options.context || 'Unknown'
          });
          throw error;
        }
        
        const delay = this.calculateDelay(attempt, config);
        console.warn(`⚠️ [ERROR_HANDLING] Transaction attempt ${attempt + 1} failed, retrying in ${delay}ms:`, error.message);
        
        await this.sleep(delay);
      }
    }
  }

  /**
   * Calculate delay for retry attempts
   * @param {number} attempt - Current attempt number
   * @param {Object} config - Retry configuration
   * @returns {number} Delay in milliseconds
   */
  calculateDelay(attempt, config) {
    const delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt);
    return Math.min(delay, config.maxDelay);
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Promise that resolves after delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Handle API errors with proper response formatting
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   * @returns {Object} Formatted error response
   */
  handleApiError(error, context = {}) {
    const errorResponse = {
      success: false,
      timestamp: new Date().toISOString(),
      ...context
    };

    // Handle specific error types
    if (error.name === 'ValidationError') {
      errorResponse.error = {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: error.details || error.message
      };
      errorResponse.statusCode = 400;
    } else if (error.name === 'AuthenticationError') {
      errorResponse.error = {
        code: 'AUTHENTICATION_ERROR',
        message: 'Authentication failed',
        details: error.message
      };
      errorResponse.statusCode = 401;
    } else if (error.name === 'AuthorizationError') {
      errorResponse.error = {
        code: 'AUTHORIZATION_ERROR',
        message: 'Access denied',
        details: error.message
      };
      errorResponse.statusCode = 403;
    } else if (error.name === 'NotFoundError') {
      errorResponse.error = {
        code: 'NOT_FOUND',
        message: 'Resource not found',
        details: error.message
      };
      errorResponse.statusCode = 404;
    } else if (error.name === 'ConflictError') {
      errorResponse.error = {
        code: 'CONFLICT',
        message: 'Resource conflict',
        details: error.message
      };
      errorResponse.statusCode = 409;
    } else if (error.name === 'RateLimitError') {
      errorResponse.error = {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests',
        details: error.message
      };
      errorResponse.statusCode = 429;
    } else if (error.name === 'ServiceUnavailableError') {
      errorResponse.error = {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable',
        details: error.message
      };
      errorResponse.statusCode = 503;
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      errorResponse.error = {
        code: 'CONNECTION_ERROR',
        message: 'Connection failed',
        details: 'Unable to connect to external service'
      };
      errorResponse.statusCode = 502;
    } else if (error.code === 'ETIMEDOUT') {
      errorResponse.error = {
        code: 'TIMEOUT_ERROR',
        message: 'Request timeout',
        details: 'The request took too long to complete'
      };
      errorResponse.statusCode = 504;
      } else {
      errorResponse.error = {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        details: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : error.message
      };
      errorResponse.statusCode = 500;
    }

    // Log error
    this.logError(error, context);

    return errorResponse;
  }

  /**
   * Remove undefined values from object (Firestore doesn't allow undefined)
   * @param {Object} obj - Object to clean
   * @returns {Object} Cleaned object
   */
  removeUndefinedValues(obj) {
    if (obj === null || obj === undefined) {
      return null;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.removeUndefinedValues(item)).filter(item => item !== undefined);
    }
    
    if (typeof obj !== 'object') {
      return obj;
    }
    
    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = this.removeUndefinedValues(value);
      }
    }
    return cleaned;
  }

  /**
   * Log error to database and console
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   */
  async logError(error, context = {}) {
    try {
      const errorLog = {
        message: error.message || 'Unknown error',
        stack: error.stack || null,
        name: error.name || 'Error',
        code: error.code || null,
        context: context || {},
        timestamp: new Date(),
        severity: this.determineSeverity(error),
        environment: process.env.NODE_ENV || 'development'
      };

      // Log to console (can include undefined for debugging)
      console.error('🚨 [ERROR_HANDLING] Error logged:', errorLog);

      // Clean object before saving to Firestore (remove undefined values)
      const cleanedErrorLog = this.removeUndefinedValues(errorLog);

      // Store in Firestore
      await this.db.collection('errorLogs').add(cleanedErrorLog);

      // Check for error thresholds (use cleaned log)
      await this.checkErrorThresholds(cleanedErrorLog);

    } catch (logError) {
      console.error('❌ [ERROR_HANDLING] Failed to log error:', logError);
    }
  }

  /**
   * Determine error severity
   * @param {Error} error - Error object
   * @returns {string} Severity level
   */
  determineSeverity(error) {
    if (error.name === 'ValidationError' || error.name === 'NotFoundError') {
      return 'low';
    } else if (error.name === 'AuthenticationError' || error.name === 'AuthorizationError') {
      return 'medium';
    } else if (error.name === 'ServiceUnavailableError' || error.code === 'ECONNREFUSED') {
      return 'high';
    } else {
      return 'medium';
    }
  }

  /**
   * Check error thresholds and send alerts
   * @param {Object} errorLog - Error log object
   */
  async checkErrorThresholds(errorLog) {
    try {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);

      // Count errors in different time windows
      const [criticalCount, warningCount, infoCount] = await Promise.all([
        this.countErrors(oneMinuteAgo, now, 'high'),
        this.countErrors(fiveMinutesAgo, now, 'medium'),
        this.countErrors(tenMinutesAgo, now, 'low')
      ]);

      // Send alerts if thresholds exceeded
      if (criticalCount >= this.errorThresholds.critical) {
        await this.sendErrorAlert('critical', criticalCount, errorLog);
      } else if (warningCount >= this.errorThresholds.warning) {
        await this.sendErrorAlert('warning', warningCount, errorLog);
      } else if (infoCount >= this.errorThresholds.info) {
        await this.sendErrorAlert('info', infoCount, errorLog);
      }

    } catch (error) {
      console.error('❌ [ERROR_HANDLING] Failed to check error thresholds:', error);
    }
  }

  /**
   * Count errors in time range
   * @param {Date} startTime - Start time
   * @param {Date} endTime - End time
   * @param {string} severity - Severity level
   * @returns {Promise<number>} Error count
   */
  async countErrors(startTime, endTime, severity) {
    try {
      const query = await this.db.collection('errorLogs')
        .where('timestamp', '>=', startTime)
        .where('timestamp', '<=', endTime)
        .where('severity', '==', severity)
        .get();

      return query.size;
    } catch (error) {
      console.error('❌ [ERROR_HANDLING] Failed to count errors:', error);
      return 0;
    }
  }

  /**
   * Send error alert to admins
   * @param {string} level - Alert level
   * @param {number} count - Error count
   * @param {Object} errorLog - Error log object
   */
  async sendErrorAlert(level, count, errorLog) {
    try {
      const alertMessage = {
        title: `Error Alert - ${level.toUpperCase()}`,
        body: `${count} ${level} errors detected in the system`,
        data: {
          type: 'error_alert',
          level,
          count,
          errorId: errorLog.id || errorLog.message || 'unknown',
          timestamp: new Date().toISOString()
        }
      };

      // Get admin users
      const adminQuery = await this.db.collection('users')
        .where('userType', '==', 'admin')
        .get();

      const adminIds = adminQuery.docs.map(doc => doc.id);

      // Send notifications to all admins
      for (const adminId of adminIds) {
        await notificationService.sendToUser(adminId, alertMessage);
      }

      console.log(`🚨 [ERROR_HANDLING] Error alert sent to ${adminIds.length} admins`);

    } catch (error) {
      console.error('❌ [ERROR_HANDLING] Failed to send error alert:', error);
    }
  }

  /**
   * Create custom error classes
   */
  createCustomError(name, message, statusCode = 500) {
    const error = new Error(message);
    error.name = name;
    error.statusCode = statusCode;
    return error;
  }

  /**
   * Validate and sanitize input
   * @param {any} input - Input to validate
   * @param {Object} schema - Validation schema
   * @returns {Object} Validation result
   */
  validateInput(input, schema) {
    const errors = [];

    for (const [field, rules] of Object.entries(schema)) {
      const value = input[field];

      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value !== undefined && value !== null) {
        if (rules.type && typeof value !== rules.type) {
          errors.push(`${field} must be of type ${rules.type}`);
        }
        
        if (rules.minLength && value.length < rules.minLength) {
          errors.push(`${field} must be at least ${rules.minLength} characters`);
        }
        
        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push(`${field} must be no more than ${rules.maxLength} characters`);
        }
        
        if (rules.pattern && !rules.pattern.test(value)) {
          errors.push(`${field} format is invalid`);
        }
        
        if (rules.min && value < rules.min) {
          errors.push(`${field} must be at least ${rules.min}`);
        }
        
        if (rules.max && value > rules.max) {
          errors.push(`${field} must be no more than ${rules.max}`);
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Handle database connection errors
   * @param {Error} error - Database error
   * @returns {Object} Error response
   */
  handleDatabaseError(error) {
    if (error.code === 'ECONNREFUSED') {
      return this.createCustomError('ServiceUnavailableError', 'Database connection failed', 503);
    } else if (error.code === 'ETIMEDOUT') {
      return this.createCustomError('ServiceUnavailableError', 'Database operation timeout', 504);
    } else if (error.code === 'ENOTFOUND') {
      return this.createCustomError('ServiceUnavailableError', 'Database host not found', 503);
    } else {
      return this.createCustomError('InternalError', 'Database operation failed', 500);
    }
  }

  /**
   * Handle external API errors
   * @param {Error} error - API error
   * @param {string} service - Service name
   * @returns {Object} Error response
   */
  handleExternalApiError(error, service) {
    if (error.response) {
      // API responded with error status
      const status = error.response.status;
      const message = error.response.data?.message || error.message;
      
      if (status >= 400 && status < 500) {
        return this.createCustomError('ExternalApiError', `${service} API error: ${message}`, 502);
      } else if (status >= 500) {
        return this.createCustomError('ServiceUnavailableError', `${service} service unavailable`, 503);
      }
    } else if (error.request) {
      // Request was made but no response received
      return this.createCustomError('ServiceUnavailableError', `${service} service timeout`, 504);
    } else {
      // Something else happened
      return this.createCustomError('ExternalApiError', `${service} integration error`, 502);
    }
  }

  /**
   * Get error statistics
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} Error statistics
   */
  async getErrorStatistics(startDate, endDate) {
    try {
      const query = await this.db.collection('errorLogs')
        .where('timestamp', '>=', startDate)
        .where('timestamp', '<=', endDate)
        .get();

      const errors = query.docs.map(doc => doc.data());
      
      const statistics = {
        total: errors.length,
        bySeverity: {
          low: errors.filter(e => e.severity === 'low').length,
          medium: errors.filter(e => e.severity === 'medium').length,
          high: errors.filter(e => e.severity === 'high').length
        },
        byType: {},
        byHour: {},
        topErrors: []
      };

      // Group by error type
      errors.forEach(error => {
        const type = error.name || 'Unknown';
        statistics.byType[type] = (statistics.byType[type] || 0) + 1;
      });

      // Group by hour
      errors.forEach(error => {
        const hour = new Date(error.timestamp).getHours();
        statistics.byHour[hour] = (statistics.byHour[hour] || 0) + 1;
      });

      // Top errors
      const errorCounts = {};
      errors.forEach(error => {
        const key = `${error.name}: ${error.message}`;
        errorCounts[key] = (errorCounts[key] || 0) + 1;
      });

      statistics.topErrors = Object.entries(errorCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .map(([error, count]) => ({ error, count }));

      return statistics;

    } catch (error) {
      console.error('❌ [ERROR_HANDLING] Failed to get error statistics:', error);
      return null;
    }
  }

  /**
   * Clean up old error logs
   * @param {number} daysToKeep - Number of days to keep logs
   */
  async cleanupOldLogs(daysToKeep = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const query = await this.db.collection('errorLogs')
        .where('timestamp', '<', cutoffDate)
        .get();

      const batch = this.db.batch();
      query.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      if (query.docs.length > 0) {
        await batch.commit();
        console.log(`🧹 [ERROR_HANDLING] Cleaned up ${query.docs.length} old error logs`);
      }

    } catch (error) {
      console.error('❌ [ERROR_HANDLING] Failed to cleanup old logs:', error);
    }
  }
}

module.exports = new ErrorHandlingService();