// Google Maps API Status Checker
const axios = require('axios');
const environmentConfig = require('./src/config/environment');

const BASE_URL = 'https://epickup-backend.onrender.com';
const API_BASE = `${BASE_URL}/api/google-maps`;

console.log('🔍 Google Maps API Status Checker');
console.log('=====================================');
console.log(`📡 Backend URL: ${BASE_URL}`);
console.log(`🔑 API Key: ${environmentConfig.getGoogleMapsApiKey()?.substring(0, 10)}...${environmentConfig.getGoogleMapsApiKey()?.substring(environmentConfig.getGoogleMapsApiKey().length - 4)}`);
console.log('');

// Test helper function
async function testEndpoint(endpoint, params, testName) {
  try {
    console.log(`🔍 Testing: ${testName}`);
    const startTime = Date.now();
    const response = await axios.get(`${API_BASE}${endpoint}`, { 
      params,
      timeout: 10000
    });
    const responseTime = Date.now() - startTime;
    
    if (response.data.success) {
      console.log(`✅ ${testName}: SUCCESS (${responseTime}ms)`);
      return { success: true, responseTime };
    } else {
      console.log(`❌ ${testName}: FAILED - ${response.data.message}`);
      if (response.data.error) {
        console.log(`   Error Code: ${response.data.error.code}`);
        console.log(`   Error Message: ${response.data.error.message}`);
      }
      return { success: false, error: response.data.error };
    }
  } catch (error) {
    console.log(`❌ ${testName}: ERROR`);
    console.log(`   Error: ${error.message}`);
    if (error.response?.data) {
      console.log(`   Response: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return { success: false, error: error.message };
  }
}

// Test all endpoints
async function checkAllAPIs() {
  const results = {
    geocoding: false,
    reverseGeocoding: false,
    placeSearch: false,
    placeAutocomplete: false,
    directions: false,
    distanceMatrix: false,
    nearbyPlaces: false,
    placeDetails: false
  };

  console.log('🚀 Starting API Status Check...\n');

  // Test 1: Geocoding (should work)
  const geocodingResult = await testEndpoint('/geocode', { address: 'Mumbai, India' }, 'Geocoding API');
  results.geocoding = geocodingResult.success;

  // Test 2: Reverse Geocoding (should work)
  const reverseGeocodingResult = await testEndpoint('/reverse-geocode', { latlng: '19.0760,72.8777' }, 'Reverse Geocoding API');
  results.reverseGeocoding = reverseGeocodingResult.success;

  // Test 3: Place Search (might fail)
  const placeSearchResult = await testEndpoint('/places', { input: 'Mumbai' }, 'Place Search API');
  results.placeSearch = placeSearchResult.success;

  // Test 4: Place Autocomplete (might fail)
  const placeAutocompleteResult = await testEndpoint('/places/autocomplete', { input: 'Mum' }, 'Place Autocomplete API');
  results.placeAutocomplete = placeAutocompleteResult.success;

  // Test 5: Directions (might fail)
  const directionsResult = await testEndpoint('/directions', {
    origin: 'Mumbai, India',
    destination: 'Delhi, India',
    mode: 'driving'
  }, 'Directions API');
  results.directions = directionsResult.success;

  // Test 6: Distance Matrix (might fail)
  const distanceMatrixResult = await testEndpoint('/distance-matrix', {
    origins: 'Mumbai, India',
    destinations: 'Delhi, India',
    mode: 'driving',
    units: 'metric'
  }, 'Distance Matrix API');
  results.distanceMatrix = distanceMatrixResult.success;

  // Test 7: Nearby Places (should work)
  const nearbyPlacesResult = await testEndpoint('/nearby-places', {
    location: '19.0760,72.8777',
    radius: 5000,
    type: 'establishment'
  }, 'Nearby Places API');
  results.nearbyPlaces = nearbyPlacesResult.success;

  // Test 8: Place Details (if we have a place ID)
  if (geocodingResult.success && geocodingResult.data?.data?.results?.[0]?.placeId) {
    const placeId = geocodingResult.data.data.results[0].placeId;
    const placeDetailsResult = await testEndpoint('/places/details', {
      placeId: placeId,
      fields: 'formatted_address,geometry,name,place_id,types'
    }, 'Place Details API');
    results.placeDetails = placeDetailsResult.success;
  } else {
    console.log('⚠️  Place Details API: SKIPPED (no place ID available)');
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 API STATUS SUMMARY');
  console.log('='.repeat(50));

  const workingAPIs = Object.values(results).filter(Boolean).length;
  const totalAPIs = Object.keys(results).length;

  console.log(`Overall Status: ${workingAPIs}/${totalAPIs} APIs Working (${Math.round(workingAPIs/totalAPIs*100)}%)`);
  console.log('');

  // Detailed status
  Object.entries(results).forEach(([api, status]) => {
    const icon = status ? '✅' : '❌';
    const statusText = status ? 'WORKING' : 'FAILED';
    console.log(`${icon} ${api}: ${statusText}`);
  });

  console.log('\n' + '='.repeat(50));
  console.log('🔧 RECOMMENDATIONS');
  console.log('='.repeat(50));

  if (!results.placeSearch || !results.placeAutocomplete) {
    console.log('❌ Places API needs to be enabled in Google Cloud Console');
  }

  if (!results.directions) {
    console.log('❌ Directions API needs to be enabled in Google Cloud Console');
  }

  if (!results.distanceMatrix) {
    console.log('❌ Distance Matrix API needs to be enabled in Google Cloud Console');
  }

  if (results.geocoding && results.reverseGeocoding && results.nearbyPlaces) {
    console.log('✅ Core APIs (Geocoding, Reverse Geocoding, Nearby Places) are working');
  }

  if (workingAPIs === totalAPIs) {
    console.log('🎉 All Google Maps APIs are working perfectly!');
  } else {
    console.log(`⚠️  ${totalAPIs - workingAPIs} APIs need to be enabled in Google Cloud Console`);
    console.log('📖 See GOOGLE_MAPS_API_PERMISSIONS_GUIDE.md for detailed instructions');
  }

  return results;
}

// Run the check
if (require.main === module) {
  checkAllAPIs().catch(console.error);
}

module.exports = { checkAllAPIs };
