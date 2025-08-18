#!/usr/bin/env node

/**
 * Test Script for Firebase Phone Authentication
 * 
 * This script tests the Firebase Phone Auth endpoints:
 * - /api/auth/send-verification-code
 * - /api/auth/verify-phone
 * - /api/auth/resend-verification-code
 * - /api/auth/refresh-token
 * - /api/auth/profile
 * - /api/auth/logout
 */

const axios = require('axios');
const { initializeFirebase } = require('../src/services/firebase');

// Configuration
const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_PHONE = process.env.TEST_PHONE || '+919876543210';
const TEST_NAME = process.env.TEST_NAME || 'Test User';
const TEST_USER_TYPE = process.env.TEST_USER_TYPE || 'customer';

// Test data
const testData = {
  phoneNumber: TEST_PHONE,
  recaptchaToken: 'test_recaptcha_token_' + Date.now(),
  name: TEST_NAME,
  userType: TEST_USER_TYPE,
  firebaseIdToken: 'test_firebase_id_token_' + Date.now()
};

let authToken = null;
let userId = null;

/**
 * Initialize Firebase for testing
 */
async function initializeFirebaseForTesting() {
  try {
    console.log('🔧 Initializing Firebase for testing...');
    initializeFirebase();
    console.log('✅ Firebase initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Firebase:', error.message);
    process.exit(1);
  }
}

/**
 * Test helper function
 */
async function testEndpoint(name, method, endpoint, data = null, headers = {}) {
  try {
    console.log(`\n🧪 Testing: ${name}`);
    console.log(`${method.toUpperCase()} ${endpoint}`);
    
    if (data) {
      console.log('Request Data:', JSON.stringify(data, null, 2));
    }
    
    const response = await axios({
      method,
      url: `${BASE_URL}${endpoint}`,
      data,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      timeout: 10000
    });
    
    console.log('✅ Success');
    console.log('Status:', response.status);
    console.log('Response:', JSON.stringify(response.data, null, 2));
    
    return response.data;
    
  } catch (error) {
    console.log('❌ Failed');
    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Error Response:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.log('Error:', error.message);
    }
    return null;
  }
}

/**
 * Test 1: Send Verification Code
 */
async function testSendVerificationCode() {
  const data = {
    phoneNumber: testData.phoneNumber,
    recaptchaToken: testData.recaptchaToken,
    isSignup: true
  };
  
  const result = await testEndpoint(
    'Send Verification Code',
    'POST',
    '/api/auth/send-verification-code',
    data
  );
  
  return result?.success === true;
}

/**
 * Test 2: Resend Verification Code
 */
async function testResendVerificationCode() {
  const data = {
    phoneNumber: testData.phoneNumber,
    recaptchaToken: testData.recaptchaToken + '_resend'
  };
  
  const result = await testEndpoint(
    'Resend Verification Code',
    'POST',
    '/api/auth/resend-verification-code',
    data
  );
  
  return result?.success === true;
}

/**
 * Test 3: Verify Phone Number (Simulated)
 */
async function testVerifyPhoneNumber() {
  const data = {
    phoneNumber: testData.phoneNumber,
    firebaseIdToken: testData.firebaseIdToken,
    name: testData.name,
    userType: testData.userType
  };
  
  const result = await testEndpoint(
    'Verify Phone Number',
    'POST',
    '/api/auth/verify-phone',
    data
  );
  
  if (result?.success) {
    authToken = result.data.token;
    userId = result.data.user.id;
    console.log('🔑 Auth Token:', authToken ? 'Received' : 'Not received');
    console.log('👤 User ID:', userId || 'Not received');
  }
  
  return result?.success === true;
}

/**
 * Test 4: Get Profile
 */
async function testGetProfile() {
  if (!authToken) {
    console.log('⚠️  Skipping Get Profile test - no auth token');
    return false;
  }
  
  const result = await testEndpoint(
    'Get Profile',
    'GET',
    '/api/auth/profile',
    null,
    { 'Authorization': `Bearer ${authToken}` }
  );
  
  return result?.success === true;
}

/**
 * Test 5: Update Profile
 */
async function testUpdateProfile() {
  if (!authToken) {
    console.log('⚠️  Skipping Update Profile test - no auth token');
    return false;
  }
  
  const data = {
    name: 'Updated ' + testData.name,
    email: 'updated@example.com'
  };
  
  const result = await testEndpoint(
    'Update Profile',
    'PUT',
    '/api/auth/profile',
    data,
    { 'Authorization': `Bearer ${authToken}` }
  );
  
  return result?.success === true;
}

/**
 * Test 6: Refresh Token
 */
async function testRefreshToken() {
  if (!authToken) {
    console.log('⚠️  Skipping Refresh Token test - no auth token');
    return false;
  }
  
  const result = await testEndpoint(
    'Refresh Token',
    'POST',
    '/api/auth/refresh-token',
    null,
    { 'Authorization': `Bearer ${authToken}` }
  );
  
  if (result?.success) {
    const newToken = result.data.token;
    console.log('🔄 Token Refreshed:', newToken ? 'New token received' : 'No new token');
    if (newToken) {
      authToken = newToken;
    }
  }
  
  return result?.success === true;
}

/**
 * Test 7: Logout
 */
async function testLogout() {
  if (!authToken) {
    console.log('⚠️  Skipping Logout test - no auth token');
    return false;
  }
  
  const result = await testEndpoint(
    'Logout',
    'POST',
    '/api/auth/logout',
    null,
    { 'Authorization': `Bearer ${authToken}` }
  );
  
  return result?.success === true;
}

/**
 * Test 8: Test Invalid Requests
 */
async function testInvalidRequests() {
  console.log('\n🧪 Testing Invalid Requests');
  
  // Test 1: Invalid phone number
  await testEndpoint(
    'Invalid Phone Number',
    'POST',
    '/api/auth/send-verification-code',
    {
      phoneNumber: 'invalid_phone',
      recaptchaToken: testData.recaptchaToken,
      isSignup: true
    }
  );
  
  // Test 2: Missing recaptcha token
  await testEndpoint(
    'Missing reCAPTCHA Token',
    'POST',
    '/api/auth/send-verification-code',
    {
      phoneNumber: testData.phoneNumber,
      isSignup: true
    }
  );
  
  // Test 3: Invalid user type
  await testEndpoint(
    'Invalid User Type',
    'POST',
    '/api/auth/verify-phone',
    {
      phoneNumber: testData.phoneNumber,
      firebaseIdToken: testData.firebaseIdToken,
      name: testData.name,
      userType: 'invalid_type'
    }
  );
  
  // Test 4: Unauthorized profile access
  await testEndpoint(
    'Unauthorized Profile Access',
    'GET',
    '/api/auth/profile'
  );
}

/**
 * Test 9: Test Session Management
 */
async function testSessionManagement() {
  console.log('\n🧪 Testing Session Management');
  
  // Test 1: Create multiple sessions
  const session1 = await testEndpoint(
    'Create Session 1',
    'POST',
    '/api/auth/send-verification-code',
    {
      phoneNumber: testData.phoneNumber,
      recaptchaToken: testData.recaptchaToken + '_session1',
      isSignup: true
    }
  );
  
  const session2 = await testEndpoint(
    'Create Session 2',
    'POST',
    '/api/auth/send-verification-code',
    {
      phoneNumber: testData.phoneNumber,
      recaptchaToken: testData.recaptchaToken + '_session2',
      isSignup: false
    }
  );
  
  console.log('Session 1 created:', session1?.success);
  console.log('Session 2 created:', session2?.success);
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('🚀 Starting Firebase Phone Auth Tests');
  console.log('=====================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Test Phone: ${testData.phoneNumber}`);
  console.log(`Test Name: ${testData.name}`);
  console.log(`Test User Type: ${testData.userType}`);
  
  // Initialize Firebase
  await initializeFirebaseForTesting();
  
  // Run tests
  const testResults = [];
  
  testResults.push(await testSendVerificationCode());
  testResults.push(await testResendVerificationCode());
  testResults.push(await testVerifyPhoneNumber());
  testResults.push(await testGetProfile());
  testResults.push(await testUpdateProfile());
  testResults.push(await testRefreshToken());
  testResults.push(await testLogout());
  
  // Test edge cases
  await testInvalidRequests();
  await testSessionManagement();
  
  // Summary
  console.log('\n📊 Test Results Summary');
  console.log('========================');
  const passed = testResults.filter(Boolean).length;
  const total = testResults.length;
  console.log(`Passed: ${passed}/${total}`);
  console.log(`Success Rate: ${((passed / total) * 100).toFixed(1)}%`);
  
  if (passed === total) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('⚠️  Some tests failed');
    process.exit(1);
  }
}

/**
 * Error handling
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Run tests if this file is executed directly
if (require.main === module) {
  runTests().catch(error => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = {
  testSendVerificationCode,
  testResendVerificationCode,
  testVerifyPhoneNumber,
  testGetProfile,
  testUpdateProfile,
  testRefreshToken,
  testLogout,
  testInvalidRequests,
  testSessionManagement
};
