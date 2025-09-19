const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function debugDocuments() {
  console.log('🔍 Debugging document fetching...\n');

  const driverId = 'user_1758212468517_4icl6p2ny'; // Vaiguu's ID

  try {
    // 1. Check user collection
    console.log('1️⃣ Checking user collection...');
    const userDoc = await db.collection('users').doc(driverId).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      console.log('✅ User found:', userData.name);
      console.log('📄 User documents:', JSON.stringify(userData.driver?.documents || userData.documents || {}, null, 2));
    } else {
      console.log('❌ User not found');
    }

    // 2. Check documentVerificationRequests
    console.log('\n2️⃣ Checking documentVerificationRequests...');
    const verificationQuery = await db.collection('documentVerificationRequests')
      .where('driverId', '==', driverId)
      .get();
    
    if (!verificationQuery.empty) {
      console.log(`✅ Found ${verificationQuery.docs.length} verification requests`);
      verificationQuery.docs.forEach((doc, index) => {
        const data = doc.data();
        console.log(`📄 Request ${index + 1}:`, {
          status: data.status,
          documents: Object.keys(data.documents || {}),
          requestedAt: data.requestedAt?.toDate?.() || data.requestedAt
        });
      });
    } else {
      console.log('❌ No verification requests found');
    }

    // 3. Check driverDocuments collection
    console.log('\n3️⃣ Checking driverDocuments collection...');
    const driverDocsQuery = await db.collection('driverDocuments')
      .where('driverId', '==', driverId)
      .get();
    
    if (!driverDocsQuery.empty) {
      console.log(`✅ Found ${driverDocsQuery.docs.length} driver documents`);
      driverDocsQuery.docs.forEach((doc, index) => {
        const data = doc.data();
        console.log(`📄 Document ${index + 1}:`, {
          documentType: data.documentType,
          status: data.status,
          verified: data.verified,
          downloadURL: data.downloadURL ? 'Present' : 'Missing'
        });
      });
    } else {
      console.log('❌ No driver documents found');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

debugDocuments();
