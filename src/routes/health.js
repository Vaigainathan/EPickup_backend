/**
 * Health Check Routes
 * Provides comprehensive health monitoring endpoints
 */

const express = require('express');
const router = express.Router();
const { getFirestore } = require('firebase-admin/firestore');
const { auth } = require('firebase-admin/auth');

// Health check data
const healthData = {
  status: 'healthy',
  timestamp: new Date().toISOString(),
  uptime: process.uptime(),
  version: process.env.npm_package_version || '1.0.0',
  environment: process.env.NODE_ENV || 'development',
  services: {
    database: 'unknown',
    auth: 'unknown',
    memory: 'unknown',
    cpu: 'unknown'
  },
  metrics: {
    memoryUsage: 0,
    cpuUsage: 0,
    responseTime: 0,
    errorRate: 0,
    requestCount: 0,
    errorCount: 0
  }
};

// Request tracking
const requestMetrics = {
  total: 0,
  errors: 0,
  responseTimes: []
};

// Update request metrics
const updateRequestMetrics = (responseTime, isError = false) => {
  requestMetrics.total++;
  if (isError) requestMetrics.errors++;
  
  requestMetrics.responseTimes.push(responseTime);
  
  // Keep only last 100 response times
  if (requestMetrics.responseTimes.length > 100) {
    requestMetrics.responseTimes.shift();
  }
  
  // Update health data
  healthData.metrics.requestCount = requestMetrics.total;
  healthData.metrics.errorCount = requestMetrics.errors;
  healthData.metrics.errorRate = requestMetrics.total > 0 ? requestMetrics.errors / requestMetrics.total : 0;
  healthData.metrics.responseTime = requestMetrics.responseTimes.length > 0 
    ? requestMetrics.responseTimes.reduce((a, b) => a + b, 0) / requestMetrics.responseTimes.length 
    : 0;
};

// Check database health
const checkDatabaseHealth = async () => {
  try {
    const db = getFirestore();
    const startTime = Date.now();
    
    // Simple read operation
    await db.collection('_health').doc('test').get();
    
    const responseTime = Date.now() - startTime;
    
    if (responseTime < 1000) {
      healthData.services.database = 'healthy';
    } else {
      healthData.services.database = 'slow';
    }
    
    return { status: 'healthy', responseTime };
  } catch (error) {
    healthData.services.database = 'unhealthy';
    return { status: 'unhealthy', error: error.message };
  }
};

// Check auth service health
const checkAuthHealth = async () => {
  try {
    const startTime = Date.now();
    
    // Simple auth operation
    await auth.listUsers(1);
    
    const responseTime = Date.now() - startTime;
    
    if (responseTime < 2000) {
      healthData.services.auth = 'healthy';
    } else {
      healthData.services.auth = 'slow';
    }
    
    return { status: 'healthy', responseTime };
  } catch (error) {
    healthData.services.auth = 'unhealthy';
    return { status: 'unhealthy', error: error.message };
  }
};

// Check memory health
const checkMemoryHealth = () => {
  const memUsage = process.memoryUsage();
  const totalMem = memUsage.heapTotal + memUsage.external;
  const usedMem = memUsage.heapUsed + memUsage.external;
  const memoryUsage = usedMem / totalMem;
  
  healthData.metrics.memoryUsage = memoryUsage;
  
  if (memoryUsage < 0.8) {
    healthData.services.memory = 'healthy';
  } else if (memoryUsage < 0.9) {
    healthData.services.memory = 'warning';
  } else {
    healthData.services.memory = 'critical';
  }
  
  return { 
    status: memoryUsage < 0.9 ? 'healthy' : 'unhealthy', 
    memoryUsage,
    heapUsed: memUsage.heapUsed,
    heapTotal: memUsage.heapTotal,
    external: memUsage.external
  };
};

// Check CPU health
const checkCPUHealth = () => {
  const cpuUsage = process.cpuUsage();
  const cpuUsagePercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
  
  healthData.metrics.cpuUsage = cpuUsagePercent;
  
  if (cpuUsagePercent < 0.5) {
    healthData.services.cpu = 'healthy';
  } else if (cpuUsagePercent < 0.8) {
    healthData.services.cpu = 'warning';
  } else {
    healthData.services.cpu = 'critical';
  }
  
  return { 
    status: cpuUsagePercent < 0.8 ? 'healthy' : 'unhealthy', 
    cpuUsage: cpuUsagePercent,
    user: cpuUsage.user,
    system: cpuUsage.system
  };
};

// Basic health check
router.get('/', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Update basic metrics
    healthData.timestamp = new Date().toISOString();
    healthData.uptime = process.uptime();
    
    // Check memory and CPU
    const memoryHealth = checkMemoryHealth();
    const cpuHealth = checkCPUHealth();
    
    // Determine overall health
    const isHealthy = memoryHealth.status === 'healthy' && cpuHealth.status === 'healthy';
    healthData.status = isHealthy ? 'healthy' : 'unhealthy';
    
    const responseTime = Date.now() - startTime;
    updateRequestMetrics(responseTime, !isHealthy);
    
    const statusCode = isHealthy ? 200 : 503;
    
    res.status(statusCode).json({
      success: true,
      data: {
        ...healthData,
        checks: {
          memory: memoryHealth,
          cpu: cpuHealth
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    updateRequestMetrics(responseTime, true);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'HEALTH_CHECK_ERROR',
        message: 'Health check failed',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Detailed health check
router.get('/detailed', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Update basic metrics
    healthData.timestamp = new Date().toISOString();
    healthData.uptime = process.uptime();
    
    // Run all health checks
    const [databaseHealth, authHealth, memoryHealth, cpuHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkAuthHealth(),
      Promise.resolve(checkMemoryHealth()),
      Promise.resolve(checkCPUHealth())
    ]);
    
    // Determine overall health
    const isHealthy = databaseHealth.status === 'healthy' && 
                     authHealth.status === 'healthy' && 
                     memoryHealth.status === 'healthy' && 
                     cpuHealth.status === 'healthy';
    
    healthData.status = isHealthy ? 'healthy' : 'unhealthy';
    
    const responseTime = Date.now() - startTime;
    updateRequestMetrics(responseTime, !isHealthy);
    
    const statusCode = isHealthy ? 200 : 503;
    
    res.status(statusCode).json({
      success: true,
      data: {
        ...healthData,
        checks: {
          database: databaseHealth,
          auth: authHealth,
          memory: memoryHealth,
          cpu: cpuHealth
        },
        metrics: {
          ...healthData.metrics,
          uptime: healthData.uptime,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    updateRequestMetrics(responseTime, true);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'DETAILED_HEALTH_CHECK_ERROR',
        message: 'Detailed health check failed',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Readiness check
router.get('/ready', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Check critical services
    const [databaseHealth, authHealth] = await Promise.all([
      checkDatabaseHealth(),
      checkAuthHealth()
    ]);
    
    const isReady = databaseHealth.status === 'healthy' && authHealth.status === 'healthy';
    
    const responseTime = Date.now() - startTime;
    updateRequestMetrics(responseTime, !isReady);
    
    const statusCode = isReady ? 200 : 503;
    
    res.status(statusCode).json({
      success: true,
      data: {
        ready: isReady,
        checks: {
          database: databaseHealth,
          auth: authHealth
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    updateRequestMetrics(responseTime, true);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'READINESS_CHECK_ERROR',
        message: 'Readiness check failed',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Liveness check
router.get('/live', (req, res) => {
  const startTime = Date.now();
  
  try {
    // Simple liveness check
    const isAlive = process.uptime() > 0;
    
    const responseTime = Date.now() - startTime;
    updateRequestMetrics(responseTime, !isAlive);
    
    const statusCode = isAlive ? 200 : 503;
    
    res.status(statusCode).json({
      success: true,
      data: {
        alive: isAlive,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    const responseTime = Date.now() - startTime;
    updateRequestMetrics(responseTime, true);
    
    res.status(500).json({
      success: false,
      error: {
        code: 'LIVENESS_CHECK_ERROR',
        message: 'Liveness check failed',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Metrics endpoint
router.get('/metrics', (req, res) => {
  try {
    const metrics = {
      ...healthData.metrics,
      uptime: healthData.uptime,
      version: healthData.version,
      environment: healthData.environment,
      services: healthData.services,
      requestMetrics: {
        total: requestMetrics.total,
        errors: requestMetrics.errors,
        errorRate: requestMetrics.total > 0 ? requestMetrics.errors / requestMetrics.total : 0,
        avgResponseTime: requestMetrics.responseTimes.length > 0 
          ? requestMetrics.responseTimes.reduce((a, b) => a + b, 0) / requestMetrics.responseTimes.length 
          : 0,
        minResponseTime: requestMetrics.responseTimes.length > 0 ? Math.min(...requestMetrics.responseTimes) : 0,
        maxResponseTime: requestMetrics.responseTimes.length > 0 ? Math.max(...requestMetrics.responseTimes) : 0
      }
    };
    
    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
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

module.exports = router;