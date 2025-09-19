const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'epickup-app.appspot.com'
});

const db = admin.firestore();

async function testCompleteDocumentFlow() {
  try {
    console.log('🔍 Testing complete document flow...');
    
    const driverId = 'user_1758212121688_hdsnkjei6';
    console.log(`\n👤 Testing driver: ${driverId}`);
    
    // Step 1: Check users collection
    console.log('\n📄 Step 1: Checking users collection...');
    const userDoc = await db.collection('users').doc(driverId).get();
    const userData = userDoc.data();
    const userDocs = userData.driver?.documents || userData.documents || {};
    console.log('User collection documents:', Object.keys(userDocs));
    
    // Step 2: Check verification requests
    console.log('\n📋 Step 2: Checking verification requests...');
    const verificationQuery = await db.collection('documentVerificationRequests')
      .where('driverId', '==', driverId)
      .limit(1)
      .get();
    
    let verificationDocs = {};
    if (!verificationQuery.empty) {
      verificationDocs = verificationQuery.docs[0].data().documents || {};
      console.log('Verification request documents:', Object.keys(verificationDocs));
    } else {
      console.log('No verification request found');
    }
    
    // Step 3: Check driverDocuments collection
    console.log('\n📁 Step 3: Checking driverDocuments collection...');
    const driverDocsQuery = await db.collection('driverDocuments')
      .where('driverId', '==', driverId)
      .get();
    
    let driverDocs = {};
    if (!driverDocsQuery.empty) {
      driverDocsQuery.docs.forEach(doc => {
        const data = doc.data();
        driverDocs[data.documentType] = data;
      });
      console.log('DriverDocuments collection:', Object.keys(driverDocs));
    } else {
      console.log('No driverDocuments found');
    }
    
    // Step 4: Simulate backend logic
    console.log('\n🔄 Step 4: Simulating backend logic...');
    let documents = { ...userDocs };
    let source = 'user_collection';
    
    if (!verificationQuery.empty) {
      // Merge verification request with user collection
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
    }
    
    console.log(`Documents after merging (${source}):`, Object.keys(documents));
    
    // Step 5: Test document normalization
    console.log('\n📄 Step 5: Testing document normalization...');
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
    
    // Step 6: Check for missing documents and try driverDocuments fallback
    console.log('\n🔍 Step 6: Checking for missing documents...');
    const missingDocuments = Object.entries(normalizedDocuments).filter(([key, doc]) => !doc.url);
    
    if (missingDocuments.length > 0) {
      console.log(`Missing documents: ${missingDocuments.map(([key]) => key).join(', ')}`);
      
      // Try driverDocuments fallback
      missingDocuments.forEach(([key, doc]) => {
        const docTypeMap = {
          'drivingLicense': 'driving_license',
          'aadhaar': 'aadhaar_card',
          'insurance': 'bike_insurance',
          'rcBook': 'rc_book',
          'profilePhoto': 'profile_photo'
        };
        
        const docType = docTypeMap[key];
        const driverDoc = driverDocs[docType];
        
        if (driverDoc && driverDoc.downloadURL) {
          console.log(`✅ Found missing document ${key} in driverDocuments collection`);
          normalizedDocuments[key] = {
            url: driverDoc.downloadURL,
            status: driverDoc.status || 'uploaded',
            uploadedAt: driverDoc.uploadedAt || '',
            verified: false,
            rejectionReason: null
          };
        }
      });
    }
    
    // Step 7: Final results
    console.log('\n📊 Step 7: Final results...');
    Object.entries(normalizedDocuments).forEach(([key, doc]) => {
      console.log(`${key}: ${doc.url ? '✅ FOUND' : '❌ MISSING'} - ${doc.url || 'No URL'}`);
    });
    
    const foundDocuments = Object.values(normalizedDocuments).filter(doc => doc.url).length;
    console.log(`\n📊 Summary: ${foundDocuments}/5 documents found`);
    
    if (foundDocuments === 5) {
      console.log('✅ SUCCESS: All 5 documents found!');
    } else {
      console.log('❌ ISSUE: Some documents are still missing');
      console.log('Missing documents:', Object.entries(normalizedDocuments)
        .filter(([key, doc]) => !doc.url)
        .map(([key]) => key));
    }
    
  } catch (error) {
    console.error('❌ Error testing complete flow:', error);
  }
}

testCompleteDocumentFlow();
