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

async function debugUsers() {
  try {
    initializeFirebase();
    const db = getFirestore();
    
    console.log('🔍 Debugging users in database...\n');
    
    // Get all users
    const usersSnapshot = await db.collection('users').get();
    
    console.log(`📊 Total users found: ${usersSnapshot.size}\n`);
    
    usersSnapshot.forEach((doc, index) => {
      const userData = doc.data();
      const isFirebaseUID = /^[a-zA-Z0-9]{28}$/.test(doc.id);
      
      console.log(`👤 User ${index + 1}:`);
      console.log(`   ID: ${doc.id}`);
      console.log(`   Is Firebase UID: ${isFirebaseUID ? '✅ Yes' : '❌ No'}`);
      console.log(`   Phone: ${userData.phone || 'N/A'}`);
      console.log(`   Name: ${userData.name || 'N/A'}`);
      console.log(`   Email: ${userData.email || 'N/A'}`);
      console.log(`   User Type: ${userData.userType || 'N/A'}`);
      console.log(`   Created: ${userData.createdAt || 'N/A'}`);
      console.log(`   Has UID field: ${userData.uid ? '✅ Yes' : '❌ No'}`);
      if (userData.uid) {
        console.log(`   UID field value: ${userData.uid}`);
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

debugUsers();
