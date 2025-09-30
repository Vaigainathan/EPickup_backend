// Load environment variables
require('dotenv').config();

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

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

async function checkSamePhoneUsers() {
  try {
    initializeFirebase();
    const db = getFirestore();
    
    console.log('🔍 Checking for same phone number with different roles...\n');
    
    // Get all users
    const usersSnapshot = await db.collection('users').get();
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
          name: userData.name,
          isFirebaseUID: /^[a-zA-Z0-9]{28}$/.test(doc.id)
        });
      }
    });
    
    // Check for duplicates
    let duplicatePhones = 0;
    Object.keys(phoneMap).forEach(phone => {
      if (phoneMap[phone].length > 1) {
        duplicatePhones++;
        console.log(`📱 Phone: ${phone}`);
        phoneMap[phone].forEach(user => {
          console.log(`   👤 ${user.userType}: ${user.id} (${user.name}) ${user.isFirebaseUID ? '🔥' : '🆔'}`);
        });
        console.log('');
      }
    });
    
    console.log('📊 Summary:');
    console.log(`   Total unique phones: ${Object.keys(phoneMap).length}`);
    console.log(`   Phones with multiple users: ${duplicatePhones}`);
    
    if (duplicatePhones === 0) {
      console.log('   ✅ No duplicate phone numbers found');
    } else {
      console.log('   ⚠️  Found phones with multiple user roles');
    }
    
  } catch (error) {
    console.error('❌ Check failed:', error);
  }
}

checkSamePhoneUsers();
