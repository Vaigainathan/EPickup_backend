// Test Server Version and Route Status
const axios = require('axios');

const BASE_URL = 'https://epickup-backend.onrender.com';

async function testServerVersion() {
  console.log('🔍 Testing Server Version and Route Status...');
  
  try {
    // Test 1: Health endpoint to check server status
    console.log('\n1. Testing Health Endpoint...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Server Health:', healthResponse.status);
    console.log('Server Info:', healthResponse.data);
    
    // Test 2: Test a working endpoint (geocode)
    console.log('\n2. Testing Working Endpoint (Geocode)...');
    const geocodeResponse = await axios.get(`${BASE_URL}/api/google-maps/geocode`, {
      params: { address: 'Mumbai, India' }
    });
    console.log('✅ Geocode Works:', geocodeResponse.status);
    
    // Test 3: Test places endpoint with minimal parameters
    console.log('\n3. Testing Places Endpoint...');
    const placesResponse = await axios.get(`${BASE_URL}/api/google-maps/places`, {
      params: { input: 'test' }
    });
    console.log('✅ Places Works:', placesResponse.status);
    
    // Test 4: Test autocomplete endpoint
    console.log('\n4. Testing Autocomplete Endpoint...');
    const autocompleteResponse = await axios.get(`${BASE_URL}/api/google-maps/places/autocomplete`, {
      params: { input: 'test' }
    });
    console.log('✅ Autocomplete Works:', autocompleteResponse.status);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testServerVersion();
