const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'epickup-app.appspot.com'
});

const db = admin.firestore();

async function comprehensiveSystemCheck() {
  try {
    console.log('🔍 COMPREHENSIVE SYSTEM VERIFICATION CHECK');
    console.log('=' .repeat(60));
    
    // Test 1: Check all drivers and their verification status
    console.log('\n📊 TEST 1: Driver Verification Status Check');
    console.log('-'.repeat(40));
    
    const driversSnapshot = await db.collection('users')
      .where('userType', '==', 'driver')
      .limit(5)
      .get();
    
    console.log(`Found ${driversSnapshot.docs.length} drivers to check`);
    
    let statusIssues = 0;
    let documentIssues = 0;
    
    for (const driverDoc of driversSnapshot.docs) {
      const driverId = driverDoc.id;
      const driverData = driverDoc.data();
      
      console.log(`\n👤 Driver: ${driverData.name || 'Unknown'} (${driverId})`);
      
      // Check verification status consistency
      const driverVerificationStatus = driverData.driver?.verificationStatus || 'unknown';
      const isVerified = driverData.isVerified || false;
      const driverIsVerified = driverData.driver?.isVerified || false;
      
      console.log('📊 Verification Status:');
      console.log(`  - driver.verificationStatus: ${driverVerificationStatus}`);
      console.log(`  - isVerified: ${isVerified}`);
      console.log(`  - driver.isVerified: ${driverIsVerified}`);
      
      // Check if status fields are consistent
      const statusConsistent = (driverVerificationStatus === 'verified') === isVerified;
      if (!statusConsistent) {
        console.log('❌ STATUS INCONSISTENCY DETECTED!');
        statusIssues++;
      } else {
        console.log('✅ Status fields are consistent');
      }
      
      // Check documents
      const documents = driverData.driver?.documents || driverData.documents || {};
      const allDocuments = ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
      
      let verifiedDocs = 0;
      let pendingDocs = 0;
      let rejectedDocs = 0;
      let totalDocs = 0;
      
      console.log('📄 Document Status:');
      allDocuments.forEach(docType => {
        const doc = documents[docType];
        if (doc && (doc.url || doc.downloadURL)) {
          totalDocs++;
          const status = doc.verificationStatus || doc.status || 'pending';
          const verified = doc.verified || false;
          
          console.log(`  - ${docType}: ${status} (verified: ${verified})`);
          
          if (verified || status === 'verified') {
            verifiedDocs++;
          } else if (status === 'rejected') {
            rejectedDocs++;
          } else {
            pendingDocs++;
          }
        } else {
          console.log(`  - ${docType}: NOT FOUND`);
        }
      });
      
      // Calculate what status should be
      let calculatedStatus = 'pending';
      if (totalDocs === 0) {
        calculatedStatus = 'pending';
      } else if (verifiedDocs === totalDocs) {
        calculatedStatus = 'verified';
      } else if (rejectedDocs > 0) {
        calculatedStatus = 'rejected';
      } else if (verifiedDocs > 0 || pendingDocs > 0) {
        calculatedStatus = 'pending_verification';
      }
      
      console.log(`📊 Document Summary: ${verifiedDocs}/${totalDocs} verified, ${rejectedDocs} rejected, ${pendingDocs} pending`);
      console.log(`🎯 Calculated Status: ${calculatedStatus}`);
      console.log(`❌ Current Status: ${driverVerificationStatus}`);
      
      if (calculatedStatus !== driverVerificationStatus) {
        console.log('❌ STATUS CALCULATION MISMATCH!');
        documentIssues++;
      } else {
        console.log('✅ Status calculation is correct');
      }
    }
    
    // Test 2: Check documentVerificationRequests collection
    console.log('\n\n📋 TEST 2: Document Verification Requests Check');
    console.log('-'.repeat(40));
    
    const verificationRequestsSnapshot = await db.collection('documentVerificationRequests')
      .orderBy('requestedAt', 'desc')
      .limit(3)
      .get();
    
    console.log(`Found ${verificationRequestsSnapshot.docs.length} verification requests`);
    
    for (const requestDoc of verificationRequestsSnapshot.docs) {
      const requestData = requestDoc.data();
      console.log(`\n📋 Request: ${requestData.driverId} (${requestData.status})`);
      console.log(`  - Requested: ${requestData.requestedAt}`);
      console.log(`  - Documents: ${Object.keys(requestData.documents || {}).length}`);
    }
    
    // Test 3: Check driverDocuments collection
    console.log('\n\n📁 TEST 3: Driver Documents Collection Check');
    console.log('-'.repeat(40));
    
    const driverDocsSnapshot = await db.collection('driverDocuments')
      .limit(5)
      .get();
    
    console.log(`Found ${driverDocsSnapshot.docs.length} driver documents`);
    
    for (const doc of driverDocsSnapshot.docs) {
      const docData = doc.data();
      console.log(`\n📄 Document: ${docData.documentType} (${docData.driverId})`);
      console.log(`  - Status: ${docData.status}`);
      console.log(`  - Has URL: ${!!docData.downloadURL}`);
    }
    
    // Summary
    console.log('\n\n📊 COMPREHENSIVE CHECK SUMMARY');
    console.log('=' .repeat(60));
    console.log(`✅ Drivers checked: ${driversSnapshot.docs.length}`);
    console.log(`❌ Status inconsistencies: ${statusIssues}`);
    console.log(`❌ Document calculation issues: ${documentIssues}`);
    console.log(`📋 Verification requests: ${verificationRequestsSnapshot.docs.length}`);
    console.log(`📁 Driver documents: ${driverDocsSnapshot.docs.length}`);
    
    if (statusIssues === 0 && documentIssues === 0) {
      console.log('\n🎉 ALL CHECKS PASSED! System is working correctly.');
    } else {
      console.log('\n⚠️  ISSUES DETECTED! System needs attention.');
    }
    
  } catch (error) {
    console.error('❌ Error during comprehensive check:', error);
  }
}

comprehensiveSystemCheck();
