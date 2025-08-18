#!/usr/bin/env node

/**
 * Real-time Communication System Test Script
 * Tests WebSocket, Socket.IO, live tracking, and push notifications
 */

const io = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

// Configuration
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const TEST_DURATION = 30000; // 30 seconds
const LOCATION_UPDATE_INTERVAL = 5000; // 5 seconds

// Test data
const testUsers = {
  customer: {
    id: 'test_customer_' + uuidv4(),
    type: 'customer',
    role: 'customer',
    token: 'test_customer_token_' + uuidv4()
  },
  driver: {
    id: 'test_driver_' + uuidv4(),
    type: 'driver',
    role: 'driver',
    token: 'test_driver_token_' + uuidv4()
  }
};

const testTrip = {
  id: 'test_trip_' + uuidv4(),
  pickup: {
    coordinates: { latitude: 12.9716, longitude: 77.5946 },
    address: 'Test Pickup Location'
  },
  dropoff: {
    coordinates: { latitude: 12.9789, longitude: 77.5917 },
    address: 'Test Dropoff Location'
  }
};

// Test results
const testResults = {
  passed: 0,
  failed: 0,
  total: 0,
  details: []
};

/**
 * Log test results
 */
function logTest(testName, passed, details = '') {
  testResults.total++;
  if (passed) {
    testResults.passed++;
    console.log(`✅ ${testName} - PASSED`);
  } else {
    testResults.failed++;
    console.log(`❌ ${testName} - FAILED`);
    if (details) console.log(`   Details: ${details}`);
  }
  
  testResults.details.push({
    name: testName,
    passed,
    details
  });
}

/**
 * Test WebSocket connection
 */
async function testWebSocketConnection() {
  return new Promise((resolve) => {
    console.log('\n🔌 Testing WebSocket Connection...');
    
    const socket = io(SERVER_URL, {
      auth: {
        token: testUsers.customer.token
      },
      transports: ['websocket']
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      logTest('WebSocket Connection', false, 'Connection timeout');
      resolve(false);
    }, 10000);

    socket.on('connect', () => {
      clearTimeout(timeout);
      logTest('WebSocket Connection', true);
      socket.disconnect();
      resolve(true);
    });

    socket.on('connect_error', (error) => {
      clearTimeout(timeout);
      logTest('WebSocket Connection', false, error.message);
      resolve(false);
    });
  });
}

/**
 * Test Socket.IO authentication
 */
async function testSocketAuthentication() {
  return new Promise((resolve) => {
    console.log('\n🔐 Testing Socket.IO Authentication...');
    
    // Test with invalid token
    const invalidSocket = io(SERVER_URL, {
      auth: {
        token: 'invalid_token'
      }
    });

    const timeout = setTimeout(() => {
      invalidSocket.disconnect();
      logTest('Socket Authentication - Invalid Token', false, 'No rejection received');
      resolve(false);
    }, 5000);

    invalidSocket.on('connect_error', (error) => {
      clearTimeout(timeout);
      logTest('Socket Authentication - Invalid Token', true);
      invalidSocket.disconnect();
      resolve(true);
    });

    invalidSocket.on('connect', () => {
      clearTimeout(timeout);
      logTest('Socket Authentication - Invalid Token', false, 'Connection should have been rejected');
      invalidSocket.disconnect();
      resolve(false);
    });
  });
}

/**
 * Test tracking subscription
 */
async function testTrackingSubscription() {
  return new Promise((resolve) => {
    console.log('\n📍 Testing Tracking Subscription...');
    
    const socket = io(SERVER_URL, {
      auth: {
        token: testUsers.customer.token
      }
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      logTest('Tracking Subscription', false, 'Subscription confirmation timeout');
      resolve(false);
    }, 10000);

    socket.on('connected', () => {
      // Subscribe to tracking
      socket.emit('subscribe_tracking', { tripId: testTrip.id });
    });

    socket.on('tracking_subscribed', (data) => {
      clearTimeout(timeout);
      if (data.success && data.data.tripId === testTrip.id) {
        logTest('Tracking Subscription', true);
        socket.disconnect();
        resolve(true);
      } else {
        logTest('Tracking Subscription', false, 'Invalid subscription response');
        socket.disconnect();
        resolve(false);
      }
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      logTest('Tracking Subscription', false, error.message);
      socket.disconnect();
      resolve(false);
    });
  });
}

/**
 * Test location updates
 */
async function testLocationUpdates() {
  return new Promise((resolve) => {
    console.log('\n📍 Testing Location Updates...');
    
    const customerSocket = io(SERVER_URL, {
      auth: {
        token: testUsers.customer.token
      }
    });

    const driverSocket = io(SERVER_URL, {
      auth: {
        token: testUsers.driver.token
      }
    });

    let locationReceived = false;
    const timeout = setTimeout(() => {
      customerSocket.disconnect();
      driverSocket.disconnect();
      logTest('Location Updates', false, 'Location update timeout');
      resolve(false);
    }, 15000);

    customerSocket.on('connected', () => {
      // Subscribe to tracking
      customerSocket.emit('subscribe_tracking', { tripId: testTrip.id });
    });

    driverSocket.on('connected', () => {
      // Wait a bit then send location update
      setTimeout(() => {
        const location = {
          latitude: 12.9720,
          longitude: 77.5950,
          accuracy: 10,
          speed: 25,
          bearing: 45
        };
        
        driverSocket.emit('update_location', {
          tripId: testTrip.id,
          location
        });
      }, 2000);
    });

    customerSocket.on('location_updated', (data) => {
      if (data.tripId === testTrip.id && data.location) {
        locationReceived = true;
        logTest('Location Updates', true);
        clearTimeout(timeout);
        customerSocket.disconnect();
        driverSocket.disconnect();
        resolve(true);
      }
    });

    customerSocket.on('error', (error) => {
      clearTimeout(timeout);
      logTest('Location Updates', false, error.message);
      customerSocket.disconnect();
      driverSocket.disconnect();
      resolve(false);
    });
  });
}

/**
 * Test chat functionality
 */
async function testChatFunctionality() {
  return new Promise((resolve) => {
    console.log('\n💬 Testing Chat Functionality...');
    
    const customerSocket = io(SERVER_URL, {
      auth: {
        token: testUsers.customer.token
      }
    });

    const driverSocket = io(SERVER_URL, {
      auth: {
        token: testUsers.driver.token
      }
    });

    let messageReceived = false;
    const timeout = setTimeout(() => {
      customerSocket.disconnect();
      driverSocket.disconnect();
      logTest('Chat Functionality', false, 'Chat message timeout');
      resolve(false);
    }, 15000);

    customerSocket.on('connected', () => {
      // Subscribe to tracking for chat
      customerSocket.emit('subscribe_tracking', { tripId: testTrip.id });
    });

    driverSocket.on('connected', () => {
      // Subscribe to tracking for chat
      driverSocket.emit('subscribe_tracking', { tripId: testTrip.id });
    });

    customerSocket.on('tracking_subscribed', () => {
      driverSocket.on('tracking_subscribed', () => {
        // Send chat message
        setTimeout(() => {
          driverSocket.emit('send_message', {
            tripId: testTrip.id,
            message: 'Hello from driver!',
            recipientId: testUsers.customer.id
          });
        }, 1000);
      });
    });

    customerSocket.on('chat_message', (data) => {
      if (data.tripId === testTrip.id && data.message === 'Hello from driver!') {
        messageReceived = true;
        logTest('Chat Functionality', true);
        clearTimeout(timeout);
        customerSocket.disconnect();
        driverSocket.disconnect();
        resolve(true);
      }
    });

    customerSocket.on('error', (error) => {
      clearTimeout(timeout);
      logTest('Chat Functionality', false, error.message);
      customerSocket.disconnect();
      driverSocket.disconnect();
      resolve(false);
    });
  });
}

/**
 * Test typing indicators
 */
async function testTypingIndicators() {
  return new Promise((resolve) => {
    console.log('\n⌨️ Testing Typing Indicators...');
    
    const customerSocket = io(SERVER_URL, {
      auth: {
        token: testUsers.customer.token
      }
    });

    const driverSocket = io(SERVER_URL, {
      auth: {
        token: testUsers.driver.token
      }
    });

    let typingIndicatorReceived = false;
    const timeout = setTimeout(() => {
      customerSocket.disconnect();
      driverSocket.disconnect();
      logTest('Typing Indicators', false, 'Typing indicator timeout');
      resolve(false);
    }, 15000);

    customerSocket.on('connected', () => {
      customerSocket.emit('subscribe_tracking', { tripId: testTrip.id });
    });

    driverSocket.on('connected', () => {
      driverSocket.emit('subscribe_tracking', { tripId: testTrip.id });
    });

    customerSocket.on('tracking_subscribed', () => {
      driverSocket.on('tracking_subscribed', () => {
        // Send typing start indicator
        setTimeout(() => {
          driverSocket.emit('typing_start', {
            tripId: testTrip.id,
            recipientId: testUsers.customer.id
          });
        }, 1000);
      });
    });

    customerSocket.on('typing_indicator', (data) => {
      if (data.tripId === testTrip.id && data.isTyping) {
        typingIndicatorReceived = true;
        logTest('Typing Indicators', true);
        clearTimeout(timeout);
        customerSocket.disconnect();
        driverSocket.disconnect();
        resolve(true);
      }
    });

    customerSocket.on('error', (error) => {
      clearTimeout(timeout);
      logTest('Typing Indicators', false, error.message);
      customerSocket.disconnect();
      driverSocket.disconnect();
      resolve(false);
    });
  });
}

/**
 * Test emergency alerts
 */
async function testEmergencyAlerts() {
  return new Promise((resolve) => {
    console.log('\n🚨 Testing Emergency Alerts...');
    
    const customerSocket = io(SERVER_URL, {
      auth: {
        token: testUsers.customer.token
      }
    });

    const driverSocket = io(SERVER_URL, {
      auth: {
        token: testUsers.driver.token
      }
    });

    let emergencyAlertReceived = false;
    const timeout = setTimeout(() => {
      customerSocket.disconnect();
      driverSocket.disconnect();
      logTest('Emergency Alerts', false, 'Emergency alert timeout');
      resolve(false);
    }, 15000);

    customerSocket.on('connected', () => {
      customerSocket.emit('subscribe_tracking', { tripId: testTrip.id });
    });

    driverSocket.on('connected', () => {
      customerSocket.on('tracking_subscribed', () => {
        // Send emergency alert
        setTimeout(() => {
          driverSocket.emit('emergency_alert', {
            tripId: testTrip.id,
            alertType: 'accident',
            alertData: {
              description: 'Minor accident occurred',
              location: { latitude: 12.9720, longitude: 77.5950 }
            }
          });
        }, 1000);
      });
    });

    customerSocket.on('emergency_alert', (data) => {
      if (data.tripId === testTrip.id && data.alertType === 'accident') {
        emergencyAlertReceived = true;
        logTest('Emergency Alerts', true);
        clearTimeout(timeout);
        customerSocket.disconnect();
        driverSocket.disconnect();
        resolve(true);
      }
    });

    customerSocket.on('error', (error) => {
      clearTimeout(timeout);
      logTest('Emergency Alerts', false, error.message);
      customerSocket.disconnect();
      driverSocket.disconnect();
      resolve(false);
    });
  });
}

/**
 * Test presence updates
 */
async function testPresenceUpdates() {
  return new Promise((resolve) => {
    console.log('\n👤 Testing Presence Updates...');
    
    const customerSocket = io(SERVER_URL, {
      auth: {
        token: testUsers.customer.token
      }
    });

    const driverSocket = io(SERVER_URL, {
      auth: {
        token: testUsers.driver.token
      }
    });

    let presenceUpdateReceived = false;
    const timeout = setTimeout(() => {
      customerSocket.disconnect();
      driverSocket.disconnect();
      logTest('Presence Updates', false, 'Presence update timeout');
      resolve(false);
    }, 15000);

    customerSocket.on('connected', () => {
      // Wait for driver to update presence
    });

    driverSocket.on('connected', () => {
      // Update presence
      setTimeout(() => {
        driverSocket.emit('presence_update', {
          status: 'busy',
          location: { latitude: 12.9720, longitude: 77.5950 },
          tripId: testTrip.id
        });
      }, 1000);
    });

    customerSocket.on('presence_updated', (data) => {
      if (data.userId === testUsers.driver.id && data.status === 'busy') {
        presenceUpdateReceived = true;
        logTest('Presence Updates', true);
        clearTimeout(timeout);
        customerSocket.disconnect();
        driverSocket.disconnect();
        resolve(true);
      }
    });

    customerSocket.on('error', (error) => {
      clearTimeout(timeout);
      logTest('Presence Updates', false, error.message);
      customerSocket.disconnect();
      driverSocket.disconnect();
      resolve(false);
    });
  });
}

/**
 * Test connection statistics
 */
async function testConnectionStatistics() {
  return new Promise((resolve) => {
    console.log('\n📊 Testing Connection Statistics...');
    
    const socket = io(SERVER_URL, {
      auth: {
        token: testUsers.customer.token
      }
    });

    const timeout = setTimeout(() => {
      socket.disconnect();
      logTest('Connection Statistics', false, 'Statistics check timeout');
      resolve(false);
    }, 10000);

    socket.on('connected', () => {
      // Connection successful, test passed
      logTest('Connection Statistics', true);
      clearTimeout(timeout);
      socket.disconnect();
      resolve(true);
    });

    socket.on('connect_error', (error) => {
      clearTimeout(timeout);
      logTest('Connection Statistics', false, error.message);
      resolve(false);
    });
  });
}

/**
 * Test disconnection handling
 */
async function testDisconnectionHandling() {
  return new Promise((resolve) => {
    console.log('\n🔌 Testing Disconnection Handling...');
    
    const socket = io(SERVER_URL, {
      auth: {
        token: testUsers.customer.token
      }
    });

    const timeout = setTimeout(() => {
      logTest('Disconnection Handling', false, 'Disconnection test timeout');
      resolve(false);
    }, 10000);

    socket.on('connected', () => {
      // Disconnect after connection
      setTimeout(() => {
        socket.disconnect();
      }, 1000);
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') {
        logTest('Disconnection Handling', true);
        clearTimeout(timeout);
        resolve(true);
      }
    });

    socket.on('connect_error', (error) => {
      clearTimeout(timeout);
      logTest('Disconnection Handling', false, error.message);
      resolve(false);
    });
  });
}

/**
 * Test multiple concurrent connections
 */
async function testConcurrentConnections() {
  return new Promise((resolve) => {
    console.log('\n🔗 Testing Concurrent Connections...');
    
    const connections = [];
    const maxConnections = 5;
    let successfulConnections = 0;
    let failedConnections = 0;

    const timeout = setTimeout(() => {
      connections.forEach(conn => conn.disconnect());
      const passed = successfulConnections === maxConnections;
      logTest('Concurrent Connections', passed, 
        `${successfulConnections}/${maxConnections} successful connections`);
      resolve(passed);
    }, 15000);

    for (let i = 0; i < maxConnections; i++) {
      const socket = io(SERVER_URL, {
        auth: {
          token: `test_token_${i}_${uuidv4()}`
        }
      });

      connections.push(socket);

      socket.on('connect', () => {
        successfulConnections++;
      });

      socket.on('connect_error', () => {
        failedConnections++;
      });
    }
  });
}

/**
 * Test real-time performance
 */
async function testRealTimePerformance() {
  return new Promise((resolve) => {
    console.log('\n⚡ Testing Real-time Performance...');
    
    const customerSocket = io(SERVER_URL, {
      auth: {
        token: testUsers.customer.token
      }
    });

    const driverSocket = io(SERVER_URL, {
      auth: {
        token: testUsers.driver.token
      }
    });

    let messageCount = 0;
    const maxMessages = 10;
    const startTime = Date.now();
    
    const timeout = setTimeout(() => {
      customerSocket.disconnect();
      driverSocket.disconnect();
      const passed = messageCount === maxMessages;
      const duration = Date.now() - startTime;
      logTest('Real-time Performance', passed, 
        `${messageCount}/${maxMessages} messages in ${duration}ms`);
      resolve(passed);
    }, 20000);

    customerSocket.on('connected', () => {
      customerSocket.emit('subscribe_tracking', { tripId: testTrip.id });
    });

    driverSocket.on('connected', () => {
      customerSocket.on('tracking_subscribed', () => {
        // Send multiple rapid messages
        for (let i = 0; i < maxMessages; i++) {
          setTimeout(() => {
            driverSocket.emit('send_message', {
              tripId: testTrip.id,
              message: `Test message ${i + 1}`,
              recipientId: testUsers.customer.id
            });
          }, i * 100);
        }
      });
    });

    customerSocket.on('chat_message', (data) => {
      if (data.tripId === testTrip.id) {
        messageCount++;
      }
    });

    customerSocket.on('error', (error) => {
      clearTimeout(timeout);
      logTest('Real-time Performance', false, error.message);
      customerSocket.disconnect();
      driverSocket.disconnect();
      resolve(false);
    });
  });
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🚀 Starting Real-time Communication System Tests...');
  console.log(`📡 Server URL: ${SERVER_URL}`);
  console.log(`⏱️ Test Duration: ${TEST_DURATION / 1000} seconds`);
  console.log('=' * 60);

  const startTime = Date.now();

  try {
    // Run all tests
    await testWebSocketConnection();
    await testSocketAuthentication();
    await testTrackingSubscription();
    await testLocationUpdates();
    await testChatFunctionality();
    await testTypingIndicators();
    await testEmergencyAlerts();
    await testPresenceUpdates();
    await testConnectionStatistics();
    await testDisconnectionHandling();
    await testConcurrentConnections();
    await testRealTimePerformance();

  } catch (error) {
    console.error('❌ Test execution error:', error);
  }

  const duration = Date.now() - startTime;

  // Print results
  console.log('\n' + '=' * 60);
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('=' * 60);
  console.log(`✅ Passed: ${testResults.passed}`);
  console.log(`❌ Failed: ${testResults.failed}`);
  console.log(`📊 Total: ${testResults.total}`);
  console.log(`⏱️ Duration: ${duration}ms`);
  console.log(`📈 Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);

  if (testResults.failed > 0) {
    console.log('\n❌ FAILED TESTS:');
    testResults.details
      .filter(test => !test.passed)
      .forEach(test => {
        console.log(`   • ${test.name}: ${test.details}`);
      });
  }

  console.log('\n' + '=' * 60);
  
  if (testResults.failed === 0) {
    console.log('🎉 All tests passed! Real-time communication system is working correctly.');
    process.exit(0);
  } else {
    console.log('⚠️ Some tests failed. Please check the system configuration.');
    process.exit(1);
  }
}

/**
 * Cleanup function
 */
function cleanup() {
  console.log('\n🧹 Cleaning up...');
  process.exit(0);
}

// Handle process termination
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Run tests if this script is executed directly
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('❌ Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = {
  runAllTests,
  testResults
};
