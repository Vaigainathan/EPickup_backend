/**
 * Error Monitoring Middleware
 * Provides comprehensive error monitoring and alerting
 */

const { logger } = require('./logger');

// Error tracking
const errorTracker = {
  errors: new Map(),
  maxErrors: 100,
  
  track(error, context) {
    const errorKey = `${error.name}:${error.message}`;
    const now = Date.now();
    
    if (!this.errors.has(errorKey)) {
      this.errors.set(errorKey, {
        count: 0,
        firstSeen: now,
        lastSeen: now,
        contexts: []
      });
    }
    
    const errorData = this.errors.get(errorKey);
    errorData.count++;
    errorData.lastSeen = now;
    errorData.contexts.push(context);
    
    // Keep only recent contexts
    if (errorData.contexts.length > 10) {
      errorData.contexts = errorData.contexts.slice(-10);
    }
    
    // Clean up old errors
    if (this.errors.size > this.maxErrors) {
      const oldestKey = Array.from(this.errors.keys())[0];
      this.errors.delete(oldestKey);
    }
    
    // Check for error spikes
    this.checkForErrorSpikes(errorKey, errorData);
  },
  
  checkForErrorSpikes(errorKey, errorData) {
    const timeWindow = 5 * 60 * 1000; // 5 minutes
    const threshold = 10; // 10 errors in 5 minutes
    
    if (errorData.count >= threshold && 
        (Date.now() - errorData.firstSeen) <= timeWindow) {
      
      logger.error('Error spike detected', {
        event: 'error_spike',
        errorKey,
        count: errorData.count,
        timeWindow: `${timeWindow}ms`,
        contexts: errorData.contexts.slice(-5) // Last 5 contexts
      });
      
      // Reset counter after alerting
      errorData.count = 0;
      errorData.firstSeen = Date.now();
    }
  },
  
  getErrorStats() {
    const stats = {
      totalErrors: 0,
      uniqueErrors: this.errors.size,
      topErrors: []
    };
    
    for (const [key, data] of this.errors.entries()) {
      stats.totalErrors += data.count;
      stats.topErrors.push({
        error: key,
        count: data.count,
        firstSeen: data.firstSeen,
        lastSeen: data.lastSeen
      });
    }
    
    // Sort by count
    stats.topErrors.sort((a, b) => b.count - a.count);
    stats.topErrors = stats.topErrors.slice(0, 10);
    
    return stats;
  }
};

// Health check monitoring
const healthMonitor = {
  checks: new Map(),
  
  addCheck(name, checkFunction) {
    this.checks.set(name, checkFunction);
  },
  
  async runChecks() {
    const results = {};
    
    for (const [name, checkFunction] of this.checks.entries()) {
      try {
        const startTime = Date.now();
        const result = await checkFunction();
        const duration = Date.now() - startTime;
        
        results[name] = {
          status: 'healthy',
          duration: `${duration}ms`,
          ...result
        };
      } catch (error) {
        results[name] = {
          status: 'unhealthy',
          error: error.message
        };
        
        logger.error('Health check failed', {
          event: 'health_check_failed',
          check: name,
          error: error.message
        });
      }
    }
    
    return results;
  }
};

// Performance monitoring
const performanceMonitor = {
  metrics: new Map(),
  
  recordMetric(name, value, tags = {}) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    
    const metric = {
      value,
      timestamp: Date.now(),
      tags
    };
    
    this.metrics.get(name).push(metric);
    
    // Keep only last 1000 metrics
    const metricsArray = this.metrics.get(name);
    if (metricsArray.length > 1000) {
      this.metrics.set(name, metricsArray.slice(-1000));
    }
  },
  
  getMetricStats(name) {
    const metrics = this.metrics.get(name) || [];
    if (metrics.length === 0) return null;
    
    const values = metrics.map(m => m.value);
    return {
      count: values.length,
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      latest: values[values.length - 1]
    };
  }
};

// Middleware for error monitoring
const errorMonitoringMiddleware = (req, res, next) => {
  const startTime = Date.now();
  
  // Override res.json to monitor response times
  const originalJson = res.json;
  res.json = function(data) {
    const duration = Date.now() - startTime;
    
    // Record response time metric
    performanceMonitor.recordMetric('response_time', duration, {
      method: req.method,
      route: req.route?.path || req.path,
      statusCode: res.statusCode
    });
    
    // Check for slow responses
    if (duration > 5000) { // 5 seconds
      logger.warn('Slow response detected', {
        event: 'slow_response',
        method: req.method,
        url: req.url,
        duration: `${duration}ms`,
        userId: req.user?.uid || 'anonymous'
      });
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

// Error handler with monitoring
const monitoredErrorHandler = (error, req, res, next) => {
  // Track error
  errorTracker.track(error, {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userId: req.user?.uid || 'anonymous',
    userAgent: req.get('User-Agent')
  });
  
  next(error);
};

module.exports = {
  errorTracker,
  healthMonitor,
  performanceMonitor,
  errorMonitoringMiddleware,
  monitoredErrorHandler
};
