const { getFirestore } = require('./firebase');

/**
 * Monitoring Service
 * Provides comprehensive system monitoring and alerting
 */
class MonitoringService {
  constructor() {
    this.db = getFirestore();
    this.metrics = new Map();
    this.alerts = [];
    this.isInitialized = false;
    this.intervals = []; // Track intervals for cleanup
  }

  /**
   * Initialize monitoring service
   */
  async initialize() {
    if (this.isInitialized) return;

    try {
      this.startMetricsCollection();
      this.startHealthChecks();
      this.isInitialized = true;
      console.log('✅ Monitoring service initialized');
    } catch (error) {
      console.error('❌ Failed to initialize monitoring service:', error);
      throw error;
    }
  }

  /**
   * Record metric
   * @param {string} name - Metric name
   * @param {number} value - Metric value
   * @param {Object} tags - Metric tags
   */
  recordMetric(name, value, tags = {}) {
    const timestamp = new Date().toISOString();
    const metric = { name, value, tags, timestamp };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    
    const metricArray = this.metrics.get(name);
    metricArray.push(metric);
    
    if (metricArray.length > 1000) {
      metricArray.shift();
    }

    this.storeMetric(metric);
  }

  /**
   * Record counter metric
   * @param {string} name - Metric name
   * @param {number} increment - Increment value
   * @param {Object} tags - Metric tags
   */
  recordCounter(name, increment = 1, tags = {}) {
    const currentValue = this.getMetricValue(name, tags) || 0;
    this.recordMetric(name, currentValue + increment, tags);
  }

  /**
   * Record timing metric
   * @param {string} name - Metric name
   * @param {number} duration - Duration in milliseconds
   * @param {Object} tags - Metric tags
   */
  recordTiming(name, duration, tags = {}) {
    this.recordMetric(name, duration, { ...tags, type: 'timing' });
  }

  /**
   * Get metric value
   * @param {string} name - Metric name
   * @param {Object} tags - Metric tags
   * @returns {number} Metric value
   */
  getMetricValue(name, tags = {}) {
    const metricArray = this.metrics.get(name) || [];
    const matchingMetrics = metricArray.filter(metric => 
      Object.keys(tags).every(key => metric.tags[key] === tags[key])
    );
    
    return matchingMetrics.length > 0 ? matchingMetrics[matchingMetrics.length - 1].value : null;
  }

  /**
   * Store metric in database
   * @param {Object} metric - Metric data
   */
  async storeMetric(metric) {
    try {
      await this.db.collection('metrics').add(metric);
    } catch (error) {
      console.error('Failed to store metric:', error);
    }
  }

  /**
   * Create alert
   * @param {string} type - Alert type
   * @param {string} message - Alert message
   * @param {Object} data - Alert data
   * @param {string} severity - Alert severity
   */
  createAlert(type, message, data = {}, severity = 'medium') {
    const alert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      message,
      data,
      severity,
      status: 'active',
      createdAt: new Date().toISOString()
    };

    this.alerts.push(alert);
    this.storeAlert(alert);
    
    console.log(`🚨 Alert created: ${type} - ${message}`);
    return alert;
  }

  /**
   * Store alert in database
   * @param {Object} alert - Alert data
   */
  async storeAlert(alert) {
    try {
      await this.db.collection('alerts').add(alert);
    } catch (error) {
      console.error('Failed to store alert:', error);
    }
  }

  /**
   * Get system health status
   * @returns {Object} Health status
   */
  async getSystemHealth() {
    try {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {},
        metrics: {}
      };

      // Check database health
      try {
        await this.db.collection('health').doc('test').set({ test: true });
        await this.db.collection('health').doc('test').delete();
        health.services.database = 'healthy';
      } catch (error) {
        console.warn('Database health check failed:', error.message);
        health.services.database = 'unhealthy';
        health.status = 'degraded';
      }

      // Check memory usage
      const memUsage = process.memoryUsage();
      const memoryUsage = {
        rss: Math.round(memUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024)
      };
      
      health.metrics.memoryUsage = memoryUsage;
      
      // Check for high memory usage and trigger GC
      const memoryPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      if (memoryPercentage > 75) { // Lowered from 85 to 75
        console.warn(`⚠️ [PERF_MONITOR] High memory usage detected: ${memoryPercentage.toFixed(1)}%`);
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
          console.log('✅ [PERF_MONITOR] Forced garbage collection executed');
        }
        
        // Create alert for high memory usage
        this.createAlert('high_memory_usage', 
          `High memory usage detected: ${memoryPercentage.toFixed(1)}%`, 
          { memoryPercentage, memoryUsage }, 
          memoryPercentage > 90 ? 'critical' : 'warning' // Lowered from 95 to 90
        );
        
        // Clear old metrics to free memory
        this.clearOldMetrics();
        
        // Clear old alerts to free memory
        this.clearOldAlerts();
        
        // Additional cleanup for critical memory usage
        if (memoryPercentage > 90) {
          console.warn('🚨 [PERF_MONITOR] Critical memory usage - performing aggressive cleanup');
          
          // Clear all metrics older than 1 hour
          const oneHourAgo = Date.now() - (60 * 60 * 1000);
          this.metrics = this.metrics.filter(metric => metric.timestamp > oneHourAgo);
          
          // Clear all alerts older than 30 minutes
          const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
          this.alerts = this.alerts.filter(alert => alert.timestamp > thirtyMinutesAgo);
          
          console.log('✅ [PERF_MONITOR] Aggressive cleanup completed');
        }
      }

      return health;
    } catch (error) {
      return {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }

  /**
   * Start metrics collection
   */
  startMetricsCollection() {
    const interval = setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);
    this.intervals.push(interval);
  }

  /**
   * Collect system metrics
   */
  collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    this.recordMetric('memory.rss', memUsage.rss);
    this.recordMetric('memory.heap_used', memUsage.heapUsed);
    this.recordMetric('uptime', process.uptime());
  }

  /**
   * Clear old metrics to free memory
   */
  clearOldMetrics() {
    const maxMetricsPerType = 100;
    for (const [metricName, metricArray] of this.metrics.entries()) {
      if (metricArray.length > maxMetricsPerType) {
        const toRemove = metricArray.length - maxMetricsPerType;
        metricArray.splice(0, toRemove);
        console.log(`🧹 [PERF_MONITOR] Cleared ${toRemove} old metrics for ${metricName}`);
      }
    }
  }

  /**
   * Clear old alerts to free memory
   */
  clearOldAlerts() {
    const maxAlerts = 50;
    if (this.alerts.length > maxAlerts) {
      const toRemove = this.alerts.length - maxAlerts;
      this.alerts.splice(0, toRemove);
      console.log(`🧹 [PERF_MONITOR] Cleared ${toRemove} old alerts`);
    }
  }

  /**
   * Start health checks
   */
  startHealthChecks() {
    const interval = setInterval(async () => {
      const health = await this.getSystemHealth();
      
      if (health.status === 'unhealthy') {
        this.createAlert('system_unhealthy', 'System health check failed', health, 'critical');
      }
    }, 5 * 60 * 1000);
    this.intervals.push(interval);
  }

  /**
   * Cleanup intervals to prevent memory leaks
   */
  cleanup() {
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];
    console.log('✅ Monitoring service intervals cleaned up');
  }
}

const monitoringService = new MonitoringService();
module.exports = monitoringService;