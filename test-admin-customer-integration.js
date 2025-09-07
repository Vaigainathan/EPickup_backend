#!/usr/bin/env node

/**
 * Admin Dashboard - Customer App Integration Test
 * Tests all communication and integration between admin dashboard and customer app
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

// Test 2: Customer Authentication
async function testCustomerAuth() {
  console.log('\n👤 Testing Customer Authentication...');
  
  const phoneNumber = '+919876543211'; // Different from driver
  
  // Send OTP
  const otpResponse = await makeRequest('POST', '/auth/send-otp', {
    phoneNumber,
    userType: 'customer'
  });
  
  if (!otpResponse.success) {
    logTest('Customer OTP Send', false, otpResponse.error?.message || 'Failed to send OTP');
    return null;
  }
  
  logTest('Customer OTP Send', true);
  
  // Verify OTP (using mock mode - OTP is always 123456)
  const verifyResponse = await makeRequest('POST', '/auth/verify-otp', {
    phoneNumber,
    otp: '123456',
    userType: 'customer',
    name: 'Test Customer'
  });
  
  if (verifyResponse.success && verifyResponse.data.token) {
    logTest('Customer OTP Verify', true);
    return verifyResponse.data.token;
  } else {
    logTest('Customer OTP Verify', false, verifyResponse.error?.message || 'No token received');
    return null;
  }
}

// Test 3: Admin-Customer WebSocket Communication
async function testAdminCustomerWebSocket(adminToken, customerToken) {
  console.log('\n🔌 Testing Admin-Customer WebSocket Communication...');
  
  return new Promise((resolve) => {
    let adminSocket = null;
    let customerSocket = null;
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
    
    // Connect Customer WebSocket
    customerSocket = io(BASE_URL, {
      auth: { 
        token: customerToken,
        userType: 'customer'
      },
      transports: ['websocket', 'polling'],
      timeout: 5000
    });
    
    adminSocket.on('connect', () => {
      console.log('✅ Admin WebSocket connected');
      
      // Join admin rooms
      adminSocket.emit('join_room', { room: 'admin_customers' });
      adminSocket.emit('join_room', { room: 'admin_bookings' });
      adminSocket.emit('join_room', { room: 'admin_support' });
    });
    
    customerSocket.on('connect', () => {
      console.log('✅ Customer WebSocket connected');
      connectionEstablished = true;
      
      // Test customer status update
      setTimeout(() => {
        customerSocket.emit('update_customer_status', {
          status: 'active',
          location: {
            latitude: 12.4950,
            longitude: 78.5678,
            address: 'Test Customer Location'
          }
        });
      }, 1000);
    });
    
    // Admin receives customer updates
    adminSocket.on('customer_update', (data) => {
      console.log('📡 Admin received customer update:', data);
      eventsReceived++;
    });
    
    // Customer receives confirmation
    customerSocket.on('customer_status_confirmed', (data) => {
      console.log('📡 Customer received status confirmation:', data);
      eventsReceived++;
    });
    
    // Test after 5 seconds
    setTimeout(() => {
      adminSocket.disconnect();
      customerSocket.disconnect();
      
      if (connectionEstablished && eventsReceived >= 1) {
        logTest('Admin-Customer WebSocket Communication', true);
        resolve(true);
      } else {
        logTest('Admin-Customer WebSocket Communication', false, `Only received ${eventsReceived} events`);
        resolve(false);
      }
    }, 5000);
  });
}

// Test 4: Customer Monitoring from Admin Dashboard
async function testCustomerMonitoring(adminToken, customerToken) {
  console.log('\n👁️ Testing Customer Monitoring from Admin Dashboard...');
  
  // Test admin can fetch customer data (if endpoint exists)
  const customersResponse = await makeRequest('GET', '/admin/customers', null, adminToken);
  
  if (customersResponse.success) {
    logTest('Admin Fetch Customers', true);
  } else if (customersResponse.status === 404) {
    logTest('Admin Fetch Customers', false, 'Endpoint not found - needs backend restart');
  } else {
    logTest('Admin Fetch Customers', false, customersResponse.error?.message || 'Failed to fetch customers');
  }
  
  // Test customer profile update
  const profileUpdateResponse = await makeRequest('PUT', '/customer/profile', {
    name: 'Updated Test Customer',
    email: 'testcustomer@example.com'
  }, customerToken);
  
  if (profileUpdateResponse.success) {
    logTest('Customer Profile Update', true);
  } else {
    logTest('Customer Profile Update', false, profileUpdateResponse.error?.message || 'Failed to update profile');
  }
  
  return customersResponse.success && profileUpdateResponse.success;
}

// Test 5: Booking Creation and Management
async function testBookingManagement(adminToken, customerToken) {
  console.log('\n📦 Testing Booking Creation and Management...');
  
  // Create a test booking
  const bookingResponse = await makeRequest('POST', '/bookings', {
    pickup: {
      name: 'Test Customer',
      phone: '+919876543211',
      address: '123 Test Street, Tirupattur',
      coordinates: {
        latitude: 12.4950,
        longitude: 78.5678
      }
    },
    dropoff: {
      name: 'Test Destination',
      phone: '+919876543211',
      address: '456 Destination Road, Tirupattur',
      coordinates: {
        latitude: 12.5050,
        longitude: 78.5778
      }
    },
    package: {
      weight: 5,
      description: 'Test package from customer'
    },
    vehicle: {
      type: '2_wheeler'
    },
    paymentMethod: 'cash',
    estimatedPickupTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    estimatedDeliveryTime: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  }, customerToken);
  
  if (bookingResponse.success) {
    logTest('Customer Create Booking', true);
    
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
    logTest('Customer Create Booking', false, bookingResponse.error?.message || 'Failed to create booking');
    return false;
  }
}

// Test 6: Support Ticket Management
async function testSupportTickets(adminToken, customerToken) {
  console.log('\n🎫 Testing Support Ticket Management...');
  
  // Customer creates support ticket
  const ticketResponse = await makeRequest('POST', '/support/tickets', {
    subject: 'Test Support Request',
    description: 'This is a test support ticket from customer',
    category: 'technical',
    priority: 'medium'
  }, customerToken);
  
  if (ticketResponse.success) {
    logTest('Customer Create Support Ticket', true);
    
    // Test admin can fetch support tickets
    const adminTicketsResponse = await makeRequest('GET', '/admin/support/tickets', null, adminToken);
    
    if (adminTicketsResponse.success) {
      logTest('Admin Fetch Support Tickets', true);
    } else if (adminTicketsResponse.status === 500 && adminTicketsResponse.error?.code?.includes('FAILED_PRECONDITION')) {
      logTest('Admin Fetch Support Tickets', false, 'Firestore index needed - will work after index creation');
    } else {
      logTest('Admin Fetch Support Tickets', false, adminTicketsResponse.error?.message || 'Failed to fetch tickets');
    }
    
    return adminTicketsResponse.success;
  } else {
    logTest('Customer Create Support Ticket', false, ticketResponse.error?.message || 'Failed to create support ticket');
    return false;
  }
}

// Test 7: Emergency Alert Communication
async function testEmergencyAlerts(adminToken, customerToken) {
  console.log('\n🚨 Testing Emergency Alert Communication...');
  
  // Customer sends emergency alert
  const emergencyResponse = await makeRequest('POST', '/emergency/alert', {
    alertType: 'sos',
    location: {
      latitude: 12.4950,
      longitude: 78.5678
    },
    message: 'Test emergency alert from customer'
  }, customerToken);
  
  if (emergencyResponse.success) {
    logTest('Customer Send Emergency Alert', true);
    
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
    logTest('Customer Send Emergency Alert', false, emergencyResponse.error?.message || 'Failed to send emergency alert');
    return false;
  }
}

// Test 8: Customer Account Management
async function testCustomerAccountManagement(adminToken, customerToken) {
  console.log('\n👤 Testing Customer Account Management...');
  
  // Test customer can update profile
  const profileResponse = await makeRequest('PUT', '/customer/profile', {
    name: 'Updated Customer Name',
    email: 'updated@example.com'
  }, customerToken);
  
  if (profileResponse.success) {
    logTest('Customer Profile Update', true);
  } else {
    logTest('Customer Profile Update', false, profileResponse.error?.message || 'Failed to update profile');
  }
  
  // Test customer can view their bookings
  const bookingsResponse = await makeRequest('GET', '/customer/bookings', null, customerToken);
  
  if (bookingsResponse.success) {
    logTest('Customer View Bookings', true);
  } else {
    logTest('Customer View Bookings', false, bookingsResponse.error?.message || 'Failed to fetch customer bookings');
  }
  
  return profileResponse.success && bookingsResponse.success;
}

// Test 9: System Health Monitoring
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
async function runAdminCustomerIntegrationTest() {
  console.log('🚀 Starting Admin Dashboard - Customer App Integration Test...\n');
  console.log(`Testing against: ${BASE_URL}\n`);
  
  try {
    // Test 1: Admin Authentication
    const adminToken = await testAdminAuth();
    if (!adminToken) {
      console.log('\n❌ Admin authentication failed. Stopping tests.');
      return;
    }
    
    // Test 2: Customer Authentication
    const customerToken = await testCustomerAuth();
    if (!customerToken) {
      console.log('\n❌ Customer authentication failed. Stopping tests.');
      return;
    }
    
    // Test 3: WebSocket Communication
    const websocketSuccess = await testAdminCustomerWebSocket(adminToken, customerToken);
    
    // Test 4: Customer Monitoring
    const monitoringSuccess = await testCustomerMonitoring(adminToken, customerToken);
    
    // Test 5: Booking Management
    const bookingSuccess = await testBookingManagement(adminToken, customerToken);
    
    // Test 6: Support Tickets
    const supportSuccess = await testSupportTickets(adminToken, customerToken);
    
    // Test 7: Emergency Alerts
    const emergencySuccess = await testEmergencyAlerts(adminToken, customerToken);
    
    // Test 8: Customer Account Management
    const accountSuccess = await testCustomerAccountManagement(adminToken, customerToken);
    
    // Test 9: System Health
    const healthSuccess = await testSystemHealth(adminToken);
    
    // Print final results
    console.log('\n' + '='.repeat(70));
    console.log('📊 ADMIN DASHBOARD - CUSTOMER APP INTEGRATION TEST RESULTS');
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
    console.log(`✅ Customer Monitoring: ${monitoringSuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ Booking Management: ${bookingSuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ Support Tickets: ${supportSuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ Emergency Alerts: ${emergencySuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ Account Management: ${accountSuccess ? 'Working' : 'Failed'}`);
    console.log(`✅ System Health: ${healthSuccess ? 'Working' : 'Failed'}`);
    
    if (testResults.failed === 0) {
      console.log('\n🎉 ALL INTEGRATION TESTS PASSED! Admin and Customer apps are fully connected!');
    } else {
      console.log('\n⚠️  Some integration tests failed. Please check the issues above.');
    }
    
  } catch (error) {
    console.error('❌ Test execution error:', error);
  }
}

// Run the tests
runAdminCustomerIntegrationTest();
