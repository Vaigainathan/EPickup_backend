// Route Debug Test
const axios = require('axios');

const BASE_URL = 'https://epickup-backend.onrender.com';

async function debugRoutes() {
  console.log('🔍 Debugging Google Maps Routes...');
  
  const routes = [
    '/api/google-maps/places',
    '/api/google-maps/places/autocomplete', 
    '/api/google-maps/geocode',
    '/api/google-maps/directions',
    '/api/google-maps/reverse-geocode',
    '/api/google-maps/nearby-places',
    '/api/google-maps/distance-matrix'
  ];
  
  for (const route of routes) {
    try {
      console.log(`\nTesting: ${route}`);
      const response = await axios.get(`${BASE_URL}${route}`, {
        params: { input: 'test' },
        timeout: 5000
      });
      console.log(`✅ ${route}: ${response.status}`);
    } catch (error) {
      if (error.response) {
        console.log(`❌ ${route}: ${error.response.status} - ${error.response.data?.error?.message || error.message}`);
      } else {
        console.log(`❌ ${route}: ${error.message}`);
      }
    }
  }
}

debugRoutes();
