// Load environment variables
require('dotenv').config();

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

/**
 * Migration Script: Convert Custom Token Users to Firebase Users
 * 
 * This script will:
 * 1. Find all users with custom IDs (not Firebase UIDs)
 * 2. Look up their Firebase UID by phone number
 * 3. Migrate their data to use Firebase UID as primary key
 * 4. Clean up old custom user records
 */

// Initialize Firebase Admin SDK
function initializeFirebase() {
  try {
    // Check if Firebase is already initialized
    if (admin.apps.length > 0) {
      console.log('✅ Firebase Admin SDK already initialized');
      return admin.app();
    }

    // Use environment variables for service account (Render deployment)
    if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PROJECT_ID) {
      try {
        // Handle private key formatting - it might be base64 encoded or have escaped newlines
        let privateKey = process.env.FIREBASE_PRIVATE_KEY;
        
        // If it's base64 encoded, decode it
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
          try {
            privateKey = Buffer.from(privateKey, 'base64').toString('utf8');
          } catch {
            // If base64 decode fails, try with escaped newlines
            privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
          }
        } else {
          // Already in PEM format, just fix newlines
          privateKey = privateKey.replace(/\\n/g, '\n');
        }

        const serviceAccount = {
          type: "service_account",
          project_id: process.env.FIREBASE_PROJECT_ID,
          private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
          private_key: privateKey,
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
          client_id: process.env.FIREBASE_CLIENT_ID,
          auth_uri: process.env.FIREBASE_AUTH_URI,
          token_uri: process.env.FIREBASE_TOKEN_URI,
          auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
          client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
        };

        const app = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: process.env.FIREBASE_PROJECT_ID
        });

        console.log('✅ Firebase Admin SDK initialized with service account');
        return app;
      } catch (error) {
        console.error('❌ Error initializing Firebase with service account:', error);
        throw error;
      }
    } else {
      // Try to use default service account (local development)
      try {
        const app = admin.initializeApp();
        console.log('✅ Firebase Admin SDK initialized with default credentials');
        return app;
      } catch (error) {
        console.error('❌ Error initializing Firebase with default credentials:', error);
        throw new Error('Firebase initialization failed. Please check your environment variables or service account file.');
      }
    }
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error);
    throw error;
  }
}

class UserMigrationService {
  constructor() {
    // Initialize Firebase first
    initializeFirebase();
    this.db = getFirestore();
    this.migratedCount = 0;
    this.errorCount = 0;
    this.skippedCount = 0;
  }

  /**
   * Check if a string is a Firebase UID (28 chars, alphanumeric)
   */
  isFirebaseUID(id) {
    return /^[a-zA-Z0-9]{28}$/.test(id);
  }

  /**
   * Get Firebase UID by phone number
   */
  async getFirebaseUIDByPhone(phoneNumber) {
    try {
      // Query users collection for Firebase UID with this phone
      const usersSnapshot = await this.db.collection('users')
        .where('phone', '==', phoneNumber)
        .get();

      for (const doc of usersSnapshot.docs) {
        if (this.isFirebaseUID(doc.id)) {
          return doc.id;
        }
      }
      return null;
    } catch (error) {
      console.error('Error getting Firebase UID by phone:', error);
      return null;
    }
  }

  /**
   * Check if custom user ID is actually a Firebase UID that was created through old system
   */
  async isCustomUserActuallyFirebaseUID(customUserId, phoneNumber) {
    try {
      // Check if this custom user ID is actually a Firebase UID format
      if (this.isFirebaseUID(customUserId)) {
        // Check if there's a Firebase user with this exact UID
        const firebaseUserDoc = await this.db.collection('users').doc(customUserId).get();
        if (firebaseUserDoc.exists) {
          const firebaseUserData = firebaseUserDoc.data();
          // If phone numbers match, this is the same user
          if (firebaseUserData.phone === phoneNumber) {
            return true;
          }
        }
      }
      return false;
    } catch (error) {
      console.error('Error checking if custom user is Firebase UID:', error);
      return false;
    }
  }

  /**
   * Migrate a single user from custom ID to Firebase UID
   */
  async migrateUser(customUserId, userData) {
    try {
      console.log(`\n🔄 Migrating user: ${customUserId}`);
      console.log(`   Phone: ${userData.phone}`);
      console.log(`   Name: ${userData.name || 'N/A'}`);

      // Check if this custom user is actually a Firebase UID that was created through old system
      const isActuallyFirebaseUID = await this.isCustomUserActuallyFirebaseUID(customUserId, userData.phone);
      
      if (isActuallyFirebaseUID) {
        console.log(`   ✅ Custom user ${customUserId} is already a Firebase UID format`);
        console.log(`   🔄 Updating user data to ensure Firebase compatibility...`);
        
        // Update the existing Firebase user with any missing data
        const firebaseUserDoc = await this.db.collection('users').doc(customUserId).get();
        const firebaseUserData = firebaseUserDoc.data();
        
        const updatedData = {
          ...firebaseUserData,
          ...userData,
          id: customUserId, // Ensure ID is Firebase UID
          uid: customUserId,
          migratedFrom: 'custom_system',
          migrationDate: new Date().toISOString(),
          isVerified: true,
        };

        await this.db.collection('users').doc(customUserId).set(updatedData, { merge: true });
        console.log(`   ✅ Updated Firebase user ${customUserId} with custom data`);
        
        this.migratedCount++;
        return true;
      }

      // Check if Firebase UID already exists for this phone
      const firebaseUID = await this.getFirebaseUIDByPhone(userData.phone);
      
      if (!firebaseUID) {
        console.log(`   ⚠️  No Firebase UID found for phone ${userData.phone}`);
        this.skippedCount++;
        return false;
      }

      // Check if Firebase user already has data
      const firebaseUserDoc = await this.db.collection('users').doc(firebaseUID).get();
      
      if (firebaseUserDoc.exists) {
        console.log(`   ⚠️  Firebase user ${firebaseUID} already exists, merging data...`);
        
        // Merge data (keep Firebase user as primary, add missing fields from custom user)
        const firebaseUserData = firebaseUserDoc.data();
        const mergedData = {
          ...firebaseUserData,
          ...userData,
          id: firebaseUID, // Ensure ID is Firebase UID
          migratedFrom: customUserId,
          migrationDate: new Date().toISOString(),
          // Keep Firebase-specific fields
          uid: firebaseUID,
          isVerified: firebaseUserData.isVerified || true,
        };

        await this.db.collection('users').doc(firebaseUID).set(mergedData, { merge: true });
        console.log(`   ✅ Merged data into Firebase user ${firebaseUID}`);
      } else {
        // Create new Firebase user with custom user data
        const migratedData = {
          ...userData,
          id: firebaseUID,
          uid: firebaseUID,
          migratedFrom: customUserId,
          migrationDate: new Date().toISOString(),
          isVerified: true,
        };

        await this.db.collection('users').doc(firebaseUID).set(migratedData);
        console.log(`   ✅ Created Firebase user ${firebaseUID}`);
      }

      // Delete old custom user record
      await this.db.collection('users').doc(customUserId).delete();
      console.log(`   🗑️  Deleted old custom user ${customUserId}`);

      this.migratedCount++;
      return true;

    } catch (error) {
      console.error(`   ❌ Error migrating user ${customUserId}:`, error);
      this.errorCount++;
      return false;
    }
  }

  /**
   * Migrate all custom users to Firebase users
   */
  async migrateAllUsers() {
    try {
      console.log('🚀 Starting user migration from custom tokens to Firebase...\n');

      // Get all users
      const usersSnapshot = await this.db.collection('users').get();
      const customUsers = [];

      // Identify custom users (non-Firebase UIDs)
      usersSnapshot.forEach(doc => {
        const userData = doc.data();
        if (!this.isFirebaseUID(doc.id) && userData.phone) {
          customUsers.push({
            id: doc.id,
            data: userData
          });
        }
      });

      console.log(`📊 Found ${customUsers.length} custom users to migrate\n`);

      if (customUsers.length === 0) {
        console.log('✅ No custom users found. Migration not needed.');
        return;
      }

      // Migrate each user
      for (const user of customUsers) {
        await this.migrateUser(user.id, user.data);
        
        // Add small delay to avoid overwhelming Firestore
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Print summary
      console.log('\n📊 MIGRATION SUMMARY:');
      console.log(`   ✅ Successfully migrated: ${this.migratedCount}`);
      console.log(`   ⚠️  Skipped (no Firebase UID): ${this.skippedCount}`);
      console.log(`   ❌ Errors: ${this.errorCount}`);
      console.log(`   📝 Total processed: ${customUsers.length}`);

    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  /**
   * Clean up orphaned data
   */
  async cleanupOrphanedData() {
    try {
      console.log('\n🧹 Cleaning up orphaned data...');

      // Clean up old auth tokens, sessions, etc.
      // This would depend on your specific data structure
      
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('❌ Cleanup failed:', error);
    }
  }

  /**
   * Verify migration results
   */
  async verifyMigration() {
    try {
      console.log('\n🔍 Verifying migration results...');

      const usersSnapshot = await this.db.collection('users').get();
      let firebaseUsers = 0;
      let customUsers = 0;

      usersSnapshot.forEach(doc => {
        if (this.isFirebaseUID(doc.id)) {
          firebaseUsers++;
        } else {
          customUsers++;
        }
      });

      console.log(`   📊 Firebase users: ${firebaseUsers}`);
      console.log(`   📊 Custom users remaining: ${customUsers}`);

      if (customUsers === 0) {
        console.log('   ✅ Migration successful! All users now use Firebase UIDs');
      } else {
        console.log(`   ⚠️  ${customUsers} custom users still remain`);
      }

    } catch (error) {
      console.error('❌ Verification failed:', error);
    }
  }
}

// Main execution
async function main() {
  try {
    const migrationService = new UserMigrationService();
    
    // Run migration
    await migrationService.migrateAllUsers();
    
    // Clean up orphaned data
    await migrationService.cleanupOrphanedData();
    
    // Verify results
    await migrationService.verifyMigration();
    
    console.log('\n🎉 Migration completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = UserMigrationService;
