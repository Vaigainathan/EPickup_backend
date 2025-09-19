const fetch = require('node-fetch');

const BASE_URL = 'https://epickup-backend.onrender.com';
const ADMIN_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhZG1pbl8xNzU3MjQxMjkyMzA5IiwiZW1haWwiOiJhZG1pbkBlcGlja3VwLmNvbSIsInVzZXJUeXBlIjoiYWRtaW4iLCJyb2xlIjoic3VwZXJfYWRtaW4iLCJpYXQiOjE3NTgyODU3MDQsImV4cCI6MTc1ODM3MjEwNH0.27un45y5Qr0YC9UfBrXHHQWE4yl9YO2dLpYbXSDmVis';

async function testSyncDebug() {
  console.log('🔍 Testing sync debug...\n');

  try {
    // Test individual driver sync first
    console.log('1️⃣ Testing individual driver sync');
    const individualSyncResponse = await fetch(`${BASE_URL}/api/admin/drivers/user_1758212468517_4icl6p2ny/sync-status`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    const individualSyncData = await individualSyncResponse.json();
    console.log('Individual sync result:', JSON.stringify(individualSyncData, null, 2));

    // Test all drivers sync
    console.log('\n2️⃣ Testing all drivers sync');
    const allSyncResponse = await fetch(`${BASE_URL}/api/admin/sync-all-drivers-status`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    
    const allSyncData = await allSyncResponse.json();
    console.log('All sync result:', JSON.stringify(allSyncData, null, 2));

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testSyncDebug();
