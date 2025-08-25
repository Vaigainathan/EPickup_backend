const admin = require('firebase-admin');
const env = require('../config/environment');

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
      return firebaseApp;
    }

    // Use environment variables for service account (Render deployment)
    if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
      try {
        // Handle private key formatting - it might be base64 encoded or have escaped newlines
        let privateKey = process.env.FIREBASE_PRIVATE_KEY;
        
        // If it's base64 encoded, decode it
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
          try {
            privateKey = Buffer.from(privateKey, 'base64').toString('utf8');
          } catch (e) {
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

        firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          projectId: process.env.FIREBASE_PROJECT_ID
        });

        console.log('✅ Firebase Admin SDK initialized with environment variables');
        return firebaseApp;
      } catch (envError) {
        console.warn('⚠️  Failed to initialize Firebase with environment variables:', envError.message);
        // Continue to fallback options
      }
    }

    // Fallback to service account file (local development)
    const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
    
    if (require('fs').existsSync(serviceAccountPath)) {
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
        projectId: process.env.FIREBASE_PROJECT_ID
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
  return getFirebaseApp().storage();
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
  deleteFile
};
