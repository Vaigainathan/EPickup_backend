const { Expo } = require('expo-server-sdk');
const { getFirestore } = require('./firebase');
const firestoreSessionService = require('./firestoreSessionService');

/**
 * Expo Push Notification Service for EPickup
 * Handles cross-platform push notifications via Expo
 */
class ExpoPushService {
  constructor() {
    this.expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
    this.db = null; // Initialize lazily
    this.firestoreSessionService = firestoreSessionService;
    this.initialize();
  }

  /**
   * Get Firestore instance (lazy initialization)
   */
  getDb() {
    if (!this.db) {
      try {
        this.db = getFirestore();
      } catch (error) {
        console.error('❌ [ExpoPushService] Failed to get Firestore:', error);
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using ExpoPushService.');
      }
    }
    return this.db;
  }

  /**
   * Initialize Firestore Session Service
   */
  async initializeFirestoreSession() {
    try {
      console.log('✅ Firestore Session Service connected for Expo service');
      return true;
    } catch (error) {
      console.warn('⚠️  Firestore Session Service not available for Expo service:', error.message);
      return false;
    }
  }

  /**
   * Initialize Expo service
   */
  initialize() {
    try {
      console.log('✅ Expo Push service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Expo Push service:', error);
    }
  }

  /**
   * Send push notification to a single user
   * @param {string} userId - User ID
   * @param {Object} notification - Notification data
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Send result
   */
  async sendToUser(userId, notification, options = {}) {
    try {
      // ✅ FIX: Use getDb() to ensure database is initialized
      const db = this.getDb();
      // Get user's Expo push token
      const userDoc = await db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        return {
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        };
      }

      const userData = userDoc.data();
      if (!userData.expoPushToken) {
        return {
          success: false,
          error: {
            code: 'NO_EXPO_TOKEN',
            message: 'User has no Expo push token'
          }
        };
      }

      // Send notification
      const result = await this.sendToTokens([userData.expoPushToken], notification, options);

      // Save notification to database
      await this.saveNotification(userId, notification, 'sent');

      return {
        success: true,
        data: {
          userId,
          notification,
          sentAt: new Date(),
          result
        }
      };

    } catch (error) {
      console.error('Send notification error:', error);
      
      // Save failed notification
      await this.saveNotification(userId, notification, 'failed', error.message);

      return {
        success: false,
        error: {
          code: 'SEND_FAILED',
          message: 'Failed to send notification',
          details: error.message
        }
      };
    }
  }

  /**
   * Send push notification to multiple users
   * @param {Array<string>} userIds - Array of user IDs
   * @param {Object} notification - Notification data
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Send result
   */
  async sendToMultipleUsers(userIds, notification, options = {}) {
    try {
      // ✅ FIX: Use getDb() to ensure database is initialized
      const db = this.getDb();
      // Get all users' Expo push tokens
      const userDocs = await Promise.all(
        userIds.map(id => db.collection('users').doc(id).get())
      );

      const tokens = [];
      const validUserIds = [];

      userDocs.forEach((doc, index) => {
        if (doc.exists) {
          const userData = doc.data();
          if (userData.expoPushToken) {
            tokens.push(userData.expoPushToken);
            validUserIds.push(userIds[index]);
          }
        }
      });

      if (tokens.length === 0) {
        return {
          success: false,
          error: {
            code: 'NO_VALID_TOKENS',
            message: 'No valid Expo push tokens found'
          }
        };
      }

      // Send notifications
      const result = await this.sendToTokens(tokens, notification, options);

      // Save notifications to database
      await Promise.all(
        validUserIds.map(userId => 
          this.saveNotification(userId, notification, 'sent')
        )
      );

      return {
        success: true,
        data: {
          userIds: validUserIds,
          notification,
          sentAt: new Date(),
          result
        }
      };

    } catch (error) {
      console.error('Send multicast notification error:', error);
      
      return {
        success: false,
        error: {
          code: 'MULTICAST_FAILED',
          message: 'Failed to send multicast notification',
          details: error.message
        }
      };
    }
  }

  /**
   * Send push notification to specific Expo tokens
   * @param {Array<string>} tokens - Array of Expo push tokens
   * @param {Object} notification - Notification data
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Send result
   */
  async sendToTokens(tokens, notification, options = {}) {
    try {
      // Validate tokens
      const validTokens = tokens.filter(token => Expo.isExpoPushToken(token));
      const invalidTokens = tokens.filter(token => !Expo.isExpoPushToken(token));

      if (invalidTokens.length > 0) {
        console.warn('Invalid Expo push tokens:', invalidTokens);
      }

      if (validTokens.length === 0) {
        throw new Error('No valid Expo push tokens provided');
      }

      // ✅ FIX: Clean notification data to remove undefined values before sending
      const cleanedNotificationData = notification.data ? this.removeUndefinedValues(notification.data) : {};
      
      // Create notification messages
      const messages = validTokens.map(token => ({
        to: token,
        sound: options.sound || 'default',
        title: notification.title,
        body: notification.body,
        data: {
          type: notification.type || 'general',
          bookingId: notification.bookingId || '',
          driverId: notification.driverId || '',
          paymentId: notification.paymentId || '',
          timestamp: new Date().toISOString(),
          ...cleanedNotificationData
        },
        ...options
      }));

      // Send notifications in chunks (Expo recommends max 100 per request)
      const chunks = this.chunkArray(messages, 100);
      const results = [];

      for (const chunk of chunks) {
        const chunkResults = await this.expo.sendPushNotificationsAsync(chunk);
        results.push(...chunkResults);
      }

      // Process results
      const successCount = results.filter(result => result.status === 'ok').length;
      const failureCount = results.length - successCount;

      console.log(`✅ Push notifications sent: ${successCount} success, ${failureCount} failed`);

      return {
        successCount,
        failureCount,
        totalCount: results.length,
        results
      };

    } catch (error) {
      console.error('Send to tokens error:', error);
      throw error;
    }
  }

  /**
   * Register Expo push token for user
   * @param {string} userId - User ID
   * @param {string} expoPushToken - Expo push token
   * @param {Object} deviceInfo - Device information
   * @returns {Promise<Object>} Registration result
   */
  async registerToken(userId, expoPushToken, deviceInfo = {}) {
    try {
      // Validate token
      if (!Expo.isExpoPushToken(expoPushToken)) {
        return {
          success: false,
          error: {
            code: 'INVALID_TOKEN',
            message: 'Invalid Expo push token'
          }
        };
      }

      // ✅ FIX: Use getDb() to ensure database is initialized
      const db = this.getDb();
      // Update user's Expo push token (use set with merge to create document if it doesn't exist)
      await db.collection('users').doc(userId).set({
        expoPushToken,
        deviceInfo: {
          platform: deviceInfo.platform || 'unknown',
          deviceId: deviceInfo.deviceId || '',
          appVersion: deviceInfo.appVersion || '',
          ...deviceInfo
        },
        tokenUpdatedAt: new Date()
      }, { merge: true });

      console.log(`✅ Expo push token registered for user ${userId}`);

      return {
        success: true,
        message: 'Expo push token registered successfully'
      };

    } catch (error) {
      console.error('Token registration error:', error);
      
      return {
        success: false,
        error: {
          code: 'REGISTRATION_FAILED',
          message: 'Failed to register Expo push token',
          details: error.message
        }
      };
    }
  }

  /**
   * Unregister Expo push token for user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Unregistration result
   */
  async unregisterToken(userId) {
    try {
      // ✅ FIX: Use getDb() to ensure database is initialized
      const db = this.getDb();
      // Remove user's Expo push token (use set with merge to avoid errors if document doesn't exist)
      await db.collection('users').doc(userId).set({
        expoPushToken: null,
        tokenUpdatedAt: new Date()
      }, { merge: true });

      console.log(`✅ Expo push token unregistered for user ${userId}`);

      return {
        success: true,
        message: 'Expo push token unregistered successfully'
      };

    } catch (error) {
      console.error('Token unregistration error:', error);
      
      return {
        success: false,
        error: {
          code: 'UNREGISTRATION_FAILED',
          message: 'Failed to unregister Expo push token',
          details: error.message
        }
      };
    }
  }

  /**
   * Send booking status notification
   * @param {string} userId - User ID
   * @param {string} bookingId - Booking ID
   * @param {string} status - Booking status
   * @param {Object} bookingData - Booking data
   * @returns {Promise<Object>} Send result
   */
  async sendBookingStatusNotification(userId, bookingId, status, bookingData = {}) {
    const statusMessages = {
      'confirmed': {
        title: 'Booking Confirmed! 🎉',
        body: 'Your booking has been confirmed. We\'ll notify you when a driver is assigned.'
      },
      'driver_assigned': {
        title: 'Driver Assigned! 🚗',
        body: 'A driver has been assigned to your booking. You\'ll receive driver details shortly.'
      },
      'driver_enroute': {
        title: 'Driver is on the way! 🚀',
        body: 'Your driver is heading to the pickup location. Track their progress in real-time.'
      },
      'driver_arrived': {
        title: 'Driver has arrived! 📍',
        body: 'Your driver has arrived at the pickup location. Please meet them outside.'
      },
      'picked_up': {
        title: 'Package picked up! 📦',
        body: 'Your package has been picked up and is on its way to the destination.'
      },
      'delivered': {
        title: 'Package delivered! ✅',
        body: 'Your package has been successfully delivered. Thank you for using EPickup!'
      },
      'cancelled': {
        title: 'Booking cancelled',
        body: 'Your booking has been cancelled. Please contact support if you have any questions.'
      }
    };

    const message = statusMessages[status] || {
      title: 'Booking Update',
      body: `Your booking status has been updated to: ${status}`
    };

    return await this.sendToUser(userId, {
      title: message.title,
      body: message.body,
      type: 'booking_status',
      bookingId,
      data: {
        status,
        bookingData
      }
    });
  }

  /**
   * Send payment status notification
   * @param {string} userId - User ID
   * @param {string} paymentId - Payment ID
   * @param {string} status - Payment status
   * @param {Object} paymentData - Payment data
   * @returns {Promise<Object>} Send result
   */
  async sendPaymentStatusNotification(userId, paymentId, status, paymentData = {}) {
    const statusMessages = {
      'completed': {
        title: 'Payment Successful! 💳',
        body: 'Your payment has been processed successfully. Thank you!'
      },
      'failed': {
        title: 'Payment Failed',
        body: 'Your payment could not be processed. Please try again or contact support.'
      },
      'pending': {
        title: 'Payment Pending',
        body: 'Your payment is being processed. You\'ll receive a confirmation shortly.'
      }
    };

    const message = statusMessages[status] || {
      title: 'Payment Update',
      body: `Your payment status has been updated to: ${status}`
    };

    return await this.sendToUser(userId, {
      title: message.title,
      body: message.body,
      type: 'payment_status',
      paymentId,
      data: {
        status,
        paymentData
      }
    });
  }

  /**
   * Send driver assignment notification
   * @param {string} customerId - Customer ID
   * @param {Object} driverInfo - Driver information
   * @returns {Promise<Object>} Send result
   */
  async sendDriverAssignmentNotification(customerId, driverInfo) {
    return await this.sendToUser(customerId, {
      title: 'Driver Assigned! 🚗',
      body: `${driverInfo.name} will be your driver. Vehicle: ${driverInfo.vehicleNumber}`,
      type: 'driver_assignment',
      data: {
        driverInfo
      }
    });
  }

  /**
   * Send promotional notification
   * @param {Array<string>} userIds - Array of user IDs
   * @param {Object} promotionalData - Promotional data
   * @returns {Promise<Object>} Send result
   */
  async sendPromotionalNotification(userIds, promotionalData) {
    return await this.sendToMultipleUsers(userIds, {
      title: promotionalData.title || 'Special Offer! 🎉',
      body: promotionalData.body || 'Check out our latest offers and discounts.',
      type: 'promotional',
      data: promotionalData
    });
  }

  /**
   * Remove undefined values from an object recursively
   * @param {Object} obj - Object to clean
   * @returns {Object} Cleaned object
   */
  removeUndefinedValues(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.removeUndefinedValues(item));
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        cleaned[key] = this.removeUndefinedValues(value);
      }
    }
    return cleaned;
  }

  /**
   * Save notification to database
   * @param {string} userId - User ID
   * @param {Object} notification - Notification data
   * @param {string} status - Notification status
   * @param {string} errorMessage - Error message (if failed)
   */
  async saveNotification(userId, notification, status, errorMessage = null) {
    try {
      // ✅ FIX: Use getDb() to ensure database is initialized
      const db = this.getDb();
      
      // ✅ FIX: Remove undefined values from notification data to prevent Firestore errors
      const cleanedData = notification.data ? this.removeUndefinedValues(notification.data) : {};
      
      await db.collection('notifications').add({
        userId,
        title: notification.title || '',
        body: notification.body || '',
        type: notification.type || 'general',
        data: cleanedData,
        bookingId: notification.bookingId || null,
        driverId: notification.driverId || null,
        paymentId: notification.paymentId || null,
        status,
        errorMessage: errorMessage || null,
        sentAt: new Date()
      });
    } catch (error) {
      console.error('Failed to save notification:', error);
    }
  }

  /**
   * Get notification history for user
   * @param {string} userId - User ID
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} Notification history
   */
  async getNotificationHistory(userId, filters = {}) {
    try {
      // ✅ FIX: Use getDb() to ensure database is initialized
      const db = this.getDb();
      let query = db.collection('notifications').where('userId', '==', userId);

      if (filters.type) {
        query = query.where('type', '==', filters.type);
      }

      if (filters.status) {
        query = query.where('status', '==', filters.status);
      }

      const snapshot = await query
        .orderBy('sentAt', 'desc')
        .limit(filters.limit || 50)
        .get();

      return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

    } catch (error) {
      console.error('Failed to get notification history:', error);
      return [];
    }
  }

  /**
   * Get notification statistics
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>} Statistics
   */
  async getNotificationStatistics(filters = {}) {
    try {
      // ✅ FIX: Use getDb() to ensure database is initialized
      const db = this.getDb();
      let query = db.collection('notifications');

      if (filters.userId) {
        query = query.where('userId', '==', filters.userId);
      }

      if (filters.type) {
        query = query.where('type', '==', filters.type);
      }

      const snapshot = await query.get();
      const notifications = snapshot.docs.map(doc => doc.data());

      const total = notifications.length;
      const sent = notifications.filter(n => n.status === 'sent').length;
      const failed = notifications.filter(n => n.status === 'failed').length;

      return {
        total,
        sent,
        failed,
        successRate: total > 0 ? (sent / total) * 100 : 0
      };

    } catch (error) {
      console.error('Failed to get notification statistics:', error);
      return {
        total: 0,
        sent: 0,
        failed: 0,
        successRate: 0
      };
    }
  }

  /**
   * Split array into chunks
   * @param {Array} array - Array to split
   * @param {number} size - Chunk size
   * @returns {Array} Array of chunks
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Get service health status
   * @returns {Promise<Object>} Health status
   */
  async getHealthStatus() {
    try {
      const isConfigured = !!(process.env.EXPO_ACCESS_TOKEN);
      
      return {
        service: 'expo_push',
        status: isConfigured ? 'healthy' : 'unconfigured',
        configured: isConfigured,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        service: 'expo_push',
        status: 'error',
        error: error.message,
        timestamp: new Date()
      };
    }
  }
}

// Export singleton instance
module.exports = new ExpoPushService();
