const { getFirestore } = require('./firebase');

/**
 * Comprehensive Error Handling and Retry Service
 * Provides robust error handling, retry logic, and recovery mechanisms
 */
class ErrorHandlingService {
  constructor() {
    this.db = getFirestore();
    this.maxRetries = 3;
    this.baseDelay = 1000; // 1 second
    this.maxDelay = 30000; // 30 seconds
  }

  /**
   * Execute function with exponential backoff retry
   * @param {Function} fn - Function to execute
   * @param {Object} options - Retry options
   * @returns {Promise} Result of function execution
   */
  async executeWithRetry(fn, options = {}) {
    const {
      maxRetries = this.maxRetries,
      baseDelay = this.baseDelay,
      maxDelay = this.maxDelay,
      context = 'Unknown operation'
    } = options;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await fn();
        if (attempt > 0) {
          console.log(`✅ ${context} succeeded on attempt ${attempt + 1}`);
        }
        return result;
      } catch (error) {
        
        if (attempt === maxRetries) {
          console.error(`❌ ${context} failed after ${maxRetries + 1} attempts:`, error.message);
          throw this.enhanceError(error, context, attempt + 1);
        }

        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        console.warn(`⚠️ ${context} failed on attempt ${attempt + 1}, retrying in ${delay}ms:`, error.message);
        
        await this.sleep(delay);
      }
    }
  }

  /**
   * Execute Firestore transaction with retry
   * @param {Function} transactionFn - Transaction function
   * @param {Object} options - Retry options
   * @returns {Promise} Transaction result
   */
  async executeTransactionWithRetry(transactionFn, options = {}) {
    return this.executeWithRetry(async () => {
      return this.db.runTransaction(transactionFn);
    }, {
      ...options,
      context: 'Firestore transaction'
    });
  }

  /**
   * Execute API call with retry
   * @param {Function} apiCall - API call function
   * @param {Object} options - Retry options
   * @returns {Promise} API response
   */
  async executeApiCallWithRetry(apiCall, options = {}) {
    return this.executeWithRetry(apiCall, {
      ...options,
      context: 'API call'
    });
  }

  /**
   * Handle WebSocket connection with auto-reconnect
   * @param {Object} socket - Socket instance
   * @param {Object} options - Reconnect options
   */
  handleWebSocketReconnect(socket, options = {}) {
    const {
      maxReconnectAttempts = 10,
      baseDelay = 1000,
      maxDelay = 30000,
      context = 'WebSocket connection'
    } = options;

    let reconnectAttempts = 0;

    const reconnect = async () => {
      if (reconnectAttempts >= maxReconnectAttempts) {
        console.error(`❌ ${context} max reconnection attempts reached`);
        return;
      }

      reconnectAttempts++;
      const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts - 1), maxDelay);
      
      console.warn(`🔄 ${context} attempting reconnection ${reconnectAttempts}/${maxReconnectAttempts} in ${delay}ms`);
      
      setTimeout(() => {
        socket.connect();
      }, delay);
    };

    socket.on('disconnect', (reason) => {
      console.warn(`🔌 ${context} disconnected:`, reason);
      if (reason === 'io server disconnect') {
        // Server disconnected, reconnect immediately
        reconnect();
      } else {
        // Client disconnected, attempt reconnection
        reconnect();
      }
    });

    socket.on('connect', () => {
      console.log(`✅ ${context} reconnected successfully`);
      reconnectAttempts = 0; // Reset counter on successful connection
    });

    socket.on('connect_error', (error) => {
      console.error(`❌ ${context} connection error:`, error.message);
      reconnect();
    });
  }

  /**
   * Handle driver assignment failures
   * @param {string} bookingId - Booking ID
   * @param {Error} error - Assignment error
   * @param {Object} context - Additional context
   */
  async handleDriverAssignmentFailure(bookingId, error, context = {}) {
    try {
      console.error(`❌ Driver assignment failed for booking ${bookingId}:`, error.message);

      // Log the failure
      await this.logAssignmentFailure(bookingId, error, context);

      // Determine recovery action based on error type
      const recoveryAction = this.determineRecoveryAction(error);

      switch (recoveryAction) {
        case 'retry_assignment':
          console.log(`🔄 Retrying assignment for booking ${bookingId}`);
          // Re-queue for assignment
          break;
        
        case 'notify_customer':
          console.log(`📱 Notifying customer of assignment failure for booking ${bookingId}`);
          // Send notification to customer
          break;
        
        case 'cancel_booking':
          console.log(`❌ Cancelling booking ${bookingId} due to assignment failure`);
          // Cancel the booking
          await this.cancelBooking(bookingId, 'No drivers available');
          break;
        
        default:
          console.log(`⚠️ Unknown recovery action for booking ${bookingId}`);
      }

    } catch (logError) {
      console.error('❌ Failed to handle driver assignment failure:', logError.message);
    }
  }

  /**
   * Determine recovery action based on error type
   * @param {Error} error - Error object
   * @returns {string} Recovery action
   */
  determineRecoveryAction(error) {
    if (error.code === 'NO_DRIVERS_AVAILABLE') {
      return 'retry_assignment';
    }
    
    if (error.code === 'SERVICE_UNAVAILABLE') {
      return 'notify_customer';
    }
    
    if (error.code === 'CRITICAL_ERROR') {
      return 'cancel_booking';
    }
    
    return 'retry_assignment';
  }

  /**
   * Log assignment failure for monitoring
   * @param {string} bookingId - Booking ID
   * @param {Error} error - Error object
   * @param {Object} context - Additional context
   */
  async logAssignmentFailure(bookingId, error, context) {
    try {
      const failureLog = {
        bookingId,
        error: {
          code: error.code || 'UNKNOWN_ERROR',
          message: error.message,
          stack: error.stack
        },
        context,
        timestamp: new Date(),
        retryCount: context.retryCount || 0
      };

      await this.db.collection('assignmentFailures').add(failureLog);
    } catch (logError) {
      console.error('❌ Failed to log assignment failure:', logError.message);
    }
  }

  /**
   * Cancel booking due to assignment failure
   * @param {string} bookingId - Booking ID
   * @param {string} reason - Cancellation reason
   */
  async cancelBooking(bookingId, reason) {
    try {
      await this.db.collection('bookings').doc(bookingId).update({
        status: 'cancelled',
        cancellationReason: reason,
        cancelledAt: new Date(),
        updatedAt: new Date()
      });

      console.log(`✅ Booking ${bookingId} cancelled due to: ${reason}`);
    } catch (error) {
      console.error(`❌ Failed to cancel booking ${bookingId}:`, error.message);
    }
  }

  /**
   * Enhance error with additional context
   * @param {Error} error - Original error
   * @param {string} context - Operation context
   * @param {number} attempt - Attempt number
   * @returns {Error} Enhanced error
   */
  enhanceError(error, context, attempt) {
    const enhancedError = new Error(`${context} failed after ${attempt} attempts: ${error.message}`);
    enhancedError.originalError = error;
    enhancedError.context = context;
    enhancedError.attempts = attempt;
    enhancedError.timestamp = new Date();
    enhancedError.code = error.code || 'OPERATION_FAILED';
    
    return enhancedError;
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Sleep promise
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Validate and sanitize input data
   * @param {Object} data - Input data
   * @param {Object} schema - Validation schema
   * @returns {Object} Sanitized data
   */
  validateAndSanitize(data, schema) {
    const sanitized = {};
    const errors = [];

    for (const [key, rules] of Object.entries(schema)) {
      const value = data[key];

      // Required field check
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push(`${key} is required`);
        continue;
      }

      // Type validation
      if (value !== undefined && rules.type && typeof value !== rules.type) {
        errors.push(`${key} must be of type ${rules.type}`);
        continue;
      }

      // String length validation
      if (rules.type === 'string' && rules.maxLength && value.length > rules.maxLength) {
        errors.push(`${key} must be no more than ${rules.maxLength} characters`);
        continue;
      }

      // Number range validation
      if (rules.type === 'number' && rules.min !== undefined && value < rules.min) {
        errors.push(`${key} must be at least ${rules.min}`);
        continue;
      }

      if (rules.type === 'number' && rules.max !== undefined && value > rules.max) {
        errors.push(`${key} must be no more than ${rules.max}`);
        continue;
      }

      // Sanitize string values
      if (rules.type === 'string' && typeof value === 'string') {
        sanitized[key] = value.trim().replace(/[<>]/g, '');
      } else {
        sanitized[key] = value;
      }
    }

    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }

    return sanitized;
  }

  /**
   * Rate limiting helper
   * @param {string} key - Rate limit key
   * @param {number} limit - Request limit
   * @param {number} windowMs - Time window in milliseconds
   * @returns {boolean} Whether request is allowed
   */
  async checkRateLimit(key, limit, windowMs) {
    try {
      const now = Date.now();
      const windowStart = now - windowMs;
      
      // Get existing requests in time window
      const requests = await this.db.collection('rateLimits')
        .doc(key)
        .collection('requests')
        .where('timestamp', '>=', new Date(windowStart))
        .get();

      if (requests.size >= limit) {
        return false;
      }

      // Record this request
      await this.db.collection('rateLimits')
        .doc(key)
        .collection('requests')
        .add({
          timestamp: now
        });

      return true;
    } catch (error) {
      console.error('❌ Rate limit check failed:', error.message);
      return true; // Allow request if rate limiting fails
    }
  }
}

module.exports = new ErrorHandlingService();
