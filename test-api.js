const fetch = require('node-fetch');

async function testDocumentAPI() {
  try {
    console.log('🔍 Testing document API endpoint...');
    
    // Test with a driver that has verification requests
    const driverId = 'user_1758212121688_hdsnkjei6';
    const apiUrl = `http://localhost:3000/api/admin/drivers/${driverId}/documents`;
    
    console.log(`🌐 Calling: ${apiUrl}`);
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test-admin-token' // You might need to get a real token
      }
    });
    
    const data = await response.json();
    
    console.log(`📡 Response status: ${response.status}`);
    console.log(`📡 Response data:`, JSON.stringify(data, null, 2));
    
  } catch (error) {
    console.error('❌ Error testing API:', error);
  }
}

testDocumentAPI();
