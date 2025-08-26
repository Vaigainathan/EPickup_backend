const { getFirestore } = require('../src/services/firebase');

/**
 * Firebase Index Setup Script
 * This script helps create composite indexes for optimal query performance
 */

const indexConfigurations = [
  // Users Collection
  {
    collection: 'users',
    fields: ['userType', 'isActive'],
    description: 'Query users by type and active status'
  },
  
  // Drivers Collection
  {
    collection: 'drivers',
    fields: ['isOnline', 'isAvailable'],
    description: 'Query available online drivers'
  },
  
  // Bookings Collection
  {
    collection: 'bookings',
    fields: ['status', 'createdAt'],
    description: 'Query bookings by status and creation date'
  },
  
  // Orders Collection
  {
    collection: 'orders',
    fields: ['customerId', 'status'],
    description: 'Query customer orders by status'
  },
  
  // Payments Collection
  {
    collection: 'payments',
    fields: ['customerId', 'status'],
    description: 'Query customer payments by status'
  },
  
  // Notifications Collection
  {
    collection: 'notifications',
    fields: ['userId', 'isRead'],
    description: 'Query unread notifications for user'
  },
  
  // Wallet System Indexes
  {
    collection: 'driverWallets',
    fields: ['driverId'],
    description: 'Query driver wallet by driver ID'
  },
  
  {
    collection: 'commissionTransactions',
    fields: ['driverId', 'createdAt'],
    description: 'Query commission transactions by driver and date'
  },
  
  {
    collection: 'commissionTransactions',
    fields: ['tripId'],
    description: 'Query commission transaction by trip ID'
  },
  
  {
    collection: 'rechargeTransactions',
    fields: ['driverId', 'createdAt'],
    description: 'Query recharge transactions by driver and date'
  },
  
  {
    collection: 'rechargeTransactions',
    fields: ['transactionId'],
    description: 'Query recharge transaction by transaction ID'
  },
  
  {
    collection: 'rechargeTransactions',
    fields: ['status', 'createdAt'],
    description: 'Query recharge transactions by status and date'
  }
];

function displayIndexInstructions() {
  console.log('🔥 Firebase Index Setup Instructions');
  console.log('=====================================\n');
  
  console.log('📋 Manual Index Creation Required:');
  console.log('Firebase Console → Firestore Database → Indexes → Create Index\n');
  
  indexConfigurations.forEach((index, i) => {
    console.log(`${i + 1}. Collection: ${index.collection}`);
    console.log(`   Fields: [${index.fields.join(', ')}]`);
    console.log(`   Description: ${index.description}`);
    console.log('');
  });
  
  console.log('📝 Steps to create indexes:');
  console.log('1. Go to Firebase Console: https://console.firebase.google.com');
  console.log('2. Select your project');
  console.log('3. Go to Firestore Database → Indexes');
  console.log('4. Click "Create Index"');
  console.log('5. Add each index configuration above');
  console.log('6. Wait for indexes to build (may take several minutes)');
  console.log('');
  
  console.log('⚠️  Note: Single-field indexes are created automatically');
  console.log('   Only composite indexes need manual creation');
}

async function checkExistingIndexes() {
  try {
    const db = getFirestore();
    console.log('🔍 Checking existing indexes...\n');
    
    // Note: Firebase Admin SDK doesn't provide direct access to index information
    // This would require Firebase CLI or manual verification in console
    console.log('📊 To check existing indexes:');
    console.log('   Firebase Console → Firestore Database → Indexes');
    console.log('');
    
  } catch (error) {
    console.error('❌ Error checking indexes:', error.message);
  }
}

async function main() {
  console.log('🚀 Firebase Index Setup Script\n');
  
  await checkExistingIndexes();
  displayIndexInstructions();
  
  console.log('✅ Index setup instructions completed!');
  console.log('📋 Next: Set up Firestore security rules');
}

if (require.main === module) {
  main()
    .then(() => {
      console.log('\n🎉 Setup script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Setup script failed:', error);
      process.exit(1);
    });
}

module.exports = {
  indexConfigurations,
  displayIndexInstructions,
  checkExistingIndexes
};
