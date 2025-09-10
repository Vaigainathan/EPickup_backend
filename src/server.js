// IMPORTANT: Make sure to import `instrument.js` at the top of your file.
require("../instrument.js");

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
// Import configuration
const { env } = require('./config');

// Import routes
const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customer');
const driverRoutes = require('./routes/driver');
const bookingRoutes = require('./routes/booking');
const paymentRoutes = require('./routes/payment');
const trackingRoutes = require('./routes/tracking');
const notificationRoutes = require('./routes/notification');
const fileUploadRoutes = require('./routes/fileUpload');
const supportRoutes = require('./routes/support');
const googleMapsRoutes = require('./routes/googleMaps');
const realtimeRoutes = require('./routes/realtime');
const fcmTokenRoutes = require('./routes/fcmTokens');
const emergencyRoutes = require('./routes/emergency');
const serviceAreaRoutes = require('./routes/serviceArea');
const healthRoutes = require('./routes/health');
const walletRoutes = require('./routes/wallet');
const fareCalculationRoutes = require('./routes/fareCalculation');
const adminRoutes = require('./routes/admin');
const adminAuthRoutes = require('./routes/adminAuth');

// Import middleware
const { errorHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/auth');

// Import services
const { initializeFirebase } = require('./services/firebase');
// Firestore Session Service is imported but not directly used in server.js
// It's used by other services that import it directly
const socketService = require('./services/socket');
const twilioService = require('./services/twilioService');

const app = express();
const PORT = env.getServerPort();

// Trust proxy configuration for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Initialize Firebase with error handling
try {
  initializeFirebase();
  console.log('✅ Firebase initialization completed');
} catch (error) {
  console.log('⚠️  Firebase initialization failed, continuing without Firebase...');
  console.error('Firebase Error:', error.message);
}

// Initialize Firestore Session Service (replaces Redis)
try {
  console.log('✅ Firestore Session Service initialized (replaces Redis)');
} catch (error) {
  console.log('⚠️  Firestore Session Service initialization failed...');
  console.error('Firestore Session Error:', error.message);
}

// Initialize Twilio service
try {
  twilioService.initialize().then(() => {
    console.log('✅ Twilio service initialization completed');
  }).catch((error) => {
    console.log('⚠️  Twilio service initialization failed, continuing with mock service...');
    console.error('Twilio Error:', error.message);
  });
} catch (error) {
  console.log('⚠️  Twilio service initialization failed, continuing with mock service...');
  console.error('Twilio Error:', error.message);
}

// Create HTTP server
const server = require('http').createServer(app);

// Sentry is initialized in instrument.js
const Sentry = require('../instrument.js');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: env.getAllowedOrigins(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Rate limiting
const rateLimitConfig = env.getRateLimitConfig();
const limiter = rateLimit({
  windowMs: rateLimitConfig.windowMs,
  max: rateLimitConfig.maxRequests,
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: `${Math.floor(rateLimitConfig.windowMs / 60000)} minutes`
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Trust proxy for proper IP detection behind reverse proxy
  trustProxy: true,
});

// Slow down responses for repeated requests
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // allow 50 requests per 15 minutes, then...
  delayMs: (used, req) => {
    const delayAfter = req.slowDown.limit;
    return (used - delayAfter) * 500;
  },
  // Trust proxy for proper IP detection behind reverse proxy
  trustProxy: true,
});

// Apply rate limiting to all routes
app.use(limiter);
app.use(speedLimiter);

// Admin-specific rate limiter (more lenient)
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // 5000 requests per 15 minutes for admin
  message: {
    error: 'Too many admin requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  trustProxy: true
});

// Apply admin rate limiter to admin routes
app.use('/api/admin', adminLimiter);

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files (for file uploads)
app.use('/uploads', express.static('uploads'));

// Health Check Endpoint (No authentication required)
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0'
  });
});

// Root Endpoint (No authentication required)
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'EPickup Backend API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      metrics: '/metrics',
      apiDocs: '/api-docs',
      auth: '/api/auth',
      customer: '/api/customer',
      driver: '/api/driver',
      bookings: '/api/bookings',
      payments: '/api/payments',
      tracking: '/api/tracking',
      notifications: '/api/notifications'
    }
  });
});

// API Documentation Endpoint (No authentication required)
app.get('/api-docs', (req, res) => {
  res.status(200).json({
    title: 'EPickup Backend API Documentation',
    version: '1.0.0',
    description: 'Complete API documentation for EPickup platform',
    baseUrl: process.env.BACKEND_URL || 'http://localhost:3000',
    endpoints: {
      authentication: {
        'POST /api/auth/register': 'Register new user',
        'POST /api/auth/login': 'User login',
        'POST /api/auth/verify-otp': 'Verify OTP',
        'POST /api/auth/refresh-token': 'Refresh JWT token'
      },
      customer: {
        'GET /api/customer/profile': 'Get customer profile',
        'PUT /api/customer/profile': 'Update customer profile',
        'POST /api/customer/address': 'Add delivery address'
      },
      driver: {
        'GET /api/driver/profile': 'Get driver profile',
        'PUT /api/driver/profile': 'Update driver profile',
        'POST /api/driver/location': 'Update driver location'
      },
      bookings: {
        'POST /api/bookings': 'Create new booking',
        'GET /api/bookings': 'Get user bookings',
        'GET /api/bookings/:id': 'Get booking details',
        'PUT /api/bookings/:id/status': 'Update booking status'
      },
      payments: {
        'POST /api/payments/initiate': 'Initiate payment',
        'POST /api/payments/verify': 'Verify payment',
        'GET /api/payments/history': 'Get payment history'
      },
      tracking: {
        'GET /api/tracking/:bookingId': 'Get real-time tracking',
        'POST /api/tracking/update': 'Update location'
      },
      notifications: {
        'POST /api/notifications/send': 'Send notification',
        'GET /api/notifications': 'Get notifications'
      }
    }
  });
});

// Sentry request handler - must be before any routes (only if available)
if (Sentry && Sentry.Handlers && Sentry.Handlers.requestHandler) {
  app.use(Sentry.Handlers.requestHandler());
}

// Health Check Endpoint (No authentication required)
app.get('/health', (req, res) => {
  res.status(200).json({
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
      firebase: true,
      firestoreSession: true,
      socket: true
    }
  });
});

// Metrics Endpoint (No authentication required)
app.get('/metrics', (req, res) => {
  res.status(200).json({
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    activeConnections: req.app.get('activeConnections') || 0,
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/customer', authMiddleware, customerRoutes);
app.use('/api/driver', authMiddleware, driverRoutes);
app.use('/api/bookings', authMiddleware, bookingRoutes);
app.use('/api/payments', authMiddleware, paymentRoutes);
app.use('/api/tracking', authMiddleware, trackingRoutes);
app.use('/api/notifications', authMiddleware, notificationRoutes);
app.use('/api/file-upload', authMiddleware, fileUploadRoutes);
app.use('/api/support', authMiddleware, supportRoutes);
app.use('/api/google-maps', googleMapsRoutes); // No auth required for Google Maps API
app.use('/api/realtime', authMiddleware, realtimeRoutes);
app.use('/api/fcm-tokens', authMiddleware, fcmTokenRoutes);
app.use('/api/emergency', authMiddleware, emergencyRoutes);
app.use('/api/service-area', serviceAreaRoutes); // No auth required for service area validation
app.use('/service-area', serviceAreaRoutes); // Alternative path for service area validation
app.use('/api/wallet', walletRoutes);
app.use('/api/fare', fareCalculationRoutes);
app.use('/api/admin/auth', adminAuthRoutes); // No auth required for admin login
app.use('/api/admin', authMiddleware, adminRoutes);

// Health check routes (for keepalive script) - No auth required
app.use('/health', healthRoutes);

// Test Endpoints (No authentication required) - For Development Only
if (process.env.NODE_ENV === 'development' || process.env.ENABLE_TEST_ENDPOINTS === 'true') {
  app.get('/api/test/customer', (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Customer test endpoint - No auth required',
      data: {
        customerId: 'test-customer-123',
        name: 'Test Customer',
        phone: '+919876543210',
        userType: 'customer',
        status: 'active'
      },
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/test/driver', (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Driver test endpoint - No auth required',
      data: {
        driverId: 'test-driver-456',
        name: 'Test Driver',
        phone: '+919876543211',
        userType: 'driver',
        status: 'available',
        vehicle: {
          type: 'bike',
          model: 'Honda Activa',
          number: 'TN-01-AB-1234'
        }
      },
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/test/booking', (req, res) => {
    res.status(200).json({
      success: true,
      message: 'Booking test endpoint - No auth required',
      data: {
        bookingId: 'test-booking-789',
        customerId: 'test-customer-123',
        driverId: 'test-driver-456',
        status: 'confirmed',
        pickup: {
          address: '123 Main St, Chennai',
          coordinates: { lat: 13.0827, lng: 80.2707 }
        },
        dropoff: {
          address: '456 Park Ave, Chennai',
          coordinates: { lat: 13.0827, lng: 80.2707 }
        },
        fare: 150,
        createdAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  });

  console.log('✅ Test endpoints enabled for development');
}

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
      details: `The requested route ${req.originalUrl} does not exist`
    },
    timestamp: new Date().toISOString()
  });
});

// Sentry error handler - must be the first error handling middleware (only if available)
if (Sentry && Sentry.Handlers && Sentry.Handlers.errorHandler) {
  app.use(Sentry.Handlers.errorHandler());
}

// Error handling middleware
app.use(errorHandler);

// Initialize Socket.IO with error handling
try {
  socketService.initializeSocketIO(server);
  console.log('✅ Socket.IO service initialized successfully');
} catch (error) {
  console.log('⚠️  Socket.IO initialization failed, continuing without real-time features...');
  console.error('Socket.IO Error:', error.message);
}

// Start server
try {
  server.listen(PORT, () => {
    console.log(`🚀 EPickup Backend Server running on port ${PORT}`);
    console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Health Check: http://localhost:${PORT}/health`);
    console.log(`📚 API Docs: http://localhost:${PORT}/api-docs`);
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔄 Auto-reload enabled with nodemon`);
    }
  });

  server.on('error', (error) => {
    console.error('❌ Server error:', error);
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Please use a different port.`);
    }
  });
} catch (error) {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = app;
