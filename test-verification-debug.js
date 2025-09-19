const fetch = require('node-fetch');

const BASE_URL = 'https://epickup-backend.onrender.com';
const ADMIN_TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjE2NzQ5NzQ0MDAiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vZXBpY2t1cC1hcHAiLCJhdWQiOiJlcGlja3VwLWFwcCIsImF1dGhfdGltZSI6MTc1ODIxMjQ2OCwiZXhwIjoxNzU4Mjk4ODY4LCJpYXQiOjE3NTgyMTI0NjgsInN1YiI6InVzZXJfMTc1ODIxMjQ2ODUxXzRpY2w2cDJueSIsImVtYWlsIjoiYWRtaW5AZXBpY2t1cC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiaWF0IjoxNzU4MjEyNDY4LCJ1c2VyVHlwZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIn0.placeholder';

async function testVerificationEndpoint() {
  console.log('🧪 Testing Document Verification Endpoint...\n');
  
  const driverId = 'user_1758212468517_4icl6p2ny';
  const documentType = 'drivingLicense';
  
  try {
    console.log(`1️⃣ Testing POST /api/admin/drivers/${driverId}/documents/${documentType}/verify`);
    console.log('📤 Request Data:', {
      status: 'approved',
      comments: 'Test approval by admin',
      rejectionReason: null
    });
    
    const response = await fetch(`${BASE_URL}/api/admin/drivers/${driverId}/documents/${documentType}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      },
      body: JSON.stringify({
        status: 'approved',
        comments: 'Test approval by admin',
        rejectionReason: null
      })
    });
    
    const data = await response.json();
    
    console.log(`📊 Response Status: ${response.status}`);
    console.log('📋 Response Data:', JSON.stringify(data, null, 2));
    
    if (response.ok) {
      console.log('✅ Document verification successful!');
    } else {
      console.log('❌ Document verification failed!');
    }
    
  } catch (error) {
    console.error('❌ Error testing verification endpoint:', error.message);
  }
}

async function testRejectionEndpoint() {
  console.log('\n🧪 Testing Document Rejection Endpoint...\n');
  
  const driverId = 'user_1758212468517_4icl6p2ny';
  const documentType = 'aadhaar';
  
  try {
    console.log(`2️⃣ Testing POST /api/admin/drivers/${driverId}/documents/${documentType}/verify`);
    console.log('📤 Request Data:', {
      status: 'rejected',
      comments: 'Test rejection by admin',
      rejectionReason: 'Document quality is poor and not readable'
    });
    
    const response = await fetch(`${BASE_URL}/api/admin/drivers/${driverId}/documents/${documentType}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      },
      body: JSON.stringify({
        status: 'rejected',
        comments: 'Test rejection by admin',
        rejectionReason: 'Document quality is poor and not readable'
      })
    });
    
    const data = await response.json();
    
    console.log(`📊 Response Status: ${response.status}`);
    console.log('📋 Response Data:', JSON.stringify(data, null, 2));
    
    if (response.ok) {
      console.log('✅ Document rejection successful!');
    } else {
      console.log('❌ Document rejection failed!');
    }
    
  } catch (error) {
    console.error('❌ Error testing rejection endpoint:', error.message);
  }
}

async function main() {
  await testVerificationEndpoint();
  await testRejectionEndpoint();
  console.log('\n🎉 Verification endpoint testing completed!');
}

main().catch(console.error);
