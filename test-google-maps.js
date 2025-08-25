// Comprehensive Google Maps API Testing Script
const axios = require('axios');
const environmentConfig = require('./src/config/environment');

// Test configuration
const BASE_URL = 'https://epickup-backend.onrender.com';
const API_BASE = `${BASE_URL}/api/google-maps`;

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
  const timestamp = new Date().toISOString();
  console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
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
    const response = await axios.get(`${API_BASE}${endpoint}`, { params });
    
    if (response.status === 200 && response.data.success) {
      addTestResult(testName, true, `Response time: ${response.headers['x-response-time'] || 'N/A'}`);
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

// Test 1: Check API Key Configuration
async function testApiKeyConfiguration() {
  logInfo('🔑 Testing API Key Configuration...');
  
  const apiKey = environmentConfig.getGoogleMapsApiKey();
  if (!apiKey) {
    addTestResult('API Key Configuration', false, 'Google Maps API key not found');
    return false;
  }
  
  if (apiKey.startsWith('AIzaSy')) {
    addTestResult('API Key Configuration', true, 'Valid Google Maps API key found');
    return true;
  } else {
    addTestResult('API Key Configuration', false, 'Invalid API key format');
    return false;
  }
}

// Test 2: Test Place Search
async function testPlaceSearch() {
  logInfo('🔍 Testing Place Search...');
  
  const testQueries = [
    'Mumbai',
    'Delhi',
    'Bangalore',
    'Chennai'
  ];
  
  for (const query of testQueries) {
    const result = await testEndpoint('/places', {
      input: query,
      types: 'geocode',
      components: 'country:in'
    }, `Place Search: "${query}"`);
    
    if (result && result.data && result.data.predictions && result.data.predictions.length > 0) {
      logSuccess(`Found ${result.data.predictions.length} results for "${query}"`);
    }
  }
}

// Test 3: Test Place Autocomplete
async function testPlaceAutocomplete() {
  logInfo('🔍 Testing Place Autocomplete...');
  
  const testQueries = [
    'Mum',
    'Del',
    'Ban',
    'Che'
  ];
  
  for (const query of testQueries) {
    const result = await testEndpoint('/places/autocomplete', {
      input: query,
      types: 'geocode',
      components: 'country:in'
    }, `Place Autocomplete: "${query}"`);
    
    if (result && result.data && result.data.predictions && result.data.predictions.length > 0) {
      logSuccess(`Found ${result.data.predictions.length} autocomplete results for "${query}"`);
    }
  }
}

// Test 4: Test Place Details
async function testPlaceDetails() {
  logInfo('📍 Testing Place Details...');
  
  // First get a place ID from search
  const searchResult = await testEndpoint('/places', {
    input: 'Mumbai',
    types: 'geocode',
    components: 'country:in'
  }, 'Place Search for Details Test');
  
  if (searchResult && searchResult.data && searchResult.data.predictions && searchResult.data.predictions.length > 0) {
    const placeId = searchResult.data.predictions[0].place_id;
    
    const detailsResult = await testEndpoint('/places/details', {
      placeId: placeId,
      fields: 'formatted_address,geometry,name,place_id,types'
    }, 'Place Details');
    
    if (detailsResult && detailsResult.data && detailsResult.data.name) {
      logSuccess(`Retrieved details for: ${detailsResult.data.name}`);
    }
  }
}

// Test 5: Test Directions
async function testDirections() {
  logInfo('🗺️ Testing Directions...');
  
  const testRoutes = [
    {
      origin: 'Mumbai, India',
      destination: 'Delhi, India',
      mode: 'driving'
    },
    {
      origin: '12.9716,77.5946', // Bangalore coordinates
      destination: '13.0827,80.2707', // Chennai coordinates
      mode: 'driving'
    }
  ];
  
  for (const route of testRoutes) {
    const result = await testEndpoint('/directions', {
      origin: route.origin,
      destination: route.destination,
      mode: route.mode,
      alternatives: 'false'
    }, `Directions: ${route.origin} → ${route.destination}`);
    
    if (result && result.data && result.data.routes && result.data.routes.length > 0) {
      const routeInfo = result.data.routes[0];
      const leg = routeInfo.legs[0];
      logSuccess(`Route found: ${leg.distance.text} in ${leg.duration.text}`);
    }
  }
}

// Test 6: Test Geocoding
async function testGeocoding() {
  logInfo('🌍 Testing Geocoding...');
  
  const testAddresses = [
    'Mumbai, India',
    'Delhi, India',
    'Bangalore, India',
    'Chennai, India'
  ];
  
  for (const address of testAddresses) {
    const result = await testEndpoint('/geocode', {
      address: address
    }, `Geocoding: "${address}"`);
    
    if (result && result.data && result.data.results && result.data.results.length > 0) {
      const location = result.data.results[0].geometry.location;
      logSuccess(`Geocoded "${address}" to: ${location.lat}, ${location.lng}`);
    }
  }
}

// Test 7: Test Reverse Geocoding
async function testReverseGeocoding() {
  logInfo('🌍 Testing Reverse Geocoding...');
  
  const testCoordinates = [
    { lat: 19.0760, lng: 72.8777 }, // Mumbai
    { lat: 28.7041, lng: 77.1025 }, // Delhi
    { lat: 12.9716, lng: 77.5946 }, // Bangalore
    { lat: 13.0827, lng: 80.2707 }  // Chennai
  ];
  
  for (const coords of testCoordinates) {
    const result = await testEndpoint('/reverse-geocode', {
      latlng: `${coords.lat},${coords.lng}`
    }, `Reverse Geocoding: ${coords.lat}, ${coords.lng}`);
    
    if (result && result.data && result.data.results && result.data.results.length > 0) {
      const address = result.data.results[0].formatted_address;
      logSuccess(`Reverse geocoded ${coords.lat}, ${coords.lng} to: ${address}`);
    }
  }
}

// Test 8: Test Distance Matrix
async function testDistanceMatrix() {
  logInfo('📏 Testing Distance Matrix...');
  
  const result = await testEndpoint('/distance-matrix', {
    origins: 'Mumbai, India',
    destinations: 'Delhi, India|Bangalore, India|Chennai, India',
    mode: 'driving',
    units: 'metric'
  }, 'Distance Matrix');
  
  if (result && result.data && result.data.rows && result.data.rows.length > 0) {
    const row = result.data.rows[0];
    logSuccess(`Distance matrix calculated for ${row.elements.length} destinations`);
  }
}

// Test 9: Test Nearby Places
async function testNearbyPlaces() {
  logInfo('📍 Testing Nearby Places...');
  
  const testLocations = [
    { lat: 19.0760, lng: 72.8777, name: 'Mumbai' },
    { lat: 28.7041, lng: 77.1025, name: 'Delhi' },
    { lat: 12.9716, lng: 77.5946, name: 'Bangalore' },
    { lat: 13.0827, lng: 80.2707, name: 'Chennai' }
  ];
  
  for (const location of testLocations) {
    const result = await testEndpoint('/nearby-places', {
      location: `${location.lat},${location.lng}`,
      radius: 5000,
      type: 'establishment'
    }, `Nearby Places: ${location.name}`);
    
    if (result && result.data && result.data.results) {
      logSuccess(`Found ${result.data.results.length} nearby places for ${location.name}`);
    }
  }
}

// Test 10: Test API Response Times
async function testApiResponseTimes() {
  logInfo('⏱️ Testing API Response Times...');
  
  const endpoints = [
    { path: '/places', params: { input: 'Mumbai' }, name: 'Place Search' },
    { path: '/directions', params: { origin: 'Mumbai', destination: 'Delhi' }, name: 'Directions' },
    { path: '/geocode', params: { address: 'Mumbai, India' }, name: 'Geocoding' }
  ];
  
  for (const endpoint of endpoints) {
    const startTime = Date.now();
    const result = await testEndpoint(endpoint.path, endpoint.params, `${endpoint.name} Response Time`);
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
  logInfo('🚀 Starting Comprehensive Google Maps API Testing...');
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
    await testApiKeyConfiguration();
    await testPlaceSearch();
    await testPlaceAutocomplete();
    await testPlaceDetails();
    await testDirections();
    await testGeocoding();
    await testReverseGeocoding();
    await testDistanceMatrix();
    await testNearbyPlaces();
    await testApiResponseTimes();
    
    // Print summary
    logInfo('\n📊 Test Results Summary:');
    logInfo(`Total Tests: ${testResults.total}`);
    logSuccess(`Passed: ${testResults.passed}`);
    logError(`Failed: ${testResults.failed}`);
    
    const successRate = ((testResults.passed / testResults.total) * 100).toFixed(2);
    if (successRate >= 90) {
      logSuccess(`Success Rate: ${successRate}% - EXCELLENT! 🎉`);
    } else if (successRate >= 70) {
      logWarning(`Success Rate: ${successRate}% - GOOD`);
    } else {
      logError(`Success Rate: ${successRate}% - NEEDS ATTENTION`);
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
