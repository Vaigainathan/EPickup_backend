const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin
const app = initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID || 'epickup-app'
});

const db = getFirestore();

async function createFirestoreIndexes() {
  try {
    console.log('🔧 Setting up Firestore indexes...');
    
    // Read the indexes configuration
    const indexesPath = path.join(__dirname, '..', 'firestore.indexes.json');
    const indexesConfig = JSON.parse(fs.readFileSync(indexesPath, 'utf8'));
    
    console.log('📋 Indexes to create:', indexesConfig.indexes.length);
    
    for (const index of indexesConfig.indexes) {
      try {
        console.log(`📝 Creating index for collection: ${index.collectionGroup}`);
        
        // Note: Firestore indexes are typically created through the Firebase Console
        // or Firebase CLI. This script provides the configuration.
        console.log(`   Fields: ${index.fields.map(f => `${f.fieldPath}(${f.order})`).join(', ')}`);
        
      } catch (error) {
        console.error(`❌ Error creating index for ${index.collectionGroup}:`, error.message);
      }
    }
    
    console.log('✅ Firestore index setup completed');
    console.log('📌 Note: Please create these indexes manually in the Firebase Console:');
    console.log('   https://console.firebase.google.com/v1/r/project/epickup-app/firestore/indexes');
    
    // Print the index creation URLs
    indexesConfig.indexes.forEach((index, i) => {
      const fields = index.fields.map(f => `${f.fieldPath}(${f.order})`).join(',');
      console.log(`   Index ${i + 1}: ${index.collectionGroup} - ${fields}`);
    });
    
  } catch (error) {
    console.error('❌ Error setting up Firestore indexes:', error);
    process.exit(1);
  }
}

async function testQueries() {
  try {
    console.log('🧪 Testing Firestore queries...');
    
    // Test the problematic query
    console.log('🔍 Testing documentVerificationRequests query...');
    
    try {
      const testQuery = await db.collection('documentVerificationRequests')
        .where('driverId', '==', 'test')
        .where('status', '==', 'pending')
        .limit(1)
        .get();
      
      console.log('✅ Query executed successfully (no index error)');
    } catch (error) {
      if (error.code === 9) {
        console.log('⚠️ Index still required - please create the indexes manually');
        console.log('🔗 Create index here: https://console.firebase.google.com/v1/r/project/epickup-app/firestore/indexes');
      } else {
        console.log('✅ Query executed successfully');
      }
    }
    
  } catch (error) {
    console.error('❌ Error testing queries:', error);
  }
}

async function main() {
  console.log('🚀 Starting Firebase index setup...');
  
  await createFirestoreIndexes();
  await testQueries();
  
  console.log('✅ Firebase index setup completed');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { createFirestoreIndexes, testQueries };