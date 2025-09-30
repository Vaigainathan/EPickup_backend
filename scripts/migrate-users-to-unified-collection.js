#!/usr/bin/env node

/**
 * Migration Script: Move users from separate collections to unified 'users' collection
 * 
 * This script migrates users from:
 * - customers collection -> users collection (with userType: 'customer')
 * - drivers collection -> users collection (with userType: 'driver') 
 * - admins collection -> users collection (with userType: 'admin')
 */

const { initializeFirebase } = require('../src/services/firebase');
const { getFirestore } = require('../src/services/firebase');

async function migrateUsers() {
  try {
    console.log('🚀 Starting user migration to unified collection...');
    
    // Initialize Firebase
    initializeFirebase();
    const db = getFirestore();
    
    // Collections to migrate
    const collections = [
      { name: 'customers', userType: 'customer' },
      { name: 'drivers', userType: 'driver' },
      { name: 'admins', userType: 'admin' }
    ];
    
    let totalMigrated = 0;
    let totalErrors = 0;
    
    for (const collection of collections) {
      console.log(`\n📦 Processing ${collection.name} collection...`);
      
      try {
        // Get all documents from the collection
        const snapshot = await db.collection(collection.name).get();
        
        if (snapshot.empty) {
          console.log(`   ⚠️  No documents found in ${collection.name} collection`);
          continue;
        }
        
        console.log(`   📊 Found ${snapshot.size} documents in ${collection.name} collection`);
        
        // Process each document
        for (const doc of snapshot.docs) {
          try {
            const userData = doc.data();
            const uid = doc.id;
            
            // Add userType to the data
            const migratedData = {
              ...userData,
              userType: collection.userType,
              migratedAt: new Date().toISOString()
            };
            
            // Check if user already exists in users collection
            const existingUser = await db.collection('users').doc(uid).get();
            
            if (existingUser.exists) {
              console.log(`   ⚠️  User ${uid} already exists in users collection, skipping...`);
              continue;
            }
            
            // Create user in users collection
            await db.collection('users').doc(uid).set(migratedData);
            
            console.log(`   ✅ Migrated user ${uid} (${collection.userType})`);
            totalMigrated++;
            
          } catch (docError) {
            console.error(`   ❌ Error migrating document ${doc.id}:`, docError.message);
            totalErrors++;
          }
        }
        
        console.log(`   ✅ Completed ${collection.name} collection migration`);
        
      } catch (collectionError) {
        console.error(`   ❌ Error processing ${collection.name} collection:`, collectionError.message);
        totalErrors++;
      }
    }
    
    console.log(`\n🎉 Migration completed!`);
    console.log(`   📊 Total users migrated: ${totalMigrated}`);
    console.log(`   ❌ Total errors: ${totalErrors}`);
    
    if (totalErrors === 0) {
      console.log(`\n✅ All users successfully migrated to unified 'users' collection!`);
      console.log(`   🔄 You can now safely delete the old collections if needed.`);
    } else {
      console.log(`\n⚠️  Migration completed with ${totalErrors} errors. Please review the logs above.`);
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateUsers()
    .then(() => {
      console.log('\n🏁 Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateUsers };
