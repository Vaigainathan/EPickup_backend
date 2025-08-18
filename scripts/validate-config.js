#!/usr/bin/env node

/**
 * Configuration Validation Script
 * Validates all environment variables and tests service connections
 */

const path = require('path');
const fs = require('fs');

// Add the src directory to the path so we can import our modules
const srcPath = path.join(__dirname, '..', 'src');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

console.log('🔍 EPickup Backend Configuration Validation');
console.log('==========================================\n');

// Test 1: Environment Variables Loading
console.log('1️⃣  Testing Environment Variables Loading...');
try {
  const { env } = require(path.join(srcPath, 'config'));
  console.log('✅ Environment configuration loaded successfully');
  
  // Display configuration summary
  const config = env.getAll();
  console.log(`   Server Port: ${config.server.port}`);
  console.log(`   Node Environment: ${config.server.nodeEnv}`);
  console.log(`   Debug Mode: ${config.server.debug}`);
  console.log(`   Redis Enabled: ${config.redis.enabled}`);
  console.log(`   Push Notifications: ${config.notifications.pushEnabled}`);
  console.log(`   FCM V1 API: ${config.notifications.fcmUseV1Api}`);
  
} catch (error) {
  console.error('❌ Failed to load environment configuration:', error.message);
  process.exit(1);
}

// Test 2: Firebase Configuration
console.log('\n2️⃣  Testing Firebase Configuration...');
try {
  const firebaseConfig = require(path.join(srcPath, 'config')).firebase;
  
  if (!firebaseConfig.projectId) {
    throw new Error('FIREBASE_PROJECT_ID is missing');
  }
  if (!firebaseConfig.privateKey) {
    throw new Error('FIREBASE_PRIVATE_KEY is missing');
  }
  if (!firebaseConfig.clientEmail) {
    throw new Error('FIREBASE_CLIENT_EMAIL is missing');
  }
  
  // Check if service account file exists
  const serviceAccountPath = path.resolve(firebaseConfig.serviceAccountPath);
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Firebase service account file not found at: ${serviceAccountPath}`);
  }
  
  // Validate service account JSON
  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  if (!serviceAccount.project_id) {
    throw new Error('Invalid service account file: missing project_id');
  }
  
  console.log('✅ Firebase configuration is valid');
  console.log(`   Project ID: ${firebaseConfig.projectId}`);
  console.log(`   Service Account: ${serviceAccountPath}`);
  console.log(`   Functions Region: ${firebaseConfig.functionsRegion}`);
  
} catch (error) {
  console.error('❌ Firebase configuration validation failed:', error.message);
  process.exit(1);
}

// Test 3: Google Maps API Configuration
console.log('\n3️⃣  Testing Google Maps API Configuration...');
try {
  const googleMapsConfig = require(path.join(srcPath, 'config')).googleMaps;
  
  if (!googleMapsConfig.apiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY is missing');
  }
  
  if (googleMapsConfig.apiKey === 'your_google_maps_api_key') {
    throw new Error('GOOGLE_MAPS_API_KEY is set to placeholder value');
  }
  
  console.log('✅ Google Maps API configuration is valid');
  console.log(`   API Key: ${googleMapsConfig.apiKey.substring(0, 10)}...`);
  
} catch (error) {
  console.error('❌ Google Maps API configuration validation failed:', error.message);
  process.exit(1);
}

// Test 4: Redis Configuration
console.log('\n4️⃣  Testing Redis Configuration...');
try {
  const redisConfig = require(path.join(srcPath, 'config')).redis;
  
  if (redisConfig.enabled) {
    if (!redisConfig.url && (!redisConfig.host || !redisConfig.port)) {
      throw new Error('Redis is enabled but connection details are missing');
    }
    
    console.log('✅ Redis configuration is valid');
    console.log(`   Host: ${redisConfig.host || 'from URL'}`);
    console.log(`   Port: ${redisConfig.port || 'from URL'}`);
    console.log(`   Database: ${redisConfig.db}`);
    console.log(`   Username: ${redisConfig.username}`);
  } else {
    console.log('⚠️  Redis is disabled in configuration');
  }
  
} catch (error) {
  console.error('❌ Redis configuration validation failed:', error.message);
  process.exit(1);
}

// Test 5: JWT Configuration
console.log('\n5️⃣  Testing JWT Configuration...');
try {
  const jwtConfig = require(path.join(srcPath, 'config')).jwt;
  
  if (!jwtConfig.secret) {
    throw new Error('JWT_SECRET is missing');
  }
  
  if (jwtConfig.secret === 'your_jwt_secret_key_here') {
    throw new Error('JWT_SECRET is set to placeholder value');
  }
  
  console.log('✅ JWT configuration is valid');
  console.log(`   Expires In: ${jwtConfig.expiresIn}`);
  console.log(`   Secret: ${jwtConfig.secret.substring(0, 10)}...`);
  
} catch (error) {
  console.error('❌ JWT configuration validation failed:', error.message);
  process.exit(1);
}

// Test 6: Payment Gateway Configuration
console.log('\n6️⃣  Testing Payment Gateway Configuration...');
try {
  const paymentConfig = require(path.join(srcPath, 'config')).payment;
  
  if (paymentConfig.phonepe.merchantId && paymentConfig.phonepe.merchantId !== 'your_phonepay_merchant_id') {
    console.log('✅ PhonePe configuration is valid');
    console.log(`   Merchant ID: ${paymentConfig.phonepe.merchantId}`);
    console.log(`   Base URL: ${paymentConfig.phonepe.baseUrl}`);
  } else {
    console.log('⚠️  PhonePe configuration not set (using placeholder values)');
  }
  
  if (paymentConfig.razorpay.keyId && paymentConfig.razorpay.keyId !== 'your_razorpay_key_id') {
    console.log('✅ Razorpay configuration is valid');
    console.log(`   Key ID: ${paymentConfig.razorpay.keyId}`);
  } else {
    console.log('⚠️  Razorpay configuration not set (using placeholder values)');
  }
  
} catch (error) {
  console.error('❌ Payment gateway configuration validation failed:', error.message);
  process.exit(1);
}

// Test 7: Notification Configuration
console.log('\n7️⃣  Testing Notification Configuration...');
try {
  const notificationConfig = require(path.join(srcPath, 'config')).notifications;
  
  console.log('✅ Notification configuration is valid');
  console.log(`   Push Enabled: ${notificationConfig.pushEnabled}`);
  console.log(`   FCM V1 API: ${notificationConfig.fcmUseV1Api}`);
  console.log(`   FCM Enabled: ${notificationConfig.fcmEnabled}`);
  console.log(`   Enhanced Notifications: ${notificationConfig.enhancedNotificationsEnabled}`);
  console.log(`   Max Per Day: ${notificationConfig.maxNotificationsPerDay}`);
  console.log(`   Max Per Hour: ${notificationConfig.maxNotificationsPerHour}`);
  
} catch (error) {
  console.error('❌ Notification configuration validation failed:', error.message);
  process.exit(1);
}

// Test 8: Security Configuration
console.log('\n8️⃣  Testing Security Configuration...');
try {
  const securityConfig = require(path.join(srcPath, 'config')).security;
  
  if (!securityConfig.sessionSecret) {
    throw new Error('SESSION_SECRET is missing');
  }
  
  console.log('✅ Security configuration is valid');
  console.log(`   Bcrypt Salt Rounds: ${securityConfig.bcryptSaltRounds}`);
  console.log(`   Session Secret: ${securityConfig.sessionSecret.substring(0, 10)}...`);
  
} catch (error) {
  console.error('❌ Security configuration validation failed:', error.message);
  process.exit(1);
}

// Test 9: File Upload Configuration
console.log('\n9️⃣  Testing File Upload Configuration...');
try {
  const fileUploadConfig = require(path.join(srcPath, 'config')).fileUpload;
  
  console.log('✅ File upload configuration is valid');
  console.log(`   Max File Size: ${(fileUploadConfig.maxFileSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Upload Path: ${fileUploadConfig.uploadPath}`);
  console.log(`   Thumbnail Size: ${fileUploadConfig.thumbnailSize}px`);
  console.log(`   Image Quality: ${fileUploadConfig.imageQuality}%`);
  
  // Check if upload directory exists
  const uploadPath = path.resolve(fileUploadConfig.uploadPath);
  if (!fs.existsSync(uploadPath)) {
    console.log(`⚠️  Upload directory does not exist: ${uploadPath}`);
    console.log('   Creating upload directory...');
    fs.mkdirSync(uploadPath, { recursive: true });
    console.log('✅ Upload directory created');
  } else {
    console.log(`✅ Upload directory exists: ${uploadPath}`);
  }
  
} catch (error) {
  console.error('❌ File upload configuration validation failed:', error.message);
  process.exit(1);
}

// Test 10: Monitoring Configuration
console.log('\n🔟  Testing Monitoring Configuration...');
try {
  const monitoringConfig = require(path.join(srcPath, 'config')).monitoring;
  
  if (monitoringConfig.sentryDsn) {
    console.log('✅ Sentry monitoring is configured');
    console.log(`   DSN: ${monitoringConfig.sentryDsn.substring(0, 30)}...`);
  } else {
    console.log('⚠️  Sentry monitoring not configured');
  }
  
  if (monitoringConfig.newRelicLicenseKey) {
    console.log('✅ New Relic monitoring is configured');
  } else {
    console.log('⚠️  New Relic monitoring not configured');
  }
  
} catch (error) {
  console.error('❌ Monitoring configuration validation failed:', error.message);
  process.exit(1);
}

// Test 11: Development Configuration
console.log('\n1️⃣1️⃣  Testing Development Configuration...');
try {
  const developmentConfig = require(path.join(srcPath, 'config')).development;
  
  console.log('✅ Development configuration is valid');
  console.log(`   Test Phone Numbers: ${developmentConfig.testPhoneNumbers.join(', ')}`);
  
} catch (error) {
  console.error('❌ Development configuration validation failed:', error.message);
  process.exit(1);
}

// Test 12: Service Initialization Test
console.log('\n1️⃣2️⃣  Testing Service Initialization...');
try {
  // Test Firebase initialization
  const { initializeFirebase } = require(path.join(srcPath, 'services', 'firebase'));
  initializeFirebase();
  console.log('✅ Firebase service initialized successfully');
  
  // Test Redis initialization (if enabled)
  const { env } = require(path.join(srcPath, 'config'));
  if (env.isRedisEnabled()) {
    const { initializeRedis } = require(path.join(srcPath, 'services', 'redis'));
    initializeRedis().then(() => {
      console.log('✅ Redis service initialized successfully');
    }).catch((error) => {
      console.log('⚠️  Redis service initialization failed (continuing):', error.message);
    });
  } else {
    console.log('⚠️  Redis service initialization skipped (disabled)');
  }
  
} catch (error) {
  console.error('❌ Service initialization test failed:', error.message);
  process.exit(1);
}

console.log('\n🎉 Configuration validation completed successfully!');
console.log('✅ All critical configurations are valid');
console.log('✅ Services are ready for initialization');
console.log('\n🚀 You can now start the backend server with: npm run dev');

// Exit successfully
process.exit(0);
