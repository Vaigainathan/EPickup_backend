const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'epickup-app.appspot.com'
});

const db = admin.firestore();

async function testDocumentRetrieval() {
  try {
    console.log('🔍 Testing document retrieval...');
    
    // Get all drivers
    const driversSnapshot = await db.collection('users')
      .where('userType', '==', 'driver')
      .limit(5)
      .get();
    
    console.log(`📊 Found ${driversSnapshot.docs.length} drivers`);
    
    for (const driverDoc of driversSnapshot.docs) {
      const driverId = driverDoc.id;
      const driverData = driverDoc.data();
      
      console.log(`\n👤 Driver: ${driverData.name || 'Unknown'} (${driverId})`);
      
      // Check user collection documents
      const userDocuments = driverData.driver?.documents || driverData.documents || {};
      console.log('📄 User collection documents:', Object.keys(userDocuments));
      
      // Check verification requests
      try {
        const verificationQuery = await db.collection('documentVerificationRequests')
          .where('driverId', '==', driverId)
          .limit(1)
          .get();
        
        if (!verificationQuery.empty) {
          const verificationData = verificationQuery.docs[0].data();
          console.log('📋 Verification request documents:', Object.keys(verificationData.documents || {}));
          console.log('📋 Verification request data:', verificationData);
        } else {
          console.log('📋 No verification request found');
        }
      } catch (error) {
        console.log('📋 Error checking verification requests:', error.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testDocumentRetrieval();
