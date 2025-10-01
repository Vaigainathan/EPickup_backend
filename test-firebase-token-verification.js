#!/usr/bin/env node

/**
 * Test Firebase Token Verification
 * This will help us debug the token verification issue
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK
function initializeFirebaseAdmin() {
  try {
    if (admin.apps.length > 0) {
      console.log('✅ Firebase Admin SDK already initialized');
      return admin.app();
    }

    const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');
    
    if (require('fs').existsSync(serviceAccountPath)) {
      const serviceAccount = require(serviceAccountPath);
      const app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
        storageBucket: `${serviceAccount.project_id}.appspot.com`
      });
      console.log('✅ Firebase Admin SDK initialized');
      return app;
    } else {
      throw new Error('Service account file not found');
    }
  } catch (error) {
    console.error('❌ Error initializing Firebase:', error.message);
    throw error;
  }
}

async function testTokenVerification() {
  console.log('🔍 Testing Firebase Token Verification...\n');
  
  try {
    const firebaseApp = initializeFirebaseAdmin();
    const auth = admin.auth(firebaseApp);

    // Test 1: Create a test user
    console.log('📝 Step 1: Creating test user...');
    const testEmail = `test-${Date.now()}@epickup.com`;
    const testPassword = 'password123';
    
    const userRecord = await auth.createUser({
      email: testEmail,
      password: testPassword,
      emailVerified: true,
      disabled: false,
    });
    console.log('✅ Test user created:', userRecord.uid);

    // Test 2: Set custom claims
    console.log('\n📝 Step 2: Setting custom claims...');
    await auth.setCustomUserClaims(userRecord.uid, { 
      userType: 'admin', 
      role: 'super_admin',
      permissions: ['all']
    });
    console.log('✅ Custom claims set successfully');

    // Test 3: Create custom token
    console.log('\n📝 Step 3: Creating custom token...');
    const customToken = await auth.createCustomToken(userRecord.uid, { 
      userType: 'admin', 
      role: 'super_admin',
      permissions: ['all']
    });
    console.log('✅ Custom token created');
    console.log(`📋 Token length: ${customToken.length} characters`);

    // Test 4: Test token verification with a real ID token
    console.log('\n📝 Step 4: Testing ID token verification...');
    
    // Create a real ID token by simulating frontend authentication
    // We'll use the Firebase Web SDK to get a real ID token
    const { initializeApp } = require('firebase/app');
    const { getAuth, signInWithEmailAndPassword } = require('firebase/auth');
    
    const firebaseConfig = {
      apiKey: "AIzaSyBzqWYuvb3cdvy62YyXP-EdO7qnAJW5fZw",
      authDomain: "epickup-app.firebaseapp.com",
      projectId: "epickup-app",
      storageBucket: "epickup-app.firebasestorage.app",
      messagingSenderId: "622192289668",
      appId: "1:622192289668:web:80c4d7bb7a23282e76dfd1",
      measurementId: "G-CNG4PF3YCR"
    };
    
    try {
      const webApp = initializeApp(firebaseConfig, 'test-app');
      const webAuth = getAuth(webApp);
      
      // Sign in with the test user to get a real ID token
      const userCredential = await signInWithEmailAndPassword(webAuth, testEmail, testPassword);
      const idToken = await userCredential.user.getIdToken();
      
      console.log('✅ Real ID token obtained from frontend simulation');
      console.log(`📋 ID Token length: ${idToken.length} characters`);
      
      // Now verify the real ID token with Admin SDK
      const decodedToken = await auth.verifyIdToken(idToken);
      console.log('✅ ID token verified successfully');
      console.log(`📋 Decoded token:`, {
        uid: decodedToken.uid,
        email: decodedToken.email,
        userType: decodedToken.userType,
        role: decodedToken.role,
        permissions: decodedToken.permissions
      });
      
    } catch (idTokenError) {
      console.log('❌ ID token verification failed:', idTokenError.message);
      console.log('💡 This might be due to Firebase configuration or network issues');
    }

    // Clean up
    console.log('\n📝 Step 6: Cleaning up test user...');
    await auth.deleteUser(userRecord.uid);
    console.log('✅ Test user deleted');

    console.log('\n🎉 Firebase Token Verification Test Completed!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('📋 Full error:', error);
  }
}

// Run the test
testTokenVerification().catch(console.error);
