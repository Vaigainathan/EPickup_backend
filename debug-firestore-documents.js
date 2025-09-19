const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'epickup-app.appspot.com'
});

const db = admin.firestore();

async function debugDocumentStructure() {
  try {
    console.log('🔍 Debugging Firestore document structure...');
    
    // Get a specific driver with documents
    const driverId = 'user_1758212121688_hdsnkjei6';
    console.log(`\n👤 Debugging driver: ${driverId}`);
    
    // Check users collection
    console.log('\n📄 Checking users collection...');
    const userDoc = await db.collection('users').doc(driverId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      console.log('✅ User document exists');
      console.log('📊 User data structure:');
      console.log('- userType:', userData.userType);
      console.log('- name:', userData.name);
      console.log('- driver exists:', !!userData.driver);
      
      if (userData.driver) {
        console.log('📄 Driver documents in users collection:');
        const driverDocs = userData.driver.documents || {};
        console.log('Document keys:', Object.keys(driverDocs));
        
        Object.entries(driverDocs).forEach(([key, doc]) => {
          console.log(`\n📄 ${key}:`);
          console.log('  - url:', doc.url || 'MISSING');
          console.log('  - downloadURL:', doc.downloadURL || 'MISSING');
          console.log('  - status:', doc.status || 'MISSING');
          console.log('  - verificationStatus:', doc.verificationStatus || 'MISSING');
          console.log('  - verified:', doc.verified || 'MISSING');
          console.log('  - uploadedAt:', doc.uploadedAt || 'MISSING');
        });
      }
    } else {
      console.log('❌ User document not found');
    }
    
    // Check documentVerificationRequests collection
    console.log('\n📋 Checking documentVerificationRequests collection...');
    const verificationQuery = await db.collection('documentVerificationRequests')
      .where('driverId', '==', driverId)
      .limit(1)
      .get();
    
    if (!verificationQuery.empty) {
      const verificationData = verificationQuery.docs[0].data();
      console.log('✅ Verification request found');
      console.log('📊 Verification request structure:');
      console.log('- driverId:', verificationData.driverId);
      console.log('- status:', verificationData.status);
      console.log('- requestedAt:', verificationData.requestedAt);
      
      console.log('📄 Documents in verification request:');
      const verificationDocs = verificationData.documents || {};
      console.log('Document keys:', Object.keys(verificationDocs));
      
      Object.entries(verificationDocs).forEach(([key, doc]) => {
        console.log(`\n📄 ${key}:`);
        console.log('  - downloadURL:', doc.downloadURL || 'MISSING');
        console.log('  - url:', doc.url || 'MISSING');
        console.log('  - verificationStatus:', doc.verificationStatus || 'MISSING');
        console.log('  - status:', doc.status || 'MISSING');
        console.log('  - filename:', doc.filename || 'MISSING');
        console.log('  - uploadedAt:', doc.uploadedAt || 'MISSING');
      });
    } else {
      console.log('❌ No verification request found');
    }
    
    // Check driverDocuments collection
    console.log('\n📁 Checking driverDocuments collection...');
    const driverDocsQuery = await db.collection('driverDocuments')
      .where('driverId', '==', driverId)
      .get();
    
    if (!driverDocsQuery.empty) {
      console.log(`✅ Found ${driverDocsQuery.docs.length} documents in driverDocuments collection`);
      driverDocsQuery.docs.forEach((doc, index) => {
        const data = doc.data();
        console.log(`\n📄 Document ${index + 1}:`);
        console.log('  - documentType:', data.documentType);
        console.log('  - downloadURL:', data.downloadURL || 'MISSING');
        console.log('  - status:', data.status || 'MISSING');
        console.log('  - filename:', data.filename || 'MISSING');
      });
    } else {
      console.log('❌ No documents found in driverDocuments collection');
    }
    
  } catch (error) {
    console.error('❌ Error debugging documents:', error);
  }
}

debugDocumentStructure();
