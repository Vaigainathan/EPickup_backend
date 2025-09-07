#!/usr/bin/env node

/**
 * Admin Dashboard - Driver App Integration Test
 * Tests all communication and integration between admin dashboard and driver app
 */

const axios = require('axios');
const { io } = require('socket.io-client');

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

// Test 2: Driver Authentication
async function testDriverAuth() {
  console.log('\n🚗 Testing Driver Authentication...');
  
  const phoneNumber = '+919876543210';
  
  // Send OTP
  const otpResponse = await makeRequest('POST', '/auth/send-otp', {
    phoneNumber,
    userType: 'driver'
  });
  
  if (!otpResponse.success) {
    logTest('Driver OTP Send', false, otpResponse.error?.message || 'Failed to send OTP');
    return null;
  }
  
  logTest('Driver OTP Send', true);
  
  // Verify OTP (using mock mode - OTP is always 123456)
  const verifyResponse = await makeRequest('POST', '/auth/verify-otp', {
    phoneNumber,
    otp: '123456',
    userType: 'driver',
    name: 'Test Driver'
  });
  
  if (verifyResponse.success && verifyResponse.data.token) {
    logTest('Driver OTP Verify', true);
    return verifyResponse.data.token;
  } else {
    logTest('Driver OTP Verify', false, verifyResponse.error?.message || 'No token received');
    return null;
  }
}

// Test 3: Admin-Driver WebSocket Communication
async function testAdminDriverWebSocket(adminToken, driverToken) {
  console.log('\n🔌 Testing Admin-Driver WebSocket Communication...');
  
  return new Promise((resolve) => {
    let adminSocket = null;
    let driverSocket = null;
    let eventsReceived = 0;
    let connectionEstablished = false;
    
    // Connect Admin WebSocket
    adminSocket = io(BASE_URL, {
      auth: { 
        token: adminToken,
        userType: 'admin'
      },
      transports: ['websocket', 'polling'],
      timeout: 5000
    });
    
    // Connect Driver WebSocket
    driverSocket = io(BASE_URL, {
      auth: { 
        token: driverToken,
        userType: 'driver'
      },
      transports: ['websocket', 'polling'],
      timeout: 5000
    });
    
    adminSocket.on('connect', () => {
      console.log('✅ Admin WebSocket connected');
      
      // Join admin rooms
      adminSocket.emit('join_room', { room: 'admin_drivers' });
      adminSocket.emit('join_room', { room: 'admin_bookings' });
      adminSocket.emit('join_room', { room: 'admin_emergency' });
    });
    
    driverSocket.on('connect', () => {
      console.log('✅ Driver WebSocket connected');
      connectionEstablished = true;
      
      // Test driver status update
      setTimeout(() => {
        driverSocket.emit('update_driver_status', {
          status: 'online',
          isAvailable: true,
          location: {
            latitude: 12.4950,
            longitude: 78.5678,
            address: 'Test Location'
          }
        });
      }, 1000);
    });
    
    // Admin receives driver status update
    adminSocket.on('driver_status_update', (data) => {
      console.log('📡 Admin received driver status update:', data);
      eventsReceived++;
    });
    
    // Driver receives confirmation
    driverSocket.on('driver_status_confirmed', (data) => {
      console.log('📡 Driver received status confirmation:', data);
      eventsReceived++;
    });
    
    // Test after 5 seconds
    setTimeout(() => {
      adminSocket.disconnect();
      driverSocket.disconnect();
      
      if (connectionEstablished && eventsReceived >= 1) {
        logTest('Admin-Driver WebSocket Communication', true);
        resolve(true);
      } else {
        logTest('Admin-Driver WebSocket Communication', false, `Only received ${eventsReceived} events`);
        resolve(false);
      }
    }, 5000);
  });
}

// Test 4: Driver Monitoring from Admin Dashboard
async function testDriverMonitoring(adminToken, driverToken) {
  console.log('\n👁️ Testing Driver Monitoring from Admin Dashboard...');
  
  // Test admin can fetch driver data
  const driversResponse = await makeRequest('GET', '/admin/drivers', null, adminToken);
  
  if (driversResponse.success) {
    logTest('Admin Fetch Drivers', true);
  } else if (driversResponse.status === 404) {
    logTest('Admin Fetch Drivers', false, 'Endpoint not found - needs backend restart');
  } else {
    logTest('Admin Fetch Drivers', false, driversResponse.error?.message || 'Failed to fetch drivers');
  }
  
  // Test driver location update
  const locationUpdateResponse = await makeRequest('POST', '/driver/update-location', {
    latitude: 12.4950,
    longitude: 78.5678,
    address: 'Test Location Update'
  }, driverToken);
  
  if (locationUpdateResponse.success) {
    logTest('Driver Location Update', true);
  } else {
    logTest('Driver Location Update', false, locationUpdateResponse.error?.message || 'Failed to update location');
  }
  
  return driversResponse.success && locationUpdateResponse.success;
}

// Test 5: Booking Management Communication
async function testBookingManagement(adminToken, driverToken) {
  console.log('\n📦 Testing Booking Management Communication...');
  
  // Create a test booking
  const bookingResponse = await makeRequest('POST', '/bookings', {
    pickup: {
      name: 'Test Customer',
      phone: '+919876543210',
      address: '123 Test Street, Tirupattur',
      coordinates: {
        latitude: 12.4950,
        longitude: 78.5678
      }
    },
    dropoff: {
      name: 'Test Destination',
      phone: '+919876543210',
      address: '456 Destination Road, Tirupattur',
      coordinates: {
        latitude: 12.5050,
        longitude: 78.5778
      }
    },
    package: {
      weight: 5,
      description: 'Test package'
    },
    vehicle: {
      type: '2_wheeler'
    },
    paymentMethod: 'cash',
    estimatedPickupTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    estimatedDeliveryTime: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  }, driverToken);
  
  if (bookingResponse.success) {
    logTest('Create Test Booking', true);
    
    const bookingId = bookingResponse.data.bookingId;
    
    // Test admin can fetch bookings
    const adminBookingsResponse = await makeRequest('GET', '/admin/bookings', null, adminToken);
    
    if (adminBookingsResponse.success) {
      logTest('Admin Fetch Bookings', true);
    } else if (adminBookingsResponse.status === 404) {
      logTest('Admin Fetch Bookings', false, 'Endpoint not found - needs backend restart');
    } else {
      logTest('Admin Fetch Bookings', false, adminBookingsResponse.error?.message || 'Failed to fetch bookings');
    }
    
    return adminBookingsResponse.success;
  } else {
    logTest('Create Test Booking', false, bookingResponse.error?.message || 'Failed to create booking');
    return false;
  }
}

// Test 6: Emergency Alert Communication
async function testEmergencyAlerts(adminToken, driverToken) {
  console.log('\n🚨 Testing Emergency Alert Communication...');
  
  // Driver sends emergency alert
  const emergencyResponse = await makeRequest('POST', '/emergency/alert', {
    alertType: 'sos',
    location: {
      latitude: 12.4950,
      longitude: 78.5678
    },
    message: 'Test emergency alert'
  }, driverToken);
  
  if (emergencyResponse.success) {
    logTest('Driver Send Emergency Alert', true);
    
    // Test admin can fetch emergency alerts
    const adminAlertsResponse = await makeRequest('GET', '/admin/emergency-alerts', null, adminToken);
    
    if (adminAlertsResponse.success) {
      logTest('Admin Fetch Emergency Alerts', true);
    } else if (adminAlertsResponse.status === 404) {
      logTest('Admin Fetch Emergency Alerts', false, 'Endpoint not found - needs backend restart');
    } else {
      logTest('Admin Fetch Emergency Alerts', false, adminAlertsResponse.error?.message || 'Failed to fetch alerts');
    }
    
    return adminAlertsResponse.success;
  } else {
    logTest('Driver Send Emergency Alert', false, emergencyResponse.error?.message || 'Failed to send emergency alert');
    return false;
  }
}

// Test 7: Driver Verification Workflow
async function testDriverVerification(adminToken, driverToken) {
  console.log('\n✅ Testing Driver Verification Workflow...');
  
  // Test admin can fetch pending verifications
  const pendingResponse = await makeRequest('GET', '/admin/drivers/pending', null, adminToken);
  
  if (pendingResponse.success) {
    logTest('Admin Fetch Pending Verifications', true);
  } else if (pendingResponse.status === 500 && pendingResponse.error?.code?.includes('FAILED_PRECONDITION')) {
    logTest('Admin Fetch Pending Verifications', false, 'Firestore index needed - will work after index creation');
  } else {
    logTest('Admin Fetch Pending Verifications', false, pendingResponse.error?.message || 'Failed to fetch pending verifications');
  }
  
  return pendingResponse.success;
}

// Test 8: System Health Monitoring
async function testSystemHealth(adminToken) {
  console.log('\n💚 Testing System Health Monitoring...');
  
  const healthResponse = await makeRequest('GET', '/admin/system-health', null, adminToken);
  
  if (healthResponse.success) {
    logTest('Admin System Health Check', true);
    console.log('📊 System Health Data:', healthResponse.data);
  } else if (healthResponse.status === 404) {
    logTest('Admin System Health Check', false, 'Endpoint not found - needs backend restart');
  } else {
    logTest('Admin System Health Check', false, healthResponse.error?.message || 'Failed to fetch system health');
  }
  
  return healthResponse.success;
}

// Main test function
async function runAdminDriverIntegrationTest() {
  console.log('🚀 Starting Admin Dashboard - Driver App Integration Test...\n');
  console.log(`Testing against: ${BASE_URL}\n`);
  
  try {
    // Test 1: Admin Authentication
    const adminToken = await testAdminAuth();
    if (!adminToken) {
      console.log('\n❌ Admin authentication failed. Stopping tests.');
      return;
    }
    
    // Test 2: Driver Authentication
    const driverToken = await testDriverAuth();
    if (!driverToken) {
      console.log('\n❌ Driver authentication failed. Stopping tests.');
      return;
    }
    
    // Test 3: WebSocket Communication
    const websocketSuccess = await testAdminDriverWebSocket(adminToken, driverToken);
    
    // Test 4: Driver Monitoring
    const monitoringSuccess = await testDriverMonitoring(adminToken, driverToken);
    
    // Test 5: Booking Management
    const bookingSuccess = await testBookingManagement(adminToken, driverToken);
    
    // Test 6: Emergency Alerts
    const emergencySuccess = await testEmergencyAlerts(adminToken, driverToken);
    
    // Test 7: Driver Verification
    const verificationSuccess = await testDriverVerification(adminToken, driverToken);
    
    // Test 8: System Health
    const healthSuccess = await testSystemHealth(adminToken);
    
    // Print final results
    console.log('\n' + '='.repeat(70));
    console.log('📊 ADMIN DASHBOARD - DRIVER APP INTEGRATION TEST RESULTS');
    console.log('='.repeat(70));
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
    
    console.log('\n' + '='.repeat(70));
    
    // Summary of integration status
    console.log('\n📋 Integration Status Summary:');
    console.log(`✅ WebSocket Communication: ${websocketSuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ Driver Monitoring: ${monitoringSuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ Booking Management: ${bookingSuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ Emergency Alerts: ${emergencySuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ Driver Verification: ${verificationSuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ System Health: ${healthSuccess ? 'Working' : 'Failed'}`);
    
    if (testResults.failed === 0) {
      console.log('\n🎉 ALL INTEGRATION TESTS PASSED! Admin and Driver apps are fully connected!');
    } else {
      console.log('\n⚠️  Some integration tests failed. Please check the issues above.');
    }
    
  } catch (error) {
    console.error('❌ Test execution error:', error);
  }
}

// Run the tests
runAdminDriverIntegrationTest();
