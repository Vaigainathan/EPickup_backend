const { getFirestore } = require('./firebase');

/**
 * Comprehensive Monitoring and Logging Service
 * Provides metrics, logging, and health monitoring for production systems
 */
class MonitoringService {
  constructor() {
    this.db = getFirestore();
    this.metrics = new Map();
    this.healthChecks = new Map();
  }

  /**
   * Log structured event
   * @param {string} event - Event name
   * @param {Object} data - Event data
   * @param {string} level - Log level (info, warn, error, debug)
   * @param {Object} context - Additional context
   */
  async logEvent(event, data = {}, level = 'info', context = {}) {
    try {
      const logEntry = {
        event,
        level,
        data,
        context,
        timestamp: new Date(),
        service: 'epickup-backend',
        version: process.env.npm_package_version || '1.0.0'
      };

      // Store in Firestore
      await this.db.collection('systemLogs').add(logEntry);

      // Update metrics
      this.updateMetric(`events.${event}.${level}`, 1);
      this.updateMetric('events.total', 1);

      // Console logging for development
      if (process.env.NODE_ENV === 'development') {
        console.log(`[${level.toUpperCase()}] ${event}:`, data);
      }
    } catch (error) {
      console.error('❌ Failed to log event:', error.message);
    }
  }

  /**
   * Log API request
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {number} duration - Request duration in ms
   */
  async logApiRequest(req, res, duration) {
    const logData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      userId: req.user?.uid,
      userType: req.user?.userType
    };

    const level = res.statusCode >= 400 ? 'error' : 'info';
    await this.logEvent('api_request', logData, level);
  }

  /**
   * Log driver assignment event
   * @param {string} event - Assignment event
   * @param {Object} data - Assignment data
   */
  async logDriverAssignment(event, data) {
    await this.logEvent(`driver_assignment.${event}`, data, 'info', {
      service: 'driver_assignment'
    });
  }

  /**
   * Log booking lifecycle event
   * @param {string} event - Booking event
   * @param {Object} data - Booking data
   */
  async logBookingLifecycle(event, data) {
    await this.logEvent(`booking.${event}`, data, 'info', {
      service: 'booking_lifecycle'
    });
  }

  /**
   * Log WebSocket event
   * @param {string} event - WebSocket event
   * @param {Object} data - Event data
   * @param {string} userId - User ID
   */
  async logWebSocketEvent(event, data, userId) {
    await this.logEvent(`websocket.${event}`, data, 'info', {
      userId,
      service: 'websocket'
    });
  }

  /**
   * Log error with stack trace
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   * @param {string} service - Service name
   */
  async logError(error, context = {}, service = 'unknown') {
    const errorData = {
      message: error.message,
      stack: error.stack,
      code: error.code,
      context,
      service
    };

    await this.logEvent('error', errorData, 'error', { service });
  }

  /**
   * Update metric counter
   * @param {string} metric - Metric name
   * @param {number} value - Metric value
   */
  updateMetric(metric, value = 1) {
    const current = this.metrics.get(metric) || 0;
    this.metrics.set(metric, current + value);
  }

  /**
   * Get metric value
   * @param {string} metric - Metric name
   * @returns {number} Metric value
   */
  getMetric(metric) {
    return this.metrics.get(metric) || 0;
  }

  /**
   * Get all metrics
   * @returns {Object} All metrics
   */
  getAllMetrics() {
    const metricsObj = {};
    for (const [key, value] of this.metrics.entries()) {
      metricsObj[key] = value;
    }
    return metricsObj;
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics.clear();
  }

  /**
   * Register health check
   * @param {string} name - Health check name
   * @param {Function} checkFn - Health check function
   */
  registerHealthCheck(name, checkFn) {
    this.healthChecks.set(name, checkFn);
  }

  /**
   * Run all health checks
   * @returns {Promise<Object>} Health check results
   */
  async runHealthChecks() {
    const results = {
      status: 'healthy',
      timestamp: new Date(),
      checks: {}
    };

    for (const [name, checkFn] of this.healthChecks.entries()) {
      try {
        const checkResult = await checkFn();
        results.checks[name] = {
          status: 'healthy',
          ...checkResult
        };
      } catch (error) {
        results.checks[name] = {
          status: 'unhealthy',
          error: error.message
        };
        results.status = 'unhealthy';
      }
    }

    return results;
  }

  /**
   * Get system performance metrics
   * @returns {Object} Performance metrics
   */
  getPerformanceMetrics() {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    return {
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external
      },
      uptime,
      timestamp: new Date()
    };
  }

  /**
   * Get driver assignment metrics
   * @param {string} timeRange - Time range (1h, 24h, 7d)
   * @returns {Promise<Object>} Assignment metrics
   */
  async getDriverAssignmentMetrics(timeRange = '24h') {
    try {
      const now = new Date();
      const timeRanges = {
        '1h': 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000
      };

      const startTime = new Date(now.getTime() - timeRanges[timeRange]);

      // Get assignment events
      const assignmentsSnapshot = await this.db.collection('systemLogs')
        .where('event', '==', 'driver_assignment.assigned')
        .where('timestamp', '>=', startTime)
        .get();

      const rejectionsSnapshot = await this.db.collection('systemLogs')
        .where('event', '==', 'driver_assignment.rejected')
        .where('timestamp', '>=', startTime)
        .get();

      const failuresSnapshot = await this.db.collection('systemLogs')
        .where('event', '==', 'driver_assignment.failed')
        .where('timestamp', '>=', startTime)
        .get();

      const totalAssignments = assignmentsSnapshot.size;
      const totalRejections = rejectionsSnapshot.size;
      const totalFailures = failuresSnapshot.size;

      return {
        timeRange,
        totalAssignments,
        totalRejections,
        totalFailures,
        successRate: totalAssignments > 0 ? (totalAssignments / (totalAssignments + totalFailures)) * 100 : 0,
        rejectionRate: totalAssignments > 0 ? (totalRejections / totalAssignments) * 100 : 0,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('❌ Failed to get driver assignment metrics:', error.message);
      return {
        timeRange,
        totalAssignments: 0,
        totalRejections: 0,
        totalFailures: 0,
        successRate: 0,
        rejectionRate: 0,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Get booking lifecycle metrics
   * @param {string} timeRange - Time range
   * @returns {Promise<Object>} Booking metrics
   */
  async getBookingMetrics(timeRange = '24h') {
    try {
      const now = new Date();
      const timeRanges = {
        '1h': 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000
      };

      const startTime = new Date(now.getTime() - timeRanges[timeRange]);

      // Get booking counts by status
      const bookingsSnapshot = await this.db.collection('bookings')
        .where('createdAt', '>=', startTime)
        .get();

      const statusCounts = {};
      bookingsSnapshot.forEach(doc => {
        const status = doc.data().status;
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });

      return {
        timeRange,
        totalBookings: bookingsSnapshot.size,
        statusCounts,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('❌ Failed to get booking metrics:', error.message);
      return {
        timeRange,
        totalBookings: 0,
        statusCounts: {},
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Create alert for critical issues
   * @param {string} type - Alert type
   * @param {string} message - Alert message
   * @param {Object} data - Alert data
   * @param {string} severity - Alert severity (low, medium, high, critical)
   */
  async createAlert(type, message, data = {}, severity = 'medium') {
    const alert = {
      type,
      message,
      data,
      severity,
      timestamp: new Date(),
      status: 'active',
      service: 'epickup-backend'
    };

    try {
      await this.db.collection('systemAlerts').add(alert);
      await this.logEvent('alert_created', alert, 'warn');
    } catch (error) {
      console.error('❌ Failed to create alert:', error.message);
    }
  }

  /**
   * Initialize monitoring service
   */
  async initialize() {
    // Register default health checks
    this.registerHealthCheck('database', async () => {
      try {
        await this.db.collection('health').doc('check').get();
        return { message: 'Database connection healthy' };
      } catch (error) {
        throw new Error(`Database health check failed: ${error.message}`);
      }
    });

    this.registerHealthCheck('memory', async () => {
      const memUsage = process.memoryUsage();
      const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
      
      if (heapUsedMB > 500) { // 500MB threshold
        throw new Error(`High memory usage: ${heapUsedMB.toFixed(2)}MB`);
      }
      
      return { message: `Memory usage: ${heapUsedMB.toFixed(2)}MB` };
    });

    this.registerHealthCheck('uptime', async () => {
      const uptime = process.uptime();
      const uptimeHours = uptime / 3600;
      
      if (uptimeHours > 168) { // 7 days
        throw new Error(`High uptime: ${uptimeHours.toFixed(2)} hours`);
      }
      
      return { message: `Uptime: ${uptimeHours.toFixed(2)} hours` };
    });

    console.log('✅ Monitoring service initialized');
  }
}

module.exports = new MonitoringService();
