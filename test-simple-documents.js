const fetch = require('node-fetch');

const BASE_URL = 'https://epickup-backend.onrender.com';
const ADMIN_TOKEN = 'YOUR_ADMIN_TOKEN_HERE'; // Replace with your admin token

async function testSimpleDocuments() {
  console.log('🧪 Testing Simple Document Endpoint...\n');

  try {
    // Test the documents endpoint
    console.log('1️⃣ Testing GET /api/admin/drivers/user_1758212468517_4icl6p2ny/documents');
    
    const response = await fetch(`${BASE_URL}/api/admin/drivers/user_1758212468517_4icl6p2ny/documents`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Documents endpoint working!');
      console.log('📄 Response:', JSON.stringify(data, null, 2));
    } else {
      console.log('❌ Documents endpoint failed:');
      console.log('Status:', response.status);
      console.log('Error:', JSON.stringify(data, null, 2));
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testSimpleDocuments();
