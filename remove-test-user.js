// Script to remove test user for signup flow testing
const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.firestore();

async function removeTestUser() {
  const phoneNumber = '+919148101698';
  const normalizedPhone = phoneNumber.replace(/\s+/g, '');
  
  console.log('🧹 Removing test user for signup flow testing...');
  console.log(`📱 Phone: ${phoneNumber}`);
  console.log(`🔍 Normalized: ${normalizedPhone}`);
  
  try {
    // Find all users with this phone number (both customer and driver)
    const usersQuery = await db.collection('users')
      .where('phone', '==', normalizedPhone)
      .get();
    
    if (usersQuery.empty) {
      console.log('✅ No users found with this phone number');
      return;
    }
    
    console.log(`📊 Found ${usersQuery.size} user(s) with this phone number:`);
    
    // Remove each user
    const batch = db.batch();
    let removedCount = 0;
    
    usersQuery.forEach(doc => {
      const userData = doc.data();
      console.log(`   - User ID: ${doc.id}`);
      console.log(`   - Type: ${userData.userType || 'unknown'}`);
      console.log(`   - Name: ${userData.name || 'N/A'}`);
      console.log(`   - Created: ${userData.createdAt || 'N/A'}`);
      
      batch.delete(doc.ref);
      removedCount++;
    });
    
    // Commit the batch deletion
    await batch.commit();
    
    console.log(`✅ Successfully removed ${removedCount} user(s)`);
    
    // Also check for any incomplete users in auth collection
    const authQuery = await db.collection('auth')
      .where('phone', '==', normalizedPhone)
      .get();
    
    if (!authQuery.empty) {
      console.log(`📊 Found ${authQuery.size} auth record(s) to remove:`);
      
      const authBatch = db.batch();
      authQuery.forEach(doc => {
        console.log(`   - Auth ID: ${doc.id}`);
        authBatch.delete(doc.ref);
      });
      
      await authBatch.commit();
      console.log(`✅ Successfully removed ${authQuery.size} auth record(s)`);
    }
    
    // Check for any driver documents
    const driverQuery = await db.collection('drivers')
      .where('phone', '==', normalizedPhone)
      .get();
    
    if (!driverQuery.empty) {
      console.log(`📊 Found ${driverQuery.size} driver record(s) to remove:`);
      
      const driverBatch = db.batch();
      driverQuery.forEach(doc => {
        console.log(`   - Driver ID: ${doc.id}`);
        driverBatch.delete(doc.ref);
      });
      
      await driverBatch.commit();
      console.log(`✅ Successfully removed ${driverQuery.size} driver record(s)`);
    }
    
    console.log('\n🎉 Test user cleanup completed!');
    console.log('🚀 You can now test the signup flow with +919148101698');
    console.log('💡 Run this script again anytime you need to reset for testing');
    
  } catch (error) {
    console.error('❌ Error removing test user:', error);
    process.exit(1);
  }
}

// Run the cleanup
removeTestUser()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
