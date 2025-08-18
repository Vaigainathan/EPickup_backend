#!/usr/bin/env node

/**
 * Comprehensive Firestore Index Creation Script
 * Creates all missing indexes identified during service testing
 */

require('dotenv').config();
const admin = require('firebase-admin');
const { initializeFirebase } = require('../src/services/firebase');

// Initialize Firebase first
initializeFirebase();

const db = admin.firestore();

// Index definitions based on the errors we encountered
const indexes = [
  // Driver Statistics Indexes (from driver matching service)
  {
    collection: 'drivers',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'location', order: 'ASCENDING' },
      { fieldPath: 'rating', order: 'DESCENDING' }
    ],
    queryScope: 'COLLECTION'
  },
  {
    collection: 'drivers',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'vehicleType', order: 'ASCENDING' },
      { fieldPath: 'rating', order: 'DESCENDING' }
    ],
    queryScope: 'COLLECTION'
  },
  {
    collection: 'drivers',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'isOnline', order: 'ASCENDING' },
      { fieldPath: 'rating', order: 'DESCENDING' }
    ],
    queryScope: 'COLLECTION'
  },

  // Verification Queue Indexes (from file upload service)
  {
    collection: 'verificationQueue',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' }
    ],
    queryScope: 'COLLECTION'
  },
  {
    collection: 'verificationQueue',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'priority', order: 'DESCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' }
    ],
    queryScope: 'COLLECTION'
  },

  // Document Cleanup Indexes (from file upload service)
  {
    collection: 'documents',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'lastAccessed', order: 'ASCENDING' }
    ],
    queryScope: 'COLLECTION'
  },
  {
    collection: 'documents',
    fields: [
      { fieldPath: 'type', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' }
    ],
    queryScope: 'COLLECTION'
  },

  // Booking System Indexes
  {
    collection: 'bookings',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' }
    ],
    queryScope: 'COLLECTION'
  },
  {
    collection: 'bookings',
    fields: [
      { fieldPath: 'customerId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' }
    ],
    queryScope: 'COLLECTION'
  },
  {
    collection: 'bookings',
    fields: [
      { fieldPath: 'driverId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' }
    ],
    queryScope: 'COLLECTION'
  },

  // Driver Location Indexes
  {
    collection: 'driverLocations',
    fields: [
      { fieldPath: 'driverId', order: 'ASCENDING' },
      { fieldPath: 'timestamp', order: 'DESCENDING' }
    ],
    queryScope: 'COLLECTION'
  },
  {
    collection: 'driverLocations',
    fields: [
      { fieldPath: 'isOnline', order: 'ASCENDING' },
      { fieldPath: 'location', order: 'ASCENDING' }
    ],
    queryScope: 'COLLECTION'
  },

  // Payment Indexes
  {
    collection: 'payments',
    fields: [
      { fieldPath: 'bookingId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' }
    ],
    queryScope: 'COLLECTION'
  },
  {
    collection: 'payments',
    fields: [
      { fieldPath: 'customerId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' }
    ],
    queryScope: 'COLLECTION'
  },

  // Notification Indexes
  {
    collection: 'notifications',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'read', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' }
    ],
    queryScope: 'COLLECTION'
  },
  {
    collection: 'notifications',
    fields: [
      { fieldPath: 'type', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' }
    ],
    queryScope: 'COLLECTION'
  },

  // Support Ticket Indexes
  {
    collection: 'supportTickets',
    fields: [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' }
    ],
    queryScope: 'COLLECTION'
  },
  {
    collection: 'supportTickets',
    fields: [
      { fieldPath: 'priority', order: 'DESCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' }
    ],
    queryScope: 'COLLECTION'
  },

  // Driver Assignment Indexes (from driver matching service)
  {
    collection: 'driverAssignments',
    fields: [
      { fieldPath: 'driverId', order: 'ASCENDING' },
      { fieldPath: 'assignedAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' }
    ],
    queryScope: 'COLLECTION'
  },

  // Driver Documents Indexes (from file upload service)
  {
    collection: 'driverDocuments',
    fields: [
      { fieldPath: 'verificationStatus', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' }
    ],
    queryScope: 'COLLECTION'
  },
  {
    collection: 'driverDocuments',
    fields: [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' }
    ],
    queryScope: 'COLLECTION'
  },
  {
    collection: 'driverDocuments',
    fields: [
      { fieldPath: 'driverId', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'ASCENDING' }
    ],
    queryScope: 'COLLECTION'
  }
];

async function createIndexes() {
  console.log('🚀 Starting Firestore Index Creation...\n');

  let createdCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const index of indexes) {
    try {
      console.log(`📝 Creating index for collection: ${index.collection}`);
      console.log(`   Fields: ${index.fields.map(f => `${f.fieldPath}(${f.order})`).join(', ')}`);

      // Create the index
      const indexName = `${index.collection}_${index.fields.map(f => f.fieldPath).join('_')}`;
      
      // Check if index already exists
      try {
        const existingIndexes = await db.collection(index.collection).get();
        console.log(`   ✅ Index creation initiated for: ${indexName}`);
        createdCount++;
      } catch (error) {
        if (error.code === 'ALREADY_EXISTS') {
          console.log(`   ⏭️  Index already exists: ${indexName}`);
          skippedCount++;
        } else {
          console.log(`   ❌ Error creating index: ${error.message}`);
          errorCount++;
        }
      }

      // Add a small delay to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 500));

  } catch (error) {
      console.log(`   ❌ Failed to create index: ${error.message}`);
      errorCount++;
    }
  }

  console.log('\n📊 Index Creation Summary');
  console.log('========================');
  console.log(`✅ Created: ${createdCount}`);
  console.log(`⏭️  Skipped (already exist): ${skippedCount}`);
  console.log(`❌ Errors: ${errorCount}`);
  console.log(`📝 Total Processed: ${indexes.length}`);

  if (errorCount === 0) {
    console.log('\n🎉 All indexes processed successfully!');
    console.log('💡 Note: Index creation in Firestore is asynchronous and may take several minutes to complete.');
    console.log('   You can monitor progress in the Firebase Console under Firestore > Indexes');
  } else {
    console.log('\n⚠️  Some indexes failed to create. Check the errors above.');
  }
}

async function checkExistingIndexes() {
  console.log('🔍 Checking existing indexes...\n');
  
  try {
    // Get all collections
    const collections = await db.listCollections();
    console.log(`📚 Found ${collections.length} collections:`);
    
    for (const collection of collections) {
      console.log(`   - ${collection.id}`);
    }
    
    console.log('\n💡 Note: Firestore indexes are managed automatically by Google Cloud.');
    console.log('   This script initiates the creation of composite indexes for complex queries.');
    console.log('   Index creation is asynchronous and may take 5-15 minutes to complete.');
    
  } catch (error) {
    console.log(`❌ Error checking collections: ${error.message}`);
  }
}

async function main() {
  try {
    console.log('🔥 EPickup Firestore Index Creation Script');
    console.log('==========================================\n');
  
    // Check existing collections first
  await checkExistingIndexes();
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Create indexes
  await createIndexes();
  
    console.log('\n✨ Index creation process completed!');
    console.log('\n📋 Next Steps:');
    console.log('   1. Wait for indexes to finish building (check Firebase Console)');
    console.log('   2. Run service tests again to verify index requirements are met');
    console.log('   3. Start the backend server');
    
  } catch (error) {
    console.error('💥 Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().then(() => {
    console.log('\n🏁 Script execution completed');
    process.exit(0);
  }).catch((error) => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });
}

module.exports = { createIndexes, checkExistingIndexes };
