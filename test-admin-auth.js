#!/usr/bin/env node

/**
 * Admin Authentication Test Script
 * Tests the complete admin authentication flow and identifies issues
 */

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin SDK
function initializeFirebase() {
  try {
    // Check if Firebase is already initialized
    if (admin.apps.length > 0) {
      console.log('✅ Firebase Admin SDK already initialized');
      return admin.app();
    }

    // Try to initialize with service account file
    const serviceAccountPath = './firebase-service-account.json';
    
    if (require('fs').existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      const app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
        storageBucket: `${serviceAccount.project_id}.appspot.com`
      });

      console.log('✅ Firebase Admin SDK initialized with service account file');
      console.log(`📋 Project ID: ${serviceAccount.project_id}`);
      console.log(`📧 Service Account: ${serviceAccount.client_email}`);
      return app;
    }

    throw new Error('Service account file not found');
  } catch (error) {
    console.error('❌ Error initializing Firebase:', error.message);
    throw error;
  }
}

// Test setCustomClaims functionality
async function testSetCustomClaims() {
  console.log('\n🔧 Testing setCustomClaims functionality...');
  
  try {
    const auth = admin.auth();
    const db = getFirestore();
    
    // Test with a dummy UID
    const testUid = 'test-admin-' + Date.now();
    const testClaims = {
      userType: 'admin',
      role: 'super_admin'
    };

    console.log(`📝 Attempting to set custom claims for UID: ${testUid}`);
    
    // This will fail if the service account doesn't have proper permissions
    await auth.setCustomUserClaims(testUid, testClaims);
    
    console.log('✅ setCustomClaims succeeded - IAM permissions are correct');
    
    // Clean up - delete the test user if it was created
    try {
      await auth.deleteUser(testUid);
      console.log('🧹 Cleaned up test user');
    } catch (cleanupError) {
      console.log('ℹ️ Test user cleanup not needed (user not created)');
    }
    
    return true;
  } catch (error) {
    console.error('❌ setCustomClaims failed:', error.message);
    console.error('📋 Error details:', {
      code: error.code,
      message: error.message,
      status: error.status
    });
    
    // Check for specific IAM permission errors
    if (error.message.includes('serviceusage.serviceUsageConsumer')) {
      console.error('🚨 ROOT CAUSE: Missing IAM role: roles/serviceusage.serviceUsageConsumer');
      console.error('💡 Fix: Add this role to the service account');
    }
    
    if (error.message.includes('firebase.admin')) {
      console.error('🚨 ROOT CAUSE: Missing IAM role: roles/firebase.admin');
      console.error('💡 Fix: Add this role to the service account');
    }
    
    if (error.message.includes('iam.serviceAccountUser')) {
      console.error('🚨 ROOT CAUSE: Missing IAM role: roles/iam.serviceAccountUser');
      console.error('💡 Fix: Add this role to the service account');
    }
    
    return false;
  }
}

// Test Firestore write permissions
async function testFirestoreWrite() {
  console.log('\n🔧 Testing Firestore write permissions...');
  
  try {
    const db = getFirestore();
    const testUid = 'test-admin-' + Date.now();
    
    const testAdminData = {
      uid: testUid,
      email: 'test@epickup.com',
      displayName: 'Test Admin',
      role: 'super_admin',
      permissions: ['all'],
      createdAt: new Date().toISOString(),
      userType: 'admin'
    };

    console.log(`📝 Attempting to write to adminUsers collection: ${testUid}`);
    
    // Test write to adminUsers collection
    await db.collection('adminUsers').doc(testUid).set(testAdminData);
    console.log('✅ adminUsers write succeeded');
    
    // Test write to users collection
    await db.collection('users').doc(testUid).set(testAdminData);
    console.log('✅ users write succeeded');
    
    // Clean up
    await db.collection('adminUsers').doc(testUid).delete();
    await db.collection('users').doc(testUid).delete();
    console.log('🧹 Cleaned up test documents');
    
    return true;
  } catch (error) {
    console.error('❌ Firestore write failed:', error.message);
    console.error('📋 Error details:', {
      code: error.code,
      message: error.message,
      status: error.status
    });
    
    if (error.message.includes('PERMISSION_DENIED')) {
      console.error('🚨 ROOT CAUSE: Firestore rules blocking write operations');
      console.error('💡 Fix: Check Firestore rules or service account permissions');
    }
    
    return false;
  }
}

// Test admin user creation flow
async function testAdminUserCreation() {
  console.log('\n🔧 Testing complete admin user creation flow...');
  
  try {
    const auth = admin.auth();
    const db = getFirestore();
    
    const testEmail = `test-admin-${Date.now()}@epickup.com`;
    const testPassword = 'TestPassword123!';
    const testDisplayName = 'Test Admin User';
    
    console.log(`📝 Creating Firebase Auth user: ${testEmail}`);
    
    // Create Firebase Auth user
    const userRecord = await auth.createUser({
      email: testEmail,
      password: testPassword,
      displayName: testDisplayName,
      emailVerified: true
    });
    
    console.log(`✅ Firebase Auth user created: ${userRecord.uid}`);
    
    // Set custom claims
    const claims = {
      userType: 'admin',
      role: 'super_admin'
    };
    
    console.log('📝 Setting custom claims...');
    await auth.setCustomUserClaims(userRecord.uid, claims);
    console.log('✅ Custom claims set successfully');
    
    // Create admin user document
    const adminUserData = {
      uid: userRecord.uid,
      email: testEmail,
      displayName: testDisplayName,
      role: 'super_admin',
      permissions: ['all'],
      createdAt: new Date().toISOString(),
      userType: 'admin'
    };
    
    console.log('📝 Creating adminUsers document...');
    await db.collection('adminUsers').doc(userRecord.uid).set(adminUserData);
    console.log('✅ adminUsers document created');
    
    console.log('📝 Creating users document...');
    await db.collection('users').doc(userRecord.uid).set(adminUserData);
    console.log('✅ users document created');
    
    // Verify the user can be retrieved
    console.log('📝 Verifying user retrieval...');
    const retrievedUser = await auth.getUser(userRecord.uid);
    const customClaims = retrievedUser.customClaims;
    
    console.log('✅ User verification successful');
    console.log('📋 Custom claims:', customClaims);
    
    // Clean up
    console.log('🧹 Cleaning up test user...');
    await db.collection('adminUsers').doc(userRecord.uid).delete();
    await db.collection('users').doc(userRecord.uid).delete();
    await auth.deleteUser(userRecord.uid);
    console.log('✅ Test user cleaned up');
    
    return true;
  } catch (error) {
    console.error('❌ Admin user creation failed:', error.message);
    console.error('📋 Error details:', {
      code: error.code,
      message: error.message,
      status: error.status
    });
    
    return false;
  }
}

// Test Firebase project configuration
async function testProjectConfiguration() {
  console.log('\n🔧 Testing Firebase project configuration...');
  
  try {
    const app = admin.app();
    const projectId = app.options.projectId;
    const serviceAccount = app.options.credential;
    
    console.log(`📋 Project ID: ${projectId}`);
    console.log(`📋 Service Account Type: ${serviceAccount ? 'Present' : 'Missing'}`);
    
    // Test basic Firebase services
    const auth = admin.auth();
    const db = getFirestore();
    
    console.log('✅ Firebase Auth service accessible');
    console.log('✅ Firestore service accessible');
    
    return true;
  } catch (error) {
    console.error('❌ Project configuration test failed:', error.message);
    return false;
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Starting Admin Authentication Tests...\n');
  
  try {
    // Initialize Firebase
    initializeFirebase();
    
    // Run tests
    const configTest = await testProjectConfiguration();
    const customClaimsTest = await testSetCustomClaims();
    const firestoreTest = await testFirestoreWrite();
    const adminCreationTest = await testAdminUserCreation();
    
    // Summary
    console.log('\n📊 Test Results Summary:');
    console.log(`✅ Project Configuration: ${configTest ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Custom Claims: ${customClaimsTest ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Firestore Write: ${firestoreTest ? 'PASS' : 'FAIL'}`);
    console.log(`✅ Admin Creation: ${adminCreationTest ? 'PASS' : 'FAIL'}`);
    
    const allTestsPassed = configTest && customClaimsTest && firestoreTest && adminCreationTest;
    
    if (allTestsPassed) {
      console.log('\n🎉 All tests passed! Admin authentication should work correctly.');
    } else {
      console.log('\n❌ Some tests failed. Check the error messages above for root causes.');
      console.log('\n💡 Common fixes:');
      console.log('   1. Add missing IAM roles to service account');
      console.log('   2. Check Firestore rules for adminUsers collection');
      console.log('   3. Verify service account has proper permissions');
    }
    
  } catch (error) {
    console.error('❌ Test execution failed:', error.message);
    process.exit(1);
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = {
  initializeFirebase,
  testSetCustomClaims,
  testFirestoreWrite,
  testAdminUserCreation,
  testProjectConfiguration
};
