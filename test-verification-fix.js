const fetch = require('node-fetch');

const BASE_URL = 'https://epickup-backend.onrender.com';

// Valid admin token from debug-admin-auth.js
const ADMIN_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJhZG1pbl8xNzU3MjQxMjkyMzA5IiwiZW1haWwiOiJhZG1pbkBlcGlja3VwLmNvbSIsInVzZXJUeXBlIjoiYWRtaW4iLCJyb2xlIjoic3VwZXJfYWRtaW4iLCJpYXQiOjE3NTgyODU3MDQsImV4cCI6MTc1ODM3MjEwNH0.27un45y5Qr0YC9UfBrXHHQWE4yl9YO2dLpYbXSDmVis';

async function testVerificationFix() {
  console.log('🧪 Testing Verification Status Fix...\n');

  try {
    // Test 1: Get all drivers
    console.log('1️⃣ Testing GET /api/admin/drivers');
    const driversResponse = await fetch(`${BASE_URL}/api/admin/drivers`, {
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    const driversData = await driversResponse.json();
    
    if (driversData.success) {
      console.log(`✅ Drivers fetched: ${driversData.data.length} drivers`);
      
      // Check verification status consistency
      const verificationStatuses = driversData.data.map(driver => ({
        id: driver.id,
        name: driver.name || driver.personalInfo?.name || 'Unknown',
        status: driver.status,
        isVerified: driver.isVerified,
        driverVerificationStatus: driver.driver?.verificationStatus,
        documents: driver.documents ? Object.keys(driver.documents).length : 0
      }));
      
      console.log('\n📊 Driver Verification Status Summary:');
      verificationStatuses.forEach(driver => {
        console.log(`  ${driver.name}: ${driver.status} (isVerified: ${driver.isVerified}, driver.verificationStatus: ${driver.driverVerificationStatus}, docs: ${driver.documents})`);
      });
    } else {
      console.log('❌ Failed to fetch drivers:', driversData.error);
    }

    // Test 2: Get pending drivers
    console.log('\n2️⃣ Testing GET /api/admin/drivers/pending');
    const pendingResponse = await fetch(`${BASE_URL}/api/admin/drivers/pending`, {
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    const pendingData = await pendingResponse.json();
    
    if (pendingData.success) {
      console.log(`✅ Pending drivers fetched: ${pendingData.data.length} drivers`);
      
      const pendingStatuses = pendingData.data.map(driver => ({
        id: driver.id,
        name: driver.name || driver.personalInfo?.name || 'Unknown',
        status: driver.status,
        isVerified: driver.isVerified
      }));
      
      console.log('\n📋 Pending Drivers:');
      pendingStatuses.forEach(driver => {
        console.log(`  ${driver.name}: ${driver.status} (isVerified: ${driver.isVerified})`);
      });
    } else {
      console.log('❌ Failed to fetch pending drivers:', pendingData.error);
    }

    // Test 3: Test driver documents endpoint
    if (driversData.success && driversData.data.length > 0) {
      const firstDriver = driversData.data[0];
      console.log(`\n3️⃣ Testing GET /api/admin/drivers/${firstDriver.id}/documents`);
      
      const documentsResponse = await fetch(`${BASE_URL}/api/admin/drivers/${firstDriver.id}/documents`, {
        headers: {
          'Authorization': `Bearer ${ADMIN_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      const documentsData = await documentsResponse.json();
      
      if (documentsData.success) {
        console.log(`✅ Driver documents fetched for ${firstDriver.name}`);
        console.log(`   Verification Status: ${documentsData.data.verificationStatus}`);
        console.log(`   Is Verified: ${documentsData.data.isVerified}`);
        console.log(`   Document Summary: ${documentsData.data.documentSummary?.verified}/${documentsData.data.documentSummary?.total} verified`);
        
        const documentTypes = Object.keys(documentsData.data.documents || {});
        console.log(`   Document Types: ${documentTypes.join(', ')}`);
        
        documentTypes.forEach(docType => {
          const doc = documentsData.data.documents[docType];
          console.log(`     ${docType}: ${doc.status} (verified: ${doc.verified})`);
        });
      } else {
        console.log('❌ Failed to fetch driver documents:', documentsData.error);
      }
    }

    // Test 4: Sync all drivers status
    console.log('\n4️⃣ Testing POST /api/admin/sync-all-drivers-status');
    const syncResponse = await fetch(`${BASE_URL}/api/admin/sync-all-drivers-status`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    const syncData = await syncResponse.json();
    
    if (syncData.success) {
      console.log(`✅ Sync completed successfully`);
      console.log(`   Total Drivers: ${syncData.data.totalDrivers}`);
      console.log(`   Success Count: ${syncData.data.successCount}`);
      console.log(`   Error Count: ${syncData.data.errorCount}`);
      
      if (syncData.data.results && syncData.data.results.length > 0) {
        console.log('\n📋 Sync Results:');
        syncData.data.results.slice(0, 5).forEach(result => {
          if (result.success) {
            console.log(`   ${result.driverName}: ${result.oldStatus} → ${result.newStatus}`);
          } else {
            console.log(`   ${result.driverName}: ERROR - ${result.error}`);
          }
        });
      }
    } else {
      console.log('❌ Failed to sync drivers:', syncData.error);
    }

    // Test 5: Get verification statistics
    console.log('\n5️⃣ Testing GET /api/admin/verification/stats');
    const statsResponse = await fetch(`${BASE_URL}/api/admin/verification/stats`, {
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    const statsData = await statsResponse.json();
    
    if (statsData.success) {
      console.log(`✅ Verification statistics fetched`);
      console.log(`   Pending: ${statsData.data.pending}`);
      console.log(`   Approved: ${statsData.data.approved}`);
      console.log(`   Rejected: ${statsData.data.rejected}`);
      console.log(`   Total: ${statsData.data.total}`);
    } else {
      console.log('❌ Failed to fetch verification stats:', statsData.error);
    }

    console.log('\n🎉 Verification fix testing completed!');

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Run the test
testVerificationFix();