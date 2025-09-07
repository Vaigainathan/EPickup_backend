#!/usr/bin/env node

/**
 * Admin Dashboard Fixes Test
 * Tests the fixes applied to the admin dashboard
 */

const axios = require('axios');

// Configuration
const BASE_URL = process.env.API_BASE_URL || 'https://epickup-backend.onrender.com';
const API_URL = `${BASE_URL}/api`;

// Test results tracking
let testResults = {
  passed: 0,
  failed: 0,
  total: 0,
  details: []
};

// Helper function to log test results
function logTest(testName, success, details = '') {
  testResults.total++;
  if (success) {
    testResults.passed++;
    console.log(`✅ ${testName}: PASSED`);
  } else {
    testResults.failed++;
    console.log(`❌ ${testName}: FAILED - ${details}`);
  }
  testResults.details.push({ testName, success, details });
}

// Helper function to make API requests
async function makeRequest(method, endpoint, data = null, token = null) {
  try {
    const config = {
      method,
      url: `${API_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status || 500
    };
  }
}

// Test 1: Admin Authentication
async function testAdminAuth() {
  console.log('\n🔐 Testing Admin Authentication...');
  
  const loginData = {
    email: 'admin@epickup.com',
    password: 'admin123'
  };
  
  const response = await makeRequest('POST', '/admin/auth/login', loginData);
  
  if (response.success && response.data.token) {
    logTest('Admin Login', true);
    return response.data.token;
  } else {
    logTest('Admin Login', false, response.error?.message || 'No token received');
    return null;
  }
}

// Test 2: Admin Dashboard API Endpoints (with fallback handling)
async function testAdminEndpoints(adminToken) {
  console.log('\n📊 Testing Admin Dashboard API Endpoints...');
  
  const endpoints = [
    { name: 'Get Drivers', endpoint: '/admin/drivers', method: 'GET' },
    { name: 'Get Bookings', endpoint: '/admin/bookings', method: 'GET' },
    { name: 'Get Emergency Alerts', endpoint: '/admin/emergency-alerts', method: 'GET' },
    { name: 'Get System Health', endpoint: '/admin/system-health', method: 'GET' },
    { name: 'Get Pending Drivers', endpoint: '/admin/drivers/pending', method: 'GET' }
  ];
  
  let allPassed = true;
  
  for (const endpoint of endpoints) {
    const response = await makeRequest(endpoint.method, endpoint.endpoint, null, adminToken);
    
    // Check if endpoint exists or if it's a fallback scenario
    if (response.success) {
      logTest(endpoint.name, true);
    } else if (response.status === 404) {
      logTest(endpoint.name, false, 'Endpoint not found - needs backend restart');
      allPassed = false;
    } else if (response.status === 500 && response.error?.code?.includes('FAILED_PRECONDITION')) {
      logTest(endpoint.name, false, 'Firestore index needed - will work after index creation');
      allPassed = false;
    } else {
      logTest(endpoint.name, false, response.error?.message || 'API call failed');
      allPassed = false;
    }
  }
  
  return allPassed;
}

// Test 3: Support Endpoints (should work)
async function testSupportEndpoints(adminToken) {
  console.log('\n🆘 Testing Support Endpoints...');
  
  const endpoints = [
    { name: 'Get Support Tickets', endpoint: '/support/tickets', method: 'GET' },
    { name: 'Get FAQ', endpoint: '/support/faq', method: 'GET' },
    { name: 'Get Contact Info', endpoint: '/support/contact', method: 'GET' }
  ];
  
  let allPassed = true;
  
  for (const endpoint of endpoints) {
    const response = await makeRequest(endpoint.method, endpoint.endpoint, null, adminToken);
    
    if (response.success) {
      logTest(endpoint.name, true);
    } else if (response.status === 500 && response.error?.code?.includes('FAILED_PRECONDITION')) {
      logTest(endpoint.name, false, 'Firestore index needed - will work after index creation');
      allPassed = false;
    } else {
      logTest(endpoint.name, false, response.error?.message || 'API call failed');
      allPassed = false;
    }
  }
  
  return allPassed;
}

// Test 4: Emergency Endpoints (should work)
async function testEmergencyEndpoints(adminToken) {
  console.log('\n🚨 Testing Emergency Endpoints...');
  
  const endpoints = [
    { name: 'Get Emergency Alerts', endpoint: '/emergency/alerts', method: 'GET' }
  ];
  
  let allPassed = true;
  
  for (const endpoint of endpoints) {
    const response = await makeRequest(endpoint.method, endpoint.endpoint, null, adminToken);
    
    if (response.success) {
      logTest(endpoint.name, true);
    } else if (response.status === 500 && response.error?.code?.includes('FAILED_PRECONDITION')) {
      logTest(endpoint.name, false, 'Firestore index needed - will work after index creation');
      allPassed = false;
    } else {
      logTest(endpoint.name, false, response.error?.message || 'API call failed');
      allPassed = false;
    }
  }
  
  return allPassed;
}

// Main test function
async function runAdminDashboardFixesTest() {
  console.log('🚀 Starting Admin Dashboard Fixes Test...\n');
  console.log(`Testing against: ${BASE_URL}\n`);
  
  try {
    // Test 1: Admin Authentication
    const adminToken = await testAdminAuth();
    if (!adminToken) {
      console.log('\n❌ Admin authentication failed. Stopping tests.');
      return;
    }
    
    // Test 2: Admin Dashboard API Endpoints
    const endpointsSuccess = await testAdminEndpoints(adminToken);
    
    // Test 3: Support Endpoints
    const supportSuccess = await testSupportEndpoints(adminToken);
    
    // Test 4: Emergency Endpoints
    const emergencySuccess = await testEmergencyEndpoints(adminToken);
    
    // Print final results
    console.log('\n' + '='.repeat(60));
    console.log('📊 ADMIN DASHBOARD FIXES TEST RESULTS');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${testResults.total}`);
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
    
    if (testResults.failed > 0) {
      console.log('\n❌ Failed Tests:');
      testResults.details
        .filter(test => !test.success)
        .forEach(test => {
          console.log(`  - ${test.testName}: ${test.details}`);
        });
    }
    
    console.log('\n' + '='.repeat(60));
    
    // Summary of fixes applied
    console.log('\n🔧 Fixes Applied:');
    console.log('✅ Added Firestore composite indexes for admin queries');
    console.log('✅ Added missing admin API endpoints (/admin/drivers, /admin/bookings, etc.)');
    console.log('✅ Enhanced admin service with Firestore fallback methods');
    console.log('✅ Fixed WebSocket room management for admin dashboard');
    console.log('✅ Updated API URL configuration to production');
    
    console.log('\n📋 Next Steps:');
    console.log('1. Deploy Firestore indexes: firebase deploy --only firestore:indexes');
    console.log('2. Restart backend server to pick up new routes');
    console.log('3. Test admin dashboard functionality');
    
    if (testResults.failed === 0) {
      console.log('\n🎉 ALL TESTS PASSED! Admin dashboard fixes are working!');
    } else {
      console.log('\n⚠️  Some tests failed. Please check the issues above.');
    }
    
  } catch (error) {
    console.error('❌ Test execution error:', error);
  }
}

// Run the tests
runAdminDashboardFixesTest();
