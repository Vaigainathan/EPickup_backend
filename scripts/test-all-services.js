#!/usr/bin/env node

/**
 * Comprehensive Service Testing Script
 * Tests all backend services and their integration with the new configuration system
 */

const path = require('path');
const fs = require('fs');

// Add the src directory to the path so we can import our modules
const srcPath = path.join(__dirname, '..', 'src');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('🧪 EPickup Backend - Comprehensive Service Testing');
console.log('==================================================\n');

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  total: 0
};

function logTestResult(testName, passed, details = '') {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ ${testName}: PASSED`);
    if (details) console.log(`   ${details}`);
  } else {
    testResults.failed++;
    console.error(`❌ ${testName}: FAILED`);
    if (details) console.error(`   ${details}`);
  }
}

// Test 1: Environment Configuration
async function testEnvironmentConfiguration() {
  console.log('1️⃣  Testing Environment Configuration...\n');
  
  try {
    const { env } = require(path.join(srcPath, 'config'));
    
    // Test configuration loading
    const config = env.getAll();
    if (config && Object.keys(config).length > 0) {
      logTestResult('Configuration Loading', true, `Loaded ${Object.keys(config).length} configuration categories`);
    } else {
      logTestResult('Configuration Loading', false, 'No configuration loaded');
      return;
    }
    
    // Test Firebase configuration
    const firebaseConfig = env.get('firebase');
    if (firebaseConfig.projectId && firebaseConfig.privateKey && firebaseConfig.clientEmail) {
      logTestResult('Firebase Configuration', true, `Project: ${firebaseConfig.projectId}`);
    } else {
      logTestResult('Firebase Configuration', false, 'Missing required Firebase credentials');
    }
    
    // Test Redis configuration
    const redisConfig = env.get('redis');
    if (redisConfig.enabled && redisConfig.url) {
      logTestResult('Redis Configuration', true, `URL: ${redisConfig.url.substring(0, 30)}...`);
    } else if (!redisConfig.enabled) {
      logTestResult('Redis Configuration', true, 'Redis is disabled (optional)');
    } else {
      logTestResult('Redis Configuration', false, 'Redis enabled but no URL provided');
    }
    
    // Test JWT configuration
    const jwtConfig = env.get('jwt');
    if (jwtConfig.secret) {
      logTestResult('JWT Configuration', true, `Secret: ${jwtConfig.secret.substring(0, 10)}...`);
    } else {
      logTestResult('JWT Configuration', false, 'Missing JWT secret');
    }
    
    // Test Google Maps configuration
    const googleMapsConfig = env.get('googleMaps');
    if (googleMapsConfig.apiKey) {
      logTestResult('Google Maps Configuration', true, `API Key: ${googleMapsConfig.apiKey.substring(0, 10)}...`);
    } else {
      logTestResult('Google Maps Configuration', false, 'Missing Google Maps API key');
    }
    
    // Test notification configuration
    const notificationConfig = env.get('notifications');
    if (notificationConfig.pushEnabled !== undefined) {
      logTestResult('Notification Configuration', true, `Push: ${notificationConfig.pushEnabled}, FCM V1: ${notificationConfig.fcmUseV1Api}`);
    } else {
      logTestResult('Notification Configuration', false, 'Missing notification configuration');
    }
    
  } catch (error) {
    logTestResult('Environment Configuration', false, error.message);
  }
  
  console.log('');
}

// Test 2: Firebase Service
async function testFirebaseService() {
  console.log('2️⃣  Testing Firebase Service...\n');
  
  try {
    const { initializeFirebase, getFirestore, getAuth, getStorage, getMessagingInstance } = require(path.join(srcPath, 'services', 'firebase'));
    
    // Test initialization
    initializeFirebase();
    logTestResult('Firebase Initialization', true, 'Firebase Admin SDK initialized');
    
    // Test Firestore
    try {
      const db = getFirestore();
      logTestResult('Firestore Access', true, 'Firestore instance retrieved');
      
      // Test basic Firestore operations
      const testCollection = db.collection('_test_service');
      await testCollection.doc('test').set({ test: true, timestamp: new Date() });
      logTestResult('Firestore Write', true, 'Document written successfully');
      
      const testDoc = await testCollection.doc('test').get();
      if (testDoc.exists) {
        logTestResult('Firestore Read', true, 'Document read successfully');
      } else {
        logTestResult('Firestore Read', false, 'Document not found after write');
      }
      
      // Cleanup
      await testCollection.doc('test').delete();
      logTestResult('Firestore Delete', true, 'Test document cleaned up');
      
    } catch (error) {
      logTestResult('Firestore Operations', false, error.message);
    }
    
    // Test Auth
    try {
      const auth = getAuth();
      logTestResult('Firebase Auth', true, 'Auth instance retrieved');
    } catch (error) {
      logTestResult('Firebase Auth', false, error.message);
    }
    
    // Test Storage
    try {
      const storage = getStorage();
      logTestResult('Firebase Storage', true, 'Storage instance retrieved');
    } catch (error) {
      logTestResult('Firebase Storage', false, error.message);
    }
    
    // Test Messaging
    try {
      const messaging = getMessagingInstance();
      logTestResult('Firebase Messaging', true, 'Messaging instance retrieved');
    } catch (error) {
      logTestResult('Firebase Messaging', false, error.message);
    }
    
  } catch (error) {
    logTestResult('Firebase Service', false, error.message);
  }
  
  console.log('');
}

// Test 3: Redis Service
async function testRedisService() {
  console.log('3️⃣  Testing Redis Service...\n');
  
  try {
    const { env } = require(path.join(srcPath, 'config'));
    
    if (!env.isRedisEnabled()) {
      logTestResult('Redis Service', true, 'Redis is disabled in configuration (skipping tests)');
      console.log('');
      return;
    }
    
    const { initializeRedis, getRedisClient, set, get, del } = require(path.join(srcPath, 'services', 'redis'));
    
    // Test initialization
    try {
      await initializeRedis();
      logTestResult('Redis Initialization', true, 'Redis connection initialized');
      
      // Wait a bit for connection
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const redisClient = getRedisClient();
      if (redisClient && redisClient.isReady) {
        logTestResult('Redis Connection', true, 'Redis client is ready');
        
        // Test basic operations
        const testKey = 'test_service_key';
        const testValue = { test: true, timestamp: Date.now() };
        
        // Test set
        const setResult = await set(testKey, JSON.stringify(testValue), 60);
        if (setResult) {
          logTestResult('Redis Set', true, 'Key-value set successfully');
        } else {
          logTestResult('Redis Set', false, 'Failed to set key-value');
        }
        
        // Test get
        const retrievedValue = await get(testKey);
        let parsedValue;
        try {
          parsedValue = typeof retrievedValue === 'string' ? JSON.parse(retrievedValue) : retrievedValue;
          if (parsedValue && parsedValue.test) {
            logTestResult('Redis Get', true, 'Value retrieved successfully');
          } else {
            logTestResult('Redis Get', false, 'Failed to retrieve value');
          }
        } catch (parseError) {
          logTestResult('Redis Get', false, `JSON parse error: ${parseError.message}`);
        }
        
        // Test delete
        const delResult = await del(testKey);
        if (delResult) {
          logTestResult('Redis Delete', true, 'Key deleted successfully');
        } else {
          logTestResult('Redis Delete', false, 'Failed to delete key');
        }
        
      } else {
        logTestResult('Redis Connection', false, 'Redis client not ready');
      }
      
    } catch (error) {
      logTestResult('Redis Operations', false, error.message);
    }
    
  } catch (error) {
    logTestResult('Redis Service', false, error.message);
  }
  
  console.log('');
}

// Test 4: JWT Service
async function testJWTService() {
  console.log('4️⃣  Testing JWT Service...\n');
  
  try {
    const JWTService = require(path.join(srcPath, 'services', 'jwtService'));
    const jwtService = new JWTService();
    
    // Test token generation
    const testPayload = { userId: 'test123', userType: 'customer', phone: '9999999999' };
    const token = jwtService.generateAccessToken(testPayload);
    
    if (token && typeof token === 'string') {
      logTestResult('JWT Generation', true, 'Token generated successfully');
      
      // Test token verification
      try {
        const decoded = jwtService.verifyToken(token);
        if (decoded.userId === testPayload.userId && decoded.userType === testPayload.userType) {
          logTestResult('JWT Verification', true, 'Token verified successfully');
        } else {
          logTestResult('JWT Verification', false, 'Token payload mismatch');
        }
      } catch (error) {
        logTestResult('JWT Verification', false, error.message);
      }
      
    } else {
      logTestResult('JWT Generation', false, 'Failed to generate token');
    }
    
  } catch (error) {
    logTestResult('JWT Service', false, error.message);
  }
  
  console.log('');
}

// Test 5: Bcrypt Service
async function testBcryptService() {
  console.log('5️⃣  Testing Bcrypt Service...\n');
  
  try {
    const BcryptService = require(path.join(srcPath, 'services', 'bcryptService'));
    const bcryptService = new BcryptService();
    
    // Test password hashing
    const testPassword = 'testPassword123';
    const hashedPassword = await bcryptService.hashPassword(testPassword);
    
    if (hashedPassword && hashedPassword !== testPassword) {
      logTestResult('Password Hashing', true, 'Password hashed successfully');
      
      // Test password comparison
      const isMatch = await bcryptService.verifyPassword(testPassword, hashedPassword);
      if (isMatch) {
        logTestResult('Password Comparison', true, 'Password comparison successful');
      } else {
        logTestResult('Password Comparison', false, 'Password comparison failed');
      }
      
      // Test wrong password
      const wrongMatch = await bcryptService.verifyPassword('wrongPassword', hashedPassword);
      if (!wrongMatch) {
        logTestResult('Wrong Password Rejection', true, 'Wrong password correctly rejected');
      } else {
        logTestResult('Wrong Password Rejection', false, 'Wrong password incorrectly accepted');
      }
      
    } else {
      logTestResult('Password Hashing', false, 'Failed to hash password');
    }
    
  } catch (error) {
    logTestResult('Bcrypt Service', false, error.message);
  }
  
  console.log('');
}

// Test 6: Notification Service
async function testNotificationService() {
  console.log('6️⃣  Testing Notification Service...\n');
  
  try {
    const { env } = require(path.join(srcPath, 'config'));
    
    if (!env.arePushNotificationsEnabled()) {
      logTestResult('Notification Service', true, 'Push notifications are disabled (skipping tests)');
      console.log('');
      return;
    }
    
    const NotificationService = require(path.join(srcPath, 'services', 'notificationService'));
    
    // Test service availability
    if (typeof NotificationService === 'function') {
      logTestResult('Notification Service Availability', true, 'Service class is available');
    } else {
      logTestResult('Notification Service Availability', false, 'Service class not found');
    }
    
    // Test configuration
    const notificationConfig = env.getNotificationConfig();
    if (notificationConfig.fcmEnabled) {
      logTestResult('FCM Configuration', true, `FCM enabled with V1 API: ${notificationConfig.fcmUseV1Api}`);
    } else {
      logTestResult('FCM Configuration', false, 'FCM is disabled');
    }
    
  } catch (error) {
    logTestResult('Notification Service', false, error.message);
  }
  
  console.log('');
}

// Test 7: Payment Service
async function testPaymentService() {
  console.log('7️⃣  Testing Payment Service...\n');
  
  try {
    const { env } = require(path.join(srcPath, 'config'));
    const paymentConfig = env.getPaymentConfig();
    
    // Test PhonePe configuration
    if (paymentConfig.phonepe.merchantId && paymentConfig.phonepe.merchantId !== 'your_phonepay_merchant_id') {
      logTestResult('PhonePe Configuration', true, `Merchant ID: ${paymentConfig.phonepe.merchantId}`);
    } else {
      logTestResult('PhonePe Configuration', false, 'PhonePe not configured (using placeholder)');
    }
    
    // Test Razorpay configuration
    if (paymentConfig.razorpay.keyId && paymentConfig.razorpay.keyId !== 'your_razorpay_key_id') {
      logTestResult('Razorpay Configuration', true, `Key ID: ${paymentConfig.razorpay.keyId}`);
    } else {
      logTestResult('Razorpay Configuration', false, 'Razorpay not configured (using placeholder)');
    }
    
    // Test service availability
    try {
      const PaymentService = require(path.join(srcPath, 'services', 'paymentService'));
      
      if (PaymentService && typeof PaymentService.initiatePhonePePayment === 'function') {
        logTestResult('Payment Service Functions', true, 'Payment service functions are available');
      } else {
        logTestResult('Payment Service Functions', false, 'Payment service functions not found');
      }
    } catch (error) {
      logTestResult('Payment Service Functions', false, 'Payment service not available');
    }
    
  } catch (error) {
    logTestResult('Payment Service', false, error.message);
  }
  
  console.log('');
}

// Test 8: File Upload Service
async function testFileUploadService() {
  console.log('8️⃣  Testing File Upload Service...\n');
  
  try {
    const { env } = require(path.join(srcPath, 'config'));
    const fileUploadConfig = env.getFileUploadConfig();
    
    // Test configuration
    logTestResult('File Upload Configuration', true, 
      `Max Size: ${(fileUploadConfig.maxFileSize / 1024 / 1024).toFixed(2)}MB, Path: ${fileUploadConfig.uploadPath}`);
    
    // Test upload directory
    const uploadPath = path.resolve(fileUploadConfig.uploadPath);
    if (fs.existsSync(uploadPath)) {
      logTestResult('Upload Directory', true, `Directory exists: ${uploadPath}`);
    } else {
      logTestResult('Upload Directory', false, `Directory does not exist: ${uploadPath}`);
    }
    
    // Test service availability
    try {
      const FileUploadService = require(path.join(srcPath, 'services', 'fileUploadService'));
      
      if (typeof FileUploadService === 'function') {
        logTestResult('File Upload Functions', true, 'File upload service class is available');
      } else {
        logTestResult('File Upload Functions', false, 'File upload service class not found');
      }
    } catch (error) {
      logTestResult('File Upload Functions', false, 'File upload service not available');
    }
    
  } catch (error) {
    logTestResult('File Upload Service', false, error.message);
  }
  
  console.log('');
}

// Test 9: Real-time Communication Service
async function testRealtimeService() {
  console.log('9️⃣  Testing Real-time Communication Service...\n');
  
  try {
    // Test service availability
    try {
      const { initializeSocketIO, emitToUser, emitToRoom } = require(path.join(srcPath, 'services', 'socket'));
      
      if (typeof initializeSocketIO === 'function') {
        logTestResult('Socket.IO Service', true, 'Socket.IO service is available');
      } else {
        logTestResult('Socket.IO Service', false, 'Socket.IO service not found');
      }
    } catch (error) {
      logTestResult('Socket.IO Service', false, 'Socket.IO service not available');
    }
    
    // Test WebSocket service
    try {
      const WebSocketService = require(path.join(srcPath, 'services', 'websocketService'));
      
      if (typeof WebSocketService === 'function') {
        logTestResult('WebSocket Service', true, 'WebSocket service class is available');
      } else {
        logTestResult('WebSocket Service', false, 'WebSocket service class not found');
      }
    } catch (error) {
      logTestResult('WebSocket Service', false, 'WebSocket service not available');
    }
    
  } catch (error) {
    logTestResult('Real-time Communication Service', false, error.message);
  }
  
  console.log('');
}

// Test 10: Tracking Service
async function testTrackingService() {
  console.log('🔟  Testing Tracking Service...\n');
  
  try {
    // Test service availability
    try {
      const TrackingService = require(path.join(srcPath, 'services', 'trackingService'));
      
      if (typeof TrackingService === 'function') {
        logTestResult('Tracking Service Functions', true, 'Tracking service class is available');
      } else {
        logTestResult('Tracking Service Functions', false, 'Tracking service class not found');
      }
    } catch (error) {
      logTestResult('Tracking Service Functions', false, 'Tracking service not available');
    }
    
    // Test live tracking service
    try {
      const LiveTrackingService = require(path.join(srcPath, 'services', 'liveTrackingService'));
      
      if (typeof LiveTrackingService === 'function') {
        logTestResult('Live Tracking Service', true, 'Live tracking service class is available');
      } else {
        logTestResult('Live Tracking Service', false, 'Live tracking service class not found');
      }
    } catch (error) {
      logTestResult('Live Tracking Service', false, 'Live tracking service not available');
    }
    
  } catch (error) {
    logTestResult('Tracking Service', false, error.message);
  }
  
  console.log('');
}

// Test 11: Database Connectivity
async function testDatabaseConnectivity() {
  console.log('1️⃣1️⃣  Testing Database Connectivity...\n');
  
  try {
    const { getFirestore } = require(path.join(srcPath, 'services', 'firebase'));
    const db = getFirestore();
    
    // Test basic connectivity
    try {
      const testRef = db.collection('_test_connectivity').doc('test');
      await testRef.set({ test: true, timestamp: new Date() });
      logTestResult('Database Write', true, 'Write operation successful');
      
      const testDoc = await testRef.get();
      if (testDoc.exists) {
        logTestResult('Database Read', true, 'Read operation successful');
      } else {
        logTestResult('Database Read', false, 'Read operation failed');
      }
      
      await testRef.delete();
      logTestResult('Database Delete', true, 'Delete operation successful');
      
    } catch (error) {
      logTestResult('Database Operations', false, error.message);
    }
    
  } catch (error) {
    logTestResult('Database Connectivity', false, error.message);
  }
  
  console.log('');
}

// Test 12: Configuration Hot Reload
async function testConfigurationHotReload() {
  console.log('1️⃣2️⃣  Testing Configuration Hot Reload...\n');
  
  try {
    const { env } = require(path.join(srcPath, 'config'));
    
    // Get initial configuration
    const initialConfig = env.getAll();
    
    // Test reload function
    if (typeof env.reload === 'function') {
      env.reload();
      logTestResult('Configuration Reload Function', true, 'Reload function is available');
      
      // Verify configuration is still accessible
      const reloadedConfig = env.getAll();
      if (reloadedConfig && Object.keys(reloadedConfig).length > 0) {
        logTestResult('Configuration After Reload', true, 'Configuration accessible after reload');
      } else {
        logTestResult('Configuration After Reload', false, 'Configuration not accessible after reload');
      }
    } else {
      logTestResult('Configuration Reload Function', false, 'Reload function not available');
    }
    
  } catch (error) {
    logTestResult('Configuration Hot Reload', false, error.message);
  }
  
  console.log('');
}

// Main test runner
async function runAllTests() {
  try {
    console.log('🚀 Starting comprehensive service testing...\n');
    
    // Run all tests
    await testEnvironmentConfiguration();
    await testFirebaseService();
    await testRedisService();
    await testJWTService();
    await testBcryptService();
    await testNotificationService();
    await testPaymentService();
    await testFileUploadService();
    await testRealtimeService();
    await testTrackingService();
    await testDatabaseConnectivity();
    await testConfigurationHotReload();
    
    // Print summary
    console.log('📊 Test Summary');
    console.log('===============');
    console.log(`Total Tests: ${testResults.total}`);
    console.log(`Passed: ${testResults.passed} ✅`);
    console.log(`Failed: ${testResults.failed} ❌`);
    console.log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
    
    if (testResults.failed === 0) {
      console.log('\n🎉 All tests passed! Your backend is ready to go!');
      console.log('🚀 You can now start the server with: npm run dev');
    } else {
      console.log('\n⚠️  Some tests failed. Please check the errors above.');
      console.log('🔧 Fix the issues before starting the server.');
    }
    
  } catch (error) {
    console.error('💥 Test runner failed:', error.message);
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  runAllTests,
  testResults
};
