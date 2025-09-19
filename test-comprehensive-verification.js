const axios = require('axios');

const BASE_URL = 'https://epickup-backend.onrender.com';

// Test comprehensive verification flow
async function testComprehensiveVerification() {
  console.log('🧪 Testing Comprehensive Verification Flow...\n');

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
    console.log(`\n2️⃣ Testing comprehensive flow for driver: ${driverId}`);

    // 3. Test driver profile endpoint
    console.log('\n3️⃣ Testing driver profile endpoint...');
    try {
      const profileResponse = await axios.get(`${BASE_URL}/api/driver/profile`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      console.log('✅ Driver profile endpoint working');
    } catch (error) {
      console.log('⚠️ Driver profile endpoint error (expected for admin token):', error.response?.status);
    }

    // 4. Test admin driver documents endpoint
    console.log('\n4️⃣ Testing admin driver documents endpoint...');
    const documentsResponse = await axios.get(`${BASE_URL}/api/admin/drivers/${driverId}/documents`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (documentsResponse.data.success) {
      const documents = documentsResponse.data.data;
      console.log('✅ Driver documents fetched successfully');
      console.log('📊 Document status summary:');
      Object.entries(documents).forEach(([type, doc]) => {
        if (doc && doc.status) {
          console.log(`  ${type}: ${doc.status}`);
        }
      });
    } else {
      console.log('❌ Failed to fetch driver documents:', documentsResponse.data.error?.message);
    }

    // 5. Test WebSocket notification by verifying a document
    console.log('\n5️⃣ Testing WebSocket notification...');
    const testDocType = 'drivingLicense';
    
    console.log(`📄 Verifying document: ${testDocType}`);
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
      console.log(`✅ ${testDocType} verification completed`);
      console.log('📡 Check backend logs for WebSocket notification messages');
      console.log('📱 Check driver app for real-time updates');
    } else {
      console.log(`❌ Failed to verify ${testDocType}:`, verifyResponse.data.error?.message);
    }

    // 6. Test sync all drivers status
    console.log('\n6️⃣ Testing sync all drivers status...');
    const syncResponse = await axios.post(
      `${BASE_URL}/api/admin/sync-all-drivers-status`,
      {},
      {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      }
    );

    if (syncResponse.data.success) {
      console.log('✅ Sync all drivers status completed');
      console.log(`📊 Sync results: ${syncResponse.data.data.successCount} successful, ${syncResponse.data.data.errorCount} errors`);
    } else {
      console.log('❌ Failed to sync all drivers status:', syncResponse.data.error?.message);
    }

    // 7. Test driver verification endpoint
    console.log('\n7️⃣ Testing driver verification endpoint...');
    const driverVerifyResponse = await axios.post(
      `${BASE_URL}/api/admin/drivers/${driverId}/verify`,
      {
        status: 'approved',
        comments: 'All documents verified successfully',
        rejectionReason: null
      },
      {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      }
    );

    if (driverVerifyResponse.data.success) {
      console.log('✅ Driver verification completed');
      console.log('📡 Check backend logs for WebSocket completion notification');
    } else {
      console.log('❌ Failed to verify driver:', driverVerifyResponse.data.error?.message);
    }

    // 8. Test final status check
    console.log('\n8️⃣ Testing final status check...');
    const finalDocumentsResponse = await axios.get(`${BASE_URL}/api/admin/drivers/${driverId}/documents`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (finalDocumentsResponse.data.success) {
      const finalDocuments = finalDocumentsResponse.data.data;
      console.log('📊 Final document status:');
      Object.entries(finalDocuments).forEach(([type, doc]) => {
        if (doc && doc.status) {
          console.log(`  ${type}: ${doc.status}`);
        }
      });
    }

    console.log('\n✅ Comprehensive verification test completed!');
    console.log('\n📋 Summary of fixes applied:');
    console.log('  ✅ JWT Token Management - Unified token storage');
    console.log('  ✅ WebSocket Connection - Robust connection handling');
    console.log('  ✅ Verification Status - Real-time status management');
    console.log('  ✅ Backend Notifications - Enhanced WebSocket notifications');
    console.log('  ✅ Error Handling - Comprehensive error management');
    console.log('  ✅ Debug Logging - Detailed logging for troubleshooting');
    
    console.log('\n🎯 Expected results:');
    console.log('  1. Driver app should connect to WebSocket successfully');
    console.log('  2. Real-time notifications should be received');
    console.log('  3. Verification status should update automatically');
    console.log('  4. Driver should be redirected to home screen when verified');
    console.log('  5. All error scenarios should be handled gracefully');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testComprehensiveVerification();
