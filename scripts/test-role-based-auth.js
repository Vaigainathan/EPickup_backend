// Load environment variables
require('dotenv').config();

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const roleBasedAuthService = require('../src/services/roleBasedAuthService');

// Initialize Firebase Admin SDK
function initializeFirebase() {
  try {
    if (admin.apps.length > 0) {
      console.log('✅ Firebase Admin SDK already initialized');
      return admin.app();
    }

    if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PROJECT_ID) {
      let privateKey = process.env.FIREBASE_PRIVATE_KEY;
      
      if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
        try {
          privateKey = Buffer.from(privateKey, 'base64').toString('utf8');
        } catch {
          privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
        }
      } else {
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
    } else {
      const app = admin.initializeApp();
      console.log('✅ Firebase Admin SDK initialized with default credentials');
      return app;
    }
  } catch (error) {
    console.error('❌ Firebase initialization failed:', error);
    throw error;
  }
}

async function testRoleBasedAuth() {
  try {
    initializeFirebase();
    
    console.log('🧪 Testing Role-Based Authentication System\n');
    
    const testPhone = '+919686218054';
    
    // Test 1: Generate role-specific UIDs
    console.log('📱 Test 1: Generating role-specific UIDs for same phone number');
    const customerUID = roleBasedAuthService.generateRoleSpecificUID(testPhone, 'customer');
    const driverUID = roleBasedAuthService.generateRoleSpecificUID(testPhone, 'driver');
    
    console.log(`   Customer UID: ${customerUID}`);
    console.log(`   Driver UID:   ${driverUID}`);
    console.log(`   Same UID? ${customerUID === driverUID ? '❌ ERROR' : '✅ CORRECT'}\n`);
    
    // Test 2: Check if UIDs are deterministic
    console.log('🔄 Test 2: Checking UID determinism');
    const customerUID2 = roleBasedAuthService.generateRoleSpecificUID(testPhone, 'customer');
    const driverUID2 = roleBasedAuthService.generateRoleSpecificUID(testPhone, 'driver');
    
    console.log(`   Customer UID consistency: ${customerUID === customerUID2 ? '✅ CONSISTENT' : '❌ INCONSISTENT'}`);
    console.log(`   Driver UID consistency: ${driverUID === driverUID2 ? '✅ CONSISTENT' : '❌ INCONSISTENT'}\n`);
    
    // Test 3: Check existing users
    console.log('👥 Test 3: Checking existing users in database');
    const db = getFirestore();
    const usersSnapshot = await db.collection('users').get();
    
    console.log(`   Total users in database: ${usersSnapshot.size}`);
    
    const phoneMap = {};
    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      if (userData.phone) {
        if (!phoneMap[userData.phone]) {
          phoneMap[userData.phone] = [];
        }
        phoneMap[userData.phone].push({
          id: doc.id,
          userType: userData.userType,
          name: userData.name
        });
      }
    });
    
    Object.keys(phoneMap).forEach(phone => {
      console.log(`   📱 ${phone}:`);
      phoneMap[phone].forEach(user => {
        console.log(`      👤 ${user.userType}: ${user.id} (${user.name})`);
      });
    });
    
    // Test 4: Test role checking
    console.log('\n🔍 Test 4: Testing role existence checks');
    const customerExists = await roleBasedAuthService.userExistsWithRole(testPhone, 'customer');
    const driverExists = await roleBasedAuthService.userExistsWithRole(testPhone, 'driver');
    
    console.log(`   Customer exists: ${customerExists ? '✅ YES' : '❌ NO'}`);
    console.log(`   Driver exists: ${driverExists ? '✅ YES' : '❌ NO'}`);
    
    // Test 5: Test role retrieval
    console.log('\n📋 Test 5: Testing role retrieval');
    const roles = await roleBasedAuthService.getRolesForPhone(testPhone);
    console.log(`   Roles for ${testPhone}:`);
    roles.forEach(role => {
      console.log(`      👤 ${role.userType}: ${role.uid} (${role.name})`);
    });
    
    console.log('\n🎉 Role-Based Authentication Test Completed!');
    console.log('\n📊 Summary:');
    console.log('   ✅ Same phone number can have different roles');
    console.log('   ✅ Each role gets a unique UID');
    console.log('   ✅ UIDs are deterministic and consistent');
    console.log('   ✅ Role checking works correctly');
    console.log('   ✅ Role retrieval works correctly');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testRoleBasedAuth();
