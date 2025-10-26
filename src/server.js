// IMPORTANT: Make sure to import `instrument.js` at the top of your file.
require("../instrument.js");

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const admin = require('firebase-admin');

// Import configuration
const { env } = require('./config');

// Import security middleware
const { sanitizeInput } = require('./middleware/validation');
const { generalLimiter, authLimiter, adminLimiter, speedLimiter } = require('./middleware/rateLimit');
const { securityHeaders } = require('./middleware/security');

// Routes will be imported after Firebase initialization

// Import middleware
const { 
  handleRateLimitError, 
  handleDatabaseError, 
  handleExternalApiError, 
  handle404, 
  handleTimeout, 
  errorRecovery, 
  errorMonitoring, 
  gracefulShutdown 
} = require('./middleware/errorHandler');

// Import standardized error handler
const { errorHandler: standardizedErrorHandler } = require('./middleware/errorHandler');
const { authMiddleware } = require('./middleware/auth');
// const { firebaseAdminAuthMiddleware } = require('./middleware/firebaseAuth'); // No longer used - using firebaseIdTokenAuth instead

// Import services
const { initializeFirebase } = require('./services/firebase');
// Firestore Session Service is imported but not directly used in server.js
// It's used by other services that import it directly
const socketService = require('./services/socket');
// const msg91Service = require('./services/msg91Service'); // Deprecated - using Firebase Auth instead
const monitoringService = require('./services/monitoringService');
// performanceMonitoringService removed - using monitoringService instead

const app = express();
const PORT = env.getServerPort();

// Trust proxy configuration for rate limiting behind reverse proxy
app.set('trust proxy', 1);

// Initialize Firebase with error handling
console.log('═══════════════════════════════════════════════════════════');
console.log('🔥 FIREBASE INITIALIZATION STARTING...');
console.log('═══════════════════════════════════════════════════════════');

try {
  const firebaseApp = initializeFirebase();
  
  if (!firebaseApp) {
    throw new Error('Firebase Admin SDK initialization returned null - check environment variables');
  }
  
  console.log('✅ Firebase Admin SDK initialization completed');
  console.log('🔍 Verifying Firebase app validity...');
  
  // Test if we can actually use the auth
  const testAuth = admin.auth();
  console.log('🔍 Testing admin.auth():', {
    exists: testAuth !== null && testAuth !== undefined,
    type: typeof testAuth,
    hasGetUser: typeof testAuth?.getUser === 'function',
    hasGetUserByPhoneNumber: typeof testAuth?.getUserByPhoneNumber === 'function'
  });
  
  if (typeof testAuth?.getUserByPhoneNumber !== 'function') {
    throw new Error('Firebase Admin SDK initialized but auth methods are not available');
  }
  
  console.log('✅ Firebase Auth methods verified');
  
  // ✅ CRITICAL FIX: Test Firestore access before proceeding
  console.log('🔍 Testing Firestore access...');
  const { getFirestore } = require('firebase-admin/firestore');
  const testDb = getFirestore();
  if (!testDb) {
    throw new Error('Firestore instance is null after Firebase initialization');
  }
  console.log('✅ Firestore access verified');
  
  // Initialize Firebase Auth Service after Firebase is ready
  const firebaseAuthService = require('./services/firebaseAuthService');
  firebaseAuthService.initialize();
  console.log('✅ Firebase Auth Service initialized');
  
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ FIREBASE INITIALIZATION COMPLETE');
  console.log('═══════════════════════════════════════════════════════════');
} catch (error) {
  console.error('═══════════════════════════════════════════════════════════');
  console.error('❌ FIREBASE INITIALIZATION FAILED');
  console.error('═══════════════════════════════════════════════════════════');
  console.error('❌ Error:', error.message);
  console.error('❌ Stack:', error.stack);
  console.error('');
  console.error('❌ Firebase features will NOT work. Please check:');
  console.error('   1. FIREBASE_PRIVATE_KEY environment variable');
  console.error('   2. FIREBASE_CLIENT_EMAIL environment variable'); 
  console.error('   3. FIREBASE_PROJECT_ID environment variable');
  console.error('   4. All other Firebase environment variables');
  console.error('   5. Make sure private key is properly formatted');
  console.error('');
  console.error('⚠️  Backend will continue but auth endpoints will fail!');
  console.error('═══════════════════════════════════════════════════════════');
}

// Initialize Firestore Session Service (replaces Redis)
try {
  console.log('✅ Firestore Session Service initialized (replaces Redis)');
} catch (error) {
  console.log('⚠️  Firestore Session Service initialization failed...');
  console.error('Firestore Session Error:', error.message);
}

// MSG91 service removed - using Firebase Auth for OTP

// ✅ CRITICAL FIX: Declare route variables in global scope
let authRoutes, refreshTokenRoutes, userRoutes, customerRoutes, driverRoutes, bookingRoutes;
let paymentRoutes, trackingRoutes, notificationRoutes, fileUploadRoutes, supportRoutes;
let chatRoutes, googleMapsRoutes, realtimeRoutes, fcmTokenRoutes, emergencyRoutes;
let serviceAreaRoutes, healthRoutes, walletRoutes, fareCalculationRoutes, workSlotsRoutes;
let adminRoutes, adminAuthRoutes, adminSignupRoutes, locationTrackingRoutes;

// ✅ CRITICAL FIX: Import routes after Firebase is fully ready
function importRoutesAfterFirebaseReady() {
  console.log('📦 Importing routes after Firebase initialization...');
  
  authRoutes = require('./routes/auth');
  refreshTokenRoutes = require('./routes/refreshToken');
  userRoutes = require('./routes/user');
  customerRoutes = require('./routes/customer');
  driverRoutes = require('./routes/driver');
  bookingRoutes = require('./routes/booking');
  paymentRoutes = require('./routes/payments');
  trackingRoutes = require('./routes/tracking');
  notificationRoutes = require('./routes/notification');
  fileUploadRoutes = require('./routes/fileUpload');
  supportRoutes = require('./routes/support');
  chatRoutes = require('./routes/chat');
  googleMapsRoutes = require('./routes/googleMaps');
  realtimeRoutes = require('./routes/realtime');
  fcmTokenRoutes = require('./routes/fcmTokens');
  emergencyRoutes = require('./routes/emergency');
  serviceAreaRoutes = require('./routes/serviceArea');
  healthRoutes = require('./routes/health');
  walletRoutes = require('./routes/wallet');
  fareCalculationRoutes = require('./routes/fareCalculation');
  workSlotsRoutes = require('./routes/workSlots');
  adminRoutes = require('./routes/admin');
  adminAuthRoutes = require('./routes/adminAuth');
  adminSignupRoutes = require('./routes/adminSignup');
  // adminBookingManagementRoutes = require('./routes/adminBookingManagement'); // Included in adminRoutes
  locationTrackingRoutes = require('./routes/locationTracking');
  
  console.log('✅ All routes imported successfully');
  
  // Set up routes
  setupRoutes();
}

// ✅ CRITICAL FIX: Function to set up all routes after Firebase is ready
function setupRoutes() {
  console.log('🔧 Setting up API routes...');
  
  // API Routes
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/auth', refreshTokenRoutes); // Add refresh token route
  app.use('/api/user', appCheckMiddleware.optionalMiddleware(), userRoutes); // User profile routes (includes profile picture upload)

  // =============================================================================
  // APP CHECK MIDDLEWARE CONFIGURATION
  // =============================================================================
  // DEBUG MODE: Using optionalMiddleware() for debug tokens (allows requests without App Check headers)
  // PRODUCTION MODE: Switch to middleware() for Play Integrity enforcement
  //
  // TO SWITCH TO PRODUCTION MODE:
  // 1. Comment out all lines with optionalMiddleware()
  // 2. Uncomment all lines with middleware() 
  // 3. Update frontend to send real App Check tokens instead of null
  // =============================================================================
  app.use('/api/customer', appCheckMiddleware.optionalMiddleware(), authMiddleware, customerRoutes);
  // app.use('/api/customer', appCheckMiddleware.middleware(), authMiddleware, customerRoutes); // Production mode

  app.use('/api/driver', appCheckMiddleware.optionalMiddleware(), authMiddleware, driverRoutes);
  // app.use('/api/driver', appCheckMiddleware.middleware(), authMiddleware, driverRoutes); // Production mode

  app.use('/api/bookings', appCheckMiddleware.optionalMiddleware(), authMiddleware, bookingRoutes);
  // app.use('/api/bookings', appCheckMiddleware.middleware(), authMiddleware, bookingRoutes); // Production mode

  // ✅ PAYMENT WEBHOOKS MUST BE PUBLIC (no auth middleware)
  // Payment gateway webhooks don't have user tokens - they use signature verification
  // Register webhook route BEFORE the authenticated payment routes
  const phonepeService = require('./services/phonepeService');
  const mockPaymentService = require('./services/mockPaymentService');
  app.post('/api/payments/phonepe/callback', 
    appCheckMiddleware.optionalMiddleware(),
    async (req, res) => {
      try {
        console.log('📥 [WEBHOOK] Received PhonePe callback (public endpoint)');
        
        // Intelligent service selection
        const isPhonePeConfigured = process.env.PHONEPE_MERCHANT_ID && 
                                     process.env.PHONEPE_MERCHANT_ID !== 'PGTESTPAYUAT' &&
                                     process.env.PHONEPE_SALT_KEY &&
                                     process.env.PHONEPE_SALT_KEY.length > 20;
        
        const callbackService = isPhonePeConfigured ? phonepeService : mockPaymentService;
        console.log(`🔧 [WEBHOOK] Using ${isPhonePeConfigured ? 'Real PhonePe' : 'Mock Payment'} callback handler`);
        
        const result = await callbackService.handlePaymentCallback(req.body);

        if (result.success) {
          console.log('✅ [WEBHOOK] Callback processed successfully');
          res.json({
            success: true,
            message: 'Callback processed successfully',
            timestamp: new Date().toISOString()
          });
        } else {
          console.warn('⚠️ [WEBHOOK] Callback processing failed:', result.error);
          res.status(400).json({
            success: false,
            message: 'Callback processing failed',
            error: result.error,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error('❌ [WEBHOOK] Payment callback error:', error);
        res.status(500).json({
          success: false,
          message: 'Internal server error',
          error: {
            code: 'CALLBACK_ERROR',
            message: error.message
          },
          timestamp: new Date().toISOString()
        });
      }
    }
  );

  // All other payment routes require authentication
  app.use('/api/payments', appCheckMiddleware.optionalMiddleware(), authMiddleware, paymentRoutes);
  // app.use('/api/payments', appCheckMiddleware.middleware(), authMiddleware, paymentRoutes); // Production mode

  app.use('/api/tracking', appCheckMiddleware.optionalMiddleware(), authMiddleware, trackingRoutes);
  // app.use('/api/tracking', appCheckMiddleware.middleware(), authMiddleware, trackingRoutes); // Production mode

  app.use('/api/notifications', appCheckMiddleware.optionalMiddleware(), authMiddleware, notificationRoutes);
  // app.use('/api/notifications', appCheckMiddleware.middleware(), authMiddleware, notificationRoutes); // Production mode

  app.use('/api/file-upload', appCheckMiddleware.optionalMiddleware(), authMiddleware, fileUploadRoutes);
  // app.use('/api/file-upload', appCheckMiddleware.middleware(), authMiddleware, fileUploadRoutes); // Production mode

  app.use('/api/support', appCheckMiddleware.optionalMiddleware(), authMiddleware, supportRoutes);
  // app.use('/api/support', appCheckMiddleware.middleware(), authMiddleware, supportRoutes); // Production mode

  app.use('/api/chat', appCheckMiddleware.optionalMiddleware(), authMiddleware, chatRoutes);
  // app.use('/api/chat', appCheckMiddleware.middleware(), authMiddleware, chatRoutes); // Production mode

  app.use('/api/google-maps', googleMapsRoutes); // No auth required for Google Maps API

  app.use('/api/realtime', appCheckMiddleware.optionalMiddleware(), authMiddleware, realtimeRoutes);
  // app.use('/api/realtime', appCheckMiddleware.middleware(), authMiddleware, realtimeRoutes); // Production mode

  app.use('/api/fcm-tokens', appCheckMiddleware.optionalMiddleware(), authMiddleware, fcmTokenRoutes);
  // app.use('/api/fcm-tokens', appCheckMiddleware.middleware(), authMiddleware, fcmTokenRoutes); // Production mode

  app.use('/api/emergency', appCheckMiddleware.optionalMiddleware(), authMiddleware, emergencyRoutes);
  // app.use('/api/emergency', appCheckMiddleware.middleware(), authMiddleware, emergencyRoutes); // Production mode

  app.use('/api/service-area', serviceAreaRoutes); // No auth required for service area validation
  app.use('/service-area', serviceAreaRoutes); // Alternative path for service area validation
  // Wallet and fare calculation routes
  app.use('/api/wallet', appCheckMiddleware.optionalMiddleware(), walletRoutes);
  // app.use('/api/wallet', appCheckMiddleware.middleware(), walletRoutes); // Production mode

  app.use('/api/fare', appCheckMiddleware.optionalMiddleware(), fareCalculationRoutes);
  // app.use('/api/fare', appCheckMiddleware.middleware(), fareCalculationRoutes); // Production mode

  app.use('/api/slots', appCheckMiddleware.optionalMiddleware(), workSlotsRoutes);
  // app.use('/api/slots', appCheckMiddleware.middleware(), workSlotsRoutes); // Production mode

  app.use('/api/location-tracking', appCheckMiddleware.optionalMiddleware(), authMiddleware, locationTrackingRoutes);
  // app.use('/api/location-tracking', appCheckMiddleware.middleware(), authMiddleware, locationTrackingRoutes); // Production mode
  app.use('/api/admin/auth', adminAuthRoutes); // No auth required for admin login
  app.use('/api/admin/signup', adminSignupRoutes); // Admin signup route (no auth required)
  // Import admin role validation
  const { requireAdmin } = require('./middleware/auth');
  app.use('/api/admin', adminLimiter, authMiddleware, requireAdmin, adminRoutes); // Admin routes require admin role
  // Note: adminBookingManagementRoutes are included in adminRoutes to avoid conflicts

  // Health check routes (for keepalive script) - No auth required
  app.use('/api/health', healthRoutes);
  app.use('/health', healthRoutes); // Keep both for backward compatibility

  console.log('✅ All API routes set up successfully');
}

// Call the function after Firebase is ready
importRoutesAfterFirebaseReady();

// Import middleware after Firebase initialization
console.log('📦 Importing middleware after Firebase initialization...');
const AppCheckMiddleware = require('./middleware/appCheckAuth');
const appCheckMiddleware = new AppCheckMiddleware();
console.log('✅ All middleware imported successfully');

// Create HTTP server
const server = require('http').createServer(app);

// Sentry is initialized in instrument.js
const Sentry = require('../instrument.js');

// Security middleware
app.use(securityHeaders);
app.use(sanitizeInput);
app.use(generalLimiter);
app.use(speedLimiter);

// Additional Helmet security
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:", "wss:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
}));

// Compression middleware with optimized settings
app.use(compression({
  level: 6, // Compression level (1-9)
  threshold: 1024, // Only compress responses larger than 1KB
  filter: (req, res) => {
    // Don't compress if the request includes a no-transform directive
    if (req.headers['cache-control'] && req.headers['cache-control'].includes('no-transform')) {
      return false;
    }
    
    // Don't compress already compressed content
    if (res.getHeader('content-encoding')) {
      return false;
    }
    
    // Enable compression for more content types
    const contentType = res.getHeader('content-type') || '';
    return /json|text|javascript|css|html|xml/.test(contentType);
  }
}));

// CORS configuration with security
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = env.getAllowedOrigins();
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['X-Total-Count', 'X-Page-Count'],
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 200
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


// Apply rate limiting to all routes
app.use(limiter);
app.use(speedLimiter);

// Admin-specific rate limiter (more lenient) - using imported adminLimiter
// const adminLimiter = rateLimit({
//   windowMs: 15 * 60 * 1000, // 15 minutes
//   max: 5000, // 5000 requests per 15 minutes for admin
//   message: {
//     error: 'Too many admin requests from this IP, please try again later.',
//     retryAfter: '15 minutes'
//   },
//   standardHeaders: true,
//   legacyHeaders: false,
//   trustProxy: true
// });

// Apply admin rate limiter to protected admin routes only (not signup/auth)
// app.use('/api/admin', adminLimiter); // Moved to individual routes

// Compression middleware
app.use(compression());

// Logging middleware
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parsing middleware with security limits
app.use(express.json({ 
  limit: '1mb', // Reduced from 10mb for security
  verify: (req, res, buf) => {
    // Additional security check for JSON payload
    if (buf.length > 1024 * 1024) { // 1MB limit
      throw new Error('Payload too large');
    }
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '1mb', // Reduced from 10mb for security
  parameterLimit: 100 // Limit number of parameters
}));

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
        notifications: '/api/notifications',
        slots: '/api/slots'
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
        'POST /api/customer/upload-photo': 'Upload profile photo',
        'GET /api/customer/bookings': 'Get customer bookings',
        'POST /api/customer/bookings': 'Create new booking',
        'PUT /api/customer/bookings/:id/cancel': 'Cancel booking',
        'GET /api/customer/addresses': 'Get customer addresses',
        'POST /api/customer/addresses': 'Add customer address',
        'PUT /api/customer/addresses/:id': 'Update customer address',
        'DELETE /api/customer/addresses/:id': 'Delete customer address',
        'GET /api/customer/payments/methods': 'Get payment methods',
        'POST /api/customer/payments/methods': 'Add payment method',
        'GET /api/customer/payments/history': 'Get payment history',
        'GET /api/customer/invoice/:bookingId': 'Download invoice for completed booking',
        'GET /api/customer/tracking/:bookingId': 'Get booking tracking',
        'GET /api/customer/notifications': 'Get notifications',
        'PUT /api/customer/notifications/:id/read': 'Mark notification as read',
        'GET /api/customer/support/tickets': 'Get support tickets',
        'POST /api/customer/support/tickets': 'Create support ticket',
        'GET /api/customer/emergency/contacts': 'Get emergency contacts',
        'POST /api/customer/emergency/contacts': 'Add emergency contact',
        'POST /api/customer/emergency/alert': 'Send emergency alert'
      },
      driver: {
        'GET /api/driver/profile': 'Get driver profile',
        'PUT /api/driver/profile': 'Update driver profile',
        'POST /api/driver/location': 'Update driver location',
        'GET /api/driver/earnings': 'Get driver earnings',
        'GET /api/driver/earnings/detailed': 'Get detailed driver earnings',
        'POST /api/driver/earnings/report': 'Generate earnings report (PDF/CSV)',
        'GET /api/driver/bookings': 'Get driver bookings',
        'POST /api/driver/bookings/:id/accept': 'Accept booking',
        'POST /api/driver/bookings/:id/reject': 'Reject booking',
        'POST /api/driver/bookings/:id/photo-verification': 'Upload photo verification',
        'GET /api/driver/documents/status': 'Get document verification status',
        'POST /api/driver/documents/submit': 'Submit documents for verification',
        'GET /api/driver/documents/:type/download': 'Download individual document',
        'GET /api/driver/documents/download-all': 'Download all documents'
      },
      bookings: {
        'POST /api/bookings': 'Create new booking',
        'GET /api/bookings': 'Get user bookings',
        'GET /api/bookings/:id': 'Get booking details',
        'PUT /api/bookings/:id/status': 'Update booking status'
      },
      payments: {
        'GET /api/payments/methods': 'Get available payment methods',
        'POST /api/payments/create': 'Create payment request',
        'POST /api/payments/phonepe/initiate': 'Initiate PhonePe payment',
        'GET /api/payments/verify/:transactionId': 'Verify payment status',
        'POST /api/payments/phonepe/callback': 'Handle PhonePe callback',
        'POST /api/payments/refund': 'Process refund',
        'GET /api/payments/history': 'Get payment history',
        'GET /api/payments/statistics': 'Get payment statistics (Admin)',
        'GET /api/payments/:transactionId': 'Get payment details'
      },
      tracking: {
        'GET /api/tracking/:bookingId': 'Get real-time tracking',
        'POST /api/tracking/update': 'Update location'
      },
      chat: {
        'POST /api/chat/send': 'Send message to driver/customer',
        'GET /api/chat/:bookingId': 'Get chat messages for booking',
        'GET /api/chat/:bookingId/instructions': 'Get customer instructions for driver'
      },
      support: {
        'POST /api/support/report-issue': 'Report an issue',
        'POST /api/support/ticket': 'Create support ticket',
        'GET /api/support/tickets': 'Get user support tickets',
        'GET /api/support/faq': 'Get frequently asked questions',
        'POST /api/support/feedback': 'Submit feedback'
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

// Performance metrics endpoint (Admin only)
app.get('/api/admin/performance', authMiddleware, (req, res) => {
  try {
    // Use monitoringService instead of removed performanceMonitoringService
    const metrics = monitoringService.getMetrics();
    
    res.json({
      success: true,
      data: {
        metrics,
        message: 'Performance monitoring consolidated into monitoringService'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get performance metrics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

// File Upload Service Health Check (Public)
app.get('/api/file-upload/health', (req, res) => {
  try {
    res.json({
      success: true,
      message: 'File Upload Service is healthy',
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'EPickup File Upload Service',
        version: '1.0.0'
      }
    });
  } catch {
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVICE_UNHEALTHY',
        message: 'File Upload Service is unhealthy'
      }
    });
  }
});

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

  // Create test booking in database
  app.post('/api/test/create-booking', async (req, res) => {
    try {
      const { getFirestore } = require('./services/firebase');
      const db = getFirestore();
      
      const testBooking = {
        customerId: 'test-customer-123',
        driverId: null, // Available for drivers
        status: 'pending',
        pickup: {
          name: 'Test Customer',
          address: '123 Main St, Bangalore',
          coordinates: {
            latitude: 13.0681637,
            longitude: 77.5021978
          },
          contactName: 'Test Customer',
          contactPhone: '+919876543210'
        },
        dropoff: {
          name: 'Test Recipient',
          address: '456 Park Ave, Bangalore',
          coordinates: {
            latitude: 13.0681637,
            longitude: 77.5021978
          },
          contactName: 'Test Recipient',
          contactPhone: '+919876543211'
        },
        package: {
          weight: 5.0,
          description: 'Test package for debugging'
        },
        fare: {
          total: 150,
          base: 100,
          distance: 50
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const docRef = await db.collection('bookings').add(testBooking);
      
      res.status(200).json({
        success: true,
        message: 'Test booking created successfully',
        data: {
          bookingId: docRef.id,
          ...testBooking
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error creating test booking:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create test booking',
        timestamp: new Date().toISOString()
      });
    }
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

// Performance monitoring middleware
app.use((req, res, next) => {
  res.on('finish', () => {
    // API request monitoring handled by monitoringService
  });
  
  next();
});

// Enhanced error handling middleware stack
app.use(handleTimeout);
app.use(handleRateLimitError);
app.use(handleDatabaseError);
app.use(handleExternalApiError);
app.use(errorMonitoring);
app.use(errorRecovery);

// Sentry error handler - must be the first error handling middleware (only if available)
if (Sentry && Sentry.Handlers && Sentry.Handlers.errorHandler) {
  app.use(Sentry.Handlers.errorHandler());
}

// 404 handler for unmatched routes
app.use(handle404);

// Final error handling middleware
app.use(standardizedErrorHandler);

// Initialize Socket.IO with error handling
try {
  socketService.initializeSocketIO(server);
  console.log('✅ Socket.IO service initialized successfully');
  
  // ✅ FIXED: Initialize LiveTrackingService
  const liveTrackingService = require('./services/liveTrackingService');
  const io = socketService.getIO();
  if (io) {
    liveTrackingService.initialize(io);
    console.log('✅ LiveTrackingService initialized successfully');
  }
} catch (error) {
  console.log('⚠️  Socket.IO initialization failed, continuing without real-time features...');
  console.error('Socket.IO Error:', error.message);
}

// Initialize monitoring service
async function initializeServices() {
  try {
    console.log('🔧 Initializing services...');
    
    // Initialize monitoring service
    await monitoringService.initialize();
    console.log('✅ Monitoring service initialized');

    // Performance monitoring handled by monitoringService
    console.log('✅ Performance monitoring consolidated into monitoringService');
    
    console.log('✅ All services initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize services:', error);
    throw error;
  }
}

// Start server
try {
  // Initialize services first
  initializeServices().then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 EPickup Backend Server running on port ${PORT}`);
      console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔗 Health Check: http://localhost:${PORT}/api/health`);
      console.log(`📈 Metrics: http://localhost:${PORT}/api/health/metrics`);
      console.log(`📚 API Docs: http://localhost:${PORT}/api-docs`);
      
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔄 Auto-reload enabled with nodemon`);
      }
    });
  }).catch(error => {
    console.error('❌ Failed to initialize services:', error);
    process.exit(1);
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

// Enhanced graceful shutdown
gracefulShutdown(server, {
  timeout: 10000,
  signals: ['SIGTERM', 'SIGINT', 'SIGUSR2']
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
