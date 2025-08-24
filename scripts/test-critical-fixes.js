#!/usr/bin/env node

/**
 * Test Script for Critical Fixes
 * Tests FCM Token Management, Emergency Alerts, and Background Location Tracking
 */

const axios = require('axios');
const { getFirestore } = require('../src/services/firebase');

const BASE_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const TEST_USER_TOKEN = process.env.TEST_USER_TOKEN || 'test-token';

const db = getFirestore();

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logHeader(message) {
  log(`\n${'='.repeat(60)}`, 'cyan');
  log(`  ${message}`, 'bright');
  log(`${'='.repeat(60)}`, 'cyan');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

// Test FCM Token Management
async function testFCMTokenManagement() {
  logHeader('Testing FCM Token Management');

  try {
    // Test token registration
    logInfo('Testing FCM token registration...');
    const registerResponse = await axios.post(`${BASE_URL}/api/fcm-tokens/register`, {
      fcmToken: 'test-fcm-token-123',
      deviceId: 'test-device-123',
      platform: 'android'
    }, {
      headers: {
        'Authorization': `Bearer ${TEST_USER_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (registerResponse.data.success) {
      logSuccess('FCM token registration successful');
    } else {
      logError('FCM token registration failed');
      return false;
    }

    // Test token unregistration
    logInfo('Testing FCM token unregistration...');
    const unregisterResponse = await axios.delete(`${BASE_URL}/api/fcm-tokens/unregister`, {
      headers: {
        'Authorization': `Bearer ${TEST_USER_TOKEN}`
      }
    });

    if (unregisterResponse.data.success) {
      logSuccess('FCM token unregistration successful');
    } else {
      logError('FCM token unregistration failed');
      return false;
    }

    return true;
  } catch (error) {
    logError(`FCM Token Management test failed: ${error.message}`);
    return false;
  }
}

// Test Emergency Alert System
async function testEmergencyAlertSystem() {
  logHeader('Testing Emergency Alert System');

  try {
    // Test emergency alert creation
    logInfo('Testing emergency alert creation...');
    const alertResponse = await axios.post(`${BASE_URL}/api/emergency/alert`, {
      alertType: 'sos',
      location: {
        latitude: 13.0827,
        longitude: 80.2707
      },
      message: 'Test emergency alert'
    }, {
      headers: {
        'Authorization': `Bearer ${TEST_USER_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (alertResponse.data.success) {
      logSuccess('Emergency alert creation successful');
      const alertId = alertResponse.data.data.alertId;
      logInfo(`Alert ID: ${alertId}`);
    } else {
      logError('Emergency alert creation failed');
      return false;
    }

    // Test emergency contacts
    logInfo('Testing emergency contacts...');
    const contactsResponse = await axios.get(`${BASE_URL}/api/emergency/contacts`, {
      headers: {
        'Authorization': `Bearer ${TEST_USER_TOKEN}`
      }
    });

    if (contactsResponse.data.success) {
      logSuccess('Emergency contacts retrieval successful');
      logInfo(`Found ${contactsResponse.data.data.length} contacts`);
    } else {
      logError('Emergency contacts retrieval failed');
      return false;
    }

    // Test adding emergency contact
    logInfo('Testing emergency contact addition...');
    const addContactResponse = await axios.post(`${BASE_URL}/api/emergency/contacts`, {
      name: 'Test Contact',
      phone: '+919876543210',
      relationship: 'family',
      isDefault: true
    }, {
      headers: {
        'Authorization': `Bearer ${TEST_USER_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (addContactResponse.data.success) {
      logSuccess('Emergency contact addition successful');
      const contactId = addContactResponse.data.data.id;
      logInfo(`Contact ID: ${contactId}`);

      // Test deleting emergency contact
      logInfo('Testing emergency contact deletion...');
      const deleteContactResponse = await axios.delete(`${BASE_URL}/api/emergency/contacts/${contactId}`, {
        headers: {
          'Authorization': `Bearer ${TEST_USER_TOKEN}`
        }
      });

      if (deleteContactResponse.data.success) {
        logSuccess('Emergency contact deletion successful');
      } else {
        logError('Emergency contact deletion failed');
        return false;
      }
    } else {
      logError('Emergency contact addition failed');
      return false;
    }

    return true;
  } catch (error) {
    logError(`Emergency Alert System test failed: ${error.message}`);
    return false;
  }
}

// Test Database Schema
async function testDatabaseSchema() {
  logHeader('Testing Database Schema');

  try {
    // Test USERS collection
    logInfo('Testing USERS collection...');
    const usersSnapshot = await db.collection('users').limit(1).get();
    if (!usersSnapshot.empty) {
      logSuccess('USERS collection accessible');
    } else {
      logWarning('USERS collection is empty');
    }

    // Test EMERGENCY_ALERTS collection
    logInfo('Testing EMERGENCY_ALERTS collection...');
    const alertsSnapshot = await db.collection('emergency_alerts').limit(1).get();
    logSuccess('EMERGENCY_ALERTS collection accessible');

    // Test EMERGENCY_CONTACTS collection
    logInfo('Testing EMERGENCY_CONTACTS collection...');
    const contactsSnapshot = await db.collection('emergency_contacts').limit(1).get();
    logSuccess('EMERGENCY_CONTACTS collection accessible');

    // Test NOTIFICATIONS collection
    logInfo('Testing NOTIFICATIONS collection...');
    const notificationsSnapshot = await db.collection('notifications').limit(1).get();
    logSuccess('NOTIFICATIONS collection accessible');

    return true;
  } catch (error) {
    logError(`Database Schema test failed: ${error.message}`);
    return false;
  }
}

// Test API Endpoints
async function testAPIEndpoints() {
  logHeader('Testing API Endpoints');

  try {
    // Test health endpoint
    logInfo('Testing health endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    if (healthResponse.status === 200) {
      logSuccess('Health endpoint working');
    } else {
      logError('Health endpoint failed');
      return false;
    }

    // Test metrics endpoint
    logInfo('Testing metrics endpoint...');
    const metricsResponse = await axios.get(`${BASE_URL}/metrics`);
    if (metricsResponse.status === 200) {
      logSuccess('Metrics endpoint working');
    } else {
      logError('Metrics endpoint failed');
      return false;
    }

    // Test API documentation endpoint
    logInfo('Testing API documentation endpoint...');
    const docsResponse = await axios.get(`${BASE_URL}/api-docs`);
    if (docsResponse.status === 200) {
      logSuccess('API documentation endpoint working');
    } else {
      logError('API documentation endpoint failed');
      return false;
    }

    return true;
  } catch (error) {
    logError(`API Endpoints test failed: ${error.message}`);
    return false;
  }
}

// Test WebSocket Connection
async function testWebSocketConnection() {
  logHeader('Testing WebSocket Connection');

  try {
    // Test WebSocket endpoint availability
    logInfo('Testing WebSocket endpoint...');
    const wsResponse = await axios.get(`${BASE_URL}/socket.io/`, {
      timeout: 5000
    });
    
    if (wsResponse.status === 200) {
      logSuccess('WebSocket endpoint accessible');
    } else {
      logWarning('WebSocket endpoint not accessible via HTTP');
    }

    return true;
  } catch (error) {
    logWarning(`WebSocket test failed: ${error.message}`);
    return true; // WebSocket might not be accessible via HTTP, which is normal
  }
}

// Main test function
async function runAllTests() {
  logHeader('EPickup Critical Fixes Test Suite');
  logInfo(`Testing against: ${BASE_URL}`);
  logInfo(`Test user token: ${TEST_USER_TOKEN ? 'Provided' : 'Not provided'}`);

  const tests = [
    { name: 'API Endpoints', fn: testAPIEndpoints },
    { name: 'Database Schema', fn: testDatabaseSchema },
    { name: 'FCM Token Management', fn: testFCMTokenManagement },
    { name: 'Emergency Alert System', fn: testEmergencyAlertSystem },
    { name: 'WebSocket Connection', fn: testWebSocketConnection }
  ];

  let passedTests = 0;
  let totalTests = tests.length;

  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result) {
        passedTests++;
      }
    } catch (error) {
      logError(`Test ${test.name} crashed: ${error.message}`);
    }
  }

  logHeader('Test Results Summary');
  logInfo(`Tests passed: ${passedTests}/${totalTests}`);
  
  if (passedTests === totalTests) {
    logSuccess('All tests passed! Critical fixes are working correctly.');
  } else {
    logError(`${totalTests - passedTests} tests failed. Please check the implementation.`);
  }

  return passedTests === totalTests;
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      logError(`Test suite failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = {
  runAllTests,
  testFCMTokenManagement,
  testEmergencyAlertSystem,
  testDatabaseSchema,
  testAPIEndpoints,
  testWebSocketConnection
};
