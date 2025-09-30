// Load environment variables
require('dotenv').config();

const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api/auth';

async function testAuthEndpoints() {
  try {
    console.log('🧪 Testing Authentication Endpoints\n');
    
    // Test 1: Check roles endpoint
    console.log('📱 Test 1: Testing roles endpoint');
    try {
      const response = await axios.get(`${BASE_URL}/roles/+919686218054`);
      console.log('   ✅ Roles endpoint working');
      console.log('   Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.log('   ❌ Roles endpoint failed:', error.message);
    }
    
    console.log('\n');
    
    // Test 2: Check role existence endpoint
    console.log('🔍 Test 2: Testing role existence endpoint');
    try {
      const response = await axios.post(`${BASE_URL}/check-role`, {
        phoneNumber: '+919686218054',
        userType: 'customer'
      });
      console.log('   ✅ Role check endpoint working');
      console.log('   Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.log('   ❌ Role check endpoint failed:', error.message);
    }
    
    console.log('\n');
    
    // Test 3: Test with driver role
    console.log('🚗 Test 3: Testing driver role check');
    try {
      const response = await axios.post(`${BASE_URL}/check-role`, {
        phoneNumber: '+919686218054',
        userType: 'driver'
      });
      console.log('   ✅ Driver role check endpoint working');
      console.log('   Response:', JSON.stringify(response.data, null, 2));
    } catch (error) {
      console.log('   ❌ Driver role check endpoint failed:', error.message);
    }
    
    console.log('\n🎉 Authentication Endpoints Test Completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Wait a moment for server to start, then run test
setTimeout(() => {
  testAuthEndpoints();
}, 3000);
