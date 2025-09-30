// Load environment variables
require('dotenv').config();

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const fs = require('fs');
const path = require('path');

/**
 * Backup Script: Export all users before migration
 * 
 * This script will:
 * 1. Export all users to a JSON file
 * 2. Create a timestamped backup
 * 3. Allow rollback if needed
 */

// Initialize Firebase Admin SDK
function initializeFirebase() {
  try {
    // Check if Firebase is already initialized
    if (admin.apps.length > 0) {
      console.log('✅ Firebase Admin SDK already initialized');
      return admin.app();
    }

    // Debug environment variables
    console.log('🔍 Environment check:');
    console.log('   FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? '✅ Set' : '❌ Missing');
    console.log('   FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? '✅ Set' : '❌ Missing');
    console.log('   FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? '✅ Set' : '❌ Missing');

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

class UserBackupService {
  constructor() {
    // Initialize Firebase first
    initializeFirebase();
    this.db = getFirestore();
    this.backupDir = path.join(__dirname, '..', 'backups');
    this.timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  }

  /**
   * Ensure backup directory exists
   */
  ensureBackupDir() {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Backup all users to JSON file
   */
  async backupUsers() {
    try {
      console.log('🔄 Creating user backup...');
      
      this.ensureBackupDir();
      
      // Get all users
      const usersSnapshot = await this.db.collection('users').get();
      const users = [];
      
      usersSnapshot.forEach(doc => {
        users.push({
          id: doc.id,
          data: doc.data(),
          isFirebaseUID: /^[a-zA-Z][a-zA-Z0-9]{27}$/.test(doc.id)
        });
      });

      // Create backup file
      const backupFile = path.join(this.backupDir, `users-backup-${this.timestamp}.json`);
      const backupData = {
        timestamp: new Date().toISOString(),
        totalUsers: users.length,
        firebaseUsers: users.filter(u => u.isFirebaseUID).length,
        customUsers: users.filter(u => !u.isFirebaseUID).length,
        users: users
      };

      fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
      
      console.log(`✅ Backup created: ${backupFile}`);
      console.log(`   📊 Total users: ${users.length}`);
      console.log(`   🔥 Firebase users: ${backupData.firebaseUsers}`);
      console.log(`   🆔 Custom users: ${backupData.customUsers}`);
      
      return backupFile;
      
    } catch (error) {
      console.error('❌ Backup failed:', error);
      throw error;
    }
  }

  /**
   * Create a summary report
   */
  async createSummaryReport() {
    try {
      const usersSnapshot = await this.db.collection('users').get();
      const customUsers = [];
      const firebaseUsers = [];

      usersSnapshot.forEach(doc => {
        const userData = doc.data();
        const userInfo = {
          id: doc.id,
          phone: userData.phone,
          name: userData.name,
          email: userData.email,
          userType: userData.userType,
          createdAt: userData.createdAt
        };

        if (/^[a-zA-Z][a-zA-Z0-9]{27}$/.test(doc.id)) {
          firebaseUsers.push(userInfo);
        } else {
          customUsers.push(userInfo);
        }
      });

      const report = {
        timestamp: new Date().toISOString(),
        summary: {
          totalUsers: usersSnapshot.size,
          firebaseUsers: firebaseUsers.length,
          customUsers: customUsers.length
        },
        customUsers: customUsers,
        firebaseUsers: firebaseUsers
      };

      const reportFile = path.join(this.backupDir, `migration-report-${this.timestamp}.json`);
      fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
      
      console.log(`📊 Migration report created: ${reportFile}`);
      
      return reportFile;
      
    } catch (error) {
      console.error('❌ Report creation failed:', error);
      throw error;
    }
  }
}

// Main execution
async function main() {
  try {
    const backupService = new UserBackupService();
    
    // Create backup
    await backupService.backupUsers();
    
    // Create report
    await backupService.createSummaryReport();
    
    console.log('\n✅ Backup completed successfully!');
    console.log('   You can now run the migration script safely.');
    
  } catch (error) {
    console.error('💥 Backup failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = UserBackupService;
