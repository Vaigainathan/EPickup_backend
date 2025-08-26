const axios = require('axios');

const BASE_URL = 'https://epickup-backend.onrender.com';

async function testTwilioStatus() {
  console.log('🔍 Testing Twilio Status...');
  
  try {
    const response = await axios.get(`${BASE_URL}/api/auth/twilio-status`);
    console.log('✅ Twilio Status Response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('❌ Twilio Status Error:', error.response?.data || error.message);
    return null;
  }
}

async function testSendOTP(phoneNumber) {
  console.log(`📱 Testing OTP Send to ${phoneNumber}...`);
  
  try {
    const response = await axios.post(`${BASE_URL}/api/auth/send-otp`, {
      phoneNumber,
      isSignup: false
    });
    
    console.log('✅ OTP Send Response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('❌ OTP Send Error:', error.response?.data || error.message);
    return null;
  }
}

async function testVerifyOTP(phoneNumber, otp) {
  console.log(`🔐 Testing OTP Verification for ${phoneNumber} with code ${otp}...`);
  
  try {
    const response = await axios.post(`${BASE_URL}/api/auth/verify-otp`, {
      phoneNumber,
      otp,
      name: 'Test User',
      userType: 'customer'
    });
    
    console.log('✅ OTP Verification Response:', JSON.stringify(response.data, null, 2));
    return response.data;
  } catch (error) {
    console.error('❌ OTP Verification Error:', error.response?.data || error.message);
    return null;
  }
}

async function runTests() {
  console.log('🚀 Starting Twilio SMS OTP Tests...\n');
  
  // Test 1: Check Twilio Status
  const status = await testTwilioStatus();
  if (!status?.success) {
    console.log('❌ Twilio status check failed, stopping tests');
    return;
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test 2: Send OTP
  const testPhone = '9148101698'; // Replace with your test phone number
  const otpResponse = await testSendOTP(testPhone);
  if (!otpResponse?.success) {
    console.log('❌ OTP send failed, stopping tests');
    return;
  }
  
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test 3: Verify OTP (using mock codes)
  const mockCodes = ['123456', '000000', '111111', '222222'];
  
  for (const code of mockCodes) {
    console.log(`\n🔄 Testing verification with code: ${code}`);
    const verifyResponse = await testVerifyOTP(testPhone, code);
    
    if (verifyResponse?.success) {
      console.log(`✅ Verification successful with code: ${code}`);
      break;
    } else {
      console.log(`❌ Verification failed with code: ${code}`);
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('🎉 Twilio SMS OTP Tests Completed!');
}

// Run the tests
runTests().catch(console.error);
