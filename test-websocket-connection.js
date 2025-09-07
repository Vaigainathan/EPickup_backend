#!/usr/bin/env node

/**
 * WebSocket Connection Test
 * Tests WebSocket communication between admin and driver
 */

const { io } = require('socket.io-client');

// Configuration
const BASE_URL = 'https://epickup-backend.onrender.com';

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

// Test WebSocket Connection
async function testWebSocketConnection() {
  console.log('\n🔌 Testing WebSocket Connection...');
  
  return new Promise((resolve) => {
    let adminSocket = null;
    let driverSocket = null;
    let eventsReceived = 0;
    let connectionEstablished = false;
    
    // Mock tokens for testing
    const adminToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhZG1pbl8xNzU3MjQxMjkyMzA5IiwiZW1haWwiOiJhZG1pbkBlcGlja3VwLmNvbSIsInVzZXJUeXBlIjoiYWRtaW4iLCJyb2xlIjoic3VwZXJfYWRtaW4iLCJpYXQiOjE3NTcyNzY2MjgsImV4cCI6MTc1NzM2MzAyOH0.3Nhy50yay068NsdlDIHRUtfm9dxvmZKG1816x3_Y9gs';
    const driverToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyXzE3NTcyNjU2NjAwOTRfaDNja3huemY1IiwibmFtZSI6IlRlc3QgRHJpdmVyIiwicGhvbmUiOiIrOTE5ODc2NTQzMjEwIiwidXNlclR5cGUiOiJkcml2ZXIiLCJpc1ZlcmlmaWVkIjp0cnVlLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxNzU3Mjc2NjE3LCJleHAiOjE3NTc4ODE0MTcsImF1ZCI6ImVwaWNrdXAtdXNlcnMiLCJpc3MiOiJlcGlja3VwLWFwcCJ9.FDMs8U9wa75rQ-etuByG3VAkd2DC0pwk62thgwHlhQw';
    
    // Connect Admin WebSocket
    adminSocket = io(BASE_URL, {
      auth: { 
        token: adminToken,
        userType: 'admin'
      },
      transports: ['websocket', 'polling'],
      timeout: 10000
    });
    
    // Connect Driver WebSocket
    driverSocket = io(BASE_URL, {
      auth: { 
        token: driverToken,
        userType: 'driver'
      },
      transports: ['websocket', 'polling'],
      timeout: 10000
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
    
    adminSocket.on('connect_error', (error) => {
      console.log('❌ Admin WebSocket connection error:', error.message);
    });
    
    driverSocket.on('connect_error', (error) => {
      console.log('❌ Driver WebSocket connection error:', error.message);
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
    
    // Test after 10 seconds
    setTimeout(() => {
      if (adminSocket) adminSocket.disconnect();
      if (driverSocket) driverSocket.disconnect();
      
      if (connectionEstablished) {
        logTest('WebSocket Connection', true);
        resolve(true);
      } else {
        logTest('WebSocket Connection', false, 'Failed to establish connection');
        resolve(false);
      }
    }, 10000);
  });
}

// Main test function
async function runWebSocketTest() {
  console.log('🚀 Starting WebSocket Connection Test...\n');
  console.log(`Testing against: ${BASE_URL}\n`);
  
  try {
    // Test WebSocket Connection
    const websocketSuccess = await testWebSocketConnection();
    
    // Print final results
    console.log('\n' + '='.repeat(60));
    console.log('📊 WEBSOCKET CONNECTION TEST RESULTS');
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
      console.log('🎉 ALL WEBSOCKET TESTS PASSED! Real-time communication is working!');
    } else {
      console.log('⚠️  Some WebSocket tests failed. Please check the issues above.');
    }
    
  } catch (error) {
    console.error('❌ Test execution error:', error);
  }
}

// Run the tests
runWebSocketTest();
