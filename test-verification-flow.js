const axios = require('axios');

const BASE_URL = 'https://epickup-backend.onrender.com';

// Test verification flow
async function testVerificationFlow() {
  console.log('🧪 Testing Verification Flow...\n');

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

    // 2. Get drivers list
    console.log('\n2️⃣ Getting drivers list...');
    const driversResponse = await axios.get(`${BASE_URL}/api/admin/drivers`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (!driversResponse.data.success) {
      throw new Error('Failed to get drivers list');
    }

    const drivers = driversResponse.data.data;
    console.log(`✅ Found ${drivers.length} drivers`);

    // Find a driver with pending verification
    const pendingDriver = drivers.find(driver => 
      driver.driver?.verificationStatus === 'pending_verification' || 
      driver.driver?.verificationStatus === 'pending'
    );

    if (!pendingDriver) {
      console.log('⚠️ No pending drivers found, using first driver');
      var testDriver = drivers[0];
    } else {
      var testDriver = pendingDriver;
    }

    console.log(`📋 Testing with driver: ${testDriver.name} (${testDriver.id})`);
    console.log(`📊 Current status: ${testDriver.driver?.verificationStatus}`);

    // 3. Get driver documents
    console.log('\n3️⃣ Getting driver documents...');
    const documentsResponse = await axios.get(`${BASE_URL}/api/admin/drivers/${testDriver.id}/documents`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (!documentsResponse.data.success) {
      throw new Error('Failed to get driver documents');
    }

    const documents = documentsResponse.data.data;
    console.log(`✅ Found ${Object.keys(documents).length} documents`);

    // 4. Test document verification
    console.log('\n4️⃣ Testing document verification...');
    const documentTypes = ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
    
    for (const docType of documentTypes) {
      if (documents[docType] && documents[docType].url) {
        console.log(`📄 Verifying ${docType}...`);
        
        const verifyResponse = await axios.post(
          `${BASE_URL}/api/admin/drivers/${testDriver.id}/documents/${docType}/verify`,
          {
            status: 'approved',
            comments: 'Test verification - looks good',
            rejectionReason: null
          },
          {
            headers: { 'Authorization': `Bearer ${adminToken}` }
          }
        );

        if (verifyResponse.data.success) {
          console.log(`✅ ${docType} verified successfully`);
        } else {
          console.log(`❌ Failed to verify ${docType}:`, verifyResponse.data.error?.message);
        }
      }
    }

    // 5. Check final verification status
    console.log('\n5️⃣ Checking final verification status...');
    const finalStatusResponse = await axios.get(`${BASE_URL}/api/admin/drivers/${testDriver.id}/documents`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

    if (finalStatusResponse.data.success) {
      const finalDocuments = finalStatusResponse.data.data;
      const verifiedCount = Object.values(finalDocuments).filter(doc => 
        doc && doc.status === 'verified'
      ).length;
      
      console.log(`📊 Final status: ${verifiedCount}/${Object.keys(finalDocuments).length} documents verified`);
      
      if (verifiedCount === Object.keys(finalDocuments).length) {
        console.log('🎉 All documents verified! Driver should receive real-time notification.');
      }
    }

    console.log('\n✅ Verification flow test completed!');
    console.log('\n📱 Check the driver app - it should receive real-time notifications and redirect to home screen.');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the test
testVerificationFlow();
