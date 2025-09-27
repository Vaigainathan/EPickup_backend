/**
 * Performance Monitoring Service
 * Tracks and analyzes system performance metrics
 */

const { getFirestore } = require('./firebase');
const cachingService = require('./cachingService');
const databasePoolService = require('./databasePoolService');

class PerformanceMonitoringService {
  constructor() {
    this.db = getFirestore();
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        averageResponseTime: 0,
        responseTimeHistory: []
      },
      database: {
        queries: 0,
        averageQueryTime: 0,
        slowQueries: 0,
        cacheHitRate: 0
      },
      memory: {
        used: 0,
        free: 0,
        total: 0,
        utilization: 0
      },
      errors: {
        total: 0,
        byType: {},
        recent: []
      }
    };
    this.startTime = Date.now();
    this.uptime = 0;
    this.isMonitoring = false;
  }

  /**
   * Start performance monitoring
   */
  startMonitoring() {
    if (this.isMonitoring) {
      console.log('⚠️ [PERF_MONITOR] Monitoring already started');
      return;
    }

    this.isMonitoring = true;
    this.startTime = Date.now();
    
    // Update uptime every minute
    setInterval(() => {
      this.uptime = Date.now() - this.startTime;
      this.updateMemoryMetrics();
    }, 60000);

    // Log performance metrics every 5 minutes
    setInterval(() => {
      this.logPerformanceMetrics();
    }, 300000);

    // Cleanup old metrics every hour
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 3600000);

    console.log('✅ [PERF_MONITOR] Performance monitoring started');
  }

  /**
   * Stop performance monitoring
   */
  stopMonitoring() {
    this.isMonitoring = false;
    console.log('🛑 [PERF_MONITOR] Performance monitoring stopped');
  }

  /**
   * Record API request metrics
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {number} responseTime - Response time in milliseconds
   */
  recordApiRequest(req, res, responseTime) {
    if (!this.isMonitoring) return;

    this.metrics.requests.total++;
    
    if (res.statusCode >= 200 && res.statusCode < 400) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
    }

    // Update average response time
    const totalTime = this.metrics.requests.averageResponseTime * (this.metrics.requests.total - 1);
    this.metrics.requests.averageResponseTime = (totalTime + responseTime) / this.metrics.requests.total;

    // Track response time history (keep last 100)
    this.metrics.requests.responseTimeHistory.push({
      timestamp: Date.now(),
      responseTime,
      endpoint: req.originalUrl,
      method: req.method,
      statusCode: res.statusCode
    });

    if (this.metrics.requests.responseTimeHistory.length > 100) {
      this.metrics.requests.responseTimeHistory.shift();
    }

    // Log slow requests
    if (responseTime > 5000) { // 5 seconds
      console.warn(`🐌 [PERF_MONITOR] Slow request detected: ${req.method} ${req.originalUrl} - ${responseTime}ms`);
    }
  }

  /**
   * Record database query metrics
   * @param {string} queryType - Type of query
   * @param {number} queryTime - Query execution time in milliseconds
   * @param {boolean} fromCache - Whether result came from cache
   */
  recordDatabaseQuery(queryType, queryTime, fromCache = false) {
    if (!this.isMonitoring) return;

    this.metrics.database.queries++;
    
    // Update average query time
    const totalTime = this.metrics.database.averageQueryTime * (this.metrics.database.queries - 1);
    this.metrics.database.averageQueryTime = (totalTime + queryTime) / this.metrics.database.queries;

    // Track slow queries
    if (queryTime > 2000) { // 2 seconds
      this.metrics.database.slowQueries++;
      console.warn(`🐌 [PERF_MONITOR] Slow query detected: ${queryType} - ${queryTime}ms`);
    }

    // Update cache hit rate
    if (fromCache) {
      const totalQueries = this.metrics.database.queries;
      const cacheHits = this.metrics.database.queries - (totalQueries - this.metrics.database.queries);
      this.metrics.database.cacheHitRate = (cacheHits / totalQueries) * 100;
    }
  }

  /**
   * Record error metrics
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   */
  recordError(error, context = {}) {
    if (!this.isMonitoring) return;

    this.metrics.errors.total++;
    
    // Track errors by type
    const errorType = error.name || 'UnknownError';
    this.metrics.errors.byType[errorType] = (this.metrics.errors.byType[errorType] || 0) + 1;

    // Track recent errors
    this.metrics.errors.recent.push({
      timestamp: Date.now(),
      type: errorType,
      message: error.message,
      stack: error.stack,
      context
    });

    // Keep only last 50 errors
    if (this.metrics.errors.recent.length > 50) {
      this.metrics.errors.recent.shift();
    }

    // Log critical errors
    if (error.name === 'CriticalError' || error.statusCode >= 500) {
      console.error(`🚨 [PERF_MONITOR] Critical error detected: ${errorType} - ${error.message}`);
    }
  }

  /**
   * Update memory metrics
   */
  updateMemoryMetrics() {
    const memUsage = process.memoryUsage();
    
    this.metrics.memory.used = Math.round(memUsage.heapUsed / 1024 / 1024); // MB
    this.metrics.memory.free = Math.round((memUsage.heapTotal - memUsage.heapUsed) / 1024 / 1024); // MB
    this.metrics.memory.total = Math.round(memUsage.heapTotal / 1024 / 1024); // MB
    this.metrics.memory.utilization = Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100); // Percentage

    // Alert on high memory usage
    if (this.metrics.memory.utilization > 90) {
      console.warn(`⚠️ [PERF_MONITOR] High memory usage detected: ${this.metrics.memory.utilization}%`);
    }
  }

  /**
   * Get current performance metrics
   * @returns {Object} Current metrics
   */
  getMetrics() {
    const dbStats = databasePoolService.getStats();
    const cacheStats = cachingService.getStats();

    return {
      ...this.metrics,
      database: {
        ...this.metrics.database,
        ...dbStats
      },
      cache: cacheStats,
      uptime: this.uptime,
      isMonitoring: this.isMonitoring,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get performance summary
   * @returns {Object} Performance summary
   */
  getPerformanceSummary() {
    const metrics = this.getMetrics();
    
    return {
      uptime: this.formatUptime(metrics.uptime),
      requests: {
        total: metrics.requests.total,
        successRate: metrics.requests.total > 0 
          ? Math.round((metrics.requests.successful / metrics.requests.total) * 100) 
          : 0,
        averageResponseTime: Math.round(metrics.requests.averageResponseTime),
        slowRequests: metrics.requests.responseTimeHistory.filter(r => r.responseTime > 5000).length
      },
      database: {
        totalQueries: metrics.database.queries,
        averageQueryTime: Math.round(metrics.database.averageQueryTime),
        slowQueries: metrics.database.slowQueries,
        cacheHitRate: Math.round(metrics.database.cacheHitRate)
      },
      memory: {
        used: metrics.memory.used,
        total: metrics.memory.total,
        utilization: metrics.memory.utilization,
        status: metrics.memory.utilization > 90 ? 'critical' : 
                metrics.memory.utilization > 75 ? 'warning' : 'healthy'
      },
      errors: {
        total: metrics.errors.total,
        recent: metrics.errors.recent.length,
        topTypes: Object.entries(metrics.errors.byType)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5)
          .map(([type, count]) => ({ type, count }))
      }
    };
  }

  /**
   * Format uptime in human readable format
   * @param {number} uptime - Uptime in milliseconds
   * @returns {string} Formatted uptime
   */
  formatUptime(uptime) {
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Log performance metrics
   */
  async logPerformanceMetrics() {
    try {
      const summary = this.getPerformanceSummary();
      
      console.log('📊 [PERF_MONITOR] Performance Summary:');
      console.log(`   Uptime: ${summary.uptime}`);
      console.log(`   Requests: ${summary.requests.total} (${summary.requests.successRate}% success)`);
      console.log(`   Avg Response Time: ${summary.requests.averageResponseTime}ms`);
      console.log(`   Database Queries: ${summary.database.totalQueries} (${summary.database.cacheHitRate}% cache hit)`);
      console.log(`   Memory Usage: ${summary.memory.used}MB / ${summary.memory.total}MB (${summary.memory.utilization}%)`);
      console.log(`   Errors: ${summary.errors.total} total, ${summary.errors.recent} recent`);

      // Store metrics in database for historical analysis
      await this.storeMetrics(summary);

    } catch (error) {
      console.error('❌ [PERF_MONITOR] Error logging metrics:', error);
    }
  }

  /**
   * Store metrics in database
   * @param {Object} summary - Performance summary
   */
  async storeMetrics(summary) {
    try {
      await this.db.collection('performanceMetrics').add({
        ...summary,
        timestamp: new Date(),
        serverId: process.env.SERVER_ID || 'default'
      });
    } catch (error) {
      console.error('❌ [PERF_MONITOR] Error storing metrics:', error);
    }
  }

  /**
   * Cleanup old metrics
   */
  async cleanupOldMetrics() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 7); // Keep 7 days

      const query = await this.db.collection('performanceMetrics')
        .where('timestamp', '<', cutoffDate)
        .get();

      const batch = this.db.batch();
      query.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      if (query.docs.length > 0) {
        await batch.commit();
        console.log(`🧹 [PERF_MONITOR] Cleaned up ${query.docs.length} old metrics`);
      }
    } catch (error) {
      console.error('❌ [PERF_MONITOR] Error cleaning up metrics:', error);
    }
  }

  /**
   * Get performance alerts
   * @returns {Array} Array of alerts
   */
  getAlerts() {
    const alerts = [];
    const metrics = this.getMetrics();

    // Memory usage alert
    if (metrics.memory.utilization > 90) {
      alerts.push({
        type: 'critical',
        message: `High memory usage: ${metrics.memory.utilization}%`,
        timestamp: new Date().toISOString()
      });
    } else if (metrics.memory.utilization > 75) {
      alerts.push({
        type: 'warning',
        message: `Elevated memory usage: ${metrics.memory.utilization}%`,
        timestamp: new Date().toISOString()
      });
    }

    // Response time alert
    if (metrics.requests.averageResponseTime > 5000) {
      alerts.push({
        type: 'warning',
        message: `High average response time: ${Math.round(metrics.requests.averageResponseTime)}ms`,
        timestamp: new Date().toISOString()
      });
    }

    // Error rate alert
    const errorRate = metrics.requests.total > 0 
      ? (metrics.errors.total / metrics.requests.total) * 100 
      : 0;
    
    if (errorRate > 10) {
      alerts.push({
        type: 'critical',
        message: `High error rate: ${Math.round(errorRate)}%`,
        timestamp: new Date().toISOString()
      });
    } else if (errorRate > 5) {
      alerts.push({
        type: 'warning',
        message: `Elevated error rate: ${Math.round(errorRate)}%`,
        timestamp: new Date().toISOString()
      });
    }

    // Database performance alert
    if (metrics.database.averageQueryTime > 2000) {
      alerts.push({
        type: 'warning',
        message: `Slow database queries: ${Math.round(metrics.database.averageQueryTime)}ms average`,
        timestamp: new Date().toISOString()
      });
    }

    return alerts;
  }

  /**
   * Reset all metrics
   */
  resetMetrics() {
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        averageResponseTime: 0,
        responseTimeHistory: []
      },
      database: {
        queries: 0,
        averageQueryTime: 0,
        slowQueries: 0,
        cacheHitRate: 0
      },
      memory: {
        used: 0,
        free: 0,
        total: 0,
        utilization: 0
      },
      errors: {
        total: 0,
        byType: {},
        recent: []
      }
    };
    this.startTime = Date.now();
    this.uptime = 0;
    
    console.log('🔄 [PERF_MONITOR] Metrics reset');
  }
}

module.exports = new PerformanceMonitoringService();
