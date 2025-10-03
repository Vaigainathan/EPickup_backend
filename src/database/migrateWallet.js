const { getFirestore } = require('../services/firebase');

/**
 * Wallet System Database Migration Script
 * Creates Firestore collections for the wallet system
 */

const walletCollections = {
  driverWallets: {
    description: 'Driver wallet balances and information',
    fields: {
      driverId: 'string',
      initialCredit: 'number',
      commissionUsed: 'number',
      recharges: 'number',
      currentBalance: 'number',
      status: 'string', // 'active', 'inactive', 'suspended'
      lastRechargeDate: 'timestamp',
      lastCommissionDeduction: 'timestamp',
      createdAt: 'timestamp',
      updatedAt: 'timestamp'
    }
  },

  commissionTransactions: {
    description: 'Commission deduction transactions',
    fields: {
      driverId: 'string',
      tripId: 'string',
      distanceKm: 'number',
      commissionAmount: 'number',
      walletBalanceBefore: 'number',
      walletBalanceAfter: 'number',
      pickupLocation: 'map',
      dropoffLocation: 'map',
      tripFare: 'number',
      status: 'string', // 'pending', 'completed', 'failed', 'refunded'
      notes: 'string',
      createdAt: 'timestamp',
      updatedAt: 'timestamp'
    }
  },

  rechargeTransactions: {
    description: 'Wallet recharge transactions',
    fields: {
      driverId: 'string',
      amount: 'number',
      paymentMethod: 'string', // 'upi', 'cash'
      paymentGateway: 'string', // 'phonepe', 'cash'
      transactionId: 'string',
      gatewayTransactionId: 'string',
      status: 'string', // 'pending', 'completed', 'failed', 'cancelled'
      walletBalanceBefore: 'number',
      walletBalanceAfter: 'number',
      failureReason: 'string',
      receiptUrl: 'string',
      notes: 'string',
      createdAt: 'timestamp',
      updatedAt: 'timestamp'
    }
  }
};

/**
 * Create wallet system collections
 */
async function createWalletCollections() {
  const db = getFirestore();
  console.log('💰 Creating wallet system collections...');
  
  for (const [collectionName, collectionInfo] of Object.entries(walletCollections)) {
    try {
      // Create a schema document to ensure collection exists
      const docRef = db.collection(collectionName).doc('_schema');
      await docRef.set({
        description: collectionInfo.description,
        fields: collectionInfo.fields,
        createdAt: new Date(),
        isSchema: true
      });
      
      console.log(`✅ Created collection: ${collectionName}`);
    } catch (error) {
      console.error(`❌ Failed to create collection ${collectionName}:`, error.message);
    }
  }
}

/**
 * Create indexes for wallet collections
 */
async function createWalletIndexes() {
  console.log('📊 Creating wallet system indexes...');
  
  // Note: Firestore automatically creates single-field indexes
  // Composite indexes need to be created manually in Firebase Console
  console.log('💡 For optimal performance, create these composite indexes in Firebase Console:');
  console.log('   - driverWallets: driverId (ascending)');
  console.log('   - commissionTransactions: driverId (ascending), createdAt (descending)');
  console.log('   - commissionTransactions: tripId (ascending)');
  console.log('   - rechargeTransactions: driverId (ascending), createdAt (descending)');
  console.log('   - rechargeTransactions: transactionId (ascending)');
  console.log('   - rechargeTransactions: status (ascending), createdAt (descending)');
}

/**
 * Create sample data for testing
 */
async function createSampleWalletData() {
  const db = getFirestore();
  console.log('🧪 Creating sample wallet data...');
  
  try {
    // Sample driver wallet
    const sampleWallet = {
      driverId: 'sample_driver_001',
      initialCredit: 500,
      commissionUsed: 0,
      recharges: 0,
      currentBalance: 500,
      status: 'active',
      lastRechargeDate: null,
      lastCommissionDeduction: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await db.collection('driverWallets').doc('sample_driver_001').set(sampleWallet);
    console.log('✅ Created sample driver wallet');
    
    // Sample commission transaction
    const sampleCommission = {
      driverId: 'sample_driver_001',
      tripId: 'sample_trip_001',
      distanceKm: 5.2,
      commissionAmount: 5.2,
      walletBalanceBefore: 500,
      walletBalanceAfter: 494.8,
      pickupLocation: {
        address: 'Sample Pickup Address',
        coordinates: { lat: 12.9716, lng: 77.5946 }
      },
      dropoffLocation: {
        address: 'Sample Dropoff Address',
        coordinates: { lat: 12.9789, lng: 77.5917 }
      },
      tripFare: 52,
      status: 'completed',
      notes: 'Sample commission transaction',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await db.collection('commissionTransactions').add(sampleCommission);
    console.log('✅ Created sample commission transaction');
    
    // Sample recharge transaction
    const sampleRecharge = {
      driverId: 'sample_driver_001',
      amount: 100,
      paymentMethod: 'upi',
      paymentGateway: 'phonepe',
      transactionId: 'sample_recharge_001',
      gatewayTransactionId: 'phonepe_sample_001',
      status: 'completed',
      walletBalanceBefore: 494.8,
      walletBalanceAfter: 594.8,
      failureReason: null,
      receiptUrl: 'https://example.com/receipt.pdf',
      notes: 'Sample recharge transaction',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await db.collection('rechargeTransactions').add(sampleRecharge);
    console.log('✅ Created sample recharge transaction');
    
  } catch (error) {
    console.error('❌ Failed to create sample data:', error.message);
  }
}

/**
 * Main migration function
 */
async function migrateWalletSystem() {
  console.log('🚀 Starting wallet system migration...');
  
  try {
    await createWalletCollections();
    await createWalletIndexes();
    await createSampleWalletData();
    
    console.log('✅ Wallet system migration completed successfully!');
  } catch (error) {
    console.error('❌ Wallet system migration failed:', error.message);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateWalletSystem()
    .then(() => {
      console.log('🎉 Wallet system setup complete!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Wallet system setup failed:', error);
      process.exit(1);
    });
}

module.exports = {
  migrateWalletSystem,
  createWalletCollections,
  createWalletIndexes,
  createSampleWalletData
};
