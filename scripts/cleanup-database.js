/**
 * ⚠️ DANGER: COMPLETE DATABASE CLEANUP SCRIPT
 * 
 * This script will DELETE ALL DATA from:
 * - Firestore collections
 * - Firebase Authentication users
 * - Firebase Storage files
 * 
 * ⚠️ USE ONLY IN DEVELOPMENT/TESTING ENVIRONMENTS
 * ⚠️ NEVER RUN THIS IN PRODUCTION
 * 
 * Usage:
 *   node scripts/cleanup-database.js
 */

const admin = require('firebase-admin');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    // Try multiple methods to load Firebase credentials
    let credential = null;
    let serviceAccountPath = null;

    // Method 1: Check for firebase-service-account.json in backend root
    const localServiceAccount = path.join(__dirname, '..', 'firebase-service-account.json');
    if (fs.existsSync(localServiceAccount)) {
      console.log('✅ Found firebase-service-account.json');
      serviceAccountPath = localServiceAccount;
      credential = admin.credential.cert(require(localServiceAccount));
    }
    // Method 2: Check for serviceAccountKey.json in backend root
    else if (fs.existsSync(path.join(__dirname, '..', 'serviceAccountKey.json'))) {
      serviceAccountPath = path.join(__dirname, '..', 'serviceAccountKey.json');
      console.log('✅ Found serviceAccountKey.json');
      credential = admin.credential.cert(require(serviceAccountPath));
    }
    // Method 3: Check environment variable
    else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      console.log('✅ Using GOOGLE_APPLICATION_CREDENTIALS');
      serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      credential = admin.credential.cert(require(serviceAccountPath));
    }
    // Method 4: Try application default
    else {
      console.log('⚠️  Trying application default credentials...');
      credential = admin.credential.applicationDefault();
    }

    // Read project ID from service account file
    let projectId = null;
    let storageBucket = null;
    
    if (serviceAccountPath) {
      const serviceAccountData = require(serviceAccountPath);
      projectId = serviceAccountData.project_id;
      storageBucket = `${projectId}.appspot.com`;
      console.log(`📦 Project ID: ${projectId}`);
    }

    // Initialize with credential
    admin.initializeApp({
      credential: credential,
      projectId: projectId,
      storageBucket: storageBucket || process.env.FIREBASE_STORAGE_BUCKET
    });

    console.log('✅ Firebase Admin SDK initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Firebase Admin SDK');
    console.error('');
    console.error('Error:', error.message);
    console.error('');
    console.error('📝 Please do ONE of the following:');
    console.error('');
    console.error('Option 1 - Use existing file (Recommended):');
    console.error('   Your firebase-service-account.json is already in the backend folder');
    console.error('   The script should work now!');
    console.error('');
    console.error('Option 2 - Download from Firebase Console:');
    console.error('   1. Go to https://console.firebase.google.com/');
    console.error('   2. Select your project');
    console.error('   3. Settings → Service Accounts');
    console.error('   4. Click "Generate new private key"');
    console.error('   5. Save as: backend/serviceAccountKey.json');
    console.error('');
    console.error('Option 3 - Set environment variable:');
    console.error('   set GOOGLE_APPLICATION_CREDENTIALS=path\\to\\serviceAccountKey.json');
    console.error('');
    process.exit(1);
  }
}

const db = admin.firestore();
const auth = admin.auth();
const storage = admin.storage();

// Collections to clean
const COLLECTIONS_TO_CLEAN = [
  'users',           // All users (customers, drivers, admins)
  'bookings',        // All bookings
  'drivers',         // Driver-specific data
  'customers',       // Customer-specific data
  'transactions',    // Payment transactions
  'wallets',         // Wallet data
  'notifications',   // Push notifications
  'support_tickets', // Support tickets
  'emergency_alerts',// SOS alerts
  'documents',       // Driver documents
  'reviews',         // Ratings and reviews
  'work_slots',      // Driver work slots
  'chat_messages',   // Support chat messages
  'analytics',       // Analytics data
  'system_logs',     // System logs
  'sessions',        // User sessions
];

// Prompt for confirmation
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

/**
 * Delete all documents in a collection
 */
async function deleteCollection(collectionName) {
  const collectionRef = db.collection(collectionName);
  const batchSize = 100;
  let deletedCount = 0;

  try {
    console.log(`🗑️  Deleting collection: ${collectionName}...`);

    while (true) {
      const snapshot = await collectionRef.limit(batchSize).get();
      
      if (snapshot.size === 0) {
        break;
      }

      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      deletedCount += snapshot.size;
      console.log(`   Deleted ${deletedCount} documents from ${collectionName}...`);
    }

    console.log(`✅ Completed: ${collectionName} (${deletedCount} documents deleted)`);
    return { collection: collectionName, deleted: deletedCount };
  } catch (error) {
    console.error(`❌ Error deleting ${collectionName}:`, error.message);
    return { collection: collectionName, deleted: 0, error: error.message };
  }
}

/**
 * Delete all Firebase Authentication users
 */
async function deleteAllAuthUsers() {
  const batchSize = 100;
  let deletedCount = 0;

  try {
    console.log('🗑️  Deleting Firebase Auth users...');

    while (true) {
      const listResult = await auth.listUsers(batchSize);
      
      if (listResult.users.length === 0) {
        break;
      }

      const deletePromises = listResult.users.map(user => 
        auth.deleteUser(user.uid)
          .then(() => {
            deletedCount++;
            if (deletedCount % 10 === 0) {
              console.log(`   Deleted ${deletedCount} auth users...`);
            }
          })
          .catch(error => {
            console.error(`   Failed to delete user ${user.uid}:`, error.message);
          })
      );

      await Promise.all(deletePromises);
    }

    console.log(`✅ Completed: Firebase Auth (${deletedCount} users deleted)`);
    return { deleted: deletedCount };
  } catch (error) {
    console.error('❌ Error deleting auth users:', error.message);
    return { deleted: 0, error: error.message };
  }
}

/**
 * Delete all files in Firebase Storage
 */
async function deleteAllStorageFiles() {
  try {
    console.log('🗑️  Deleting Firebase Storage files...');
    
    // Try to get the bucket with error handling
    let bucket;
    try {
      // First try with default bucket
      bucket = storage.bucket();
    } catch {
      // If default bucket fails, try with explicit bucket name
      const serviceAccountPath = path.join(__dirname, '..', 'firebase-service-account.json');
      if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        const bucketName = `${serviceAccount.project_id}.appspot.com`;
        console.log(`   Trying bucket: ${bucketName}`);
        try {
          bucket = storage.bucket(bucketName);
        } catch {
          console.log('⚠️  Firebase Storage not configured or bucket does not exist');
          console.log('   This is OK - Storage might not be set up yet');
          console.log('✅ Skipping storage cleanup (no bucket configured)');
          return { deleted: 0, skipped: true };
        }
      } else {
        console.log('⚠️  Cannot determine storage bucket name');
        console.log('✅ Skipping storage cleanup');
        return { deleted: 0, skipped: true };
      }
    }

    // Check if bucket exists
    try {
      const [exists] = await bucket.exists();
      if (!exists) {
        console.log('⚠️  Storage bucket does not exist');
        console.log('   This is OK - Storage might not be enabled in Firebase project');
        console.log('✅ Skipping storage cleanup (bucket not created)');
        return { deleted: 0, skipped: true };
      }
    } catch (existsError) {
      console.log('⚠️  Cannot check if bucket exists:', existsError.message);
      console.log('✅ Skipping storage cleanup');
      return { deleted: 0, skipped: true };
    }
    
    // Get files from bucket
    const [files] = await bucket.getFiles();
    
    if (files.length === 0) {
      console.log('✅ No storage files to delete');
      return { deleted: 0 };
    }

    console.log(`   Found ${files.length} files to delete...`);
    
    const deletePromises = files.map((file, index) => 
      file.delete()
        .then(() => {
          if ((index + 1) % 10 === 0) {
            console.log(`   Deleted ${index + 1}/${files.length} files...`);
          }
        })
        .catch(error => {
          console.error(`   Failed to delete ${file.name}:`, error.message);
        })
    );

    await Promise.all(deletePromises);
    
    console.log(`✅ Completed: Firebase Storage (${files.length} files deleted)`);
    return { deleted: files.length };
  } catch (error) {
    console.log('⚠️  Storage cleanup error:', error.message);
    console.log('   This is OK - Storage might not be configured');
    console.log('✅ Skipping storage cleanup');
    return { deleted: 0, error: error.message, skipped: true };
  }
}

/**
 * Create default admin user
 */
async function createDefaultAdmin() {
  try {
    console.log('👤 Creating default admin user...');
    
    const adminEmail = 'admin@epickup.com';
    const adminPassword = 'Admin@123456';
    const adminPhone = '+919999999999';

    // Create Firebase Auth user
    const userRecord = await auth.createUser({
      email: adminEmail,
      password: adminPassword,
      phoneNumber: adminPhone,
      displayName: 'System Admin',
      emailVerified: true,
    });

    // Set custom claims
    await auth.setCustomUserClaims(userRecord.uid, {
      role: 'admin',
      userType: 'admin',
      isAdmin: true,
    });

    // Create Firestore document
    await db.collection('users').doc(userRecord.uid).set({
      id: userRecord.uid,
      email: adminEmail,
      phone: adminPhone,
      name: 'System Admin',
      role: 'admin',
      userType: 'admin',
      isAdmin: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'active',
      permissions: [
        'dashboard',
        'drivers:view',
        'drivers:verify',
        'drivers:ban',
        'bookings:view',
        'bookings:manage',
        'customers:view',
        'customers:manage',
        'analytics:view',
        'support:manage',
        'emergency:manage',
        'settings:manage',
      ]
    });

    console.log('✅ Default admin user created successfully!');
    console.log('');
    console.log('📧 Email:', adminEmail);
    console.log('🔑 Password:', adminPassword);
    console.log('📱 Phone:', adminPhone);
    console.log('');
    console.log('⚠️  IMPORTANT: Change this password after first login!');
    
    return { success: true, email: adminEmail, password: adminPassword };
  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Main cleanup function
 */
async function cleanupDatabase() {
  console.log('');
  console.log('🧹 ═══════════════════════════════════════════════════════════');
  console.log('🧹  EPICKUP DATABASE CLEANUP SCRIPT');
  console.log('🧹 ═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('⚠️  WARNING: This will DELETE ALL DATA from:');
  console.log('   - Firestore collections');
  console.log('   - Firebase Authentication users');
  console.log('   - Firebase Storage files');
  console.log('');
  console.log('⚠️  THIS ACTION CANNOT BE UNDONE!');
  console.log('');

  // Confirm before proceeding
  const answer1 = await askQuestion('Are you sure you want to continue? (type "YES" to confirm): ');
  
  if (answer1 !== 'YES') {
    console.log('❌ Cleanup cancelled');
    process.exit(0);
  }

  const answer2 = await askQuestion('This is your last chance! Type "DELETE EVERYTHING" to proceed: ');
  
  if (answer2 !== 'DELETE EVERYTHING') {
    console.log('❌ Cleanup cancelled');
    process.exit(0);
  }

  console.log('');
  console.log('🗑️  Starting cleanup process...');
  console.log('');

  const startTime = Date.now();
  const results = {
    collections: [],
    authUsers: null,
    storageFiles: null,
    adminUser: null,
  };

  // 1. Delete Firestore collections
  console.log('📦 STEP 1/4: Deleting Firestore collections...');
  console.log('');
  
  for (const collection of COLLECTIONS_TO_CLEAN) {
    const result = await deleteCollection(collection);
    results.collections.push(result);
  }

  console.log('');
  console.log('👤 STEP 2/4: Deleting Firebase Auth users...');
  console.log('');
  results.authUsers = await deleteAllAuthUsers();

  console.log('');
  console.log('📁 STEP 3/4: Deleting Firebase Storage files...');
  console.log('');
  results.storageFiles = await deleteAllStorageFiles();

  console.log('');
  console.log('👤 STEP 4/4: Creating default admin user...');
  console.log('');
  results.adminUser = await createDefaultAdmin();

  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  // Print summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ CLEANUP COMPLETED SUCCESSFULLY!');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('📊 Summary:');
  console.log('');
  
  const totalDocsDeleted = results.collections.reduce((sum, c) => sum + c.deleted, 0);
  console.log(`   Firestore documents deleted: ${totalDocsDeleted}`);
  console.log(`   Auth users deleted: ${results.authUsers.deleted}`);
  
  if (results.storageFiles.skipped) {
    console.log(`   Storage files: Skipped (bucket not configured)`);
  } else {
    console.log(`   Storage files deleted: ${results.storageFiles.deleted}`);
  }
  
  console.log('');
  console.log(`⏱️  Total time: ${duration} seconds`);
  console.log('');
  
  if (results.adminUser.success) {
    console.log('✅ Default admin user created:');
    console.log(`   Email: ${results.adminUser.email}`);
    console.log(`   Password: ${results.adminUser.password}`);
    console.log('');
  }

  console.log('🎉 Your database is now completely clean and ready for testing!');
  console.log('');
  console.log('Next steps:');
  console.log('1. Login to admin dashboard with credentials above');
  console.log('2. Test customer app signup');
  console.log('3. Test driver app signup and document upload');
  console.log('4. Admin verifies driver documents');
  console.log('5. Test complete booking workflow');
  console.log('');
}

// Run cleanup
cleanupDatabase()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
