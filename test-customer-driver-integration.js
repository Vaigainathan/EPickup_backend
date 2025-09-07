#!/usr/bin/env node

/**
 * Comprehensive Customer-Driver Integration Test
 * Tests the complete workflow from customer booking to driver completion
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

// Test 1: Customer Authentication
async function testCustomerAuth() {
  console.log('\n🔐 Testing Customer Authentication...');
  
  const phoneNumber = '+919876543210';
  
  // Send OTP
  const otpResponse = await makeRequest('POST', '/auth/send-otp', {
    phoneNumber,
    userType: 'customer'
  });
  
  if (otpResponse.success) {
    logTest('Customer OTP Send', true);
    
    // Verify OTP (using mock mode - OTP is always 123456)
    // First try login (without name)
    let verifyResponse = await makeRequest('POST', '/auth/verify-otp', {
      phoneNumber,
      otp: '123456',
      userType: 'customer'
    });
    
    // If login fails, try signup (with name)
    if (!verifyResponse.success) {
      verifyResponse = await makeRequest('POST', '/auth/verify-otp', {
        phoneNumber,
        otp: '123456',
        userType: 'customer',
        name: 'Test Customer'
      });
    }
    
    if (verifyResponse.success && verifyResponse.data.token) {
      logTest('Customer OTP Verify', true);
      return verifyResponse.data.token;
    } else {
      logTest('Customer OTP Verify', false, verifyResponse.error?.message || 'No token received');
    }
  } else {
    logTest('Customer OTP Send', false, otpResponse.error?.message || 'OTP send failed');
  }
  
  return null;
}

// Test 2: Driver Authentication
async function testDriverAuth() {
  console.log('\n🔐 Testing Driver Authentication...');
  
  const phoneNumber = '+919876543211';
  
  // Send OTP
  const otpResponse = await makeRequest('POST', '/auth/send-otp', {
    phoneNumber,
    userType: 'driver'
  });
  
  if (otpResponse.success) {
    logTest('Driver OTP Send', true);
    
    // Verify OTP (using mock mode - OTP is always 123456)
    // First try login (without name)
    let verifyResponse = await makeRequest('POST', '/auth/verify-otp', {
      phoneNumber,
      otp: '123456',
      userType: 'driver'
    });
    
    // If login fails, try signup (with name)
    if (!verifyResponse.success) {
      verifyResponse = await makeRequest('POST', '/auth/verify-otp', {
        phoneNumber,
        otp: '123456',
        userType: 'driver',
        name: 'Test Driver'
      });
    }
    
    if (verifyResponse.success && verifyResponse.data.token) {
      logTest('Driver OTP Verify', true);
      return verifyResponse.data.token;
    } else {
      logTest('Driver OTP Verify', false, verifyResponse.error?.message || 'No token received');
    }
  } else {
    logTest('Driver OTP Send', false, otpResponse.error?.message || 'OTP send failed');
  }
  
  return null;
}

// Test 3: Customer Creates Booking
async function testCustomerBooking(customerToken) {
  console.log('\n📦 Testing Customer Booking Creation...');
  
  const bookingData = {
    pickup: {
      name: 'Test Customer',
      phone: '+919876543210',
      address: '123 Test Street, Bangalore',
      coordinates: {
        latitude: 12.9716,
        longitude: 77.5946
      }
    },
    dropoff: {
      name: 'Test Destination',
      phone: '+919876543210',
      address: '456 Destination Road, Bangalore',
      coordinates: {
        latitude: 12.9352,
        longitude: 77.6245
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
    estimatedPickupTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    estimatedDeliveryTime: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  };
  
  const response = await makeRequest('POST', '/bookings', bookingData, customerToken);
  
  if (response.success && response.data.booking) {
    logTest('Customer Booking Creation', true);
    return response.data.booking;
  } else {
    logTest('Customer Booking Creation', false, response.error?.message || 'Booking creation failed');
    return null;
  }
}

// Test 4: Driver Accepts Booking
async function testDriverBookingAcceptance(driverToken, bookingId) {
  console.log('\n✅ Testing Driver Booking Acceptance...');
  
  const response = await makeRequest('POST', `/bookings/${bookingId}/accept`, {}, driverToken);
  
  if (response.success) {
    logTest('Driver Booking Acceptance', true);
    return true;
  } else {
    logTest('Driver Booking Acceptance', false, response.error?.message || 'Booking acceptance failed');
    return false;
  }
}

// Test 5: Real-time Location Updates
async function testLocationUpdates(driverToken, bookingId) {
  console.log('\n📍 Testing Real-time Location Updates...');
  
  const locationData = {
    bookingId,
    location: {
      lat: 12.9716,
      lng: 77.5946
    },
    estimatedArrival: 15
  };
  
  const response = await makeRequest('POST', '/realtime/location/update', locationData, driverToken);
  
  if (response.success) {
    logTest('Driver Location Update', true);
    return true;
  } else {
    logTest('Driver Location Update', false, response.error?.message || 'Location update failed');
    return false;
  }
}

// Test 6: Real-time Chat System
async function testChatSystem(customerToken, driverToken, bookingId) {
  console.log('\n💬 Testing Real-time Chat System...');
  
  // Test customer sending message
  const customerMessage = {
    bookingId,
    message: 'Hello driver, I\'m waiting at the pickup location',
    senderType: 'customer'
  };
  
  const customerResponse = await makeRequest('POST', '/realtime/chat/send', customerMessage, customerToken);
  
  if (customerResponse.success) {
    logTest('Customer Chat Message', true);
  } else {
    logTest('Customer Chat Message', false, customerResponse.error?.message || 'Customer message failed');
  }
  
  // Test driver sending message
  const driverMessage = {
    bookingId,
    message: 'On my way! ETA 5 minutes',
    senderType: 'driver'
  };
  
  const driverResponse = await makeRequest('POST', '/realtime/chat/send', driverMessage, driverToken);
  
  if (driverResponse.success) {
    logTest('Driver Chat Message', true);
  } else {
    logTest('Driver Chat Message', false, driverResponse.error?.message || 'Driver message failed');
  }
  
  return customerResponse.success && driverResponse.success;
}

// Test 7: Booking Status Updates
async function testBookingStatusUpdates(driverToken, bookingId) {
  console.log('\n📊 Testing Booking Status Updates...');
  
  const statusUpdates = [
    { status: 'in_progress', message: 'Trip started' },
    { status: 'completed', message: 'Trip completed' }
  ];
  
  let allPassed = true;
  
  for (const update of statusUpdates) {
    const response = await makeRequest('POST', `/bookings/${bookingId}/status`, update, driverToken);
    
    if (response.success) {
      logTest(`Booking Status Update: ${update.status}`, true);
    } else {
      logTest(`Booking Status Update: ${update.status}`, false, response.error?.message || 'Status update failed');
      allPassed = false;
    }
  }
  
  return allPassed;
}

// Test 8: WebSocket Connection Test
async function testWebSocketConnection(customerToken, driverToken) {
  console.log('\n🔌 Testing WebSocket Connections...');
  
  return new Promise((resolve) => {
    let customerConnected = false;
    let driverConnected = false;
    
    // Test customer WebSocket connection
    const customerSocket = io(BASE_URL, {
      auth: { token: customerToken },
      transports: ['websocket', 'polling'],
      timeout: 5000
    });
    
    customerSocket.on('connect', () => {
      customerConnected = true;
      logTest('Customer WebSocket Connection', true);
      customerSocket.disconnect();
      
      if (driverConnected) {
        resolve(true);
      }
    });
    
    customerSocket.on('connect_error', (error) => {
      logTest('Customer WebSocket Connection', false, error.message);
      if (driverConnected) {
        resolve(false);
      }
    });
    
    // Test driver WebSocket connection
    const driverSocket = io(BASE_URL, {
      auth: { token: driverToken },
      transports: ['websocket', 'polling'],
      timeout: 5000
    });
    
    driverSocket.on('connect', () => {
      driverConnected = true;
      logTest('Driver WebSocket Connection', true);
      driverSocket.disconnect();
      
      if (customerConnected) {
        resolve(true);
      }
    });
    
    driverSocket.on('connect_error', (error) => {
      logTest('Driver WebSocket Connection', false, error.message);
      if (customerConnected) {
        resolve(false);
      }
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!customerConnected) {
        logTest('Customer WebSocket Connection', false, 'Connection timeout');
      }
      if (!driverConnected) {
        logTest('Driver WebSocket Connection', false, 'Connection timeout');
      }
      resolve(customerConnected && driverConnected);
    }, 10000);
  });
}

// Main test function
async function runIntegrationTests() {
  console.log('🚀 Starting Customer-Driver Integration Tests...\n');
  console.log(`Testing against: ${BASE_URL}\n`);
  
  try {
    // Test 1: Customer Authentication
    const customerToken = await testCustomerAuth();
    if (!customerToken) {
      console.log('\n❌ Customer authentication failed. Stopping tests.');
      return;
    }
    
    // Test 2: Driver Authentication
    const driverToken = await testDriverAuth();
    if (!driverToken) {
      console.log('\n❌ Driver authentication failed. Stopping tests.');
      return;
    }
    
    // Test 3: Customer Creates Booking
    const booking = await testCustomerBooking(customerToken);
    if (!booking) {
      console.log('\n❌ Booking creation failed. Stopping tests.');
      return;
    }
    
    const bookingId = booking.id;
    console.log(`📦 Created booking: ${bookingId}`);
    
    // Test 4: Driver Accepts Booking
    const acceptanceSuccess = await testDriverBookingAcceptance(driverToken, bookingId);
    
    // Test 5: Real-time Location Updates
    const locationSuccess = await testLocationUpdates(driverToken, bookingId);
    
    // Test 6: Real-time Chat System
    const chatSuccess = await testChatSystem(customerToken, driverToken, bookingId);
    
    // Test 7: Booking Status Updates
    const statusSuccess = await testBookingStatusUpdates(driverToken, bookingId);
    
    // Test 8: WebSocket Connection Test
    const websocketSuccess = await testWebSocketConnection(customerToken, driverToken);
    
    // Print final results
    console.log('\n' + '='.repeat(60));
    console.log('📊 INTEGRATION TEST RESULTS');
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
      console.log('🎉 ALL TESTS PASSED! Customer-Driver integration is working perfectly!');
    } else {
      console.log('⚠️  Some tests failed. Please check the issues above.');
    }
    
  } catch (error) {
    console.error('❌ Test execution error:', error);
  }
}

// Run the tests
runIntegrationTests();
