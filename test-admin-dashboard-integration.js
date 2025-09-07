#!/usr/bin/env node

/**
 * Admin Dashboard Integration Test
 * Tests all real-time features and functionality of the admin dashboard
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

// Test 2: Admin Dashboard API Endpoints
async function testAdminEndpoints(adminToken) {
  console.log('\n📊 Testing Admin Dashboard API Endpoints...');
  
  const endpoints = [
    { name: 'Get Drivers', endpoint: '/admin/drivers', method: 'GET' },
    { name: 'Get Bookings', endpoint: '/admin/bookings', method: 'GET' },
    { name: 'Get Emergency Alerts', endpoint: '/admin/emergency-alerts', method: 'GET' },
    { name: 'Get System Health', endpoint: '/admin/system-health', method: 'GET' },
    { name: 'Get Support Tickets', endpoint: '/admin/support-tickets', method: 'GET' }
  ];
  
  let allPassed = true;
  
  for (const endpoint of endpoints) {
    const response = await makeRequest(endpoint.method, endpoint.endpoint, null, adminToken);
    
    if (response.success) {
      logTest(endpoint.name, true);
    } else {
      logTest(endpoint.name, false, response.error?.message || 'API call failed');
      allPassed = false;
    }
  }
  
  return allPassed;
}

// Test 3: WebSocket Connection
async function testWebSocketConnection(adminToken) {
  console.log('\n🔌 Testing Admin WebSocket Connection...');
  
  return new Promise((resolve) => {
    const adminSocket = io(BASE_URL, {
      auth: { 
        token: adminToken,
        userType: 'admin'
      },
      transports: ['websocket', 'polling'],
      timeout: 5000
    });
    
    let connected = false;
    
    adminSocket.on('connect', () => {
      connected = true;
      logTest('Admin WebSocket Connection', true);
      adminSocket.disconnect();
      resolve(true);
    });
    
    adminSocket.on('connect_error', (error) => {
      logTest('Admin WebSocket Connection', false, error.message);
      resolve(false);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!connected) {
        logTest('Admin WebSocket Connection', false, 'Connection timeout');
      }
      resolve(connected);
    }, 10000);
  });
}

// Test 4: Real-time Event Handling
async function testRealTimeEvents(adminToken) {
  console.log('\n📡 Testing Real-time Event Handling...');
  
  return new Promise((resolve) => {
    const adminSocket = io(BASE_URL, {
      auth: { 
        token: adminToken,
        userType: 'admin'
      },
      transports: ['websocket', 'polling'],
      timeout: 5000
    });
    
    let eventsReceived = 0;
    const expectedEvents = ['connected', 'auth_status_update'];
    
    adminSocket.on('connect', () => {
      console.log('✅ Admin WebSocket connected for event testing');
      
      // Test room subscriptions
      adminSocket.emit('join_room', { room: 'admin_drivers' });
      adminSocket.emit('join_room', { room: 'admin_bookings' });
      adminSocket.emit('join_room', { room: 'admin_emergency' });
    });
    
    adminSocket.on('connected', (data) => {
      eventsReceived++;
      console.log('📡 Received connected event:', data);
    });
    
    adminSocket.on('auth_status_update', (data) => {
      eventsReceived++;
      console.log('📡 Received auth status update:', data);
    });
    
    adminSocket.on('room_joined', (data) => {
      console.log('📡 Room joined:', data);
    });
    
    adminSocket.on('driver_status_update', (data) => {
      console.log('📡 Driver status update received:', data);
      eventsReceived++;
    });
    
    adminSocket.on('booking_status_update', (data) => {
      console.log('📡 Booking status update received:', data);
      eventsReceived++;
    });
    
    adminSocket.on('emergency_alert', (data) => {
      console.log('📡 Emergency alert received:', data);
      eventsReceived++;
    });
    
    // Test after 5 seconds
    setTimeout(() => {
      adminSocket.disconnect();
      
      if (eventsReceived >= 2) {
        logTest('Real-time Event Handling', true);
        resolve(true);
      } else {
        logTest('Real-time Event Handling', false, `Only received ${eventsReceived} events`);
        resolve(false);
      }
    }, 5000);
  });
}

// Test 5: Admin Room Subscriptions
async function testAdminRoomSubscriptions(adminToken) {
  console.log('\n🚪 Testing Admin Room Subscriptions...');
  
  return new Promise((resolve) => {
    const adminSocket = io(BASE_URL, {
      auth: { 
        token: adminToken,
        userType: 'admin'
      },
      transports: ['websocket', 'polling'],
      timeout: 5000
    });
    
    let roomsJoined = 0;
    const adminRooms = [
      'admin_drivers',
      'admin_bookings', 
      'admin_emergency',
      'admin_system',
      'admin_locations',
      'admin_chat',
      'admin_support',
      'admin_eta'
    ];
    
    adminSocket.on('connect', () => {
      console.log('✅ Admin WebSocket connected for room testing');
      
      // Join all admin rooms
      adminRooms.forEach(room => {
        adminSocket.emit('join_room', { room });
      });
    });
    
    adminSocket.on('room_joined', (data) => {
      roomsJoined++;
      console.log(`🚪 Joined room: ${data.room}`);
    });
    
    adminSocket.on('room_left', (data) => {
      console.log(`🚪 Left room: ${data.room}`);
    });
    
    // Test after 3 seconds
    setTimeout(() => {
      adminSocket.disconnect();
      
      if (roomsJoined >= adminRooms.length) {
        logTest('Admin Room Subscriptions', true);
        resolve(true);
      } else {
        logTest('Admin Room Subscriptions', false, `Only joined ${roomsJoined}/${adminRooms.length} rooms`);
        resolve(false);
      }
    }, 3000);
  });
}

// Test 6: Admin Dashboard Data Fetching
async function testAdminDataFetching(adminToken) {
  console.log('\n📊 Testing Admin Dashboard Data Fetching...');
  
  // Test drivers data
  const driversResponse = await makeRequest('GET', '/admin/drivers', null, adminToken);
  if (driversResponse.success) {
    logTest('Fetch Drivers Data', true);
  } else {
    logTest('Fetch Drivers Data', false, driversResponse.error?.message || 'Failed to fetch drivers');
  }
  
  // Test bookings data
  const bookingsResponse = await makeRequest('GET', '/admin/bookings', null, adminToken);
  if (bookingsResponse.success) {
    logTest('Fetch Bookings Data', true);
  } else {
    logTest('Fetch Bookings Data', false, bookingsResponse.error?.message || 'Failed to fetch bookings');
  }
  
  // Test emergency alerts data
  const alertsResponse = await makeRequest('GET', '/admin/emergency-alerts', null, adminToken);
  if (alertsResponse.success) {
    logTest('Fetch Emergency Alerts Data', true);
  } else {
    logTest('Fetch Emergency Alerts Data', false, alertsResponse.error?.message || 'Failed to fetch alerts');
  }
  
  return driversResponse.success && bookingsResponse.success && alertsResponse.success;
}

// Main test function
async function runAdminDashboardTests() {
  console.log('🚀 Starting Admin Dashboard Integration Tests...\n');
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
    
    // Test 3: WebSocket Connection
    const websocketSuccess = await testWebSocketConnection(adminToken);
    
    // Test 4: Real-time Event Handling
    const eventsSuccess = await testRealTimeEvents(adminToken);
    
    // Test 5: Admin Room Subscriptions
    const roomsSuccess = await testAdminRoomSubscriptions(adminToken);
    
    // Test 6: Admin Dashboard Data Fetching
    const dataSuccess = await testAdminDataFetching(adminToken);
    
    // Print final results
    console.log('\n' + '='.repeat(60));
    console.log('📊 ADMIN DASHBOARD INTEGRATION TEST RESULTS');
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
    
    if (testResults.failed === 0) {
      console.log('🎉 ALL TESTS PASSED! Admin dashboard is fully functional!');
    } else {
      console.log('⚠️  Some tests failed. Please check the issues above.');
    }
    
    // Summary of real-time features
    console.log('\n📋 Real-time Features Status:');
    console.log(`✅ WebSocket Connection: ${websocketSuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ Event Handling: ${eventsSuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ Room Subscriptions: ${roomsSuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ Data Fetching: ${dataSuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ API Endpoints: ${endpointsSuccess ? 'Working' : 'Failed'}`);
    
  } catch (error) {
    console.error('❌ Test execution error:', error);
  }
}

// Run the tests
runAdminDashboardTests();
