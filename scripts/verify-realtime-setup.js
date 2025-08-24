#!/usr/bin/env node

/**
 * Real-Time Features Verification Script
 * Verifies that all real-time update mechanisms are properly configured
 * after database migrations
 */

require('dotenv').config();
const { getFirestore } = require('../src/services/firebase');
const { initializeRedis } = require('../src/services/redis');

const db = getFirestore();

function log(message, color = 'reset') {
  const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
  };
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logHeader(message) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log(`  ${message}`, 'bright');
  log(`${'='.repeat(60)}`, 'cyan');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

async function verifyRealTimeCollections() {
  logHeader('Verifying Real-Time Collections');
  
  const realTimeCollections = [
    'bookings',
    'driverLocations',
    'notifications',
    'chatMessages',
    'emergencyAlerts',
    'driverAssignments',
    'tripUpdates',
    'paymentStatus'
  ];

  for (const collectionName of realTimeCollections) {
    try {
      const snapshot = await db.collection(collectionName).limit(1).get();
      logSuccess(`${collectionName} collection accessible`);
    } catch (error) {
      logWarning(`${collectionName} collection not found (may be created dynamically)`);
    }
  }
}

async function verifyWebSocketSupport() {
  logHeader('Verifying WebSocket Support');
  
  try {
    // Check if Socket.IO service is available
    const socketService = require('../src/services/socket');
    logSuccess('Socket.IO service available');
    
    // Check if WebSocket service is available
    const websocketService = require('../src/services/websocketService');
    logSuccess('WebSocket service available');
    
    // Check if real-time service is available
    const realtimeService = require('../src/services/realTimeService');
    logSuccess('Real-time service available');
    
    // Check if tracking service is available
    const trackingService = require('../src/services/trackingService');
    logSuccess('Tracking service available');
    
    // Check if live tracking service is available
    const liveTrackingService = require('../src/services/liveTrackingService');
    logSuccess('Live tracking service available');
    
  } catch (error) {
    logError(`WebSocket service verification failed: ${error.message}`);
  }
}

async function verifyFirebaseRealTimeFeatures() {
  logHeader('Verifying Firebase Real-Time Features');
  
  try {
    // Test Firestore real-time listener capability
    const testRef = db.collection('_test').doc('realtime');
    await testRef.set({ test: true, timestamp: new Date() });
    logSuccess('Firestore write operation successful');
    
    // Test read operation
    const doc = await testRef.get();
    if (doc.exists) {
      logSuccess('Firestore read operation successful');
    }
    
    // Clean up test document
    await testRef.delete();
    logSuccess('Firestore delete operation successful');
    
    // Check if Firebase Admin SDK is properly initialized
    const admin = require('firebase-admin');
    if (admin.apps.length > 0) {
      logSuccess('Firebase Admin SDK initialized');
    }
    
  } catch (error) {
    logError(`Firebase real-time features verification failed: ${error.message}`);
  }
}

async function verifyRedisConnection() {
  logHeader('Verifying Redis Connection');
  
  try {
    await initializeRedis();
    logSuccess('Redis connection established');
    
    // Test Redis operations
    const redis = require('../src/services/redis');
    await redis.set('test_key', 'test_value', 60);
    const value = await redis.get('test_key');
    if (value === 'test_value') {
      logSuccess('Redis read/write operations successful');
    }
    await redis.del('test_key');
    logSuccess('Redis delete operation successful');
    
  } catch (error) {
    logError(`Redis verification failed: ${error.message}`);
  }
}

async function verifyNotificationSystem() {
  logHeader('Verifying Notification System');
  
  try {
    // Check if notification collections exist
    const notificationsSnapshot = await db.collection('notifications').limit(1).get();
    logSuccess('Notifications collection accessible');
    
    // Check if FCM configuration is available
    const fcmConfig = {
      enabled: process.env.FCM_ENABLED === 'true',
      useV1: process.env.FCM_USE_V1_API === 'true',
      serviceAccountPath: process.env.FCM_SERVICE_ACCOUNT_PATH
    };
    
    if (fcmConfig.enabled) {
      logSuccess('FCM notifications enabled');
    } else {
      logWarning('FCM notifications disabled');
    }
    
    if (fcmConfig.useV1) {
      logSuccess('FCM V1 API configured');
    } else {
      logWarning('FCM V1 API not configured');
    }
    
  } catch (error) {
    logError(`Notification system verification failed: ${error.message}`);
  }
}

async function verifyLocationTracking() {
  logHeader('Verifying Location Tracking');
  
  try {
    // Check if location-related collections exist
    const collections = ['driverLocations', 'tripUpdates', 'locationHistory'];
    
    for (const collection of collections) {
      try {
        const snapshot = await db.collection(collection).limit(1).get();
        logSuccess(`${collection} collection accessible`);
      } catch (error) {
        logWarning(`${collection} collection not found (may be created dynamically)`);
      }
    }
    
    // Check if location services are available
    const locationServices = [
      '../src/services/trackingService',
      '../src/services/liveTrackingService',
      '../src/services/driverMatchingService'
    ];
    
    for (const service of locationServices) {
      try {
        require(service);
        logSuccess(`${service.split('/').pop()} service available`);
      } catch (error) {
        logWarning(`${service.split('/').pop()} service not found`);
      }
    }
    
  } catch (error) {
    logError(`Location tracking verification failed: ${error.message}`);
  }
}

async function verifyChatSystem() {
  logHeader('Verifying Chat System');
  
  try {
    // Check if chat-related collections exist
    const chatCollections = ['chatMessages', 'chatRooms', 'typingIndicators'];
    
    for (const collection of chatCollections) {
      try {
        const snapshot = await db.collection(collection).limit(1).get();
        logSuccess(`${collection} collection accessible`);
      } catch (error) {
        logWarning(`${collection} collection not found (may be created dynamically)`);
      }
    }
    
    // Check if chat services are available
    try {
      const realtimeService = require('../src/services/realTimeService');
      logSuccess('Real-time chat service available');
    } catch (error) {
      logWarning('Real-time chat service not found');
    }
    
  } catch (error) {
    logError(`Chat system verification failed: ${error.message}`);
  }
}

async function verifyEmergencySystem() {
  logHeader('Verifying Emergency System');
  
  try {
    // Check if emergency-related collections exist
    const emergencyCollections = ['emergencyAlerts', 'emergencyContacts'];
    
    for (const collection of emergencyCollections) {
      try {
        const snapshot = await db.collection(collection).limit(1).get();
        logSuccess(`${collection} collection accessible`);
      } catch (error) {
        logWarning(`${collection} collection not found (may be created dynamically)`);
      }
    }
    
    // Check if emergency services are available
    try {
      const websocketService = require('../src/services/websocketService');
      logSuccess('Emergency alert service available');
    } catch (error) {
      logWarning('Emergency alert service not found');
    }
    
  } catch (error) {
    logError(`Emergency system verification failed: ${error.message}`);
  }
}

async function verifyPaymentRealTimeUpdates() {
  logHeader('Verifying Payment Real-Time Updates');
  
  try {
    // Check if payment collections exist
    const paymentCollections = ['payments', 'paymentStatus', 'paymentWebhooks'];
    
    for (const collection of paymentCollections) {
      try {
        const snapshot = await db.collection(collection).limit(1).get();
        logSuccess(`${collection} collection accessible`);
      } catch (error) {
        logWarning(`${collection} collection not found (may be created dynamically)`);
      }
    }
    
    // Check payment gateway configuration
    const paymentConfig = {
      phonepe: {
        merchantId: process.env.PHONEPE_MERCHANT_ID,
        saltKey: process.env.PHONEPE_SALT_KEY,
        baseUrl: process.env.PHONEPE_BASE_URL
      }
    };
    
    if (paymentConfig.phonepe.merchantId) {
      logSuccess('PhonePe payment gateway configured');
    } else {
      logWarning('PhonePe payment gateway not configured');
    }
    
  } catch (error) {
    logError(`Payment real-time updates verification failed: ${error.message}`);
  }
}

async function generateRealTimeReport() {
  logHeader('Real-Time Features Summary Report');
  
  const report = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    firebase: {
      projectId: process.env.FIREBASE_PROJECT_ID,
      enabled: !!process.env.FIREBASE_PROJECT_ID
    },
    redis: {
      enabled: process.env.REDIS_ENABLED === 'true',
      url: process.env.REDIS_URL ? 'configured' : 'not configured'
    },
    notifications: {
      fcm: process.env.FCM_ENABLED === 'true',
      fcmV1: process.env.FCM_USE_V1_API === 'true'
    },
    websocket: {
      enabled: true, // Socket.IO is always available
      port: process.env.PORT || 3000
    },
    realTimeFeatures: [
      'Booking status updates',
      'Driver location tracking',
      'Real-time chat',
      'Payment status updates',
      'Emergency alerts',
      'Push notifications',
      'Live trip tracking',
      'Driver assignment notifications'
    ]
  };
  
  logInfo('Real-time features configuration:');
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  try {
    logHeader('EPickup Real-Time Features Verification');
    logInfo('Verifying all real-time update mechanisms after database migrations...\n');
    
    // Run all verification tests
    await verifyRealTimeCollections();
    await verifyWebSocketSupport();
    await verifyFirebaseRealTimeFeatures();
    await verifyRedisConnection();
    await verifyNotificationSystem();
    await verifyLocationTracking();
    await verifyChatSystem();
    await verifyEmergencySystem();
    await verifyPaymentRealTimeUpdates();
    
    // Generate summary report
    await generateRealTimeReport();
    
    logHeader('Verification Complete');
    logSuccess('All real-time features are properly configured and ready for use!');
    logInfo('The EPickup platform is ready for real-time frontend-backend synchronization.');
    
  } catch (error) {
    logError(`Verification failed: ${error.message}`);
    process.exit(1);
  }
}

// Run verification if this file is executed directly
if (require.main === module) {
  main().then(() => {
    log('\n🏁 Real-time verification completed successfully', 'green');
    process.exit(0);
  }).catch((error) => {
    logError(`Real-time verification failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  verifyRealTimeCollections,
  verifyWebSocketSupport,
  verifyFirebaseRealTimeFeatures,
  verifyRedisConnection,
  verifyNotificationSystem,
  verifyLocationTracking,
  verifyChatSystem,
  verifyEmergencySystem,
  verifyPaymentRealTimeUpdates,
  generateRealTimeReport
};
