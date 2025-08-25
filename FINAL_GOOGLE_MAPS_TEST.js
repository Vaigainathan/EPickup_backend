// Final Comprehensive Google Maps Test - EPickup System
const axios = require('axios');

const BASE_URL = 'https://epickup-backend.onrender.com';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// Test results tracking
let testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  details: []
};

function addTestResult(testName, success, details = '') {
  testResults.total++;
  if (success) {
    testResults.passed++;
    logSuccess(`${testName}: PASSED`);
  } else {
    testResults.failed++;
    logError(`${testName}: FAILED`);
  }
  testResults.details.push({ testName, success, details });
}

// Test helper function
async function testEndpoint(endpoint, params = {}, testName) {
  try {
    logInfo(`Testing: ${testName}`);
    const response = await axios.get(`${BASE_URL}${endpoint}`, { 
      params,
      timeout: 10000 
    });
    
    if (response.status === 200 && response.data.success) {
      addTestResult(testName, true, `Response time: ${Date.now() - response.config.metadata?.startTime || 'N/A'}ms`);
      return response.data;
    } else {
      addTestResult(testName, false, `Status: ${response.status}, Success: ${response.data.success}`);
      return null;
    }
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    addTestResult(testName, false, errorMessage);
    return null;
  }
}

// Test 1: Server Health
async function testServerHealth() {
  logInfo('🏥 Testing Server Health...');
  
  try {
    const response = await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
    if (response.status === 200) {
      addTestResult('Server Health', true, `Uptime: ${response.data.uptime}s`);
      logSuccess(`Server is healthy - Uptime: ${Math.round(response.data.uptime)}s`);
    } else {
      addTestResult('Server Health', false, `Status: ${response.status}`);
    }
  } catch (error) {
    addTestResult('Server Health', false, error.message);
  }
}

// Test 2: Place Search
async function testPlaceSearch() {
  logInfo('🔍 Testing Place Search...');
  
  const testQueries = ['Mumbai', 'Delhi', 'Bangalore'];
  
  for (const query of testQueries) {
    const result = await testEndpoint('/api/google-maps/places', {
      input: query,
      types: 'geocode',
      components: 'country:in'
    }, `Place Search: "${query}"`);
    
    if (result && result.data && result.data.predictions && result.data.predictions.length > 0) {
      logSuccess(`Found ${result.data.predictions.length} results for "${query}"`);
    }
  }
}

// Test 3: Place Autocomplete
async function testPlaceAutocomplete() {
  logInfo('🔍 Testing Place Autocomplete...');
  
  const testQueries = ['Mum', 'Del', 'Ban'];
  
  for (const query of testQueries) {
    const result = await testEndpoint('/api/google-maps/places/autocomplete', {
      input: query,
      types: 'geocode',
      components: 'country:in'
    }, `Place Autocomplete: "${query}"`);
    
    if (result && result.data && result.data.predictions && result.data.predictions.length > 0) {
      logSuccess(`Found ${result.data.predictions.length} autocomplete results for "${query}"`);
    }
  }
}

// Test 4: Geocoding
async function testGeocoding() {
  logInfo('🌍 Testing Geocoding...');
  
  const testAddresses = ['Mumbai, India', 'Delhi, India', 'Bangalore, India'];
  
  for (const address of testAddresses) {
    const result = await testEndpoint('/api/google-maps/geocode', {
      address: address
    }, `Geocoding: "${address}"`);
    
    if (result && result.data && result.data.results && result.data.results.length > 0) {
      const location = result.data.results[0].geometry.location;
      logSuccess(`Geocoded "${address}" to: ${location.lat}, ${location.lng}`);
    }
  }
}

// Test 5: Reverse Geocoding
async function testReverseGeocoding() {
  logInfo('🌍 Testing Reverse Geocoding...');
  
  const testCoordinates = [
    { lat: 19.0760, lng: 72.8777, name: 'Mumbai' },
    { lat: 28.7041, lng: 77.1025, name: 'Delhi' },
    { lat: 12.9716, lng: 77.5946, name: 'Bangalore' }
  ];
  
  for (const coords of testCoordinates) {
    const result = await testEndpoint('/api/google-maps/reverse-geocode', {
      latlng: `${coords.lat},${coords.lng}`
    }, `Reverse Geocoding: ${coords.name}`);
    
    if (result && result.data && result.data.results && result.data.results.length > 0) {
      const address = result.data.results[0].formattedAddress;
      logSuccess(`Reverse geocoded ${coords.name} to: ${address}`);
    }
  }
}

// Test 6: Directions
async function testDirections() {
  logInfo('🗺️ Testing Directions...');
  
  const testRoutes = [
    { origin: 'Mumbai, India', destination: 'Delhi, India', name: 'Mumbai → Delhi' },
    { origin: '12.9716,77.5946', destination: '13.0827,80.2707', name: 'Bangalore → Chennai' }
  ];
  
  for (const route of testRoutes) {
    const result = await testEndpoint('/api/google-maps/directions', {
      origin: route.origin,
      destination: route.destination,
      mode: 'driving',
      alternatives: 'false'
    }, `Directions: ${route.name}`);
    
    if (result && result.data && result.data.routes && result.data.routes.length > 0) {
      const routeInfo = result.data.routes[0];
      const leg = routeInfo.legs[0];
      logSuccess(`Route found: ${leg.distance.text} in ${leg.duration.text}`);
    }
  }
}

// Test 7: Distance Matrix
async function testDistanceMatrix() {
  logInfo('📏 Testing Distance Matrix...');
  
  const result = await testEndpoint('/api/google-maps/distance-matrix', {
    origins: 'Mumbai, India',
    destinations: 'Delhi, India|Bangalore, India',
    mode: 'driving',
    units: 'metric'
  }, 'Distance Matrix');
  
  if (result && result.data && result.data.rows && result.data.rows.length > 0) {
    const row = result.data.rows[0];
    logSuccess(`Distance matrix calculated for ${row.elements.length} destinations`);
  }
}

// Test 8: Nearby Places
async function testNearbyPlaces() {
  logInfo('📍 Testing Nearby Places...');
  
  const testLocations = [
    { lat: 19.0760, lng: 72.8777, name: 'Mumbai' },
    { lat: 28.7041, lng: 77.1025, name: 'Delhi' },
    { lat: 12.9716, lng: 77.5946, name: 'Bangalore' }
  ];
  
  for (const location of testLocations) {
    const result = await testEndpoint('/api/google-maps/nearby-places', {
      location: `${location.lat},${location.lng}`,
      radius: 5000,
      type: 'establishment'
    }, `Nearby Places: ${location.name}`);
    
    if (result && result.data && result.data.results) {
      logSuccess(`Found ${result.data.results.length} nearby places for ${location.name}`);
    }
  }
}

// Test 9: Performance Test
async function testPerformance() {
  logInfo('⏱️ Testing Performance...');
  
  const endpoints = [
    { path: '/api/google-maps/geocode', params: { address: 'Mumbai, India' }, name: 'Geocoding' },
    { path: '/api/google-maps/places', params: { input: 'Mumbai' }, name: 'Place Search' },
    { path: '/api/google-maps/directions', params: { origin: 'Mumbai', destination: 'Delhi' }, name: 'Directions' }
  ];
  
  for (const endpoint of endpoints) {
    const startTime = Date.now();
    const result = await testEndpoint(endpoint.path, endpoint.params, `${endpoint.name} Performance`);
    const responseTime = Date.now() - startTime;
    
    if (result) {
      if (responseTime < 2000) {
        logSuccess(`${endpoint.name}: ${responseTime}ms (Fast)`);
      } else if (responseTime < 5000) {
        logWarning(`${endpoint.name}: ${responseTime}ms (Slow)`);
      } else {
        logError(`${endpoint.name}: ${responseTime}ms (Very Slow)`);
      }
    }
  }
}

// Main test runner
async function runAllTests() {
  logInfo('🚀 Starting Final Comprehensive Google Maps Testing...');
  logInfo(`📡 Testing against: ${BASE_URL}`);
  
  // Reset test results
  testResults = {
    total: 0,
    passed: 0,
    failed: 0,
    details: []
  };
  
  try {
    // Run all tests
    await testServerHealth();
    await testPlaceSearch();
    await testPlaceAutocomplete();
    await testGeocoding();
    await testReverseGeocoding();
    await testDirections();
    await testDistanceMatrix();
    await testNearbyPlaces();
    await testPerformance();
    
    // Print summary
    logInfo('\n📊 Final Test Results Summary:');
    logInfo(`Total Tests: ${testResults.total}`);
    logSuccess(`Passed: ${testResults.passed}`);
    logError(`Failed: ${testResults.failed}`);
    
    const successRate = ((testResults.passed / testResults.total) * 100).toFixed(2);
    if (successRate >= 90) {
      logSuccess(`Success Rate: ${successRate}% - EXCELLENT! 🎉`);
      logSuccess('🎯 Google Maps integration is ready for production!');
    } else if (successRate >= 70) {
      logWarning(`Success Rate: ${successRate}% - GOOD`);
      logWarning('⚠️ Some issues need attention before production');
    } else {
      logError(`Success Rate: ${successRate}% - NEEDS ATTENTION`);
      logError('❌ Critical issues need to be fixed');
    }
    
    // Print failed tests
    if (testResults.failed > 0) {
      logError('\n❌ Failed Tests:');
      testResults.details
        .filter(test => !test.success)
        .forEach(test => {
          logError(`  - ${test.testName}: ${test.details}`);
        });
    }
    
    // Print recommendations
    logInfo('\n📋 Recommendations:');
    if (successRate >= 90) {
      logSuccess('✅ Deploy to production');
      logSuccess('✅ Monitor performance');
      logSuccess('✅ Set up alerts');
    } else if (successRate >= 70) {
      logWarning('⚠️ Fix failed endpoints');
      logWarning('⚠️ Test again before production');
      logWarning('⚠️ Check backend deployment');
    } else {
      logError('❌ Fix all critical issues');
      logError('❌ Deploy backend fixes first');
      logError('❌ Test thoroughly before production');
    }
    
  } catch (error) {
    logError('Test runner error:', error.message);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  runAllTests,
  testResults
};
