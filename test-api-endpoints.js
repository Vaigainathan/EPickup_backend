const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

// Create a minimal test server
const app = express();
const PORT = 3001;

// Basic middleware
app.use(cors());
app.use(helmet());
app.use(express.json());

// Test routes
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Test server is healthy',
    timestamp: new Date().toISOString()
  });
});

app.get('/api-docs', (req, res) => {
  res.json({
    message: 'EPickup API Documentation',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      customer: '/api/customer',
      driver: '/api/driver',
      booking: '/api/bookings',
      payment: '/api/payments',
      tracking: '/api/tracking',
      notification: '/api/notifications',
      'file-upload': '/api/file-upload',
      support: '/api/support'
    },
    documentation: 'https://github.com/epickup/backend/blob/main/README.md'
  });
});

// Test each route module
app.get('/test-routes', (req, res) => {
  try {
    // Test route imports
    const authRoutes = require('./src/routes/auth');
    const customerRoutes = require('./src/routes/customer');
    const driverRoutes = require('./src/routes/driver');
    const bookingRoutes = require('./src/routes/booking');
    const paymentRoutes = require('./src/routes/payment');
    const trackingRoutes = require('./src/routes/tracking');
    const notificationRoutes = require('./src/routes/notification');
    const fileUploadRoutes = require('./src/routes/fileUpload');
    const supportRoutes = require('./src/routes/support');

    res.json({
      success: true,
      message: 'All route modules loaded successfully',
      routes: {
        auth: '✅ Loaded',
        customer: '✅ Loaded',
        driver: '✅ Loaded',
        booking: '✅ Loaded',
        payment: '✅ Loaded',
        tracking: '✅ Loaded',
        notification: '✅ Loaded',
        fileUpload: '✅ Loaded',
        support: '✅ Loaded'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        message: 'Route module test failed',
        details: error.message
      }
    });
  }
});

// Test middleware imports
app.get('/test-middleware', (req, res) => {
  try {
    const { errorHandler } = require('./src/middleware/errorHandler');
    const { authMiddleware } = require('./src/middleware/auth');
    const { validateRequest } = require('./src/middleware/validation');

    res.json({
      success: true,
      message: 'All middleware modules loaded successfully',
      middleware: {
        errorHandler: '✅ Loaded',
        authMiddleware: '✅ Loaded',
        validateRequest: '✅ Loaded'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        message: 'Middleware module test failed',
        details: error.message
      }
    });
  }
});

// Test service imports
app.get('/test-services', (req, res) => {
  try {
    const { initializeFirebase } = require('./src/services/firebase');
    const { initializeRedis } = require('./src/services/redis');
    const { initializeSocketIO } = require('./src/services/socket');

    res.json({
      success: true,
      message: 'All service modules loaded successfully',
      services: {
        firebase: '✅ Loaded',
        redis: '✅ Loaded',
        socket: '✅ Loaded'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        message: 'Service module test failed',
        details: error.message
      }
    });
  }
});

// Start test server
app.listen(PORT, () => {
  console.log(`🧪 Test server running on port ${PORT}`);
  console.log(`🔗 Health Check: http://localhost:${PORT}/health`);
  console.log(`📚 API Docs: http://localhost:${PORT}/api-docs`);
  console.log(`🧪 Test Routes: http://localhost:${PORT}/test-routes`);
  console.log(`🧪 Test Middleware: http://localhost:${PORT}/test-middleware`);
  console.log(`🧪 Test Services: http://localhost:${PORT}/test-services`);
});

module.exports = app;
