const { getFirestore } = require('../services/firebase');

/**
 * Database Migration Script
 * Creates Firestore collections and sets up initial data structure
 */

const collections = {
  users: {
    description: 'User accounts (customers and drivers)',
    fields: {
      uid: 'string',
      email: 'string',
      phoneNumber: 'string',
      userType: 'string', // 'customer' or 'driver'
      profile: 'map',
      createdAt: 'timestamp',
      updatedAt: 'timestamp',
      isActive: 'boolean',
      lastLoginAt: 'timestamp'
    }
  },
  
  customers: {
    description: 'Customer-specific data',
    fields: {
      uid: 'string',
      customerId: 'string',
      personalInfo: 'map',
      addresses: 'array',
      preferences: 'map',
      rating: 'number',
      totalOrders: 'number',
      createdAt: 'timestamp',
      updatedAt: 'timestamp'
    }
  },
  
  drivers: {
    description: 'Driver-specific data',
    fields: {
      uid: 'string',
      driverId: 'string',
      personalInfo: 'map',
      vehicleInfo: 'map',
      documents: 'map',
      location: 'geopoint',
      isOnline: 'boolean',
      isAvailable: 'boolean',
      rating: 'number',
      totalDeliveries: 'number',
      earnings: 'map',
      createdAt: 'timestamp',
      updatedAt: 'timestamp'
    }
  },
  
  bookings: {
    description: 'Delivery bookings',
    fields: {
      bookingId: 'string',
      customerId: 'string',
      driverId: 'string',
      pickupLocation: 'map',
      dropoffLocation: 'map',
      packageDetails: 'map',
      status: 'string',
      fare: 'map',
      paymentStatus: 'string',
      createdAt: 'timestamp',
      updatedAt: 'timestamp',
      scheduledAt: 'timestamp',
      completedAt: 'timestamp'
    }
  },
  
  orders: {
    description: 'Order tracking and history',
    fields: {
      orderId: 'string',
      bookingId: 'string',
      customerId: 'string',
      driverId: 'string',
      status: 'string',
      tracking: 'array',
      estimatedDelivery: 'timestamp',
      actualDelivery: 'timestamp',
      createdAt: 'timestamp',
      updatedAt: 'timestamp'
    }
  },
  
  payments: {
    description: 'Payment transactions',
    fields: {
      paymentId: 'string',
      orderId: 'string',
      customerId: 'string',
      amount: 'number',
      currency: 'string',
      method: 'string',
      status: 'string',
      gatewayResponse: 'map',
      createdAt: 'timestamp',
      updatedAt: 'timestamp'
    }
  },
  
  notifications: {
    description: 'Push notifications and messages',
    fields: {
      notificationId: 'string',
      userId: 'string',
      type: 'string',
      title: 'string',
      body: 'string',
      data: 'map',
      isRead: 'boolean',
      sentAt: 'timestamp',
      readAt: 'timestamp'
    }
  },
  
  appSettings: {
    description: 'Application configuration and settings',
    fields: {
      key: 'string',
      value: 'any',
      description: 'string',
      updatedAt: 'timestamp',
      updatedBy: 'string'
    }
  },
  
  rates: {
    description: 'Pricing and fare calculation rules',
    fields: {
      rateId: 'string',
      baseFare: 'number',
      perKmRate: 'number',
      waitingCharge: 'number',
      surgeMultiplier: 'number',
      isActive: 'boolean',
      validFrom: 'timestamp',
      validTo: 'timestamp',
      createdAt: 'timestamp',
      updatedAt: 'timestamp'
    }
  },
  
  support: {
    description: 'Customer support tickets',
    fields: {
      ticketId: 'string',
      customerId: 'string',
      subject: 'string',
      description: 'string',
      status: 'string',
      priority: 'string',
      assignedTo: 'string',
      createdAt: 'timestamp',
      updatedAt: 'timestamp',
      resolvedAt: 'timestamp'
    }
  },

  // Wallet System Collections
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
      paymentMethod: 'string', // 'upi', 'card', 'netbanking', 'cash'
      paymentGateway: 'string', // 'razorpay', 'paytm', 'phonepe', 'cash'
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
 * Create Firestore collections with initial structure
 */
async function createCollections() {
  const db = getFirestore();
  console.log('🗄️  Creating Firestore collections...');
  
  for (const [collectionName, collectionInfo] of Object.entries(collections)) {
    try {
      // Create a dummy document to ensure collection exists
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
 * Create Firestore indexes for better query performance
 */
async function createIndexes() {
  console.log('📊 Creating Firestore indexes...');
  
  // Note: Firestore automatically creates single-field indexes
  // Composite indexes need to be created manually in Firebase Console
  // or via the Firebase CLI
  
  const indexConfigs = [
    {
      collection: 'users',
      fields: ['userType', 'isActive'],
      description: 'Query users by type and active status'
    },
    {
      collection: 'drivers',
      fields: ['isOnline', 'isAvailable'],
      description: 'Query available online drivers'
    },
    {
      collection: 'bookings',
      fields: ['status', 'createdAt'],
      description: 'Query bookings by status and creation date'
    },
    {
      collection: 'orders',
      fields: ['customerId', 'status'],
      description: 'Query customer orders by status'
    },
    {
      collection: 'payments',
      fields: ['customerId', 'status'],
      description: 'Query customer payments by status'
    },
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
  
  console.log('📋 Index configurations (create manually in Firebase Console):');
  indexConfigs.forEach((index, i) => {
    console.log(`   ${i + 1}. Collection: ${index.collection}`);
    console.log(`      Fields: [${index.fields.join(', ')}]`);
    console.log(`      Description: ${index.description}`);
    console.log('');
  });
}

/**
 * Seed initial application data
 */
async function seedInitialData() {
  const db = getFirestore();
  console.log('🌱 Seeding initial application data...');
  
  try {
    // Seed app settings
    const appSettings = [
      {
        key: 'app_version',
        value: '1.0.0',
        description: 'Current application version',
        updatedAt: new Date(),
        updatedBy: 'system'
      },
      {
        key: 'maintenance_mode',
        value: false,
        description: 'Application maintenance mode',
        updatedAt: new Date(),
        updatedBy: 'system'
      },
      {
        key: 'max_retry_attempts',
        value: 3,
        description: 'Maximum retry attempts for failed operations',
        updatedAt: new Date(),
        updatedBy: 'system'
      }
    ];
    
    for (const setting of appSettings) {
      await db.collection('appSettings').doc(setting.key).set(setting);
    }
    console.log('✅ App settings seeded');
    
    // Seed default rates
    const defaultRates = [
      {
        rateId: 'default_base',
        baseFare: 50,
        perKmRate: 15,
        waitingCharge: 2,
        surgeMultiplier: 1.5,
        isActive: true,
        validFrom: new Date(),
        validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];
    
    for (const rate of defaultRates) {
      await db.collection('rates').doc(rate.rateId).set(rate);
    }
    console.log('✅ Default rates seeded');
    
    // Seed admin user (if not exists)
    const adminEmail = 'admin@epickup.com';
    const adminDoc = await db.collection('users').where('email', '==', adminEmail).limit(1).get();
    
    if (adminDoc.empty) {
      await db.collection('users').doc('admin').set({
        uid: 'admin',
        email: adminEmail,
        phoneNumber: '+919999999999',
        userType: 'admin',
        profile: {
          name: 'EPickup Admin',
          role: 'super_admin'
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
        lastLoginAt: new Date()
      });
      console.log('✅ Admin user seeded');
    } else {
      console.log('✅ Admin user already exists');
    }
    
  } catch (error) {
    console.error('❌ Failed to seed initial data:', error.message);
  }
}

/**
 * Verify database connectivity and permissions
 */
async function verifyDatabase() {
  console.log('🔍 Verifying database connectivity...');
  
  try {
    const db = getFirestore();
    
    // Test read operation
    const testDoc = await db.collection('appSettings').doc('app_version').get();
    if (testDoc.exists) {
      console.log('✅ Database read operation successful');
    } else {
      console.log('⚠️  Database read operation returned no data');
    }
    
    // Test write operation
    const testWriteRef = db.collection('_test').doc('connectivity');
    await testWriteRef.set({
      test: true,
      timestamp: new Date()
    });
    console.log('✅ Database write operation successful');
    
    // Clean up test document
    await testWriteRef.delete();
    console.log('✅ Database delete operation successful');
    
    console.log('✅ Database connectivity and permissions verified');
    
  } catch (error) {
    console.error('❌ Database verification failed:', error.message);
    throw error;
  }
}

/**
 * Main migration function
 */
async function runMigrations() {
  try {
    console.log('🚀 Starting EPickup Backend Database Migration');
    console.log('==============================================\n');
    
    // Verify database connectivity first
    await verifyDatabase();
    console.log('');
    
    // Create collections
    await createCollections();
    console.log('');
    
    // Create indexes (configuration only)
    await createIndexes();
    console.log('');
    
    // Seed initial data
    await seedInitialData();
    console.log('');
    
    console.log('🎉 Database migration completed successfully!');
    console.log('✅ Collections created');
    console.log('✅ Indexes configured');
    console.log('✅ Initial data seeded');
    console.log('✅ Database connectivity verified');
    console.log('\n📋 Next steps:');
    console.log('   1. Create composite indexes in Firebase Console');
    console.log('   2. Set up Firestore security rules');
    console.log('   3. Configure backup and retention policies');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

// Run migrations if this file is executed directly
if (require.main === module) {
  runMigrations();
}

module.exports = {
  runMigrations,
  createCollections,
  createIndexes,
  seedInitialData,
  verifyDatabase
};
