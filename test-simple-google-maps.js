// Simple Google Maps API Debug Test
const axios = require('axios');

const BASE_URL = 'https://epickup-backend.onrender.com';

async function testSimpleEndpoint() {
  console.log('🔍 Testing simple Google Maps endpoint...');
  
  try {
    // Test 1: Check if server is responding
    console.log('1. Testing server health...');
    const healthResponse = await axios.get(`${BASE_URL}/health`);
    console.log('✅ Server is responding:', healthResponse.status);
    
    // Test 2: Test geocoding (which we know works)
    console.log('\n2. Testing geocoding endpoint...');
    const geocodeResponse = await axios.get(`${BASE_URL}/api/google-maps/geocode`, {
      params: { address: 'Mumbai, India' }
    });
    console.log('✅ Geocoding works:', geocodeResponse.status);
    console.log('Response:', JSON.stringify(geocodeResponse.data, null, 2));
    
    // Test 3: Test place search (which is failing)
    console.log('\n3. Testing place search endpoint...');
    const placeResponse = await axios.get(`${BASE_URL}/api/google-maps/places`, {
      params: { 
        input: 'Mumbai',
        types: 'geocode',
        components: 'country:in'
      }
    });
    console.log('✅ Place search works:', placeResponse.status);
    console.log('Response:', JSON.stringify(placeResponse.data, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

testSimpleEndpoint();
