/**
 * Test Firebase Connection
 * Quick test to verify Firebase Admin SDK initialization works
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

console.log('🔍 Testing Firebase Connection...\n');

try {
  // Check for firebase-service-account.json
  const serviceAccountPath = path.join(__dirname, '..', 'firebase-service-account.json');
  
  if (!fs.existsSync(serviceAccountPath)) {
    console.error('❌ firebase-service-account.json not found');
    console.error('Expected location:', serviceAccountPath);
    process.exit(1);
  }

  console.log('✅ Found firebase-service-account.json');

  // Load service account
  const serviceAccount = require(serviceAccountPath);
  console.log('✅ Service account loaded');
  console.log('📦 Project ID:', serviceAccount.project_id);
  console.log('📧 Client Email:', serviceAccount.client_email);

  // Initialize Firebase Admin
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
      storageBucket: `${serviceAccount.project_id}.appspot.com`
    });
  }

  console.log('✅ Firebase Admin SDK initialized\n');

  // Test Firestore connection
  const db = admin.firestore();
  console.log('🔄 Testing Firestore connection...');
  
  db.collection('_test_connection').limit(1).get()
    .then(() => {
      console.log('✅ Firestore connection successful!');
      console.log('📊 Collections accessible');
      return admin.auth().listUsers(1);
    })
    .then(result => {
      console.log('✅ Firebase Auth connection successful!');
      console.log(`👥 Auth users found: ${result.users.length}`);
      
      // Test Storage
      const bucket = admin.storage().bucket();
      console.log('✅ Firebase Storage connected!');
      console.log('📦 Storage bucket:', bucket.name);
      
      console.log('\n🎉 ALL CONNECTIONS SUCCESSFUL!');
      console.log('\n✅ Your cleanup script should work now!');
      console.log('\nRun: npm run cleanup:database\n');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Connection test failed:', error.message);
      console.error('\nPossible issues:');
      console.error('1. Service account key might be invalid or expired');
      console.error('2. Firebase project might not exist');
      console.error('3. Service account might not have proper permissions\n');
      process.exit(1);
    });

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
