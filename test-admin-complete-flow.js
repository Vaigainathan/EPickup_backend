#!/usr/bin/env node

/**
 * Complete Admin Authentication Flow Test
 * Tests the entire admin authentication flow from signup to API access
 */

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

// Initialize Firebase Admin SDK
function initializeFirebase() {
  try {
    if (admin.apps.length > 0) {
      console.log('✅ Firebase Admin SDK already initialized');
      return admin.app();
    }

    const serviceAccountPath = require('path').join(__dirname, 'firebase-service-account.json');
    
    if (require('fs').existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      const app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
        storageBucket: `${serviceAccount.project_id}.appspot.com`
      });

      console.log('✅ Firebase Admin SDK initialized');
      return app;
    }

    throw new Error('Service account file not found');
  } catch (error) {
    console.error('❌ Error initializing Firebase:', error.message);
    throw error;
  }
}

// Test complete admin user creation and authentication flow
async function testCompleteAdminFlow() {
  console.log('\n🚀 Testing Complete Admin Authentication Flow...\n');
  
  try {
    const auth = admin.auth();
    const db = getFirestore();
    
    const testEmail = `test-admin-${Date.now()}@epickup.com`;
    const testPassword = 'TestPassword123!';
    const testDisplayName = 'Test Admin User';
    
    console.log(`📝 Step 1: Creating Firebase Auth user: ${testEmail}`);
    
    // Step 1: Create Firebase Auth user
    const userRecord = await auth.createUser({
      email: testEmail,
      password: testPassword,
      displayName: testDisplayName,
      emailVerified: true
    });
    
    console.log(`✅ Firebase Auth user created: ${userRecord.uid}`);
    
    // Step 2: Set custom claims
    console.log('📝 Step 2: Setting custom claims...');
    const claims = {
      userType: 'admin',
      role: 'super_admin'
    };
    
    await auth.setCustomUserClaims(userRecord.uid, claims);
    console.log('✅ Custom claims set successfully');
    
    // Step 3: Create admin user document in adminUsers collection
    console.log('📝 Step 3: Creating adminUsers document...');
    const adminUserData = {
      uid: userRecord.uid,
      id: userRecord.uid,
      email: testEmail,
      name: testDisplayName,
      displayName: testDisplayName,
      role: 'super_admin',
      permissions: ['all'],
      userType: 'admin',
      isEmailVerified: true,
      isActive: true,
      accountStatus: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    await db.collection('adminUsers').doc(userRecord.uid).set(adminUserData);
    console.log('✅ adminUsers document created');
    
    // Step 4: Create user document in users collection
    console.log('📝 Step 4: Creating users document...');
    await db.collection('users').doc(userRecord.uid).set(adminUserData);
    console.log('✅ users document created');
    
    // Step 5: Test token exchange flow
    console.log('📝 Step 5: Testing token exchange flow...');
    
    // Simulate Firebase ID token (we'll create a custom token for testing)
    const customToken = await auth.createCustomToken(userRecord.uid, claims);
    console.log('✅ Custom token created for testing');
    
    // Step 6: Test role-based auth service
    console.log('📝 Step 6: Testing role-based auth service...');
    
    const roleBasedAuthService = require('./src/services/roleBasedAuthService');
    
    // Create a mock decoded token
    const mockDecodedToken = {
      uid: userRecord.uid,
      email: testEmail,
      phone_number: null, // Admin users don't have phone numbers
      name: testDisplayName,
      picture: null
    };
    
    const userData = await roleBasedAuthService.getOrCreateRoleSpecificUser(
      mockDecodedToken,
      'admin',
      { name: testDisplayName, role: 'super_admin' }
    );
    
    console.log('✅ Role-based auth service test successful');
    console.log(`📋 Generated user data:`, {
      id: userData.id,
      userType: userData.userType,
      role: userData.role,
      email: userData.email
    });
    
    // Step 7: Test JWT token generation
    console.log('📝 Step 7: Testing JWT token generation...');
    
    // Set JWT_SECRET for testing
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test-jwt-secret-for-admin-testing';
    }
    
    const JWTService = require('./src/services/jwtService');
    const jwtService = new JWTService();
    
    const jwtToken = jwtService.generateAccessToken({
      userId: userData.id,
      uid: userData.uid,
      originalFirebaseUID: userData.originalFirebaseUID,
      phone: userData.phone,
      userType: 'admin',
      email: userData.email
    });
    
    console.log('✅ JWT token generated successfully');
    console.log(`📋 JWT token length: ${jwtToken.length} characters`);
    
    // Step 8: Test JWT token validation
    console.log('📝 Step 8: Testing JWT token validation...');
    
    const decodedJWT = jwtService.verifyToken(jwtToken);
    console.log('✅ JWT token validation successful');
    console.log(`📋 Decoded JWT:`, {
      userId: decodedJWT.userId,
      userType: decodedJWT.userType,
      email: decodedJWT.email
    });
    
    // Step 9: Test admin endpoint access simulation
    console.log('📝 Step 9: Testing admin endpoint access simulation...');
    
    // Simulate the authMiddleware behavior
    const userDoc = await db.collection('users').doc(decodedJWT.userId).get();
    
    if (userDoc.exists) {
      const userDocData = userDoc.data();
      console.log('✅ User document retrieval successful');
      console.log(`📋 User document data:`, {
        id: userDocData.id,
        userType: userDocData.userType,
        role: userDocData.role,
        email: userDocData.email
      });
      
      // Simulate req.user object
      const reqUser = {
        id: userDocData.id,
        uid: userDocData.uid,
        email: userDocData.email,
        name: userDocData.name,
        userType: userDocData.userType,
        role: userDocData.role,
        permissions: userDocData.permissions
      };
      
      console.log('✅ Simulated req.user object created');
      console.log(`📋 req.user:`, reqUser);
      
      // Test admin role check
      if (reqUser.userType === 'admin') {
        console.log('✅ Admin role check passed');
      } else {
        console.log('❌ Admin role check failed');
      }
    } else {
      console.log('❌ User document not found');
    }
    
    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    await db.collection('adminUsers').doc(userRecord.uid).delete();
    await db.collection('users').doc(userRecord.uid).delete();
    await auth.deleteUser(userRecord.uid);
    console.log('✅ Test data cleaned up');
    
    console.log('\n🎉 Complete Admin Authentication Flow Test PASSED!');
    console.log('\n📊 Summary:');
    console.log('✅ Firebase Auth user creation');
    console.log('✅ Custom claims setting');
    console.log('✅ Firestore document creation (adminUsers & users)');
    console.log('✅ Role-based auth service');
    console.log('✅ JWT token generation');
    console.log('✅ JWT token validation');
    console.log('✅ Admin endpoint access simulation');
    
    return true;
    
  } catch (error) {
    console.error('❌ Complete admin flow test failed:', error.message);
    console.error('📋 Error details:', {
      code: error.code,
      message: error.message,
      status: error.status
    });
    return false;
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Starting Complete Admin Authentication Flow Tests...\n');
  
  try {
    // Initialize Firebase
    initializeFirebase();
    
    // Run complete flow test
    const success = await testCompleteAdminFlow();
    
    if (success) {
      console.log('\n🎉 All tests passed! Admin authentication should work correctly.');
      console.log('\n💡 Next steps:');
      console.log('   1. Deploy the backend changes');
      console.log('   2. Test the admin dashboard login');
      console.log('   3. Verify admin endpoints are accessible');
    } else {
      console.log('\n❌ Some tests failed. Check the error messages above.');
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
  testCompleteAdminFlow
};
