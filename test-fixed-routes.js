// Test Fixed Google Maps Routes with Proper Parameters
const axios = require('axios');

const BASE_URL = 'https://epickup-backend.onrender.com';

async function testFixedRoutes() {
  console.log('🔍 Testing Fixed Google Maps Routes...');
  
  try {
    // Test 1: Place Search
    console.log('\n1. Testing Place Search...');
    const placeResponse = await axios.get(`${BASE_URL}/api/google-maps/places`, {
      params: { 
        input: 'Mumbai',
        types: 'geocode',
        components: 'country:in'
      }
    });
    console.log('✅ Place Search:', placeResponse.status);
    console.log('Results:', placeResponse.data.data?.predictions?.length || 0, 'predictions');
    
    // Test 2: Place Autocomplete
    console.log('\n2. Testing Place Autocomplete...');
    const autocompleteResponse = await axios.get(`${BASE_URL}/api/google-maps/places/autocomplete`, {
      params: { 
        input: 'Mum',
        types: 'geocode',
        components: 'country:in'
      }
    });
    console.log('✅ Place Autocomplete:', autocompleteResponse.status);
    console.log('Results:', autocompleteResponse.data.data?.predictions?.length || 0, 'predictions');
    
    // Test 3: Directions
    console.log('\n3. Testing Directions...');
    const directionsResponse = await axios.get(`${BASE_URL}/api/google-maps/directions`, {
      params: { 
        origin: 'Mumbai, India',
        destination: 'Delhi, India',
        mode: 'driving'
      }
    });
    console.log('✅ Directions:', directionsResponse.status);
    console.log('Routes:', directionsResponse.data.data?.routes?.length || 0, 'routes');
    
    // Test 4: Distance Matrix
    console.log('\n4. Testing Distance Matrix...');
    const matrixResponse = await axios.get(`${BASE_URL}/api/google-maps/distance-matrix`, {
      params: { 
        origins: 'Mumbai, India',
        destinations: 'Delhi, India|Bangalore, India',
        mode: 'driving',
        units: 'metric'
      }
    });
    console.log('✅ Distance Matrix:', matrixResponse.status);
    console.log('Rows:', matrixResponse.data.data?.rows?.length || 0, 'rows');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testFixedRoutes();
