const admin = require('firebase-admin');

let firebaseApp = null;

/**
 * Initialize Firebase Admin SDK
 */
function initializeFirebase() {
  try {
    // Check if Firebase is already initialized
    if (admin.apps.length > 0) {
      firebaseApp = admin.app();
      console.log('✅ Firebase Admin SDK already initialized');
      console.log('📊 Existing apps:', admin.apps.length);
      return firebaseApp;
    }

    console.log('🔧 Initializing Firebase Admin SDK...');
    console.log('🔍 Checking environment variables:');
    console.log('   FIREBASE_PROJECT_ID:', process.env.FIREBASE_PROJECT_ID ? '✅ Set' : '❌ Missing');
    console.log('   FIREBASE_PRIVATE_KEY:', process.env.FIREBASE_PRIVATE_KEY ? '✅ Set (length: ' + process.env.FIREBASE_PRIVATE_KEY.length + ')' : '❌ Missing');
    console.log('   FIREBASE_CLIENT_EMAIL:', process.env.FIREBASE_CLIENT_EMAIL ? '✅ Set' : '❌ Missing');
    console.log('   FIREBASE_PRIVATE_KEY_ID:', process.env.FIREBASE_PRIVATE_KEY_ID ? '✅ Set' : '❌ Missing');

    // Use environment variables for service account (Render deployment)
    if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      try {
        console.log('🔧 Using environment variables for Firebase initialization...');
        
        // Handle private key formatting - it might be base64 encoded or have escaped newlines
        let privateKey = process.env.FIREBASE_PRIVATE_KEY;
        
        console.log('🔍 Private key format check:');
        console.log('   Has BEGIN marker:', privateKey.includes('-----BEGIN PRIVATE KEY-----'));
        console.log('   Length:', privateKey.length);
        
        // If it's base64 encoded, decode it
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
          console.log('🔧 Attempting to decode base64 private key...');
          try {
            privateKey = Buffer.from(privateKey, 'base64').toString('utf8');
            console.log('✅ Successfully decoded base64 private key');
          } catch {
            console.log('⚠️  Not base64, trying escaped newlines...');
            // If base64 decode fails, try with escaped newlines
            privateKey = process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
          }
        } else {
          console.log('🔧 Private key already in PEM format, fixing newlines...');
          // Already in PEM format, just fix newlines
          privateKey = privateKey.replace(/\\n/g, '\n');
        }

        console.log('🔍 Final private key check:');
        console.log('   Has BEGIN marker:', privateKey.includes('-----BEGIN PRIVATE KEY-----'));
        console.log('   Has END marker:', privateKey.includes('-----END PRIVATE KEY-----'));
        console.log('   Has newlines:', privateKey.includes('\n'));

        const serviceAccount = {
          type: "service_account",
          project_id: process.env.FIREBASE_PROJECT_ID,
          private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
          private_key: privateKey,
          client_email: process.env.FIREBASE_CLIENT_EMAIL,
          client_id: process.env.FIREBASE_CLIENT_ID,
          auth_uri: process.env.FIREBASE_AUTH_URI || 'https://accounts.google.com/o/oauth2/auth',
          token_uri: process.env.FIREBASE_TOKEN_URI || 'https://oauth2.googleapis.com/token',
          auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL || 'https://www.googleapis.com/oauth2/v1/certs',
          client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
        };

        console.log('🔧 Initializing Firebase with service account...');
        console.log('   Project ID:', serviceAccount.project_id);
        console.log('   Client Email:', serviceAccount.client_email);

        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: process.env.FIREBASE_PROJECT_ID,
          storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.appspot.com`
        });

        console.log('✅ Firebase Admin SDK initialized with environment variables');
        console.log('✅ App name:', firebaseApp.name);
        console.log('✅ Project ID:', process.env.FIREBASE_PROJECT_ID);
        return firebaseApp;
      } catch (envError) {
        console.error('❌ Failed to initialize Firebase with environment variables');
        console.error('❌ Error:', envError.message);
        console.error('❌ Stack:', envError.stack);
        throw envError; // Don't continue to fallback - we want to know about this error
      }
    }

    // Fallback to service account file (local development)
    const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
    
    if (require('fs').existsSync(serviceAccountPath)) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || `${process.env.FIREBASE_PROJECT_ID}.appspot.com`
      });

      console.log('✅ Firebase Admin SDK initialized with service account file');
      return firebaseApp;
    }

    console.warn('⚠️  Firebase service account not found. Firebase features will be disabled.');
    console.warn('💡 To enable Firebase, set environment variables or provide service account file.');
    return null;
  } catch (error) {
    console.error('❌ Error initializing Firebase:', error.message);
    console.warn('⚠️  Firebase features will be disabled. Continuing without Firebase...');
    return null;
  }
}

/**
 * Get Firebase Admin SDK instance
 */
function getFirebaseApp() {
  if (!firebaseApp) {
    firebaseApp = initializeFirebase();
  }
  return firebaseApp;
}

/**
 * Get Firestore instance
 */
function getFirestore() {
  const app = getFirebaseApp();
  if (!app) {
    throw new Error('Firebase is not initialized. Firestore operations are not available.');
  }
  return app.firestore();
}

/**
 * Get Storage instance (for file uploads)
 */
function getStorage() {
  const app = getFirebaseApp();
  if (!app) {
    throw new Error('Firebase is not initialized. Storage operations are not available.');
  }
  return app.storage();
}



/**
 * Upload file to Firebase Storage
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - File name
 * @param {string} contentType - File content type
 * @param {string} folder - Storage folder path
 * @returns {Promise<string>} Download URL
 */
const uploadFile = async (fileBuffer, fileName, contentType, folder = 'uploads') => {
  try {
    const bucket = getStorage().bucket();
    const filePath = `${folder}/${Date.now()}_${fileName}`;
    const file = bucket.file(filePath);

    await file.save(fileBuffer, {
      metadata: {
        contentType,
        metadata: {
          uploadedAt: new Date().toISOString(),
          originalName: fileName
        }
      }
    });

    // Make file publicly readable
    await file.makePublic();

    const downloadURL = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    console.log('File uploaded successfully:', downloadURL);
    
    return downloadURL;
  } catch (error) {
    console.error('Error uploading file:', error);
    throw error;
  }
};

/**
 * Delete file from Firebase Storage
 * @param {string} filePath - File path in storage
 * @returns {Promise<void>}
 */
const deleteFile = async (filePath) => {
  try {
    const bucket = getStorage().bucket();
    const file = bucket.file(filePath);
    
    await file.delete();
    console.log('File deleted successfully:', filePath);
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
};



module.exports = {
  initializeFirebase,
  getFirebaseApp,
  getFirestore,
  getStorage,
  uploadFile,
  deleteFile,
  Timestamp: admin.firestore.Timestamp
};
