const fetch = require('node-fetch');

const BASE_URL = 'https://epickup-backend.onrender.com';
const ADMIN_TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjE2NzQ5NzQ0MDAiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3NlY3VyZXRva2VuLmdvb2dsZS5jb20vZXBpY2t1cC1hcHAiLCJhdWQiOiJlcGlja3VwLWFwcCIsImF1dGhfdGltZSI6MTc1ODIxMjQ2OCwiZXhwIjoxNzU4Mjk4ODY4LCJpYXQiOjE3NTgyMTI0NjgsInN1YiI6InVzZXJfMTc1ODIxMjQ2ODUxXzRpY2w2cDJueSIsImVtYWlsIjoiYWRtaW5AZXBpY2t1cC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiaWF0IjoxNzU4MjEyNDY4LCJ1c2VyVHlwZSI6ImFkbWluIiwicm9sZSI6ImFkbWluIn0.placeholder';

async function testDocumentVerification() {
  console.log('🧪 Testing Document Verification Fix...\n');
  
  const driverId = 'user_1758212468517_4icl6p2ny';
  
  try {
    console.log(`1️⃣ Testing document approval for drivingLicense`);
    
    const response = await fetch(`${BASE_URL}/api/admin/drivers/${driverId}/documents/drivingLicense/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      },
      body: JSON.stringify({
        status: 'approved',
        comments: 'Test approval - document looks good',
        rejectionReason: null
      })
    });
    
    const data = await response.json();
    
    console.log(`📊 Response Status: ${response.status}`);
    console.log('📋 Response Data:', JSON.stringify(data, null, 2));
    
    if (response.ok && data.success) {
      console.log('✅ Document approval successful!');
      console.log(`📄 Document Type: ${data.data.documentType}`);
      console.log(`📊 Verification Status: ${data.data.verificationStatus}`);
      console.log(`📈 Document Summary: ${data.data.documentSummary.verified}/${data.data.documentSummary.total} verified`);
    } else {
      console.log('❌ Document approval failed!');
      console.log('Error:', data.error);
    }
    
  } catch (error) {
    console.error('❌ Error testing verification:', error.message);
  }
}

async function testDocumentRejection() {
  console.log('\n🧪 Testing Document Rejection...\n');
  
  const driverId = 'user_1758212468517_4icl6p2ny';
  
  try {
    console.log(`2️⃣ Testing document rejection for aadhaarCard`);
    
    const response = await fetch(`${BASE_URL}/api/admin/drivers/${driverId}/documents/aadhaarCard/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      },
      body: JSON.stringify({
        status: 'rejected',
        comments: 'Test rejection - document quality is poor',
        rejectionReason: 'Document is blurry and not readable'
      })
    });
    
    const data = await response.json();
    
    console.log(`📊 Response Status: ${response.status}`);
    console.log('📋 Response Data:', JSON.stringify(data, null, 2));
    
    if (response.ok && data.success) {
      console.log('✅ Document rejection successful!');
      console.log(`📄 Document Type: ${data.data.documentType}`);
      console.log(`📊 Verification Status: ${data.data.verificationStatus}`);
      console.log(`📈 Document Summary: ${data.data.documentSummary.verified}/${data.data.documentSummary.total} verified`);
    } else {
      console.log('❌ Document rejection failed!');
      console.log('Error:', data.error);
    }
    
  } catch (error) {
    console.error('❌ Error testing rejection:', error.message);
  }
}

async function main() {
  await testDocumentVerification();
  await testDocumentRejection();
  console.log('\n🎉 Verification fix testing completed!');
}

main().catch(console.error);