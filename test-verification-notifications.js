const axios = require('axios');

const BASE_URL = 'https://epickup-backend.onrender.com';

// Test verification notifications
async function testVerificationNotifications() {
  console.log('🧪 Testing Verification Notifications...\n');

  try {
    // 1. Get admin token
    console.log('1️⃣ Getting admin token...');
    const adminResponse = await axios.post(`${BASE_URL}/api/auth/phone`, {
      phone: '+919876543210',
      userType: 'admin'
    });

    if (!adminResponse.data.success) {
      throw new Error('Failed to get admin token');
    }

    const adminToken = adminResponse.data.data.token;
    console.log('✅ Admin token obtained');

    // 2. Get the specific driver we want to test
    const driverId = 'user_1758299106141_w9982oc94'; // From the logs
    console.log(`\n2️⃣ Testing notifications for driver: ${driverId}`);

    // 3. Get driver documents to see current status
    console.log('\n3️⃣ Getting driver documents...');
    const documentsResponse = await axios.get(`${BASE_URL}/api/admin/drivers/${driverId}/documents`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (documentsResponse.data.success) {
      const documents = documentsResponse.data.data;
      console.log('📊 Current document status:');
      Object.entries(documents).forEach(([type, doc]) => {
        if (doc && doc.status) {
          console.log(`  ${type}: ${doc.status}`);
        }
      });
    }

    // 4. Test a single document verification to trigger notification
    console.log('\n4️⃣ Testing document verification notification...');
    const testDocType = 'drivingLicense';
    
    const verifyResponse = await axios.post(
      `${BASE_URL}/api/admin/drivers/${driverId}/documents/${testDocType}/verify`,
      {
        status: 'approved',
        comments: 'Test notification - document looks good',
        rejectionReason: null
      },
      {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      }
    );

    if (verifyResponse.data.success) {
      console.log(`✅ ${testDocType} verification test completed`);
      console.log('📡 Check backend logs for WebSocket notification messages');
    } else {
      console.log(`❌ Failed to verify ${testDocType}:`, verifyResponse.data.error?.message);
    }

    console.log('\n✅ Verification notification test completed!');
    console.log('\n📱 Check the driver app - it should now:');
    console.log('  1. Have a valid auth token');
    console.log('  2. Connect to WebSocket');
    console.log('  3. Receive real-time notifications');
    console.log('  4. Redirect to home screen when verified');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testVerificationNotifications();
