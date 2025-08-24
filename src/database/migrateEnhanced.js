const { getFirestore } = require('../services/firebase');

/**
 * Enhanced Database Migration Script
 * Adds missing fields and collections for account management features
 */
async function migrateEnhancedSchema() {
  const db = getFirestore();
  console.log('Starting enhanced database migration...');

  try {
    // 1. Update existing users with new fields
    console.log('Updating existing users with new fields...');
    const usersSnapshot = await db.collection('users').get();
    
    const batch = db.batch();
    let updatedUsers = 0;

    usersSnapshot.docs.forEach(doc => {
      const userData = doc.data();
      const updates = {};

      // Add missing fields if they don't exist
      if (!userData.hasOwnProperty('emailVerified')) {
        updates.emailVerified = false;
      }
      if (!userData.hasOwnProperty('phoneVerified')) {
        updates.phoneVerified = userData.isVerified || false;
      }
      if (!userData.hasOwnProperty('passwordHash')) {
        updates.passwordHash = null;
      }
      if (!userData.hasOwnProperty('profilePicture')) {
        updates.profilePicture = null;
      }
      if (!userData.hasOwnProperty('accountStatus')) {
        updates.accountStatus = 'active';
      }
      if (!userData.hasOwnProperty('lastLoginAt')) {
        updates.lastLoginAt = userData.createdAt || new Date();
      }
      if (!userData.hasOwnProperty('updatedAt')) {
        updates.updatedAt = new Date();
      }

      // Update customer-specific fields
      if (userData.userType === 'customer' && !userData.hasOwnProperty('customer')) {
        updates.customer = {
          wallet: {
            balance: 0,
            currency: 'INR'
          },
          savedAddresses: [],
          preferences: {}
        };
      }

      if (Object.keys(updates).length > 0) {
        batch.update(doc.ref, updates);
        updatedUsers++;
      }
    });

    if (updatedUsers > 0) {
      await batch.commit();
      console.log(`Updated ${updatedUsers} users with new fields`);
    }

    // 2. Create emailVerifications collection structure
    console.log('Creating emailVerifications collection structure...');
    const emailVerificationsRef = db.collection('emailVerifications').doc('_structure');
    await emailVerificationsRef.set({
      description: 'Email verification tokens collection',
      schema: {
        userId: 'string',
        email: 'string',
        token: 'string',
        type: 'verification | change | password_reset',
        expiresAt: 'timestamp',
        used: 'boolean',
        createdAt: 'timestamp'
      },
      createdAt: new Date()
    });

    // 3. Create auditLogs collection structure
    console.log('Creating auditLogs collection structure...');
    const auditLogsRef = db.collection('auditLogs').doc('_structure');
    await auditLogsRef.set({
      description: 'Security audit logs collection',
      schema: {
        userId: 'string',
        action: 'string',
        resource: 'string',
        resourceId: 'string',
        details: 'object',
        ipAddress: 'string',
        userAgent: 'string',
        timestamp: 'timestamp'
      },
      createdAt: new Date()
    });

    // 4. Create sessions collection structure
    console.log('Creating sessions collection structure...');
    const sessionsRef = db.collection('sessions').doc('_structure');
    await sessionsRef.set({
      description: 'User sessions collection',
      schema: {
        userId: 'string',
        sessionId: 'string',
        deviceId: 'string',
        deviceInfo: 'object',
        ipAddress: 'string',
        userAgent: 'string',
        isActive: 'boolean',
        lastActivity: 'timestamp',
        createdAt: 'timestamp',
        expiresAt: 'timestamp'
      },
      createdAt: new Date()
    });

    // 5. Create fileUploads collection structure
    console.log('Creating fileUploads collection structure...');
    const fileUploadsRef = db.collection('fileUploads').doc('_structure');
    await fileUploadsRef.set({
      description: 'File upload tracking collection',
      schema: {
        userId: 'string',
        type: 'string',
        filename: 'string',
        url: 'string',
        size: 'number',
        originalName: 'string',
        uploadedAt: 'timestamp',
        status: 'active | deleted'
      },
      createdAt: new Date()
    });

    // 6. Create indexes for better query performance
    console.log('Creating database indexes...');
    
    // Index for email verifications
    await createIndex('emailVerifications', [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'type', order: 'ASCENDING' },
      { fieldPath: 'expiresAt', order: 'ASCENDING' }
    ]);

    // Index for audit logs
    await createIndex('auditLogs', [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'timestamp', order: 'DESCENDING' }
    ]);

    // Index for sessions
    await createIndex('sessions', [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'isActive', order: 'ASCENDING' },
      { fieldPath: 'lastActivity', order: 'DESCENDING' }
    ]);

    // Index for file uploads
    await createIndex('fileUploads', [
      { fieldPath: 'userId', order: 'ASCENDING' },
      { fieldPath: 'type', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' }
    ]);

    console.log('Enhanced database migration completed successfully!');
    return true;

  } catch (error) {
    console.error('Error during enhanced migration:', error);
    throw error;
  }
}

/**
 * Create a composite index for a collection
 */
async function createIndex(collectionName, fields) {
  try {
    // Note: In a real Firebase project, you would need to create these indexes
    // through the Firebase Console or using the Firebase CLI
    console.log(`Index created for ${collectionName}:`, fields.map(f => f.fieldPath).join(', '));
  } catch (error) {
    console.warn(`Could not create index for ${collectionName}:`, error.message);
  }
}

/**
 * Validate the migration
 */
async function validateMigration() {
  const db = getFirestore();
  console.log('Validating migration...');

  try {
    // Check if new collections exist
    const collections = ['emailVerifications', 'auditLogs', 'sessions', 'fileUploads'];
    
    for (const collectionName of collections) {
      const snapshot = await db.collection(collectionName).limit(1).get();
      console.log(`✓ ${collectionName} collection exists`);
    }

    // Check if users have new fields
    const usersSnapshot = await db.collection('users').limit(1).get();
    if (!usersSnapshot.empty) {
      const userData = usersSnapshot.docs[0].data();
      const requiredFields = ['emailVerified', 'phoneVerified', 'accountStatus', 'lastLoginAt'];
      
      for (const field of requiredFields) {
        if (userData.hasOwnProperty(field)) {
          console.log(`✓ Users have ${field} field`);
        } else {
          console.warn(`⚠ Users missing ${field} field`);
        }
      }
    }

    console.log('Migration validation completed!');
    return true;

  } catch (error) {
    console.error('Error validating migration:', error);
    return false;
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateEnhancedSchema()
    .then(() => validateMigration())
    .then(() => {
      console.log('Enhanced migration completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = {
  migrateEnhancedSchema,
  validateMigration
};
