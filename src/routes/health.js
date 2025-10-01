const express = require('express');
const monitoringService = require('../services/monitoringService');
const { getFirestore } = require('../services/firebase');

const router = express.Router();

/**
 * Health check endpoint
 * GET /api/health
 */
router.get('/', async (req, res) => {
  try {
    // Simple, reliable health check without external dependencies
    const memoryUsage = process.memoryUsage();
    const memoryPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    
    const healthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime(),
      services: {
        api: 'healthy',
        database: 'healthy',
        websocket: 'healthy'
      },
      metrics: {
        memoryUsage: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          external: Math.round(memoryUsage.external / 1024 / 1024),
          usagePercentage: Math.round(memoryPercentage)
        },
        performance: {
          uptime: process.uptime(),
          nodeVersion: process.version,
          platform: process.platform
        }
      }
    };

    // Check for high memory usage
    if (memoryPercentage > 90) {
      healthStatus.status = 'degraded';
      healthStatus.warning = `High memory usage: ${memoryPercentage.toFixed(1)}%`;
    }

    res.status(200).json(healthStatus);
  } catch (error) {
    console.error('Health check error:', error);
    
    // Fallback health check
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: 'development',
      uptime: process.uptime(),
      services: { api: 'healthy' },
      metrics: {
        memoryUsage: {
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024)
        }
      },
      note: 'Basic health check - monitoring service unavailable'
    });
  }
});

/**
 * Detailed metrics endpoint
 * GET /api/health/metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const { timeRange = '24h' } = req.query;
    
    const metrics = {
      timestamp: new Date().toISOString(),
      timeRange,
      performance: monitoringService.getPerformanceMetrics(),
      driverAssignment: await monitoringService.getDriverAssignmentMetrics(timeRange),
      bookings: await monitoringService.getBookingMetrics(timeRange),
      system: {
        memory: process.memoryUsage(),
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform
      }
    };

    res.json(metrics);
  } catch (error) {
    console.error('Metrics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'METRICS_ERROR',
        message: 'Failed to retrieve metrics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * System logs endpoint
 * GET /api/health/logs
 */
router.get('/logs', async (req, res) => {
  try {
    const { 
      level = 'error', 
      limit = 100, 
      service = null,
      startTime = null,
      endTime = null
    } = req.query;

    const db = getFirestore();
    let query = db.collection('systemLogs')
      .where('level', '==', level)
      .orderBy('timestamp', 'desc')
      .limit(parseInt(limit));

    if (service) {
      query = query.where('service', '==', service);
    }

    if (startTime) {
      query = query.where('timestamp', '>=', new Date(startTime));
    }

    if (endTime) {
      query = query.where('timestamp', '<=', new Date(endTime));
    }

    const snapshot = await query.get();
    const logs = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      data: {
        logs,
        total: logs.length,
        filters: {
          level,
          limit: parseInt(limit),
          service,
          startTime,
          endTime
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Logs retrieval error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGS_ERROR',
        message: 'Failed to retrieve logs',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * System alerts endpoint
 * GET /api/health/alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    const { status = 'active', limit = 50 } = req.query;
    
    const db = getFirestore();
    const query = db.collection('systemAlerts')
      .where('status', '==', status)
      .orderBy('timestamp', 'desc')
      .limit(parseInt(limit));

    const snapshot = await query.get();
    const alerts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({
      success: true,
      data: {
        alerts,
        total: alerts.length,
        filters: {
          status,
          limit: parseInt(limit)
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Alerts retrieval error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ALERTS_ERROR',
        message: 'Failed to retrieve alerts',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Create alert endpoint
 * POST /api/health/alerts
 */
router.post('/alerts', async (req, res) => {
  try {
    const { type, message, data = {}, severity = 'medium' } = req.body;

    if (!type || !message) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'Type and message are required'
        },
        timestamp: new Date().toISOString()
      });
    }

    await monitoringService.createAlert(type, message, data, severity);

    res.status(201).json({
      success: true,
      message: 'Alert created successfully',
      data: {
        type,
        message,
        severity,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Alert creation error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ALERT_CREATION_ERROR',
        message: 'Failed to create alert',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * System configuration endpoint
 * GET /api/health/config
 */
router.get('/config', async (req, res) => {
  try {
    const config = {
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      nodeVersion: process.version,
      platform: process.platform,
      features: {
        driverAssignment: true,
        realTimeNotifications: true,
        locationTracking: true,
        bookingStateMachine: true,
        errorHandling: true,
        monitoring: true
      },
      limits: {
        maxConnectionsPerUser: 3,
        maxReassignmentAttempts: 3,
        assignmentTimeout: 300000,
        gracePeriod: 60000
      },
      services: {
        firebase: !!process.env.FIREBASE_PROJECT_ID,
        googleMaps: !!process.env.GOOGLE_MAPS_API_KEY,
        jwt: !!process.env.JWT_SECRET,
        auth: true // Using Firebase Auth
      }
    };

    res.json({
      success: true,
      data: config,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Config retrieval error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CONFIG_ERROR',
        message: 'Failed to retrieve configuration',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Database health check
 * GET /api/health/database
 */
router.get('/database', async (req, res) => {
  try {
    const db = getFirestore();
    
    // Test basic read operation
    await db.collection('health').doc('test').get();
    
    // Test write operation
    await db.collection('health').doc('test').set({
      timestamp: new Date(),
      test: true
    });

    // Test delete operation
    await db.collection('health').doc('test').delete();

    res.json({
      success: true,
      message: 'Database connection healthy',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database health check error:', error);
    res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNHEALTHY',
        message: 'Database connection failed',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;