const axios = require('axios');
require('dotenv').config();

// Configuration
const API_BASE = 'http://localhost:3000/api/google-maps';
const TEST_TIMEOUT = 15000;

// Test data
const TEST_LOCATIONS = {
  BANGALORE: { lat: 12.9716, lng: 77.5946 },
  MUMBAI: { lat: 19.0760, lng: 72.8777 },
  DELHI: { lat: 28.7041, lng: 77.1025 },
  CHENNAI: { lat: 13.0827, lng: 80.2707 }
};

const TEST_ADDRESSES = {
  BANGALORE: 'MG Road, Bangalore, Karnataka, India',
  MUMBAI: 'Marine Drive, Mumbai, Maharashtra, India',
  DELHI: 'Connaught Place, New Delhi, India',
  CHENNAI: 'Marina Beach, Chennai, Tamil Nadu, India'
};

// Utility functions
const log = (message, color = 'white') => {
  const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    reset: '\x1b[0m'
  };
  console.log(`${colors[color]}${message}${colors.reset}`);
};

const testEndpoint = async (testName, endpoint, params = {}, method = 'GET') => {
  const startTime = Date.now();
  try {
    log(`\n🔍 Testing: ${testName}`, 'cyan');
    log(`📍 Endpoint: ${method} ${endpoint}`, 'blue');
    
    let response;
    
    if (method === 'GET') {
      const queryString = new URLSearchParams(params).toString();
      const url = queryString ? `${endpoint}?${queryString}` : endpoint;
      response = await axios.get(url, { timeout: TEST_TIMEOUT });
    } else {
      response = await axios.post(endpoint, params, { timeout: TEST_TIMEOUT });
    }
    
    const duration = Date.now() - startTime;
    
    if (response.data.success) {
      log(`✅ ${testName} - SUCCESS (${duration}ms)`, 'green');
      log(`📊 Response: ${JSON.stringify(response.data, null, 2)}`, 'white');
      return { success: true, data: response.data, duration };
    } else {
      log(`❌ ${testName} - FAILED`, 'red');
      log(`📊 Error: ${JSON.stringify(response.data, null, 2)}`, 'red');
      return { success: false, error: response.data, duration };
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    log(`❌ ${testName} - ERROR (${duration}ms)`, 'red');
    log(`📊 Error: ${error.message}`, 'red');
    if (error.response) {
      log(`📊 Status: ${error.response.status}`, 'red');
      log(`📊 Data: ${JSON.stringify(error.response.data, null, 2)}`, 'red');
    }
    return { success: false, error: error.message, duration };
  }
};

// Test functions
async function testGoogleMapsApiStatus() {
  log('\n🚀 Starting Google Maps API Comprehensive Testing...', 'magenta');
  
  // Test 1: Health Check
  await testEndpoint('Health Check', `${API_BASE.replace('/api/google-maps', '')}/health`);
  
  // Test 2: API Status
  await testEndpoint('API Status', `${API_BASE}/status`);
}

async function testGeocodingServices() {
  log('\n🗺️ Testing Geocoding Services...', 'magenta');
  
  // Test Forward Geocoding
  for (const [city, address] of Object.entries(TEST_ADDRESSES)) {
    await testEndpoint(
      `Forward Geocoding - ${city}`,
      `${API_BASE}/geocode`,
      { address, components: 'country:in' }
    );
  }
  
  // Test Reverse Geocoding
  for (const [city, coords] of Object.entries(TEST_LOCATIONS)) {
    await testEndpoint(
      `Reverse Geocoding - ${city}`,
      `${API_BASE}/reverse-geocode`,
      { latlng: `${coords.lat},${coords.lng}` }
    );
  }
}

async function testPlacesServices() {
  log('\n🏢 Testing Places Services...', 'magenta');
  
  // Test Place Search
  await testEndpoint(
    'Place Search - Restaurants',
    `${API_BASE}/places/search`,
    {
      query: 'restaurants in Bangalore',
      location: `${TEST_LOCATIONS.BANGALORE.lat},${TEST_LOCATIONS.BANGALORE.lng}`,
      radius: '5000',
      type: 'restaurant'
    }
  );
  
  // Test Place Autocomplete
  await testEndpoint(
    'Place Autocomplete',
    `${API_BASE}/places/autocomplete`,
    {
      input: 'MG Road',
      types: 'geocode',
      components: 'country:in'
    }
  );
  
  // Test Place Details
  await testEndpoint(
    'Place Details',
    `${API_BASE}/places/details`,
    {
      placeId: 'ChIJN5Nz71W3j4ARhx5bwpTQEGg', // MG Road, Bangalore
      fields: 'name,formatted_address,geometry,rating,photos'
    }
  );
  
  // Test Nearby Places
  await testEndpoint(
    'Nearby Places',
    `${API_BASE}/places/nearby`,
    {
      location: `${TEST_LOCATIONS.BANGALORE.lat},${TEST_LOCATIONS.BANGALORE.lng}`,
      radius: '5000',
      type: 'restaurant'
    }
  );
}

async function testDirectionsServices() {
  log('\n🛣️ Testing Directions Services...', 'magenta');
  
  // Test Directions
  await testEndpoint(
    'Directions - Bangalore to Mumbai',
    `${API_BASE}/directions`,
    {
      origin: `${TEST_LOCATIONS.BANGALORE.lat},${TEST_LOCATIONS.BANGALORE.lng}`,
      destination: `${TEST_LOCATIONS.MUMBAI.lat},${TEST_LOCATIONS.MUMBAI.lng}`,
      mode: 'driving',
      alternatives: 'true'
    }
  );
  
  // Test Distance Matrix
  await testEndpoint(
    'Distance Matrix',
    `${API_BASE}/distance-matrix`,
    {
      origins: `${TEST_LOCATIONS.BANGALORE.lat},${TEST_LOCATIONS.BANGALORE.lng}`,
      destinations: `${TEST_LOCATIONS.MUMBAI.lat},${TEST_LOCATIONS.MUMBAI.lng}|${TEST_LOCATIONS.DELHI.lat},${TEST_LOCATIONS.DELHI.lng}`,
      mode: 'driving',
      units: 'metric'
    }
  );
}

async function testElevationServices() {
  log('\n⛰️ Testing Elevation Services...', 'magenta');
  
  await testEndpoint(
    'Elevation',
    `${API_BASE}/elevation`,
    {
      locations: `${TEST_LOCATIONS.BANGALORE.lat},${TEST_LOCATIONS.BANGALORE.lng}`
    }
  );
}

async function testRecaptchaIntegration() {
  log('\n🛡️ Testing reCAPTCHA Integration...', 'magenta');
  
  // Test with valid reCAPTCHA token (simulated)
  await testEndpoint(
    'reCAPTCHA Integration - Valid Token',
    `${API_BASE}/places/autocomplete`,
    {
      input: 'test',
      recaptchaToken: 'valid_token_simulation'
    }
  );
  
  // Test with invalid reCAPTCHA token
  await testEndpoint(
    'reCAPTCHA Integration - Invalid Token',
    `${API_BASE}/places/autocomplete`,
    {
      input: 'test',
      recaptchaToken: 'invalid_token_123'
    }
  );
  
  // Test without reCAPTCHA token
  await testEndpoint(
    'reCAPTCHA Integration - No Token',
    `${API_BASE}/places/autocomplete`,
    {
      input: 'test'
    }
  );
}

async function testErrorHandling() {
  log('\n⚠️ Testing Error Handling...', 'magenta');
  
  // Test invalid API key
  await testEndpoint(
    'Error Handling - Invalid API Key',
    `${API_BASE}/geocode`,
    { address: 'test', apiKey: 'invalid_key' }
  );
  
  // Test missing parameters
  await testEndpoint(
    'Error Handling - Missing Address',
    `${API_BASE}/geocode`,
    {}
  );
  
  // Test invalid place ID
  await testEndpoint(
    'Error Handling - Invalid Place ID',
    `${API_BASE}/places/details`,
    { placeId: 'invalid_place_id' }
  );
  
  // Test invalid coordinates
  await testEndpoint(
    'Error Handling - Invalid Coordinates',
    `${API_BASE}/reverse-geocode`,
    { latlng: 'invalid,coordinates' }
  );
}

async function testRateLimiting() {
  log('\n⏱️ Testing Rate Limiting...', 'magenta');
  
  // Make multiple rapid requests
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(
      testEndpoint(
        `Rate Limit Test ${i + 1}`,
        `${API_BASE}/geocode`,
        { address: `Test Address ${i}` }
      )
    );
  }
  
  const results = await Promise.all(promises);
  const successCount = results.filter(r => r.success).length;
  log(`📊 Rate Limit Results: ${successCount}/5 requests successful`, 'yellow');
}

async function testPerformance() {
  log('\n⚡ Testing Performance...', 'magenta');
  
  const tests = [
    {
      name: 'Geocoding Performance',
      endpoint: `${API_BASE}/geocode`,
      params: { address: TEST_ADDRESSES.BANGALORE }
    },
    {
      name: 'Directions Performance',
      endpoint: `${API_BASE}/directions`,
      params: {
        origin: `${TEST_LOCATIONS.BANGALORE.lat},${TEST_LOCATIONS.BANGALORE.lng}`,
        destination: `${TEST_LOCATIONS.MUMBAI.lat},${TEST_LOCATIONS.MUMBAI.lng}`
      }
    },
    {
      name: 'Places Search Performance',
      endpoint: `${API_BASE}/places/search`,
      params: {
        query: 'restaurants',
        location: `${TEST_LOCATIONS.BANGALORE.lat},${TEST_LOCATIONS.BANGALORE.lng}`
      }
    }
  ];
  
  for (const test of tests) {
    const startTime = Date.now();
    const result = await testEndpoint(test.name, test.endpoint, test.params);
    const duration = Date.now() - startTime;
    
    if (result.success) {
      log(`✅ ${test.name}: ${duration}ms`, 'green');
    } else {
      log(`❌ ${test.name}: ${duration}ms (FAILED)`, 'red');
    }
  }
}

// Main test runner
async function runAllTests() {
  try {
    log('🚀 Starting Comprehensive Google Services Testing...', 'magenta');
    log('=' .repeat(60), 'magenta');
    
    const startTime = Date.now();
    
    // Run all test suites
    await testGoogleMapsApiStatus();
    await testGeocodingServices();
    await testPlacesServices();
    await testDirectionsServices();
    await testElevationServices();
    await testRecaptchaIntegration();
    await testErrorHandling();
    await testRateLimiting();
    await testPerformance();
    
    const totalDuration = Date.now() - startTime;
    
    log('\n' + '=' .repeat(60), 'magenta');
    log('🎉 Comprehensive Google Services Testing Complete!', 'green');
    log(`⏱️ Total Duration: ${totalDuration}ms`, 'green');
    log('📊 Check the results above for detailed information', 'green');
    log('=' .repeat(60), 'magenta');
    
  } catch (error) {
    log('\n❌ Test Suite Failed:', 'red');
    log(`📊 Error: ${error.message}`, 'red');
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests();
}

module.exports = {
  runAllTests,
  testEndpoint,
  log
};
