const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
initializeApp({
  credential: cert(serviceAccount)
});

// Import the verification service
const VerificationService = require('./src/services/verificationService');

async function testDocumentMapping() {
  console.log('🧪 Testing Document Mapping Fix...\n');

  const verificationService = new VerificationService();
  const driverId = 'user_1758212468517_4icl6p2ny'; // Vaiguu's ID

  try {
    // Test document type normalization
    console.log('1️⃣ Testing document type normalization...');
    const testTypes = [
      'driving_license', 'aadhaar_card', 'bike_insurance', 'rc_book', 'profile_photo',
      'drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'
    ];
    
    testTypes.forEach(type => {
      const normalized = verificationService.normalizeDocumentField(type);
      const snakeCase = verificationService.toSnakeCase(normalized);
      console.log(`   ${type} → ${normalized} → ${snakeCase}`);
    });

    // Test getting driver verification data
    console.log('\n2️⃣ Testing getDriverVerificationData...');
    const verificationData = await verificationService.getDriverVerificationData(driverId);
    
    console.log('✅ Verification data retrieved:');
    console.log(`   Driver: ${verificationData.driverName}`);
    console.log(`   Status: ${verificationData.verificationStatus}`);
    console.log(`   Is Verified: ${verificationData.isVerified}`);
    console.log(`   Source: ${verificationData.source}`);
    console.log(`   Document Summary: ${verificationData.documentSummary.verified}/${verificationData.documentSummary.total} verified`);
    
    console.log('\n📄 Documents:');
    Object.entries(verificationData.documents).forEach(([type, doc]) => {
      const hasUrl = doc.url && doc.url.length > 0;
      const status = doc.verificationStatus || 'pending';
      console.log(`   ${type}: ${hasUrl ? '✅ Has URL' : '❌ No URL'} (${status})`);
      if (hasUrl) {
        console.log(`      URL: ${doc.url.substring(0, 50)}...`);
      }
    });

    console.log('\n✅ Document mapping test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testDocumentMapping();
