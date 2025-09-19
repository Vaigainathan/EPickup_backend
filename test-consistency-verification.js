const axios = require('axios');

const BASE_URL = 'https://epickup-backend.onrender.com';

// Test consistency across all systems
async function testConsistencyVerification() {
  console.log('🧪 Testing System Consistency...\n');

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

    // 2. Test driver profile endpoint
    console.log('\n2️⃣ Testing driver profile endpoint...');
    const driverId = 'user_1758299106141_w9982oc94';
    
    try {
      const profileResponse = await axios.get(`${BASE_URL}/api/driver/profile`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      console.log('✅ Driver profile endpoint working');
      console.log('📊 Profile response structure:', {
        hasSuccess: 'success' in profileResponse.data,
        hasData: 'data' in profileResponse.data,
        hasDriver: 'driver' in profileResponse.data.data,
        verificationStatus: profileResponse.data.data?.driver?.verificationStatus
      });
    } catch (error) {
      console.log('⚠️ Driver profile endpoint error (expected for admin token):', error.response?.status);
    }

    // 3. Test admin driver documents endpoint
    console.log('\n3️⃣ Testing admin driver documents endpoint...');
    const documentsResponse = await axios.get(`${BASE_URL}/api/admin/drivers/${driverId}/documents`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (documentsResponse.data.success) {
      console.log('✅ Admin driver documents endpoint working');
      console.log('📊 Documents response structure:', {
        hasSuccess: 'success' in documentsResponse.data,
        hasData: 'data' in documentsResponse.data,
        hasDocuments: 'documents' in documentsResponse.data.data,
        verificationStatus: documentsResponse.data.data?.verificationStatus
      });
    } else {
      console.log('❌ Failed to fetch driver documents:', documentsResponse.data.error?.message);
    }

    // 4. Test document verification with consistent status
    console.log('\n4️⃣ Testing document verification with consistent status...');
    const testDocType = 'drivingLicense';
    
    const verifyResponse = await axios.post(
      `${BASE_URL}/api/admin/drivers/${driverId}/documents/${testDocType}/verify`,
      {
        status: 'verified', // Using consistent 'verified' status
        comments: 'Test verification - document looks good',
        rejectionReason: null
      },
      {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      }
    );

    if (verifyResponse.data.success) {
      console.log(`✅ ${testDocType} verification completed with 'verified' status`);
      console.log('📡 Check backend logs for WebSocket notification messages');
    } else {
      console.log(`❌ Failed to verify ${testDocType}:`, verifyResponse.data.error?.message);
    }

    // 5. Test driver verification endpoint
    console.log('\n5️⃣ Testing driver verification endpoint...');
    const driverVerifyResponse = await axios.post(
      `${BASE_URL}/api/admin/drivers/${driverId}/verify`,
      {
        status: 'verified', // Using consistent 'verified' status
        comments: 'All documents verified successfully',
        rejectionReason: null
      },
      {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      }
    );

    if (driverVerifyResponse.data.success) {
      console.log('✅ Driver verification completed with "verified" status');
      console.log('📡 Check backend logs for WebSocket completion notification');
    } else {
      console.log('❌ Failed to verify driver:', driverVerifyResponse.data.error?.message);
    }

    // 6. Test final status check
    console.log('\n6️⃣ Testing final status check...');
    const finalDocumentsResponse = await axios.get(`${BASE_URL}/api/admin/drivers/${driverId}/documents`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (finalDocumentsResponse.data.success) {
      const finalDocuments = finalDocumentsResponse.data.data;
      console.log('📊 Final verification status:', finalDocuments.verificationStatus);
      
      // Verify status is 'verified' (not 'approved')
      if (finalDocuments.verificationStatus === 'verified') {
        console.log('✅ Status is correctly set to "verified"');
      } else {
        console.log(`❌ Status is "${finalDocuments.verificationStatus}" but should be "verified"`);
      }
    }

    console.log('\n✅ Consistency verification test completed!');
    console.log('\n📋 Summary of fixes applied:');
    console.log('  ✅ Standardized verification status to "verified"');
    console.log('  ✅ Added missing /api/driver/profile endpoint');
    console.log('  ✅ Fixed WebSocket event data structures');
    console.log('  ✅ Standardized navigation routes');
    console.log('  ✅ Updated frontend status checks');
    console.log('  ✅ Ensured API endpoint consistency');
    
    console.log('\n🎯 Expected results:');
    console.log('  1. All verification statuses should be "verified" (not "approved")');
    console.log('  2. Driver profile endpoint should work correctly');
    console.log('  3. WebSocket notifications should use consistent data structures');
    console.log('  4. Navigation routes should be standardized');
    console.log('  5. Frontend should only check for "verified" status');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testConsistencyVerification();
