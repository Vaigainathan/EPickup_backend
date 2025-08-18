const { getFirestore, getMessagingInstance, subscribeToTopic, unsubscribeFromTopic } = require('./firebase');
const FCMV1Service = require('./fcmV1Service');
const axios = require('axios');
const moment = require('moment');

/**
 * EPickup Notification Service
 * Handles all notification types: Push, In-app, SMS, and Email
 * Primary focus: Firebase Cloud Messaging (FCM) with minimal SMS fallback
 */
class NotificationService {
  constructor() {
    // Initialize Firebase instances lazily
    
    // Enhanced FCM Configuration
    this.fcmConfig = {
      enabled: process.env.FCM_ENABLED !== 'false', // Default to true
      priority: process.env.FCM_PRIORITY || 'high',
      androidChannelId: 'epickup_channel',
      androidChannelName: 'EPickup Notifications',
      androidChannelDescription: 'Important updates about your deliveries',
      retryAttempts: parseInt(process.env.FCM_RETRY_ATTEMPTS) || 3,
      batchSize: parseInt(process.env.FCM_BATCH_SIZE) || 500, // FCM limit is 500
      topicPrefix: 'epickup_',
      maxTokenAge: parseInt(process.env.FCM_MAX_TOKEN_AGE) || 30, // days
      tokenValidationInterval: parseInt(process.env.FCM_TOKEN_VALIDATION_INTERVAL) || 24, // hours
      enableTokenRefresh: process.env.FCM_ENABLE_TOKEN_REFRESH !== 'false',
      enableTopicOptimization: process.env.FCM_ENABLE_TOPIC_OPTIMIZATION !== 'false'
    };

    // Initialize FCM v1 service
    this.fcmV1Service = new FCMV1Service();
    this.initializeFCM();
    
    // Notification templates with enhanced FCM support
    this.templates = {
      // Booking notifications
      booking_created: {
        title: 'Booking Confirmed',
        body: 'Your delivery has been booked successfully',
        icon: '🚚',
        priority: 'high',
        fcmPriority: 'high',
        androidChannelId: 'epickup_bookings',
        fcmCollapseKey: 'booking_status',
        fcmTtl: 86400 // 24 hours
      },
      booking_confirmed: {
        title: 'Driver Assigned',
        body: 'A driver has been assigned to your delivery',
        icon: '👨‍💼',
        priority: 'high',
        fcmPriority: 'high',
        androidChannelId: 'epickup_bookings',
        fcmCollapseKey: 'booking_status',
        fcmTtl: 86400
      },
      driver_enroute: {
        title: 'Driver is on the way',
        body: 'Your driver is heading to pickup location',
        icon: '🛵',
        priority: 'high',
        fcmPriority: 'high',
        androidChannelId: 'epickup_tracking',
        fcmCollapseKey: 'driver_status',
        fcmTtl: 3600 // 1 hour
      },
      driver_arrived: {
        title: 'Driver has arrived',
        body: 'Your driver is waiting at pickup location',
        icon: '📍',
        priority: 'high',
        fcmPriority: 'high',
        androidChannelId: 'epickup_tracking',
        fcmCollapseKey: 'driver_status',
        fcmTtl: 3600
      },
      package_picked: {
        title: 'Package picked up',
        body: 'Your package is on its way to destination',
        icon: '📦',
        priority: 'medium',
        fcmPriority: 'high',
        androidChannelId: 'epickup_tracking',
        fcmCollapseKey: 'package_status',
        fcmTtl: 7200 // 2 hours
      },
      delivery_completed: {
        title: 'Delivery completed',
        body: 'Your package has been delivered successfully',
        icon: '✅',
        priority: 'medium',
        fcmPriority: 'high',
        androidChannelId: 'epickup_bookings',
        fcmCollapseKey: 'delivery_status',
        fcmTtl: 86400
      },
      
      // Driver notifications
      new_booking: {
        title: 'New delivery request',
        body: 'You have a new delivery assignment',
        icon: '🆕',
        priority: 'high',
        fcmPriority: 'high',
        androidChannelId: 'epickup_driver',
        fcmCollapseKey: 'new_booking',
        fcmTtl: 300 // 5 minutes
      },
      booking_accepted: {
        title: 'Booking accepted',
        body: 'Your delivery request has been accepted',
        icon: '👍',
        priority: 'medium',
        fcmPriority: 'high',
        androidChannelId: 'epickup_driver',
        fcmCollapseKey: 'booking_response',
        fcmTtl: 3600
      },
      booking_rejected: {
        title: 'Booking rejected',
        body: 'Your delivery request was not accepted',
        icon: '❌',
        priority: 'medium',
        fcmPriority: 'high',
        androidChannelId: 'epickup_driver',
        fcmCollapseKey: 'booking_response',
        fcmTtl: 3600
      },
      
      // Payment notifications
      payment_success: {
        title: 'Payment successful',
        body: 'Your payment has been processed',
        icon: '💳',
        priority: 'medium',
        fcmPriority: 'high',
        androidChannelId: 'epickup_payments',
        fcmCollapseKey: 'payment_status',
        fcmTtl: 86400
      },
      payment_failed: {
        title: 'Payment failed',
        body: 'There was an issue with your payment',
        icon: '⚠️',
        priority: 'high',
        fcmPriority: 'high',
        androidChannelId: 'epickup_payments',
        fcmCollapseKey: 'payment_status',
        fcmTtl: 3600
      },
      wallet_credited: {
        title: 'Wallet credited',
        body: 'Your wallet has been credited',
        icon: '💰',
        priority: 'medium',
        fcmPriority: 'high',
        androidChannelId: 'epickup_payments',
        fcmCollapseKey: 'wallet_update',
        fcmTtl: 86400
      },
      
      // System notifications
      system_maintenance: {
        title: 'System maintenance',
        body: 'We are performing scheduled maintenance',
        icon: '🔧',
        priority: 'low',
        fcmPriority: 'high',
        androidChannelId: 'epickup_system',
        fcmCollapseKey: 'system_status',
        fcmTtl: 86400
      },
      app_update: {
        title: 'App update available',
        body: 'A new version of the app is available',
        icon: '📱',
        priority: 'low',
        fcmPriority: 'high',
        androidChannelId: 'epickup_system',
        fcmCollapseKey: 'app_update',
        fcmTtl: 604800 // 7 days
      }
    };
    
    // SMS configuration (disabled by default, FCM is primary)
    this.smsConfig = {
      provider: 'disabled',
      fallbackEnabled: false,
      criticalNotifications: ['payment_failed', 'booking_cancelled', 'emergency', 'driver_arrived'],
      maxRetries: 0,
      enableOnlyForCritical: false
    };
  }

  get db() {
    return getFirestore();
  }

  get fcm() {
    return getMessagingInstance();
  }

  /**
   * Initialize FCM v1 service
   */
  async initializeFCM() {
    try {
      await this.fcmV1Service.initialize();
      console.log('✅ FCM v1 service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize FCM v1 service:', error.message);
    }
  }

  /**
   * Enhanced FCM Token Management Methods
   */

  /**
   * Save/Update FCM token for a user with enhanced validation
   */
  async saveFCMToken(userId, fcmToken, deviceInfo = {}) {
    try {
      if (!fcmToken) {
        throw new Error('FCM token is required');
      }

      // Validate token format
      if (!this.isValidFCMTokenFormat(fcmToken)) {
        throw new Error('Invalid FCM token format');
      }

      const tokenData = {
        fcmToken,
        deviceInfo: {
          platform: deviceInfo.platform || 'unknown',
          appVersion: deviceInfo.appVersion || 'unknown',
          deviceModel: deviceInfo.deviceModel || 'unknown',
          lastUpdated: new Date().toISOString(),
          lastValidated: new Date().toISOString()
        },
        isActive: true,
        createdAt: new Date().toISOString(),
        validationCount: 1,
        lastUsed: new Date().toISOString()
      };

      // Update user document with FCM token
      await this.db.collection('users').doc(userId).update({
        fcmToken,
        deviceInfo: tokenData.deviceInfo,
        fcmTokenUpdatedAt: new Date().toISOString(),
        fcmTokenStatus: 'active'
      });

      // Store detailed token info in separate collection
      await this.db.collection('fcmTokens').doc(userId).set(tokenData);

      // Subscribe user to default topics based on user type
      await this.subscribeUserToDefaultTopics(userId);

      console.log(`FCM token saved for user ${userId}`);
      
      return {
        success: true,
        message: 'FCM token saved successfully',
        data: tokenData
      };

    } catch (error) {
      console.error('Error saving FCM token:', error);
      throw error;
    }
  }

  /**
   * Validate FCM token format
   */
  isValidFCMTokenFormat(token) {
    // FCM tokens are typically 140+ characters and contain alphanumeric characters
    return token && typeof token === 'string' && token.length >= 140 && /^[a-zA-Z0-9:_-]+$/.test(token);
  }

  /**
   * Subscribe user to default topics based on user type
   */
  async subscribeUserToDefaultTopics(userId) {
    try {
      const userDoc = await this.db.collection('users').doc(userId).get();
      if (!userDoc.exists) return;

      const userData = userDoc.data();
      const userType = userData.userType || 'customer';
      
      let defaultTopics = ['general', 'system'];
      
      if (userType === 'customer') {
        defaultTopics.push('bookings', 'payments', 'tracking');
      } else if (userType === 'driver') {
        defaultTopics.push('driver', 'earnings', 'assignments');
      } else if (userType === 'admin') {
        defaultTopics.push('admin', 'analytics', 'reports');
      }

      await this.subscribeUserToTopics(userId, defaultTopics);
      
    } catch (error) {
      console.log('Error subscribing to default topics:', error.message);
    }
  }

  /**
   * Remove FCM token for a user
   */
  async removeFCMToken(userId) {
    try {
      // Remove FCM token from user document
      await this.db.collection('users').doc(userId).update({
        fcmToken: null,
        fcmTokenUpdatedAt: null,
        fcmTokenStatus: 'inactive'
      });

      // Mark token as inactive in fcmTokens collection
      await this.db.collection('fcmTokens').doc(userId).update({
        isActive: false,
        removedAt: new Date().toISOString(),
        removalReason: 'user_logout_or_token_invalid'
      });

      // Unsubscribe from all topics
      await this.unsubscribeUserFromAllTopics(userId);

      console.log(`FCM token removed for user ${userId}`);
      
      return {
        success: true,
        message: 'FCM token removed successfully'
      };

    } catch (error) {
      console.error('Error removing FCM token:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe user from all topics
   */
  async unsubscribeUserFromAllTopics(userId) {
    try {
      const userDoc = await this.db.collection('users').doc(userId).get();
      if (!userDoc.exists) return;

      const userData = userDoc.data();
      const subscribedTopics = userData.subscribedTopics || [];
      
      if (subscribedTopics.length > 0) {
        await this.unsubscribeUserFromTopics(userId, subscribedTopics);
      }
    } catch (error) {
      console.log('Error unsubscribing from all topics:', error.message);
    }
  }

  /**
   * Get FCM token for a user
   */
  async getFCMToken(userId) {
    try {
      const userDoc = await this.db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        return null;
      }

      const userData = userDoc.data();
      return userData.fcmToken || null;

    } catch (error) {
      console.error('Error getting FCM token:', error);
      return null;
    }
  }

  /**
   * Enhanced FCM token validation with retry logic
   */
  async validateFCMToken(fcmToken) {
    try {
      // Send a test message to validate token
      const testMessage = {
        token: fcmToken,
        notification: {
          title: 'Test',
          body: 'Test notification'
        },
        data: {
          type: 'test',
          timestamp: new Date().toISOString()
        },
        android: {
          priority: 'normal',
          notification: {
            channelId: 'epickup_system',
            priority: 'normal'
          }
        }
      };

      await this.fcm.send(testMessage);
      
      // Update token validation timestamp
      await this.updateTokenValidationTimestamp(fcmToken);
      
      return true;

    } catch (error) {
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered' ||
          error.code === 'messaging/registration-token-expired') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Update token validation timestamp
   */
  async updateTokenValidationTimestamp(fcmToken) {
    try {
      // Find user with this token and update validation timestamp
      const tokensSnapshot = await this.db.collection('fcmTokens')
        .where('fcmToken', '==', fcmToken)
        .get();

      if (!tokensSnapshot.empty) {
        const tokenDoc = tokensSnapshot.docs[0];
        await tokenDoc.ref.update({
          lastValidated: new Date().toISOString(),
          validationCount: (tokenDoc.data().validationCount || 0) + 1
        });
      }
    } catch (error) {
      console.log('Error updating token validation timestamp:', error.message);
    }
  }

  /**
   * Subscribe user to FCM topics with enhanced error handling
   */
  async subscribeUserToTopics(userId, topics) {
    try {
      const fcmToken = await this.getFCMToken(userId);
      if (!fcmToken) {
        throw new Error('No FCM token found for user');
      }

      const prefixedTopics = topics.map(topic => `/topics/${this.fcmConfig.topicPrefix}${topic}`);
      
      const result = await subscribeToTopic([fcmToken], prefixedTopics);
      
      // Update user's subscribed topics
      await this.db.collection('users').doc(userId).update({
        subscribedTopics: topics,
        topicsUpdatedAt: new Date().toISOString()
      });

      console.log(`User ${userId} subscribed to topics: ${topics.join(', ')}`);
      
      return {
        success: true,
        message: 'User subscribed to topics successfully',
        data: result
      };

    } catch (error) {
      console.error('Error subscribing user to topics:', error);
      throw error;
    }
  }

  /**
   * Unsubscribe user from FCM topics
   */
  async unsubscribeUserFromTopics(userId, topics) {
    try {
      const fcmToken = await this.getFCMToken(userId);
      if (!fcmToken) {
        throw new Error('No FCM token found for user');
      }

      const prefixedTopics = topics.map(topic => `/topics/${this.fcmConfig.topicPrefix}${topic}`);
      
      const result = await unsubscribeFromTopic([fcmToken], prefixedTopics);
      
      // Update user's subscribed topics
      const userDoc = await this.db.collection('users').doc(userId).get();
      if (userDoc.exists) {
        const currentTopics = userDoc.data().subscribedTopics || [];
        const updatedTopics = currentTopics.filter(topic => !topics.includes(topic));
        
        await this.db.collection('users').doc(userId).update({
          subscribedTopics: updatedTopics,
          topicsUpdatedAt: new Date().toISOString()
        });
      }

      console.log(`User ${userId} unsubscribed from topics: ${topics.join(', ')}`);
      
      return {
        success: true,
        message: 'User unsubscribed from topics successfully',
        data: result
      };

    } catch (error) {
      console.error('Error unsubscribing user from topics:', error);
      throw error;
    }
  }

  /**
   * Send notification to FCM topic with enhanced payload
   */
  async sendNotificationToTopic(topic, notificationType, data = {}, options = {}) {
    try {
      const prefixedTopic = `/topics/${this.fcmConfig.topicPrefix}${topic}`;
      
      // Get notification template
      const template = this.templates[notificationType];
      if (!template) {
        throw new Error(`Unknown notification type: ${notificationType}`);
      }

      // Prepare notification payload
      const notification = {
        title: options.title || template.title,
        body: options.body || template.body,
        icon: template.icon
      };

      // Prepare data payload
      const payload = {
        type: notificationType,
        timestamp: new Date().toISOString(),
        ...data
      };

      // Send to FCM topic with enhanced configuration
      const message = {
        topic: prefixedTopic,
        notification: {
          title: notification.title,
          body: notification.body,
          imageUrl: notification.icon
        },
        data: payload,
        android: {
          priority: template.fcmPriority || 'high',
          notification: {
            channelId: template.androidChannelId || this.fcmConfig.androidChannelId,
            priority: template.fcmPriority || 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
            icon: 'ic_notification',
            color: '#FF6B35'
          },
          ttl: template.fcmTtl || 86400
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
              category: 'epickup_notification'
            }
          },
          headers: {
            'apns-priority': template.fcmPriority === 'high' ? '10' : '5'
          }
        },
        webpush: {
          headers: {
            TTL: template.fcmTtl || 86400,
            priority: template.fcmPriority || 'high'
          }
        }
      };

      // Add collapse key if specified
      if (template.fcmCollapseKey) {
        message.android.notification.collapseKey = template.fcmCollapseKey;
        message.apns.payload.aps['thread-id'] = template.fcmCollapseKey;
      }

      const result = await this.fcm.send(message);
      
      // Log topic notification
      await this.logTopicNotification(prefixedTopic, notificationType, notification, payload, result);
      
      return {
        success: true,
        message: `Topic notification sent to ${prefixedTopic}`,
        data: result
      };

    } catch (error) {
      console.error('Topic notification failed:', error);
      throw error;
    }
  }

  /**
   * Enhanced Push Notification with FCM Priority and Smart Fallback
   */
  async sendPushNotification(userId, notificationType, data = {}, options = {}) {
    try {
      // Get user's FCM token
      const userDoc = await this.db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        throw new Error(`User ${userId} not found`);
      }

      const userData = userDoc.data();
      const fcmToken = userData.fcmToken;

      if (!fcmToken) {
        console.log(`No FCM token for user ${userId}, falling back to SMS for critical notifications`);
        if (this.smsConfig.fallbackEnabled && this.smsConfig.criticalNotifications.includes(notificationType)) {
          return await this.sendSMSNotification(userId, notificationType, data);
        }
        throw new Error('No FCM token available and SMS fallback not applicable');
      }

      // Validate FCM token before sending
      const isValidToken = await this.validateFCMToken(fcmToken);
      if (!isValidToken) {
        console.log(`Invalid FCM token for user ${userId}, removing token and falling back to SMS for critical notifications`);
        await this.removeFCMToken(userId);
        
        if (this.smsConfig.fallbackEnabled && this.smsConfig.criticalNotifications.includes(notificationType)) {
          return await this.sendSMSNotification(userId, notificationType, data);
        }
        throw new Error('Invalid FCM token and SMS fallback not applicable');
      }

      // Get notification template
      const template = this.templates[notificationType];
      if (!template) {
        throw new Error(`Unknown notification type: ${notificationType}`);
      }

      // Prepare notification payload with enhanced FCM options
      const notification = {
        title: options.title || template.title,
        body: options.body || template.body,
        icon: template.icon,
        priority: template.priority,
        fcmPriority: template.fcmPriority || 'high',
        androidChannelId: template.androidChannelId || this.fcmConfig.androidChannelId
      };

      // Prepare data payload
      const payload = {
        type: notificationType,
        timestamp: new Date().toISOString(),
        userId,
        ...data
      };

      // Send FCM notification with enhanced retry logic using FCM v1 service
      let result;
      let attempts = 0;
      
      while (attempts < this.fcmConfig.retryAttempts) {
        try {
          result = await this.fcmV1Service.sendToDevice(fcmToken, {
            title: notification.title,
            body: notification.body
          }, payload, {
            priority: notification.fcmPriority || 'high',
            channelId: notification.androidChannelId || this.fcmConfig.androidChannelId,
            ttl: 86400
          });
          break;
        } catch (error) {
          attempts++;
          if (attempts >= this.fcmConfig.retryAttempts) {
            throw error;
          }
          console.log(`FCM retry attempt ${attempts} for user ${userId}`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts)); // Exponential backoff
        }
      }
      
      // Update token usage timestamp
      await this.updateTokenUsageTimestamp(fcmToken);
      
      // Log notification
      await this.logNotification(userId, 'push', notificationType, notification, payload, result);
      
      return {
        success: true,
        message: 'Push notification sent successfully',
        data: result
      };

    } catch (error) {
      console.error('Push notification failed:', error);
      
      // Enhanced fallback logic - only SMS for critical notifications
      if (this.smsConfig.fallbackEnabled && 
          this.smsConfig.criticalNotifications.includes(notificationType) &&
          this.smsConfig.enableOnlyForCritical) {
        console.log('Falling back to SMS notification for critical message');
        return await this.sendSMSNotification(userId, notificationType, data);
      }
      
      throw error;
    }
  }

  /**
   * Update token usage timestamp
   */
  async updateTokenUsageTimestamp(fcmToken) {
    try {
      const tokensSnapshot = await this.db.collection('fcmTokens')
        .where('fcmToken', '==', fcmToken)
        .get();

      if (!tokensSnapshot.empty) {
        const tokenDoc = tokensSnapshot.docs[0];
        await tokenDoc.ref.update({
          lastUsed: new Date().toISOString()
        });
      }
    } catch (error) {
      console.log('Error updating token usage timestamp:', error.message);
    }
  }

  /**
   * Enhanced Multicast Notification with FCM Batching and Token Validation
   */
  async sendMulticastNotification(userIds, notificationType, data = {}, options = {}) {
    try {
      // Get FCM tokens for all users with validation
      const userDocs = await Promise.all(
        userIds.map(id => this.db.collection('users').doc(id).get())
      );

      const validTokens = [];
      const invalidTokens = [];
      const usersWithoutTokens = [];

      // Validate and categorize tokens
      for (let i = 0; i < userDocs.length; i++) {
        const doc = userDocs[i];
        const userId = userIds[i];
        
        if (!doc.exists) {
          usersWithoutTokens.push(userId);
          continue;
        }

        const userData = doc.data();
        const fcmToken = userData.fcmToken;

        if (!fcmToken) {
          usersWithoutTokens.push(userId);
          continue;
        }

        // Validate token
        try {
          const isValid = await this.validateFCMToken(fcmToken);
          if (isValid) {
            validTokens.push(fcmToken);
          } else {
            invalidTokens.push({ userId, token: fcmToken });
          }
        } catch (error) {
          console.log(`Token validation failed for user ${userId}:`, error.message);
          invalidTokens.push({ userId, token: fcmToken });
        }
      }

      // Remove invalid tokens
      if (invalidTokens.length > 0) {
        console.log(`Removing ${invalidTokens.length} invalid FCM tokens`);
        await Promise.all(
          invalidTokens.map(({ userId }) => this.removeFCMToken(userId))
        );
      }

      if (validTokens.length === 0) {
        throw new Error('No valid FCM tokens found for the specified users');
      }

      // Get notification template
      const template = this.templates[notificationType];
      if (!template) {
        throw new Error(`Unknown notification type: ${notificationType}`);
      }

      // Prepare notification payload with enhanced FCM options
      const notification = {
        title: options.title || template.title,
        body: options.body || template.body,
        icon: template.icon,
        priority: template.priority,
        fcmPriority: template.fcmPriority || 'high',
        androidChannelId: template.androidChannelId || this.fcmConfig.androidChannelId
      };

      // Prepare data payload
      const payload = {
        type: notificationType,
        timestamp: new Date().toISOString(),
        ...data
      };

      // Send notifications in batches (FCM limit is 500)
      const results = [];
      const batchSize = this.fcmConfig.batchSize;
      
      for (let i = 0; i < validTokens.length; i += batchSize) {
        const batch = validTokens.slice(i, i + batchSize);
        
        try {
          const result = await sendMulticastNotification(batch, notification, payload);
          results.push(result);
          
          // Add delay between batches to avoid rate limiting
          if (i + batchSize < validTokens.length) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        } catch (error) {
          console.error(`Batch ${Math.floor(i / batchSize) + 1} failed:`, error);
          results.push({ success: false, error: error.message });
        }
      }
      
      // Update token usage timestamps
      await Promise.all(
        validTokens.map(token => this.updateTokenUsageTimestamp(token))
      );
      
      // Log notifications
      await Promise.all(
        userIds.map(userId => 
          this.logNotification(userId, 'push', notificationType, notification, payload, results)
        )
      );
      
      const successCount = results.filter(r => r.success !== false).length;
      const failureCount = results.filter(r => r.success === false).length;
      
      return {
        success: true,
        message: `Multicast notification sent to ${validTokens.length} users`,
        data: {
          results,
          summary: {
            totalUsers: userIds.length,
            validTokens: validTokens.length,
            invalidTokens: invalidTokens.length,
            usersWithoutTokens: usersWithoutTokens.length,
            successfulBatches: successCount,
            failedBatches: failureCount
          }
        }
      };

    } catch (error) {
      console.error('Multicast notification failed:', error);
      throw error;
    }
  }

  /**
   * Send SMS notification (critical fallback only)
   */
  async sendSMSNotification(userId, notificationType, data = {}) {
    try {
      // Only send SMS for critical notifications or if explicitly enabled
      if (!this.smsConfig.fallbackEnabled || 
          (!this.smsConfig.criticalNotifications.includes(notificationType) && 
           this.smsConfig.enableOnlyForCritical)) {
        throw new Error('SMS fallback not applicable for this notification type');
      }

      // Get user's phone number
      const userDoc = await this.db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        throw new Error(`User ${userId} not found`);
      }

      const userData = userDoc.data();
      const phoneNumber = userData.phone;

      if (!phoneNumber) {
        throw new Error(`No phone number found for user ${userId}`);
      }

      // Get notification template
      const template = this.templates[notificationType];
      if (!template) {
        throw new Error(`Unknown notification type: ${notificationType}`);
      }

      // Prepare SMS message
      const message = `${template.title}: ${template.body}`;
      
      // SMS fallback is disabled, FCM is the primary method
      console.warn('SMS fallback disabled, FCM is the primary notification method');
      throw new Error('SMS fallback is disabled. FCM is the primary notification method.');

      // Since SMS is disabled, we'll create an in-app notification instead
      await this.createInAppNotification(userId, notificationType, data, options);
      
      return {
        success: true,
        message: 'SMS fallback disabled, in-app notification created instead',
        data: { fallback: 'in_app' }
      };

    } catch (error) {
      console.error('SMS notification failed:', error);
      throw error;
    }
  }



  /**
   * Create in-app notification
   */
  async createInAppNotification(userId, notificationType, data = {}, options = {}) {
    try {
      // Get notification template
      const template = this.templates[notificationType];
      if (!template) {
        throw new Error(`Unknown notification type: ${notificationType}`);
      }

      // Create notification document
      const notificationData = {
        id: `notification_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        type: notificationType,
        title: options.title || template.title,
        message: options.body || template.body,
        icon: template.icon,
        priority: template.priority,
        data,
        isRead: false,
        isSent: true,
        createdAt: new Date(),
        readAt: null,
        sentAt: new Date()
      };

      // Save to database
      await this.db.collection('notifications').doc(notificationData.id).set(notificationData);
      
      // Log notification
      await this.logNotification(userId, 'in_app', notificationType, notificationData, data, { success: true });
      
      return {
        success: true,
        message: 'In-app notification created successfully',
        data: notificationData
      };

    } catch (error) {
      console.error('In-app notification creation failed:', error);
      throw error;
    }
  }

  /**
   * Send comprehensive notification (push + in-app + SMS fallback)
   */
  async sendComprehensiveNotification(userId, notificationType, data = {}, options = {}) {
    try {
      const results = {};

      // Send push notification
      try {
        results.push = await this.sendPushNotification(userId, notificationType, data, options);
      } catch (error) {
        console.log('Push notification failed, will try SMS fallback');
        results.push = { success: false, error: error.message };
      }

      // Create in-app notification
      try {
        results.inApp = await this.createInAppNotification(userId, notificationType, data, options);
      } catch (error) {
        console.log('In-app notification failed');
        results.inApp = { success: false, error: error.message };
      }

      // Send SMS if push failed and it's a critical notification
      if (!results.push.success && this.smsConfig.fallbackEnabled && 
          this.smsConfig.criticalNotifications.includes(notificationType)) {
        try {
          results.sms = await this.sendSMSNotification(userId, notificationType, data);
        } catch (error) {
          results.sms = { success: false, error: error.message };
        }
      }

      return {
        success: true,
        message: 'Comprehensive notification sent',
        data: results
      };

    } catch (error) {
      console.error('Comprehensive notification failed:', error);
      throw error;
    }
  }

  /**
   * Send notification to all users of a specific role
   */
  async sendNotificationToRole(role, notificationType, data = {}, options = {}) {
    try {
      // Get all users with the specified role
      const usersSnapshot = await this.db.collection('users')
        .where('userType', '==', role)
        .get();

      const userIds = usersSnapshot.docs.map(doc => doc.id);

      if (userIds.length === 0) {
        return {
          success: true,
          message: `No users found with role: ${role}`,
          data: { sentTo: 0 }
        };
      }

      // Send multicast notification
      const result = await this.sendMulticastNotification(userIds, notificationType, data, options);
      
      return {
        success: true,
        message: `Notification sent to ${userIds.length} ${role}s`,
        data: { ...result.data, sentTo: userIds.length }
      };

    } catch (error) {
      console.error(`Role-based notification failed for ${role}:`, error);
      throw error;
    }
  }

  /**
   * Send notification to users in a specific area
   */
  async sendNotificationToArea(center, radius, notificationType, data = {}, options = {}) {
    try {
      // Get users within the specified radius
      const usersSnapshot = await this.db.collection('users')
        .where('userType', '==', 'customer')
        .get();

      const usersInArea = [];
      
      for (const doc of usersSnapshot.docs) {
        const userData = doc.data();
        if (userData.currentLocation) {
          const distance = this.calculateDistance(
            center.latitude, center.longitude,
            userData.currentLocation.latitude, userData.currentLocation.longitude
          );
          
          if (distance <= radius) {
            usersInArea.push(doc.id);
          }
        }
      }

      if (usersInArea.length === 0) {
        return {
          success: true,
          message: 'No users found in the specified area',
          data: { sentTo: 0 }
        };
      }

      // Send multicast notification
      const result = await this.sendMulticastNotification(usersInArea, notificationType, data, options);
      
      return {
        success: true,
        message: `Notification sent to ${usersInArea.length} users in area`,
        data: { ...result.data, sentTo: usersInArea.length }
      };

    } catch (error) {
      console.error('Area-based notification failed:', error);
      throw error;
    }
  }

  /**
   * Schedule notification for future delivery
   */
  async scheduleNotification(userId, notificationType, scheduledTime, data = {}, options = {}) {
    try {
      const scheduledNotification = {
        id: `scheduled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        type: notificationType,
        scheduledTime: new Date(scheduledTime),
        data,
        options,
        status: 'scheduled',
        createdAt: new Date(),
        sentAt: null
      };

      // Save scheduled notification
      await this.db.collection('scheduledNotifications').doc(scheduledNotification.id).set(scheduledNotification);
      
      return {
        success: true,
        message: 'Notification scheduled successfully',
        data: scheduledNotification
      };

    } catch (error) {
      console.error('Notification scheduling failed:', error);
      throw error;
    }
  }

  /**
   * Process scheduled notifications
   */
  async processScheduledNotifications() {
    try {
      const now = new Date();
      
      // Get notifications that are due
      const scheduledSnapshot = await this.db.collection('scheduledNotifications')
        .where('status', '==', 'scheduled')
        .where('scheduledTime', '<=', now)
        .get();

      const results = [];
      
      for (const doc of scheduledSnapshot.docs) {
        const scheduled = doc.data();
        
        try {
          // Send the notification
          const result = await this.sendComprehensiveNotification(
            scheduled.userId,
            scheduled.type,
            scheduled.data,
            scheduled.options
          );
          
          // Update status
          await this.db.collection('scheduledNotifications').doc(doc.id).update({
            status: 'sent',
            sentAt: new Date(),
            result
          });
          
          results.push({
            id: doc.id,
            success: true,
            result
          });
          
        } catch (error) {
          // Update status to failed
          await this.db.collection('scheduledNotifications').doc(doc.id).update({
            status: 'failed',
            error: error.message,
            updatedAt: new Date()
          });
          
          results.push({
            id: doc.id,
            success: false,
            error: error.message
          });
        }
      }
      
      return {
        success: true,
        message: `Processed ${results.length} scheduled notifications`,
        data: { results }
      };

    } catch (error) {
      console.error('Scheduled notification processing failed:', error);
      throw error;
    }
  }

  /**
   * Enhanced user notification preferences with quiet hours
   */
  async getUserNotificationPreferences(userId) {
    try {
      const userDoc = await this.db.collection('users').doc(userId).get();
      if (!userDoc.exists) {
        throw new Error('User not found');
      }

      const userData = userDoc.data();
      const preferences = userData.notificationPreferences || this.getDefaultPreferences();

      // Ensure all preference fields exist
      const enhancedPreferences = {
        ...this.getDefaultPreferences(),
        ...preferences,
        quietHours: {
          ...this.getDefaultPreferences().quietHours,
          ...preferences.quietHours
        },
        channels: {
          ...this.getDefaultPreferences().channels,
          ...preferences.channels
        },
        types: {
          ...this.getDefaultPreferences().types,
          ...preferences.types
        }
      };

      return {
        success: true,
        data: enhancedPreferences
      };
    } catch (error) {
      console.error('Error getting user notification preferences:', error);
      throw error;
    }
  }

  /**
   * Get default notification preferences
   */
  getDefaultPreferences() {
    return {
      // Global notification settings
      enabled: true,
      language: 'en',
      timezone: 'UTC',
      
      // Channel preferences
      channels: {
        push: true,
        inApp: true,
        sms: false,
        email: false
      },
      
      // Notification type preferences
      types: {
        booking: true,
        payment: true,
        tracking: true,
        driver: true,
        system: false,
        marketing: false,
        emergency: true
      },
      
      // Quiet hours configuration
      quietHours: {
        enabled: false,
        startHour: 22, // 10 PM
        endHour: 6,    // 6 AM
        timezone: 'local',
        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },
      
      // Frequency controls
      frequency: {
        maxPerDay: 50,
        maxPerHour: 10,
        batchNotifications: true,
        cooldownMinutes: 5
      },
      
      // Priority settings
      priority: {
        high: true,
        medium: true,
        low: false
      },
      
      // Advanced settings
      advanced: {
        soundEnabled: true,
        vibrationEnabled: true,
        badgeEnabled: true,
        previewEnabled: true,
        groupNotifications: true,
        showOnLockScreen: true
      }
    };
  }

  /**
   * Update user notification preferences
   */
  async updateUserNotificationPreferences(userId, preferences) {
    try {
      const currentPreferences = await this.getUserNotificationPreferences(userId);
      const updatedPreferences = {
        ...currentPreferences.data,
        ...preferences,
        updatedAt: new Date()
      };

      // Validate preferences
      this.validatePreferences(updatedPreferences);

      await this.db.collection('users').doc(userId).update({
        notificationPreferences: updatedPreferences
      });

      // Log preference update
      await this.logNotification(userId, 'system', 'preferences_updated', {
        oldPreferences: currentPreferences.data,
        newPreferences: updatedPreferences
      }, { success: true });

      return {
        success: true,
        message: 'Notification preferences updated successfully',
        data: updatedPreferences
      };
    } catch (error) {
      console.error('Error updating user notification preferences:', error);
      throw error;
    }
  }

  /**
   * Validate notification preferences
   */
  validatePreferences(preferences) {
    const errors = [];

    // Validate quiet hours
    if (preferences.quietHours?.enabled) {
      if (typeof preferences.quietHours.startHour !== 'number' || 
          preferences.quietHours.startHour < 0 || 
          preferences.quietHours.startHour > 23) {
        errors.push('Invalid start hour for quiet hours');
      }
      if (typeof preferences.quietHours.endHour !== 'number' || 
          preferences.quietHours.endHour < 0 || 
          preferences.quietHours.endHour > 23) {
        errors.push('Invalid end hour for quiet hours');
      }
    }

    // Validate frequency limits
    if (preferences.frequency?.maxPerDay && preferences.frequency.maxPerDay > 100) {
      errors.push('Maximum daily notifications cannot exceed 100');
    }
    if (preferences.frequency?.maxPerHour && preferences.frequency.maxPerHour > 20) {
      errors.push('Maximum hourly notifications cannot exceed 20');
    }

    // Validate channel preferences
    if (Object.values(preferences.channels).every(channel => !channel)) {
      errors.push('At least one notification channel must be enabled');
    }

    if (errors.length > 0) {
      throw new Error(`Invalid preferences: ${errors.join(', ')}`);
    }
  }

  /**
   * Check if user is in quiet hours
   */
  isInQuietHours(userId, preferences = null) {
    try {
      if (!preferences) {
        // Get preferences from database if not provided
        return this.getUserNotificationPreferences(userId).then(prefs => 
          this.checkQuietHours(prefs.data.quietHours)
        );
      }
      
      return this.checkQuietHours(preferences.quietHours);
    } catch (error) {
      console.error('Error checking quiet hours:', error);
      return false;
    }
  }

  /**
   * Check if current time is within quiet hours
   */
  checkQuietHours(quietHours) {
    if (!quietHours || !quietHours.enabled) {
      return false;
    }

    const now = new Date();
    const currentHour = now.getHours();
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    
    // Check if current day is in quiet hours days
    if (!quietHours.days.includes(currentDay)) {
      return false;
    }

    const { startHour, endHour } = quietHours;

    if (startHour <= endHour) {
      // Same day (e.g., 22:00 to 06:00)
      return currentHour >= startHour || currentHour < endHour;
    } else {
      // Overnight (e.g., 22:00 to 06:00)
      return currentHour >= startHour || currentHour < endHour;
    }
  }

  /**
   * Enhanced notification sending with preference checks
   */
  async sendNotificationWithPreferences(userId, notificationType, data = {}, options = {}) {
    try {
      // Get user preferences
      const preferences = await this.getUserNotificationPreferences(userId);
      const userPrefs = preferences.data;

      // Check if notifications are enabled
      if (!userPrefs.enabled) {
        return {
          success: false,
          message: 'Notifications are disabled for this user',
          skipped: true
        };
      }

      // Check quiet hours
      if (this.checkQuietHours(userPrefs.quietHours)) {
        return {
          success: false,
          message: 'User is in quiet hours',
          skipped: true,
          reason: 'quiet_hours'
        };
      }

      // Check notification type preference
      if (!userPrefs.types[notificationType]) {
        return {
          success: false,
          message: `Notification type '${notificationType}' is disabled`,
          skipped: true,
          reason: 'type_disabled'
        };
      }

      // Check frequency limits
      const frequencyCheck = await this.checkFrequencyLimits(userId, userPrefs.frequency);
      if (!frequencyCheck.allowed) {
        return {
          success: false,
          message: 'Frequency limit exceeded',
          skipped: true,
          reason: 'frequency_limit',
          nextAllowed: frequencyCheck.nextAllowed
        };
      }

      // Determine enabled channels
      const enabledChannels = this.getEnabledChannels(userPrefs.channels, options.channels);
      if (enabledChannels.length === 0) {
        return {
          success: false,
          message: 'No enabled notification channels',
          skipped: true,
          reason: 'no_channels'
        };
      }

      // Send notifications through enabled channels
      const results = {};
      
      for (const channel of enabledChannels) {
        try {
          switch (channel) {
            case 'push':
              if (userPrefs.channels.push) {
                results.push = await this.sendPushNotification(userId, notificationType, data, options);
              }
              break;
            case 'in_app':
              if (userPrefs.channels.inApp) {
                results.in_app = await this.createInAppNotification(userId, notificationType, data, options);
              }
              break;
            case 'sms':
              if (userPrefs.channels.sms) {
                results.sms = await this.sendSMSNotification(userId, notificationType, data);
              }
              break;
            case 'email':
              if (userPrefs.channels.email) {
                results.email = await this.sendEmailNotification(userId, notificationType, data, options);
              }
              break;
          }
        } catch (error) {
          console.error(`Failed to send ${channel} notification:`, error);
          results[channel] = { error: error.message };
        }
      }

      // Update frequency tracking
      await this.updateFrequencyTracking(userId, notificationType);

      return {
        success: true,
        message: 'Notifications sent successfully',
        data: results,
        channels: enabledChannels
      };

    } catch (error) {
      console.error('Error sending notification with preferences:', error);
      throw error;
    }
  }

  /**
   * Check frequency limits for user
   */
  async checkFrequencyLimits(userId, frequencyPrefs) {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Check hourly limit
      const hourlyCount = await this.db
        .collection('notificationLogs')
        .where('userId', '==', userId)
        .where('timestamp', '>=', oneHourAgo)
        .count()
        .get();

      if (hourlyCount.data().count >= (frequencyPrefs.maxPerHour || 10)) {
        const nextAllowed = new Date(oneHourAgo.getTime() + 60 * 60 * 1000);
        return { allowed: false, nextAllowed };
      }

      // Check daily limit
      const dailyCount = await this.db
        .collection('notificationLogs')
        .where('userId', '==', userId)
        .where('timestamp', '>=', oneDayAgo)
        .count()
        .get();

      if (dailyCount.data().count >= (frequencyPrefs.maxPerDay || 50)) {
        const nextAllowed = new Date(oneDayAgo.getTime() + 24 * 60 * 60 * 1000);
        return { allowed: false, nextAllowed };
      }

      return { allowed: true };
    } catch (error) {
      console.error('Error checking frequency limits:', error);
      return { allowed: true }; // Allow if check fails
    }
  }

  /**
   * Get enabled channels based on user preferences and options
   */
  getEnabledChannels(userChannels, requestedChannels = null) {
    const enabledChannels = [];
    
    if (requestedChannels) {
      // Use requested channels if specified
      requestedChannels.forEach(channel => {
        if (userChannels[channel]) {
          enabledChannels.push(channel);
        }
      });
    } else {
      // Use all enabled user channels
      Object.entries(userChannels).forEach(([channel, enabled]) => {
        if (enabled) {
          enabledChannels.push(channel);
        }
      });
    }

    return enabledChannels;
  }

  /**
   * Update frequency tracking
   */
  async updateFrequencyTracking(userId, notificationType) {
    try {
      await this.db.collection('notificationLogs').add({
        userId: userId,
        type: notificationType,
        timestamp: new Date(),
        channel: 'all'
      });
    } catch (error) {
      console.error('Error updating frequency tracking:', error);
    }
  }

  /**
   * Send email notification (placeholder for future implementation)
   */
  async sendEmailNotification(userId, notificationType, data, options) {
    // TODO: Implement email service integration
    console.log(`Email notification would be sent to user ${userId}:`, data);
    return { status: 'not_implemented', message: 'Email service not yet implemented' };
  }

  /**
   * Get user's notifications
   */
  async getUserNotifications(userId, options = {}) {
    try {
      const { limit = 50, offset = 0, unreadOnly = false, type = null } = options;
      
      let query = this.db.collection('notifications')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .offset(offset);

      if (unreadOnly) {
        query = query.where('isRead', '==', false);
      }

      if (type) {
        query = query.where('type', '==', type);
      }

      const snapshot = await query.get();
      
      const notifications = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return {
        success: true,
        data: {
          notifications,
          total: notifications.length,
          hasMore: notifications.length === limit
        }
      };

    } catch (error) {
      console.error('Failed to get user notifications:', error);
      throw error;
    }
  }

  /**
   * Mark notification as read
   */
  async markNotificationAsRead(userId, notificationId) {
    try {
      await this.db.collection('notifications').doc(notificationId).update({
        isRead: true,
        readAt: new Date()
      });
      
      return {
        success: true,
        message: 'Notification marked as read'
      };

    } catch (error) {
      console.error('Failed to mark notification as read:', error);
      throw error;
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsAsRead(userId) {
    try {
      const batch = this.db.batch();
      
      const snapshot = await this.db.collection('notifications')
        .where('userId', '==', userId)
        .where('isRead', '==', false)
        .get();

      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, {
          isRead: true,
          readAt: new Date()
        });
      });

      await batch.commit();
      
      return {
        success: true,
        message: `${snapshot.docs.length} notifications marked as read`
      };

    } catch (error) {
      console.error('Failed to mark all notifications as read:', error);
      throw error;
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(userId, notificationId) {
    try {
      await this.db.collection('notifications').doc(notificationId).delete();
      
      return {
        success: true,
        message: 'Notification deleted successfully'
      };

    } catch (error) {
      console.error('Failed to delete notification:', error);
      throw error;
    }
  }

  /**
   * Get notification statistics
   */
  async getNotificationStatistics(userId = null, timeRange = {}) {
    try {
      const { startDate, endDate } = timeRange;
      let query = this.db.collection('notifications');
      
      if (userId) {
        query = query.where('userId', '==', userId);
      }
      
      if (startDate) {
        query = query.where('createdAt', '>=', new Date(startDate));
      }
      
      if (endDate) {
        query = query.where('createdAt', '<=', new Date(endDate));
      }

      const snapshot = await query.get();
      
      const notifications = snapshot.docs.map(doc => doc.data());
      
      const stats = {
        total: notifications.length,
        byType: {},
        byStatus: {
          read: 0,
          unread: 0
        },
        byChannel: {
          push: 0,
          inApp: 0,
          sms: 0
        }
      };

      notifications.forEach(notification => {
        // Count by type
        stats.byType[notification.type] = (stats.byType[notification.type] || 0) + 1;
        
        // Count by status
        if (notification.isRead) {
          stats.byStatus.read++;
        } else {
          stats.byStatus.unread++;
        }
      });

      return {
        success: true,
        data: stats
      };

    } catch (error) {
      console.error('Failed to get notification statistics:', error);
      throw error;
    }
  }

  /**
   * Log notification for analytics
   */
  async logNotification(userId, channel, type, notification, data, result) {
    try {
      const logEntry = {
        userId,
        channel,
        type,
        notification,
        data,
        result,
        timestamp: new Date(),
        success: result.success || false
      };

      await this.db.collection('notificationLogs').add(logEntry);
      
    } catch (error) {
      console.error('Failed to log notification:', error);
      // Don't throw error as this is not critical
    }
  }

  /**
   * Log notification for topic analytics
   */
  async logTopicNotification(topic, type, notification, data, result) {
    try {
      const logEntry = {
        topic,
        type,
        notification,
        data,
        result,
        timestamp: new Date(),
        success: result.success || false
      };

      await this.db.collection('topicNotificationLogs').add(logEntry);
      
    } catch (error) {
      console.error('Failed to log topic notification:', error);
      // Don't throw error as this is not critical
    }
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Clean up old notification logs
   */
  async cleanupOldLogs(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 days
    try {
      const cutoffDate = new Date(Date.now() - maxAge);
      
      const snapshot = await this.db.collection('notificationLogs')
        .where('timestamp', '<', cutoffDate)
        .get();

      const batch = this.db.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      
      return {
        success: true,
        message: `Cleaned up ${snapshot.docs.length} old notification logs`
      };

    } catch (error) {
      console.error('Failed to cleanup old logs:', error);
      throw error;
    }
  }

  /**
   * Enhanced FCM Methods
   */

  /**
   * Clean up expired FCM tokens
   */
  async cleanupExpiredFCMTokens() {
    try {
      const maxAge = this.fcmConfig.maxTokenAge * 24 * 60 * 60 * 1000; // Convert days to milliseconds
      const cutoffDate = new Date(Date.now() - maxAge);
      
      const snapshot = await this.db.collection('fcmTokens')
        .where('lastUsed', '<', cutoffDate)
        .where('isActive', '==', true)
        .get();

      const batch = this.db.batch();
      const expiredTokens = [];

      for (const doc of snapshot.docs) {
        const tokenData = doc.data();
        
        // Mark token as expired
        batch.update(doc.ref, {
          isActive: false,
          expiredAt: new Date().toISOString(),
          removalReason: 'token_expired'
        });

        // Remove token from user document
        batch.update(this.db.collection('users').doc(doc.id), {
          fcmToken: null,
          fcmTokenStatus: 'expired',
          fcmTokenUpdatedAt: new Date().toISOString()
        });

        expiredTokens.push(doc.id);
      }

      if (expiredTokens.length > 0) {
        await batch.commit();
        console.log(`Cleaned up ${expiredTokens.length} expired FCM tokens`);
      }
      
      return {
        success: true,
        message: `Cleaned up ${expiredTokens.length} expired FCM tokens`,
        data: { expiredTokens }
      };

    } catch (error) {
      console.error('Failed to cleanup expired FCM tokens:', error);
      throw error;
    }
  }

  /**
   * Get FCM token analytics
   */
  async getFCMTokenAnalytics() {
    try {
      const tokensSnapshot = await this.db.collection('fcmTokens').get();
      const tokens = tokensSnapshot.docs.map(doc => doc.data());
      
      const analytics = {
        total: tokens.length,
        active: tokens.filter(t => t.isActive).length,
        inactive: tokens.filter(t => !t.isActive).length,
        byPlatform: {},
        byAppVersion: {},
        averageValidationCount: 0,
        recentlyUsed: 0,
        recentlyValidated: 0
      };

      const now = new Date();
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      tokens.forEach(token => {
        // Count by platform
        const platform = token.deviceInfo?.platform || 'unknown';
        analytics.byPlatform[platform] = (analytics.byPlatform[platform] || 0) + 1;

        // Count by app version
        const appVersion = token.deviceInfo?.appVersion || 'unknown';
        analytics.byAppVersion[appVersion] = (analytics.byAppVersion[appVersion] || 0) + 1;

        // Count recently used
        if (token.lastUsed && new Date(token.lastUsed) > oneWeekAgo) {
          analytics.recentlyUsed++;
        }

        // Count recently validated
        if (token.lastValidated && new Date(token.lastValidated) > oneWeekAgo) {
          analytics.recentlyValidated++;
        }
      });

      // Calculate average validation count
      const totalValidations = tokens.reduce((sum, token) => sum + (token.validationCount || 0), 0);
      analytics.averageValidationCount = tokens.length > 0 ? totalValidations / tokens.length : 0;

      return {
        success: true,
        data: analytics
      };

    } catch (error) {
      console.error('Failed to get FCM token analytics:', error);
      throw error;
    }
  }

  /**
   * Refresh FCM tokens for users
   */
  async refreshFCMTokens() {
    try {
      if (!this.fcmConfig.enableTokenRefresh) {
        throw new Error('FCM token refresh is disabled');
      }

      const validationInterval = this.fcmConfig.tokenValidationInterval * 60 * 60 * 1000; // Convert hours to milliseconds
      const cutoffDate = new Date(Date.now() - validationInterval);
      
      const snapshot = await this.db.collection('fcmTokens')
        .where('lastValidated', '<', cutoffDate)
        .where('isActive', '==', true)
        .get();

      const results = [];
      
      for (const doc of snapshot.docs) {
        const tokenData = doc.data();
        
        try {
          // Validate token
          const isValid = await this.validateFCMToken(tokenData.fcmToken);
          
          if (!isValid) {
            // Token is invalid, mark as inactive
            await this.removeFCMToken(doc.id);
            results.push({
              userId: doc.id,
              status: 'invalid',
              action: 'removed'
            });
          } else {
            // Token is valid, update validation timestamp
            await doc.ref.update({
              lastValidated: new Date().toISOString()
            });
            results.push({
              userId: doc.id,
              status: 'valid',
              action: 'refreshed'
            });
          }
        } catch (error) {
          console.log(`Error refreshing token for user ${doc.id}:`, error.message);
          results.push({
            userId: doc.id,
            status: 'error',
            action: 'none',
            error: error.message
          });
        }
      }
      
      return {
        success: true,
        message: `Refreshed ${results.length} FCM tokens`,
        data: { results }
      };

    } catch (error) {
      console.error('Failed to refresh FCM tokens:', error);
      throw error;
    }
  }

  /**
   * Send notification to FCM topic with user filtering
   */
  async sendNotificationToTopicWithFilter(topic, notificationType, data = {}, options = {}, userFilter = {}) {
    try {
      // Get users that match the filter criteria
      let query = this.db.collection('users');
      
      // Apply filters
      if (userFilter.userType) {
        query = query.where('userType', '==', userFilter.userType);
      }
      
      if (userFilter.location) {
        // Location-based filtering would require geospatial queries
        // For now, we'll use the basic topic notification
        console.log('Location-based filtering not yet implemented, using basic topic notification');
      }

      const usersSnapshot = await query.get();
      const userIds = usersSnapshot.docs.map(doc => doc.id);

      if (userIds.length === 0) {
        return {
          success: true,
          message: 'No users match the filter criteria',
          data: { sentTo: 0 }
        };
      }

      // Send to filtered users
      const result = await this.sendMulticastNotification(userIds, notificationType, data, options);
      
      return {
        success: true,
        message: `Filtered topic notification sent to ${userIds.length} users`,
        data: { ...result.data, topic, filter: userFilter }
      };

    } catch (error) {
      console.error('Filtered topic notification failed:', error);
      throw error;
    }
  }

  /**
   * Get FCM delivery statistics
   */
  async getFCMDeliveryStatistics(timeRange = {}) {
    try {
      const { startDate, endDate } = timeRange;
      let query = this.db.collection('notificationLogs')
        .where('channel', '==', 'push');
      
      if (startDate) {
        query = query.where('timestamp', '>=', new Date(startDate));
      }
      
      if (endDate) {
        query = query.where('timestamp', '<=', new Date(endDate));
      }

      const snapshot = await query.get();
      const logs = snapshot.docs.map(doc => doc.data());
      
      const stats = {
        total: logs.length,
        successful: logs.filter(log => log.success).length,
        failed: logs.filter(log => !log.success).length,
        byType: {},
        byHour: {},
        averageDeliveryTime: 0
      };

      logs.forEach(log => {
        // Count by type
        stats.byType[log.type] = (stats.byType[log.type] || 0) + 1;
        
        // Count by hour
        const hour = new Date(log.timestamp).getHours();
        stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;
      });

      // Calculate success rate
      stats.successRate = logs.length > 0 ? (stats.successful / logs.length) * 100 : 0;

      return {
        success: true,
        data: stats
      };

    } catch (error) {
      console.error('Failed to get FCM delivery statistics:', error);
      throw error;
    }
  }

  /**
   * Optimize FCM topic subscriptions
   */
  async optimizeFCMTopicSubscriptions() {
    try {
      if (!this.fcmConfig.enableTopicOptimization) {
        throw new Error('FCM topic optimization is disabled');
      }

      const usersSnapshot = await this.db.collection('users').get();
      const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      const topicStats = {};
      const optimizationResults = [];

      // Analyze topic usage
      for (const user of users) {
        const subscribedTopics = user.subscribedTopics || [];
        subscribedTopics.forEach(topic => {
          topicStats[topic] = (topicStats[topic] || 0) + 1;
        });
      }

      // Find underutilized topics
      const underutilizedTopics = Object.entries(topicStats)
        .filter(([topic, count]) => count < 5) // Topics with less than 5 subscribers
        .map(([topic]) => topic);

      // Unsubscribe users from underutilized topics
      for (const topic of underutilizedTopics) {
        const usersWithTopic = users.filter(user => 
          (user.subscribedTopics || []).includes(topic)
        );

        for (const user of usersWithTopic) {
          try {
            await this.unsubscribeUserFromTopics(user.id, [topic]);
            optimizationResults.push({
              userId: user.id,
              topic,
              action: 'unsubscribed',
              reason: 'underutilized'
            });
          } catch (error) {
            console.log(`Error unsubscribing user ${user.id} from topic ${topic}:`, error.message);
          }
        }
      }

      return {
        success: true,
        message: `Optimized FCM topic subscriptions`,
        data: {
          topicStats,
          underutilizedTopics,
          optimizationResults
        }
      };

    } catch (error) {
      console.error('Failed to optimize FCM topic subscriptions:', error);
      throw error;
    }
  }

  /**
   * Health check for FCM service
   */
  async checkFCMHealth() {
    try {
      const health = {
        fcmEnabled: this.fcmConfig.enabled,
        fcmInstance: !!this.fcm,
        tokenCount: 0,
        activeTokenCount: 0,
        lastValidation: null,
        status: 'healthy'
      };

      if (!this.fcmConfig.enabled) {
        health.status = 'disabled';
        return { success: true, data: health };
      }

      // Get token statistics
      const tokenAnalytics = await this.getFCMTokenAnalytics();
      health.tokenCount = tokenAnalytics.data.total;
      health.activeTokenCount = tokenAnalytics.data.active;

      // Check FCM instance
      try {
        await this.fcm.send({
          token: 'test_token',
          notification: { title: 'Health Check', body: 'Test' }
        });
        health.fcmInstance = true;
      } catch (error) {
        if (error.code === 'messaging/invalid-registration-token') {
          // This is expected for a test token
          health.fcmInstance = true;
        } else {
          health.fcmInstance = false;
          health.status = 'unhealthy';
        }
      }

      return {
        success: true,
        data: health
      };

    } catch (error) {
      console.error('FCM health check failed:', error);
      return {
        success: false,
        data: {
          status: 'error',
          error: error.message
        }
      };
    }
  }
}

module.exports = NotificationService;
