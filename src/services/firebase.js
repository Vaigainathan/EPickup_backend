const admin = require('firebase-admin');
const { getMessaging } = require('firebase-admin/messaging');
const path = require('path');
const fs = require('fs');
const { env } = require('../config');

let firebaseApp = null;
let db = null;
let auth = null;
let storage = null;
let messaging = null;

/**
 * Initialize Firebase Admin SDK
 */
const initializeFirebase = () => {
  try {
    // Check if Firebase is already initialized
    if (firebaseApp || admin.apps.length > 0) {
      console.log('✅ Firebase already initialized, using existing instance');
      firebaseApp = admin.app();
      db = admin.firestore();
      auth = admin.auth();
      storage = admin.storage();
      messaging = getMessaging(firebaseApp);
      return;
    }

    // Get Firebase configuration from environment config
    const firebaseConfig = env.get('firebase');
    
    // Check if service account file exists
    const serviceAccountPath = firebaseConfig.serviceAccountPath;
    const fullPath = path.resolve(serviceAccountPath);
    
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Firebase service account file not found at: ${fullPath}`);
    }

    // Read service account file
    const serviceAccount = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    
    // Validate service account
    if (!serviceAccount.project_id) {
      throw new Error('Invalid service account: missing project_id');
    }

    // Initialize Firebase Admin SDK
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: `${serviceAccount.project_id}.appspot.com`,
      databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });

    // Initialize services
    db = admin.firestore();
    auth = admin.auth();
    storage = admin.storage();
    messaging = getMessaging(firebaseApp);

    console.log('✅ Firebase Admin SDK initialized successfully');
    console.log(`   Project ID: ${serviceAccount.project_id}`);
    console.log(`   Functions Region: ${firebaseConfig.functionsRegion}`);
    console.log(`   Functions Timeout: ${firebaseConfig.functionsTimeout}s`);
    
    // Set Firestore settings
    db.settings({
      ignoreUndefinedProperties: true,
      timestampsInSnapshots: true
    });

  } catch (error) {
    console.error('❌ Error initializing Firebase:', error);
    throw error;
  }
};

/**
 * Get Firestore database instance
 */
const getFirestore = () => {
  if (!db) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return db;
};

/**
 * Get Firebase Auth instance
 */
const getAuth = () => {
  if (!auth) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return auth;
};

/**
 * Get Firebase Storage instance
 */
const getStorage = () => {
  if (!storage) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return storage;
};

/**
 * Get Firebase Messaging instance
 */
const getMessagingInstance = () => {
  if (!messaging) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return messaging;
};

/**
 * Verify Firebase ID token
 * @param {string} idToken - Firebase ID token
 * @returns {Promise<Object>} Decoded token payload
 */
const verifyIdToken = async (idToken) => {
  try {
    const decodedToken = await auth.verifyIdToken(idToken);
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
    const customToken = await auth.createCustomToken(uid, additionalClaims);
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

    const response = await messaging.send(message);
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

    const response = await messaging.sendMulticast({
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
        const response = await messaging.subscribeToTopic(tokens, topic);
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
        const response = await messaging.unsubscribeFromTopic(tokens, topic);
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
    const bucket = storage.bucket();
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
    const bucket = storage.bucket();
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
    const userRecord = await auth.getUserByPhoneNumber(phoneNumber);
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
    const userRecord = await auth.createUser({
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
    const userRecord = await auth.updateUser(uid, userData);
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
    await auth.deleteUser(uid);
    console.log('User deleted successfully:', uid);
  } catch (error) {
    console.error('Error deleting user:', error);
    throw error;
  }
};

module.exports = {
  initializeFirebase,
  getFirestore,
  getAuth,
  getStorage,
  getMessagingInstance,
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
