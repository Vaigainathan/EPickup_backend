const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'epickup-app.appspot.com'
});

const db = admin.firestore();

async function debugVerificationStatus() {
  try {
    console.log('🔍 Debugging driver verification status...');
    
    // Get all drivers
    const driversSnapshot = await db.collection('users')
      .where('userType', '==', 'driver')
      .limit(5)
      .get();
    
    console.log(`\n📊 Found ${driversSnapshot.docs.length} drivers`);
    
    for (const driverDoc of driversSnapshot.docs) {
      const driverId = driverDoc.id;
      const driverData = driverDoc.data();
      
      console.log(`\n👤 Driver: ${driverData.name || 'Unknown'} (${driverId})`);
      
      // Check driver verification status
      const driverVerificationStatus = driverData.driver?.verificationStatus || 'unknown';
      const isVerified = driverData.isVerified || false;
      const driverIsVerified = driverData.driver?.isVerified || false;
      
      console.log('📊 Verification Status Fields:');
      console.log('  - driver.verificationStatus:', driverVerificationStatus);
      console.log('  - isVerified:', isVerified);
      console.log('  - driver.isVerified:', driverIsVerified);
      
      // Check individual document statuses
      const documents = driverData.driver?.documents || driverData.documents || {};
      console.log('\n📄 Document Statuses:');
      
      const documentTypes = ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
      let verifiedDocs = 0;
      let pendingDocs = 0;
      let rejectedDocs = 0;
      
      documentTypes.forEach(docType => {
        const doc = documents[docType];
        if (doc) {
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
          pendingDocs++;
        }
      });
      
      console.log(`\n📊 Document Summary: ${verifiedDocs} verified, ${pendingDocs} pending, ${rejectedDocs} rejected`);
      
      // Calculate what the verification status SHOULD be
      let calculatedStatus = 'pending';
      if (verifiedDocs === documentTypes.length) {
        calculatedStatus = 'verified';
      } else if (rejectedDocs > 0) {
        calculatedStatus = 'rejected';
      } else if (pendingDocs > 0) {
        calculatedStatus = 'pending_verification';
      }
      
      console.log(`\n🎯 Calculated Status: ${calculatedStatus}`);
      console.log(`❌ Current Status: ${driverVerificationStatus}`);
      console.log(`❌ Status Match: ${calculatedStatus === driverVerificationStatus ? '✅ CORRECT' : '❌ MISMATCH'}`);
      
      if (calculatedStatus !== driverVerificationStatus) {
        console.log(`⚠️  NEEDS UPDATE: ${driverVerificationStatus} → ${calculatedStatus}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error debugging verification status:', error);
  }
}

debugVerificationStatus();
