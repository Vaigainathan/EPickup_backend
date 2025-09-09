const express = require('express');
const router = express.Router();

// Health check endpoint for keepalive script
router.get('/', (req, res) => {
  try {
    const healthData = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024)
      },
      services: {
        server: 'running',
        database: 'connected', // Firebase Firestore
        firestoreSession: 'configured',
        twilio: process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'not_configured',
        expo: process.env.EXPO_ACCESS_TOKEN ? 'configured' : 'not_configured'
      }
    };

    res.status(200).json(healthData);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Detailed health check with service status
router.get('/detailed', (req, res) => {
  try {
    const detailedHealth = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024)
      },
      cpu: {
        usage: process.cpuUsage(),
        load: process.loadavg ? process.loadavg() : null
      },
      services: {
        server: {
          status: 'running',
          port: process.env.PORT || 3000,
          pid: process.pid
        },
        database: {
          status: 'connected',
          type: 'Firebase Firestore',
          project: process.env.FIREBASE_PROJECT_ID || 'not_configured'
        },
        firestoreSession: {
          status: 'configured',
          type: 'Firestore-based session management'
        },
        twilio: {
          status: process.env.TWILIO_ACCOUNT_SID ? 'configured' : 'not_configured',
          accountSid: process.env.TWILIO_ACCOUNT_SID ? 'configured' : null,
          verifyService: process.env.TWILIO_VERIFY_SERVICE_SID ? 'configured' : 'not_configured'
        },
        expo: {
          status: process.env.EXPO_ACCESS_TOKEN ? 'configured' : 'not_configured',
          projectId: process.env.EXPO_PROJECT_ID || 'not_configured'
        }
      },
      endpoints: {
        auth: '/auth',
        customer: '/customer',
        driver: '/driver',
        booking: '/booking',
        payment: '/payment',
        tracking: '/tracking',
        notification: '/notification',
        fileUpload: '/file-upload',
        support: '/support',
        googleMaps: '/google-maps',
        realtime: '/realtime',
        emergency: '/emergency',
        serviceArea: '/service-area'
      }
    };

    res.status(200).json(detailedHealth);
  } catch (error) {
    console.error('Detailed health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Simple ping endpoint
router.get('/ping', (req, res) => {
  res.status(200).json({
    pong: true,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
