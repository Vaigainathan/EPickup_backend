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
    console.log('🔍 Testing document retrieval fix...');
    
    const driverId = 'user_1758212121688_hdsnkjei6';
    console.log(`\n👤 Testing driver: ${driverId}`);
    
    // Simulate the new backend logic
    const driverDoc = await db.collection('users').doc(driverId).get();
    const driverData = driverDoc.data();
    
    // Get verification request
    const verificationQuery = await db.collection('documentVerificationRequests')
      .where('driverId', '==', driverId)
      .limit(1)
      .get();
    
    let documents = {};
    let source = 'user_collection';
    
    if (!verificationQuery.empty) {
      const verificationData = verificationQuery.docs[0].data();
      const verificationDocs = verificationData.documents || {};
      const userDocs = driverData.driver?.documents || driverData.documents || {};
      
      // Start with user collection documents (complete set)
      documents = { ...userDocs };
      
      // Override with verification request data where available
      Object.entries(verificationDocs).forEach(([key, verificationDoc]) => {
        if (verificationDoc.downloadURL) {
          const userKey = key === 'bike_insurance' ? 'bikeInsurance' :
                         key === 'driving_license' ? 'drivingLicense' :
                         key === 'aadhaar_card' ? 'aadhaarCard' :
                         key === 'rc_book' ? 'rcBook' :
                         key === 'profile_photo' ? 'profilePhoto' : key;
          
          documents[userKey] = {
            ...documents[userKey],
            url: verificationDoc.downloadURL,
            verificationStatus: verificationDoc.verificationStatus || 'pending',
            status: verificationDoc.status || 'uploaded',
            filename: verificationDoc.filename,
            uploadedAt: verificationDoc.uploadedAt
          };
        }
      });
      
      source = 'merged_verification_and_user';
    } else {
      documents = driverData.driver?.documents || driverData.documents || {};
    }
    
    console.log(`\n📄 Documents from ${source}:`);
    console.log('Document keys:', Object.keys(documents));
    
    // Test document normalization
    const getDocumentData = (documents, primaryKey, alternativeKeys = []) => {
      const allKeys = [primaryKey, ...alternativeKeys];
      
      for (const key of allKeys) {
        const doc = documents[key];
        if (doc && (doc.downloadURL || doc.url)) {
          return {
            url: doc.downloadURL || doc.url || '',
            status: doc.verificationStatus || doc.status || 'pending',
            uploadedAt: doc.uploadedAt || '',
            verified: doc.verified || false,
            rejectionReason: doc.rejectionReason || null
          };
        }
      }
      
      return {
        url: '',
        status: 'pending',
        uploadedAt: '',
        verified: false,
        rejectionReason: null
      };
    };
    
    const normalizedDocuments = {
      drivingLicense: getDocumentData(documents, 'drivingLicense', ['driving_license']),
      aadhaar: getDocumentData(documents, 'aadhaarCard', ['aadhaar_card', 'aadhaar']),
      insurance: getDocumentData(documents, 'bikeInsurance', ['bike_insurance', 'insurance']),
      rcBook: getDocumentData(documents, 'rcBook', ['rc_book']),
      profilePhoto: getDocumentData(documents, 'profilePhoto', ['profile_photo'])
    };
    
    console.log('\n📄 Normalized documents:');
    Object.entries(normalizedDocuments).forEach(([key, doc]) => {
      console.log(`\n${key}:`);
      console.log('  - URL:', doc.url ? '✅ FOUND' : '❌ MISSING');
      console.log('  - Status:', doc.status);
      console.log('  - Verified:', doc.verified);
    });
    
    const foundDocuments = Object.values(normalizedDocuments).filter(doc => doc.url).length;
    console.log(`\n📊 Summary: ${foundDocuments}/5 documents found`);
    
    if (foundDocuments === 5) {
      console.log('✅ SUCCESS: All 5 documents found!');
    } else {
      console.log('❌ ISSUE: Some documents are still missing');
    }
    
  } catch (error) {
    console.error('❌ Error testing document retrieval:', error);
  }
}

testDocumentRetrieval();
