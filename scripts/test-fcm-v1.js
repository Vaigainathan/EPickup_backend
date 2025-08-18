#!/usr/bin/env node

/**
 * FCM v1 API Test Script
 * 
 * This script tests the FCM v1 service initialization and basic functionality.
 * Run this after setting up your Google Service Account JSON file.
 */

require('dotenv').config();
const path = require('path');

// Import the FCM v1 service
const FCMV1Service = require('../src/services/fcmV1Service');

// Test configuration
const TEST_CONFIG = {
  // Test token (replace with a real token for full testing)
  testToken: process.env.TEST_FCM_TOKEN || 'test_token_placeholder',
  
  // Test notification
  testNotification: {
    title: 'EPickup Test Notification',
    body: 'This is a test notification from FCM v1 API'
  },
  
  // Test data
  testData: {
    type: 'test',
    timestamp: new Date().toISOString(),
    app: 'epickup'
  }
};

/**
 * Test FCM v1 service initialization
 */
async function testInitialization() {
  console.log('\n🧪 Testing FCM v1 Service Initialization...');
  
  try {
    const fcmService = new FCMV1Service();
    await fcmService.initialize();
    
    const health = await fcmService.getHealthStatus();
    console.log('✅ FCM v1 Service initialized successfully');
    console.log('📊 Health Status:', JSON.stringify(health, null, 2));
    
    return fcmService;
  } catch (error) {
    console.error('❌ FCM v1 Service initialization failed:', error.message);
    throw error;
  }
}

/**
 * Test service account configuration
 */
function testServiceAccountConfig() {
  console.log('\n🔐 Testing Service Account Configuration...');
  
  const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
  const absolutePath = path.resolve(serviceAccountPath);
  
  try {
    const fs = require('fs');
    
    if (!fs.existsSync(absolutePath)) {
      console.error('❌ Service Account file not found at:', absolutePath);
      console.error('💡 Please download your service account JSON from Firebase Console');
      console.error('   Project Settings > Service Accounts > Generate New Private Key');
      return false;
    }
    
    const stats = fs.statSync(absolutePath);
    const fileSize = (stats.size / 1024).toFixed(2);
    
    console.log('✅ Service Account file found');
    console.log(`📁 Path: ${absolutePath}`);
    console.log(`📏 Size: ${fileSize} KB`);
    
    // Try to parse the JSON
    try {
      const content = fs.readFileSync(absolutePath, 'utf8');
      const parsed = JSON.parse(content);
      
      if (parsed.project_id && parsed.private_key && parsed.client_email) {
        console.log('✅ Service Account JSON is valid');
        console.log(`🏢 Project ID: ${parsed.project_id}`);
        console.log(`👤 Client Email: ${parsed.client_email}`);
        return true;
      } else {
        console.error('❌ Service Account JSON is missing required fields');
        return false;
      }
    } catch (parseError) {
      console.error('❌ Service Account JSON is not valid:', parseError.message);
      return false;
    }
  } catch (error) {
    console.error('❌ Error checking service account:', error.message);
    return false;
  }
}

/**
 * Test environment variables
 */
function testEnvironmentVariables() {
  console.log('\n⚙️  Testing Environment Variables...');
  
  const requiredVars = [
    'FCM_USE_V1_API',
    'FCM_SERVICE_ACCOUNT_PATH',
    'PUSH_NOTIFICATION_ENABLED',
    'FIREBASE_PROJECT_ID'
  ];
  
  let allValid = true;
  
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(`✅ ${varName}: ${value}`);
    } else {
      console.error(`❌ ${varName}: Not set`);
      allValid = false;
    }
  });
  
  // Check specific values
  if (process.env.FCM_USE_V1_API === 'true') {
    console.log('✅ FCM v1 API is enabled');
  } else {
    console.error('❌ FCM v1 API is not enabled (FCM_USE_V1_API should be "true")');
    allValid = false;
  }
  
  if (process.env.PUSH_NOTIFICATION_ENABLED === 'true') {
    console.log('✅ Push notifications are enabled');
  } else {
    console.error('❌ Push notifications are not enabled (PUSH_NOTIFICATION_ENABLED should be "true")');
    allValid = false;
  }
  
  return allValid;
}

/**
 * Test token validation (if real token provided)
 */
async function testTokenValidation(fcmService) {
  console.log('\n🔍 Testing Token Validation...');
  
  if (TEST_CONFIG.testToken === 'test_token_placeholder') {
    console.log('⚠️  Skipping token validation (no real token provided)');
    console.log('💡 Set TEST_FCM_TOKEN environment variable to test with real token');
    return;
  }
  
  try {
    const validation = await fcmService.validateToken(TEST_CONFIG.testToken);
    console.log('✅ Token validation result:', JSON.stringify(validation, null, 2));
  } catch (error) {
    console.error('❌ Token validation failed:', error.message);
  }
}

/**
 * Test notification sending (if real token provided)
 */
async function testNotificationSending(fcmService) {
  console.log('\n📱 Testing Notification Sending...');
  
  if (TEST_CONFIG.testToken === 'test_token_placeholder') {
    console.log('⚠️  Skipping notification sending (no real token provided)');
    console.log('💡 Set TEST_FCM_TOKEN environment variable to test with real token');
    return;
  }
  
  try {
    const result = await fcmService.sendToDevice(
      TEST_CONFIG.testToken,
      TEST_CONFIG.testNotification,
      TEST_CONFIG.testData
    );
    
    console.log('✅ Notification sent successfully:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('❌ Notification sending failed:', error.message);
  }
}

/**
 * Main test function
 */
async function runTests() {
  console.log('🚀 Starting FCM v1 API Tests...');
  console.log('=' .repeat(50));
  
  try {
    // Test 1: Environment variables
    const envValid = testEnvironmentVariables();
    if (!envValid) {
      console.error('\n❌ Environment variables test failed. Please fix the issues above.');
      process.exit(1);
    }
    
    // Test 2: Service account configuration
    const serviceAccountValid = testServiceAccountConfig();
    if (!serviceAccountValid) {
      console.error('\n❌ Service account configuration test failed. Please fix the issues above.');
      process.exit(1);
    }
    
    // Test 3: FCM service initialization
    const fcmService = await testInitialization();
    
    // Test 4: Token validation
    await testTokenValidation(fcmService);
    
    // Test 5: Notification sending
    await testNotificationSending(fcmService);
    
    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Your FCM v1 API is properly configured');
    console.log('   2. You can now use the FCMV1Service in your application');
    console.log('   3. Monitor Firebase Console for delivery statistics');
    console.log('   4. Check the FCM_V1_SETUP_GUIDE.md for usage examples');
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error.message);
    console.error('\n🔧 Troubleshooting:');
    console.error('   1. Check the FCM_V1_SETUP_GUIDE.md for setup instructions');
    console.error('   2. Verify your service account JSON file is correct');
    console.error('   3. Ensure environment variables are properly set');
    console.error('   4. Check Firebase Console for any project issues');
    
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
}

module.exports = {
  runTests,
  testInitialization,
  testEnvironmentVariables,
  testServiceAccountConfig
};
