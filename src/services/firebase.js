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
      const serviceAccount = {
        type: "service_account",
        project_id: process.env.FIREBASE_PROJECT_ID,
        private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
        private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
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

    throw new Error('Firebase service account not found. Please set environment variables or provide service account file.');

  } catch (error) {
    console.error('❌ Error initializing Firebase:', error.message);
    throw error;
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
  return getFirebaseApp().firestore();
}

/**
 * Get Auth instance
 */
function getAuth() {
  return getFirebaseApp().auth();
}

/**
 * Get Storage instance
 */
function getStorage() {
  return getFirebaseApp().storage();
}

/**
 * Get Messaging instance
 */
function getMessaging() {
  return getFirebaseApp().messaging();
}

/**
 * Verify Firebase ID token
 * @param {string} idToken - Firebase ID token
 * @returns {Promise<Object>} Decoded token payload
 */
const verifyIdToken = async (idToken) => {
  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    return decodedToken;
  } catch (error) {
    console.error('Error verifying ID token:', error);
    throw new Error('Invalid ID token');
  }
};

/**
 * Create custom token for user
 * @param {string} uid - User ID
 * @param {Object} additionalClaims - Additional claims to include
 * @returns {Promise<string>} Custom token
 */
const createCustomToken = async (uid, additionalClaims = {}) => {
  try {
    const customToken = await getAuth().createCustomToken(uid, additionalClaims);
    return customToken;
  } catch (error) {
    console.error('Error creating custom token:', error);
    throw error;
  }
};

/**
 * Send push notification using FCM
 * @param {string} token - FCM token
 * @param {Object} notification - Notification payload
 * @param {Object} data - Additional data
 * @returns {Promise<string>} Message ID
 */
const sendPushNotification = async (token, notification, data = {}) => {
  try {
    const message = {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
        imageUrl: notification.imageUrl
      },
      data: {
        ...data,
        clickAction: 'FLUTTER_NOTIFICATION_CLICK'
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'epickup_channel',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    const response = await getMessaging().send(message);
    console.log('Push notification sent successfully:', response);
    return response;
  } catch (error) {
    console.error('Error sending push notification:', error);
    throw error;
  }
};

/**
 * Send push notification to multiple tokens
 * @param {Array<string>} tokens - Array of FCM tokens
 * @param {Object} notification - Notification payload
 * @param {Object} data - Additional data
 * @returns {Promise<Object>} Batch response
 */
const sendMulticastNotification = async (tokens, notification, data = {}) => {
  try {
    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
        imageUrl: notification.imageUrl
      },
      data: {
        ...data,
        clickAction: 'FLUTTER_NOTIFICATION_CLICK'
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'epickup_channel',
          priority: 'high',
          defaultSound: true,
          defaultVibrateTimings: true
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    const response = await getMessaging().sendMulticast({
      tokens,
      ...message
    });

    console.log('Multicast notification sent successfully:', {
      successCount: response.successCount,
      failureCount: response.failureCount
    });

    return response;
  } catch (error) {
    console.error('Error sending multicast notification:', error);
    throw error;
  }
};

/**
 * Subscribe user to FCM topic
 * @param {Array<string>} tokens - FCM tokens
 * @param {string} topic - Topic name
 * @returns {Promise<Object>} Subscription response
 */
const subscribeToTopic = async (tokens, topics) => {
  try {
    // Handle both single topic and array of topics
    const topicArray = Array.isArray(topics) ? topics : [topics];
    
    const results = [];
    for (const topic of topicArray) {
      try {
        const response = await getMessaging().subscribeToTopic(tokens, topic);
        results.push({ topic, success: true, response });
      } catch (error) {
        console.error(`Error subscribing to topic ${topic}:`, error);
        results.push({ topic, success: false, error: error.message });
      }
    }
    
    console.log('Topic subscription results:', results);
    return results;
  } catch (error) {
    console.error('Error in topic subscription process:', error);
    throw error;
  }
};

/**
 * Unsubscribe user from FCM topic
 * @param {Array<string>} tokens - FCM tokens
 * @param {string} topic - Topic name
 * @returns {Promise<Object>} Unsubscription response
 */
const unsubscribeFromTopic = async (tokens, topics) => {
  try {
    // Handle both single topic and array of topics
    const topicArray = Array.isArray(topics) ? topics : [topics];
    
    const results = [];
    for (const topic of topicArray) {
      try {
        const response = await getMessaging().unsubscribeFromTopic(tokens, topic);
        results.push({ topic, success: true, response });
      } catch (error) {
        console.error(`Error unsubscribing from topic ${topic}:`, error);
        results.push({ topic, success: false, error: error.message });
      }
    }
    
    console.log('Topic unsubscription results:', results);
    return results;
  } catch (error) {
    console.error('Error in topic unsubscription process:', error);
    throw error;
  }
};

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

/**
 * Get user by phone number
 * @param {string} phoneNumber - Phone number
 * @returns {Promise<Object|null>} User record
 */
const getUserByPhone = async (phoneNumber) => {
  try {
    const userRecord = await getAuth().getUserByPhoneNumber(phoneNumber);
    return userRecord;
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return null;
    }
    throw error;
  }
};

/**
 * Create user with phone number
 * @param {string} phoneNumber - Phone number
 * @param {Object} userData - Additional user data
 * @returns {Promise<Object>} Created user record
 */
const createUser = async (phoneNumber, userData = {}) => {
  try {
    const userRecord = await getAuth().createUser({
      phoneNumber,
      ...userData
    });
    
    console.log('User created successfully:', userRecord.uid);
    return userRecord;
  } catch (error) {
    console.error('Error creating user:', error);
    throw error;
  }
};

/**
 * Update user data
 * @param {string} uid - User ID
 * @param {Object} userData - User data to update
 * @returns {Promise<Object>} Updated user record
 */
const updateUser = async (uid, userData) => {
  try {
    const userRecord = await getAuth().updateUser(uid, userData);
    console.log('User updated successfully:', uid);
    return userRecord;
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
};

/**
 * Delete user
 * @param {string} uid - User ID
 * @returns {Promise<void>}
 */
const deleteUser = async (uid) => {
  try {
    await getAuth().deleteUser(uid);
    console.log('User deleted successfully:', uid);
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
};

module.exports = {
  initializeFirebase,
  getFirebaseApp,
  getFirestore,
  getAuth,
  getStorage,
  getMessaging,
  verifyIdToken,
  createCustomToken,
  sendPushNotification,
  sendMulticastNotification,
  subscribeToTopic,
  unsubscribeFromTopic,
  uploadFile,
  deleteFile,
  getUserByPhone,
  createUser,
  updateUser,
  deleteUser
};
