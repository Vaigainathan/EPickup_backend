/**
 * Retry Middleware
 * Provides configurable retry logic for failed operations
 */

const { logger } = require('./logger');

// Retry configuration
const retryConfig = {
  maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS) || 3,
  baseDelay: parseInt(process.env.RETRY_BASE_DELAY) || 1000, // 1 second
  maxDelay: parseInt(process.env.RETRY_MAX_DELAY) || 30000, // 30 seconds
  backoffMultiplier: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER) || 2,
  jitter: process.env.RETRY_JITTER === 'true',
  retryableErrors: [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
    'ECONNABORTED'
  ],
  retryableStatusCodes: [408, 429, 500, 502, 503, 504]
};

// Retry strategies
const RetryStrategies = {
  FIXED: 'fixed',
  EXPONENTIAL: 'exponential',
  LINEAR: 'linear',
  CUSTOM: 'custom'
};

// Retry result
class RetryResult {
  constructor(success, data, error, attempts, totalTime) {
    this.success = success;
    this.data = data;
    this.error = error;
    this.attempts = attempts;
    this.totalTime = totalTime;
    this.timestamp = new Date().toISOString();
  }
}

// Retry service class
class RetryService {
  constructor() {
    this.config = retryConfig;
    this.metrics = {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      averageRetryTime: 0,
      retryReasons: {}
    };
  }
  
  // Execute operation with retry
  async execute(operation, options = {}) {
    const {
      maxAttempts = this.config.maxAttempts,
      strategy = RetryStrategies.EXPONENTIAL,
      delay = this.config.baseDelay,
      maxDelay = this.config.maxDelay,
      backoffMultiplier = this.config.backoffMultiplier,
      jitter = this.config.jitter,
      retryCondition = this.defaultRetryCondition,
      onRetry = null,
      operationName = 'unknown'
    } = options;
    
    let lastError = null;
    let attempts = 0;
    const startTime = Date.now();
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      attempts = attempt;
      
      try {
        const result = await operation();
        
        // Success
        const totalTime = Date.now() - startTime;
        
        if (attempt > 1) {
          this.metrics.successfulRetries++;
          this.updateAverageRetryTime(totalTime);
          
          logger.info('Operation succeeded after retry', {
            event: 'retry_success',
            operation: operationName,
            attempts,
            totalTime,
            strategy
          });
        }
        
        return new RetryResult(true, result, null, attempts, totalTime);
        
      } catch (error) {
        lastError = error;
        
        // Check if we should retry
        if (attempt === maxAttempts || !retryCondition(error)) {
          break;
        }
        
        // Calculate delay
        const retryDelay = this.calculateDelay(
          attempt,
          delay,
          maxDelay,
          backoffMultiplier,
          strategy,
          jitter
        );
        
        // Update metrics
        this.metrics.totalRetries++;
        this.updateRetryReason(error);
        
        // Log retry attempt
        logger.warn('Operation failed, retrying', {
          event: 'retry_attempt',
          operation: operationName,
          attempt,
          maxAttempts,
          error: error.message,
          delay: retryDelay,
          strategy
        });
        
        // Call retry callback
        if (onRetry) {
          try {
            await onRetry(error, attempt, retryDelay);
          } catch (callbackError) {
            logger.error('Retry callback failed', {
              event: 'retry_callback_failed',
              operation: operationName,
              error: callbackError.message
            });
          }
        }
        
        // Wait before retry
        await this.sleep(retryDelay);
      }
    }
    
    // All attempts failed
    const totalTime = Date.now() - startTime;
    this.metrics.failedRetries++;
    
    logger.error('Operation failed after all retries', {
      event: 'retry_exhausted',
      operation: operationName,
      attempts,
      totalTime,
      error: lastError.message
    });
    
    return new RetryResult(false, null, lastError, attempts, totalTime);
  }
  
  // Calculate retry delay
  calculateDelay(attempt, baseDelay, maxDelay, backoffMultiplier, strategy, jitter) {
    let delay = baseDelay;
    
    switch (strategy) {
      case RetryStrategies.FIXED:
        delay = baseDelay;
        break;
        
      case RetryStrategies.EXPONENTIAL:
        delay = baseDelay * Math.pow(backoffMultiplier, attempt - 1);
        break;
        
      case RetryStrategies.LINEAR:
        delay = baseDelay * attempt;
        break;
        
      case RetryStrategies.CUSTOM:
        // Custom strategy would be implemented by the caller
        delay = baseDelay;
        break;
    }
    
    // Apply max delay limit
    delay = Math.min(delay, maxDelay);
    
    // Apply jitter to prevent thundering herd
    if (jitter) {
      delay = delay * (0.5 + Math.random() * 0.5);
    }
    
    return Math.floor(delay);
  }
  
  // Default retry condition
  defaultRetryCondition(error) {
    // Check error code
    if (error.code && this.config.retryableErrors.includes(error.code)) {
      return true;
    }
    
    // Check status code
    if (error.status && this.config.retryableStatusCodes.includes(error.status)) {
      return true;
    }
    
    // Check error message for common retryable patterns
    const retryablePatterns = [
      'timeout',
      'connection',
      'network',
      'temporary',
      'unavailable',
      'busy',
      'rate limit'
    ];
    
    const errorMessage = error.message?.toLowerCase() || '';
    return retryablePatterns.some(pattern => errorMessage.includes(pattern));
  }
  
  // Sleep utility
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  // Update retry reason metrics
  updateRetryReason(error) {
    const reason = error.code || error.status || 'unknown';
    this.metrics.retryReasons[reason] = (this.metrics.retryReasons[reason] || 0) + 1;
  }
  
  // Update average retry time
  updateAverageRetryTime(time) {
    const totalRetries = this.metrics.successfulRetries + this.metrics.failedRetries;
    this.metrics.averageRetryTime = 
      (this.metrics.averageRetryTime * (totalRetries - 1) + time) / totalRetries;
  }
  
  // Get retry metrics
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalRetries > 0 
        ? this.metrics.successfulRetries / this.metrics.totalRetries 
        : 0
    };
  }
  
  // Reset metrics
  resetMetrics() {
    this.metrics = {
      totalRetries: 0,
      successfulRetries: 0,
      failedRetries: 0,
      averageRetryTime: 0,
      retryReasons: {}
    };
  }
}

// Create retry service instance
const retryService = new RetryService();

// Retry middleware for Express
const retryMiddleware = () => {
  return async (req, res, next) => {
    const originalSend = res.send;
    const originalJson = res.json;
    
    // Wrap response methods to track errors
    res.send = function(data) {
      if (res.statusCode >= 400) {
        req.retryError = new Error(`HTTP ${res.statusCode}: ${data}`);
      }
      return originalSend.call(this, data);
    };
    
    res.json = function(data) {
      if (res.statusCode >= 400) {
        req.retryError = new Error(`HTTP ${res.statusCode}: ${JSON.stringify(data)}`);
      }
      return originalJson.call(this, data);
    };
    
    next();
  };
};

// Retry decorator for functions
const retry = (options = {}) => {
  return (target, propertyName, descriptor) => {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args) {
      return await retryService.execute(
        () => originalMethod.apply(this, args),
        {
          ...options,
          operationName: `${target.constructor.name}.${propertyName}`
        }
      );
    };
    
    return descriptor;
  };
};

// Retry for database operations
const retryDatabaseOperation = async (operation, options = {}) => {
  const defaultOptions = {
    maxAttempts: 3,
    strategy: RetryStrategies.EXPONENTIAL,
    delay: 1000,
    retryCondition: (error) => {
      // Retry on connection errors, timeouts, and temporary failures
      return error.code === 'ECONNRESET' || 
             error.code === 'ETIMEDOUT' || 
             error.message?.includes('temporary') ||
             error.message?.includes('timeout');
    }
  };
  
  return await retryService.execute(operation, { ...defaultOptions, ...options });
};

// Retry for HTTP requests
const retryHttpRequest = async (requestFunction, options = {}) => {
  const defaultOptions = {
    maxAttempts: 3,
    strategy: RetryStrategies.EXPONENTIAL,
    delay: 1000,
    retryCondition: (error) => {
      // Retry on network errors and 5xx status codes
      return error.code === 'ECONNRESET' || 
             error.code === 'ETIMEDOUT' || 
             error.status >= 500;
    }
  };
  
  return await retryService.execute(requestFunction, { ...defaultOptions, ...options });
};

module.exports = {
  retryService,
  retryMiddleware,
  retry,
  retryDatabaseOperation,
  retryHttpRequest,
  RetryStrategies,
  RetryResult
};
