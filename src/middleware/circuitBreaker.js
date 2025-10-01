/**
 * Circuit Breaker Middleware
 * Provides circuit breaker pattern for fault tolerance
 */

const { logger } = require('./logger');
const { alertManager, AlertTypes, Severity } = require('./alerting');

// Circuit breaker configuration
const circuitBreakerConfig = {
  enabled: process.env.CIRCUIT_BREAKER_ENABLED === 'true',
  failureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD) || 5,
  recoveryTimeout: parseInt(process.env.CIRCUIT_BREAKER_RECOVERY_TIMEOUT) || 60000, // 1 minute
  monitoringPeriod: parseInt(process.env.CIRCUIT_BREAKER_MONITORING_PERIOD) || 60000, // 1 minute
  halfOpenMaxCalls: parseInt(process.env.CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS) || 3,
  timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT) || 30000 // 30 seconds
};

// Circuit breaker states
const CircuitBreakerStates = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open'
};

// Circuit breaker service class
class CircuitBreakerService {
  constructor() {
    this.config = circuitBreakerConfig;
    this.circuits = new Map();
    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      circuitOpens: 0,
      circuitCloses: 0,
      timeouts: 0
    };
  }
  
  // Create or get circuit breaker
  getCircuit(name, options = {}) {
    if (!this.circuits.has(name)) {
      this.circuits.set(name, new CircuitBreaker(name, { ...this.config, ...options }));
    }
    return this.circuits.get(name);
  }
  
  // Execute operation through circuit breaker
  async execute(circuitName, operation, options = {}) {
    const circuit = this.getCircuit(circuitName, options);
    return await circuit.execute(operation);
  }
  
  // Get circuit breaker status
  getStatus(circuitName) {
    const circuit = this.circuits.get(circuitName);
    return circuit ? circuit.getStatus() : null;
  }
  
  // Get all circuit breaker statuses
  getAllStatuses() {
    const statuses = {};
    for (const [name, circuit] of this.circuits) {
      statuses[name] = circuit.getStatus();
    }
    return statuses;
  }
  
  // Get metrics
  getMetrics() {
    return {
      ...this.metrics,
      circuitCount: this.circuits.size,
      successRate: this.metrics.totalCalls > 0 
        ? this.metrics.successfulCalls / this.metrics.totalCalls 
        : 0
    };
  }
  
  // Reset circuit breaker
  reset(circuitName) {
    const circuit = this.circuits.get(circuitName);
    if (circuit) {
      circuit.reset();
    }
  }
  
  // Reset all circuit breakers
  resetAll() {
    for (const circuit of this.circuits.values()) {
      circuit.reset();
    }
  }
}

// Individual circuit breaker class
class CircuitBreaker {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.state = CircuitBreakerStates.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    this.halfOpenCalls = 0;
    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      timeouts: 0,
      circuitOpens: 0,
      circuitCloses: 0
    };
  }
  
  // Execute operation
  async execute(operation) {
    // Check if circuit is open
    if (this.state === CircuitBreakerStates.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }
      
      // Transition to half-open
      this.state = CircuitBreakerStates.HALF_OPEN;
      this.halfOpenCalls = 0;
      
      logger.info('Circuit breaker transitioning to HALF_OPEN', {
        event: 'circuit_breaker_half_open',
        circuit: this.name,
        timestamp: new Date().toISOString()
      });
    }
    
    // Check half-open call limit
    if (this.state === CircuitBreakerStates.HALF_OPEN && 
        this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
      throw new Error(`Circuit breaker ${this.name} is HALF_OPEN and call limit reached`);
    }
    
    this.metrics.totalCalls++;
    
    try {
      // Execute operation with timeout
      const result = await this.executeWithTimeout(operation);
      
      // Success
      this.metrics.successfulCalls++;
      this.successCount++;
      this.failureCount = 0;
      
      // Transition to closed if half-open
      if (this.state === CircuitBreakerStates.HALF_OPEN) {
        this.state = CircuitBreakerStates.CLOSED;
        this.metrics.circuitCloses++;
        
        logger.info('Circuit breaker closed after successful recovery', {
          event: 'circuit_breaker_closed',
          circuit: this.name,
          timestamp: new Date().toISOString()
        });
        
        // Create recovery alert
        alertManager.createAlert(
          AlertTypes.SERVICE_DOWN,
          Severity.LOW,
          `Circuit breaker ${this.name} recovered and closed`,
          {
            circuit: this.name,
            successCount: this.successCount,
            failureCount: this.failureCount
          }
        );
      }
      
      return result;
      
    } catch (error) {
      // Failure
      this.metrics.failedCalls++;
      this.failureCount++;
      this.lastFailureTime = Date.now();
      
      // Check if we should open the circuit
      if (this.state === CircuitBreakerStates.CLOSED && 
          this.failureCount >= this.config.failureThreshold) {
        this.state = CircuitBreakerStates.OPEN;
        this.nextAttemptTime = Date.now() + this.config.recoveryTimeout;
        this.metrics.circuitOpens++;
        
        logger.error('Circuit breaker opened due to failures', {
          event: 'circuit_breaker_opened',
          circuit: this.name,
          failureCount: this.failureCount,
          threshold: this.config.failureThreshold,
          nextAttemptTime: new Date(this.nextAttemptTime).toISOString()
        });
        
        // Create circuit open alert
        alertManager.createAlert(
          AlertTypes.SERVICE_DOWN,
          Severity.HIGH,
          `Circuit breaker ${this.name} opened due to repeated failures`,
          {
            circuit: this.name,
            failureCount: this.failureCount,
            threshold: this.config.failureThreshold,
            lastError: error.message
          }
        );
      }
      
      // Increment half-open calls
      if (this.state === CircuitBreakerStates.HALF_OPEN) {
        this.halfOpenCalls++;
      }
      
      throw error;
    }
  }
  
  // Execute operation with timeout
  async executeWithTimeout(operation) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.metrics.timeouts++;
        reject(new Error(`Circuit breaker ${this.name} operation timeout`));
      }, this.config.timeout);
      
      operation()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }
  
  // Get circuit breaker status
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
      halfOpenCalls: this.halfOpenCalls,
      metrics: this.metrics,
      config: this.config
    };
  }
  
  // Reset circuit breaker
  reset() {
    this.state = CircuitBreakerStates.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    this.halfOpenCalls = 0;
    
    logger.info('Circuit breaker reset', {
      event: 'circuit_breaker_reset',
      circuit: this.name,
      timestamp: new Date().toISOString()
    });
  }
}

// Create circuit breaker service instance
const circuitBreakerService = new CircuitBreakerService();

// Circuit breaker middleware for Express
const circuitBreakerMiddleware = (circuitName, options = {}) => {
  return async (req, res, next) => {
    try {
      const circuit = circuitBreakerService.getCircuit(circuitName, options);
      
      // Execute the next middleware through circuit breaker
      await circuit.execute(async () => {
        return new Promise((resolve, reject) => {
          const originalSend = res.send;
          const originalJson = res.json;
          
          // Wrap response methods to track errors
          res.send = function(data) {
            if (res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            } else {
              resolve(data);
            }
            return originalSend.call(this, data);
          };
          
          res.json = function(data) {
            if (res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(data)}`));
            } else {
              resolve(data);
            }
            return originalJson.call(this, data);
          };
          
          next();
        });
      });
      
    } catch (error) {
      logger.error('Circuit breaker middleware error', {
        event: 'circuit_breaker_middleware_error',
        circuit: circuitName,
        error: error.message
      });
      
      res.status(503).json({
        success: false,
        error: {
          code: 'CIRCUIT_BREAKER_OPEN',
          message: `Service ${circuitName} is temporarily unavailable`,
          details: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  };
};

// Circuit breaker decorator for functions
const circuitBreaker = (circuitName, options = {}) => {
  return (target, propertyName, descriptor) => {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function(...args) {
      return await circuitBreakerService.execute(
        circuitName,
        () => originalMethod.apply(this, args),
        options
      );
    };
    
    return descriptor;
  };
};

// Circuit breaker for database operations
const circuitBreakerDatabase = async (operation, options = {}) => {
  const defaultOptions = {
    failureThreshold: 3,
    recoveryTimeout: 30000,
    timeout: 10000
  };
  
  return await circuitBreakerService.execute(
    'database',
    operation,
    { ...defaultOptions, ...options }
  );
};

// Circuit breaker for HTTP requests
const circuitBreakerHttp = async (requestFunction, options = {}) => {
  const defaultOptions = {
    failureThreshold: 5,
    recoveryTimeout: 60000,
    timeout: 30000
  };
  
  return await circuitBreakerService.execute(
    'http',
    requestFunction,
    { ...defaultOptions, ...options }
  );
};

module.exports = {
  circuitBreakerService,
  circuitBreakerMiddleware,
  circuitBreaker,
  circuitBreakerDatabase,
  circuitBreakerHttp,
  CircuitBreakerStates
};
