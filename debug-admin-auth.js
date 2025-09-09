#!/usr/bin/env node

const axios = require('axios');

async function testAdminAuth() {
  try {
    console.log('Testing admin authentication...');
    
    const response = await axios.post('https://epickup-backend.onrender.com/api/admin/auth/login', {
      email: 'admin@epickup.com',
      password: 'admin123'
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('✅ Admin login successful!');
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    
    return response.data.token;
    
  } catch (error) {
    console.log('❌ Admin login failed!');
    console.log('Error status:', error.response?.status);
    console.log('Error data:', error.response?.data);
    console.log('Error message:', error.message);
    return null;
  }
}

async function testCustomerAuth() {
  try {
    console.log('\nTesting customer authentication...');
    
    // Send OTP
    const otpResponse = await axios.post('https://epickup-backend.onrender.com/api/auth/send-otp', {
      phoneNumber: '+919876543206',
      userType: 'customer'
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('✅ Customer OTP sent!');
    console.log('OTP Response:', JSON.stringify(otpResponse.data, null, 2));
    
    // Verify OTP
    const verifyResponse = await axios.post('https://epickup-backend.onrender.com/api/auth/verify-otp', {
      phoneNumber: '+919876543206',
      otp: '123456',
      userType: 'customer',
      name: 'Test Customer'
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('✅ Customer OTP verified!');
    console.log('Verify Response:', JSON.stringify(verifyResponse.data, null, 2));
    
    return verifyResponse.data.token;
    
  } catch (error) {
    console.log('❌ Customer authentication failed!');
    console.log('Error status:', error.response?.status);
    console.log('Error data:', error.response?.data);
    console.log('Error message:', error.message);
    return null;
  }
}

async function testCustomerAPI(customerToken) {
  if (!customerToken) {
    console.log('\n❌ No customer token available for API test');
    return;
  }
  
  try {
    console.log('\nTesting customer API...');
    
    const response = await axios.get('https://epickup-backend.onrender.com/api/customer/profile', {
      headers: {
        'Authorization': `Bearer ${customerToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('✅ Customer API call successful!');
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.log('❌ Customer API call failed!');
    console.log('Error status:', error.response?.status);
    console.log('Error data:', error.response?.data);
    console.log('Error message:', error.message);
  }
}

async function runTests() {
  console.log('🚀 Starting Debug Tests...\n');
  
  // Test admin auth
  const adminToken = await testAdminAuth();
  
  // Test customer auth
  const customerToken = await testCustomerAuth();
  
  // Test customer API
  await testCustomerAPI(customerToken);
  
  console.log('\n🏁 Debug tests completed!');
}

runTests();
