/**
 * Delete Test Users from Firebase Auth
 * 
 * This script deletes specific test users from Firebase Auth
 * so you can test signup/login flows repeatedly.
 * 
 * Usage:
 *   node scripts/delete-test-users.js
 */

const admin = require('firebase-admin');
const path = require('path');

// Test phone numbers to delete
const TEST_PHONE_NUMBERS = [
  '+919148101698',
  '+919686218054'
];

/**
 * Initialize Firebase Admin SDK
 */
function initializeFirebase() {
  try {
    // Check if already initialized
    if (admin.apps.length > 0) {
      console.log('✅ Firebase Admin SDK already initialized');
      return admin.app();
    }

    // Try environment variables first
    if (process.env.FIREBASE_PROJECT_ID && 
        process.env.FIREBASE_PRIVATE_KEY && 
        process.env.FIREBASE_CLIENT_EMAIL) {
      
      console.log('🔧 Using environment variables for Firebase...');
      
      // Handle private key formatting
      let privateKey = process.env.FIREBASE_PRIVATE_KEY;
      if (!privateKey.includes('\\n') && !privateKey.includes('\n')) {
        privateKey = privateKey.replace(/-----BEGIN PRIVATE KEY-----/g, '-----BEGIN PRIVATE KEY-----\n')
                               .replace(/-----END PRIVATE KEY-----/g, '\n-----END PRIVATE KEY-----')
                               .replace(/(.{64})/g, '$1\n');
      } else if (privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
      }

      return admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          privateKey: privateKey,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL
        }),
        databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
      });
    }

    // Try service account file
    const serviceAccountPath = path.join(__dirname, '..', 'firebase-service-account.json');
    console.log('🔧 Using service account file:', serviceAccountPath);
    
    const serviceAccount = require(serviceAccountPath);
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
    });

  } catch (error) {
    console.error('❌ Failed to initialize Firebase:', error.message);
    throw error;
  }
}

/**
 * Delete user by phone number
 */
async function deleteUserByPhone(phoneNumber) {
  try {
    console.log(`\n🔍 Searching for user with phone: ${phoneNumber}`);
    
    // Get user by phone number
    const userRecord = await admin.auth().getUserByPhoneNumber(phoneNumber);
    
    console.log(`✅ Found user: ${userRecord.uid}`);
    console.log(`   - Phone: ${userRecord.phoneNumber}`);
    console.log(`   - Created: ${userRecord.metadata.creationTime}`);
    
    // Delete the user
    await admin.auth().deleteUser(userRecord.uid);
    
    console.log(`✅ Successfully deleted user: ${userRecord.uid}`);
    
    return { success: true, uid: userRecord.uid, phone: phoneNumber };
    
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.log(`ℹ️ No user found with phone: ${phoneNumber}`);
      return { success: true, notFound: true, phone: phoneNumber };
    }
    
    console.error(`❌ Error deleting user ${phoneNumber}:`, error.message);
    return { success: false, error: error.message, phone: phoneNumber };
  }
}

/**
 * Delete user from Firestore collections
 */
async function deleteUserFromFirestore(phoneNumber) {
  try {
    const db = admin.firestore();
    
    console.log(`🔍 Searching Firestore for user with phone: ${phoneNumber}`);
    
    // Search in users collection
    const usersSnapshot = await db.collection('users')
      .where('phoneNumber', '==', phoneNumber)
      .get();
    
    if (usersSnapshot.empty) {
      console.log(`ℹ️ No Firestore documents found for: ${phoneNumber}`);
      return { success: true, notFound: true };
    }
    
    // Delete all matching documents
    const batch = db.batch();
    usersSnapshot.docs.forEach(doc => {
      console.log(`   - Deleting document: ${doc.id} (type: ${doc.data().userType || 'unknown'})`);
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log(`✅ Deleted ${usersSnapshot.size} document(s) from Firestore`);
    
    return { success: true, deletedCount: usersSnapshot.size };
    
  } catch (error) {
    console.error(`❌ Error deleting Firestore documents:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🗑️  DELETE TEST USERS FROM FIREBASE');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n📱 Test phone numbers to delete: ${TEST_PHONE_NUMBERS.length}`);
  TEST_PHONE_NUMBERS.forEach(phone => console.log(`   - ${phone}`));
  console.log('');
  
  try {
    // Initialize Firebase
    initializeFirebase();
    console.log('✅ Firebase Admin SDK initialized\n');
    
    // Delete each test user
    const results = [];
    
    for (const phoneNumber of TEST_PHONE_NUMBERS) {
      console.log('─────────────────────────────────────────────────────────');
      
      // Delete from Firebase Auth
      const authResult = await deleteUserByPhone(phoneNumber);
      
      // Delete from Firestore
      const firestoreResult = await deleteUserFromFirestore(phoneNumber);
      
      results.push({
        phone: phoneNumber,
        auth: authResult,
        firestore: firestoreResult
      });
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📊 DELETION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    const deletedCount = results.filter(r => r.auth.success && !r.auth.notFound).length;
    const notFoundCount = results.filter(r => r.auth.notFound).length;
    const errorCount = results.filter(r => !r.auth.success || !r.firestore.success).length;
    
    console.log(`✅ Successfully deleted: ${deletedCount} user(s)`);
    console.log(`ℹ️  Not found: ${notFoundCount} user(s)`);
    console.log(`❌ Errors: ${errorCount} user(s)`);
    
    console.log('\n🎉 Cleanup complete! You can now test signup flows again.\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Script failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
main();

