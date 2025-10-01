/**
 * Alerting Middleware
 * Provides real-time alerting for critical events
 */

const { logger } = require('./logger');

// Alert configuration
const alertConfig = {
  thresholds: {
    errorRate: 0.1, // 10% error rate
    responseTime: 5000, // 5 seconds
    memoryUsage: 0.8, // 80% memory usage
    cpuUsage: 0.8, // 80% CPU usage
    failedLogins: 5, // 5 failed logins per minute
    unauthorizedAccess: 3 // 3 unauthorized access attempts per minute
  },
  
  cooldownPeriods: {
    errorRate: 5 * 60 * 1000, // 5 minutes
    responseTime: 2 * 60 * 1000, // 2 minutes
    memoryUsage: 10 * 60 * 1000, // 10 minutes
    cpuUsage: 5 * 60 * 1000, // 5 minutes
    failedLogins: 1 * 60 * 1000, // 1 minute
    unauthorizedAccess: 1 * 60 * 1000 // 1 minute
  }
};

// Alert state tracking
const alertState = new Map();

// Alert types
const AlertTypes = {
  ERROR_RATE: 'error_rate',
  RESPONSE_TIME: 'response_time',
  MEMORY_USAGE: 'memory_usage',
  CPU_USAGE: 'cpu_usage',
  FAILED_LOGINS: 'failed_logins',
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  SECURITY_BREACH: 'security_breach',
  SERVICE_DOWN: 'service_down'
};

// Alert severity levels
const Severity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

// Alert manager
class AlertManager {
  constructor() {
    this.alerts = new Map();
    this.notificationChannels = [];
  }
  
  // Add notification channel
  addNotificationChannel(channel) {
    this.notificationChannels.push(channel);
  }
  
  // Create alert
  createAlert(type, severity, message, data = {}) {
    const alert = {
      id: `${type}_${Date.now()}`,
      type,
      severity,
      message,
      data,
      timestamp: new Date().toISOString(),
      acknowledged: false,
      resolved: false
    };
    
    this.alerts.set(alert.id, alert);
    
    // Send notifications
    this.sendNotifications(alert);
    
    // Log alert
    logger.error('Alert created', {
      event: 'alert_created',
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      data: alert.data
    });
    
    return alert;
  }
  
  // Send notifications
  async sendNotifications(alert) {
    for (const channel of this.notificationChannels) {
      try {
        await channel.send(alert);
      } catch (error) {
        logger.error('Failed to send alert notification', {
          event: 'alert_notification_failed',
          channel: channel.name,
          alertId: alert.id,
          error: error.message
        });
      }
    }
  }
  
  // Acknowledge alert
  acknowledgeAlert(alertId, userId) {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedBy = userId;
      alert.acknowledgedAt = new Date().toISOString();
      
      logger.info('Alert acknowledged', {
        event: 'alert_acknowledged',
        alertId,
        userId
      });
    }
  }
  
  // Resolve alert
  resolveAlert(alertId, userId) {
    const alert = this.alerts.get(alertId);
    if (alert) {
      alert.resolved = true;
      alert.resolvedBy = userId;
      alert.resolvedAt = new Date().toISOString();
      
      logger.info('Alert resolved', {
        event: 'alert_resolved',
        alertId,
        userId
      });
    }
  }
  
  // Get active alerts
  getActiveAlerts() {
    return Array.from(this.alerts.values())
      .filter(alert => !alert.resolved)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }
  
  // Get alert statistics
  getAlertStats() {
    const alerts = Array.from(this.alerts.values());
    const stats = {
      total: alerts.length,
      active: alerts.filter(a => !a.resolved).length,
      acknowledged: alerts.filter(a => a.acknowledged && !a.resolved).length,
      resolved: alerts.filter(a => a.resolved).length,
      bySeverity: {},
      byType: {}
    };
    
    // Count by severity
    for (const severity of Object.values(Severity)) {
      stats.bySeverity[severity] = alerts.filter(a => a.severity === severity).length;
    }
    
    // Count by type
    for (const type of Object.values(AlertTypes)) {
      stats.byType[type] = alerts.filter(a => a.type === type).length;
    }
    
    return stats;
  }
}

// Create alert manager instance
const alertManager = new AlertManager();

// Alert checkers
const alertCheckers = {
  // Check error rate
  checkErrorRate(errorCount, totalRequests, timeWindow) {
    const errorRate = errorCount / totalRequests;
    const threshold = alertConfig.thresholds.errorRate;
    
    if (errorRate > threshold) {
      const alertKey = 'error_rate';
      const lastAlert = alertState.get(alertKey);
      const now = Date.now();
      
      if (!lastAlert || (now - lastAlert) > alertConfig.cooldownPeriods.errorRate) {
        alertManager.createAlert(
          AlertTypes.ERROR_RATE,
          Severity.HIGH,
          `High error rate detected: ${(errorRate * 100).toFixed(2)}%`,
          { errorRate, threshold, errorCount, totalRequests, timeWindow }
        );
        alertState.set(alertKey, now);
      }
    }
  },
  
  // Check response time
  checkResponseTime(avgResponseTime) {
    const threshold = alertConfig.thresholds.responseTime;
    
    if (avgResponseTime > threshold) {
      const alertKey = 'response_time';
      const lastAlert = alertState.get(alertKey);
      const now = Date.now();
      
      if (!lastAlert || (now - lastAlert) > alertConfig.cooldownPeriods.responseTime) {
        alertManager.createAlert(
          AlertTypes.RESPONSE_TIME,
          Severity.MEDIUM,
          `High response time detected: ${avgResponseTime}ms`,
          { avgResponseTime, threshold }
        );
        alertState.set(alertKey, now);
      }
    }
  },
  
  // Check memory usage
  checkMemoryUsage(memoryUsage) {
    const threshold = alertConfig.thresholds.memoryUsage;
    
    if (memoryUsage > threshold) {
      const alertKey = 'memory_usage';
      const lastAlert = alertState.get(alertKey);
      const now = Date.now();
      
      if (!lastAlert || (now - lastAlert) > alertConfig.cooldownPeriods.memoryUsage) {
        alertManager.createAlert(
          AlertTypes.MEMORY_USAGE,
          Severity.HIGH,
          `High memory usage detected: ${(memoryUsage * 100).toFixed(2)}%`,
          { memoryUsage, threshold }
        );
        alertState.set(alertKey, now);
      }
    }
  },
  
  // Check failed logins
  checkFailedLogins(failedLoginCount, timeWindow) {
    const threshold = alertConfig.thresholds.failedLogins;
    
    if (failedLoginCount > threshold) {
      const alertKey = 'failed_logins';
      const lastAlert = alertState.get(alertKey);
      const now = Date.now();
      
      if (!lastAlert || (now - lastAlert) > alertConfig.cooldownPeriods.failedLogins) {
        alertManager.createAlert(
          AlertTypes.FAILED_LOGINS,
          Severity.MEDIUM,
          `Multiple failed login attempts detected: ${failedLoginCount}`,
          { failedLoginCount, threshold, timeWindow }
        );
        alertState.set(alertKey, now);
      }
    }
  },
  
  // Check unauthorized access
  checkUnauthorizedAccess(unauthorizedCount, timeWindow) {
    const threshold = alertConfig.thresholds.unauthorizedAccess;
    
    if (unauthorizedCount > threshold) {
      const alertKey = 'unauthorized_access';
      const lastAlert = alertState.get(alertKey);
      const now = Date.now();
      
      if (!lastAlert || (now - lastAlert) > alertConfig.cooldownPeriods.unauthorizedAccess) {
        alertManager.createAlert(
          AlertTypes.UNAUTHORIZED_ACCESS,
          Severity.HIGH,
          `Multiple unauthorized access attempts detected: ${unauthorizedCount}`,
          { unauthorizedCount, threshold, timeWindow }
        );
        alertState.set(alertKey, now);
      }
    }
  }
};

// Console notification channel (for development)
const consoleChannel = {
  name: 'console',
  async send(alert) {
    console.log(`🚨 ALERT [${alert.severity.toUpperCase()}] ${alert.type}: ${alert.message}`);
    console.log(`   Data:`, alert.data);
    console.log(`   Time: ${alert.timestamp}`);
  }
};

// Add console channel
alertManager.addNotificationChannel(consoleChannel);

module.exports = {
  alertManager,
  alertCheckers,
  AlertTypes,
  Severity
};
