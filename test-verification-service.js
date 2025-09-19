const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
initializeApp({
  credential: cert(serviceAccount)
});

// Import the verification service
const VerificationService = require('./src/services/verificationService');

async function testVerificationService() {
  console.log('🧪 Testing Verification Service...\n');

  const verificationService = new VerificationService();
  const driverId = 'user_1758212468517_4icl6p2ny'; // Vaiguu's ID

  try {
    // Test 1: Get driver verification data
    console.log('1️⃣ Testing getDriverVerificationData...');
    const verificationData = await verificationService.getDriverVerificationData(driverId);
    
    console.log('✅ Verification data retrieved:');
    console.log(`   Driver: ${verificationData.driverName}`);
    console.log(`   Status: ${verificationData.verificationStatus}`);
    console.log(`   Is Verified: ${verificationData.isVerified}`);
    console.log(`   Source: ${verificationData.source}`);
    console.log(`   Document Summary: ${verificationData.documentSummary.verified}/${verificationData.documentSummary.total} verified`);
    
    console.log('\n📄 Documents:');
    Object.entries(verificationData.documents).forEach(([type, doc]) => {
      console.log(`   ${type}: ${doc.url ? '✅ Has URL' : '❌ No URL'} (${doc.verificationStatus})`);
    });

    // Test 2: Test document type normalization
    console.log('\n2️⃣ Testing document type normalization...');
    const testTypes = ['driving_license', 'aadhaar_card', 'bike_insurance', 'rc_book', 'profile_photo'];
    testTypes.forEach(type => {
      const normalized = verificationService.normalizeDocumentField(type);
      console.log(`   ${type} → ${normalized}`);
    });

    // Test 3: Test required document types
    console.log('\n3️⃣ Testing required document types...');
    const requiredTypes = verificationService.getRequiredDocumentTypes();
    console.log(`   Required types: ${requiredTypes.join(', ')}`);

    console.log('\n✅ Verification service test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testVerificationService();
