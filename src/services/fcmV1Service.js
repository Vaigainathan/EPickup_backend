const admin = require('firebase-admin');

/**
 * FCM v1 API Service for EPickup Platform
 * Uses Google Service Account authentication instead of legacy server key
 */
class FCMV1Service {
  constructor() {
    this.messaging = null;
    this.isInitialized = false;
  }

  /**
   * Initialize FCM v1 API
   */
  initialize() {
    try {
      // Use existing Firebase instance if available
      if (admin.apps.length > 0) {
        this.messaging = admin.messaging();
        this.isInitialized = true;
        console.log('✅ FCM v1 API initialized using existing Firebase instance');
        return;
      }

      // Fallback: Initialize Firebase if not already done
      const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
      
      if (!require('fs').existsSync(serviceAccountPath)) {
        console.warn(`⚠️  FCM Service Account file not found at: ${serviceAccountPath}`);
        return; // Don't throw error, just return
      }

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
        projectId: process.env.FIREBASE_PROJECT_ID
      });

      this.messaging = admin.messaging();
      this.isInitialized = true;
      
      console.log('✅ FCM v1 API initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize FCM v1 API:', error.message);
      // Don't throw error, just log it
      this.isInitialized = false;
    }
  }

  /**
   * Send notification to a single device
   */
  async sendToDevice(token, notification, data = {}, options = {}) {
    this.ensureInitialized();

    const message = {
      token,
      notification: {
        title: notification.title,
        body: notification.body,
        ...notification
      },
      data: data,
      android: {
        priority: options.priority || 'high',
        notification: {
          channelId: options.channelId || 'epickup_channel',
          notification_priority: options.priority === 'high' ? 'PRIORITY_HIGH' : 'PRIORITY_DEFAULT',
          defaultSound: true,
          defaultVibrateTimings: true,
          icon: options.icon || 'ic_notification',
          color: options.color || '#FF6B35'
        },
        ttl: options.ttl || 86400
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: options.badge || 1,
            category: options.category || 'epickup_notification'
          }
        },
        headers: {
          'apns-priority': '10'
        }
      },
      webpush: {
        headers: {
          TTL: options.ttl || 86400,
          priority: 'high'
        }
      }
    };

    try {
      const response = await this.messaging.send(message);
      console.log('✅ FCM v1 notification sent successfully:', response);
      return { success: true, messageId: response };
    } catch (error) {
      console.error('❌ FCM v1 notification failed:', error.message);
      throw error;
    }
  }

  /**
   * Send notification to multiple devices
   */
  async sendToMultipleDevices(tokens, notification, data = {}, options = {}) {
    this.ensureInitialized();

    const message = {
      notification: {
        title: notification.title,
        body: notification.body,
        ...notification
      },
      data: data,
      android: {
        priority: options.priority || 'high',
        notification: {
          channelId: options.channelId || 'epickup_channel',
          notification_priority: options.priority === 'high' ? 'PRIORITY_HIGH' : 'PRIORITY_DEFAULT',
          defaultSound: true,
          defaultVibrateTimings: true,
          icon: options.icon || 'ic_notification',
          color: options.color || '#FF6B35'
        },
        ttl: options.ttl || 86400
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: options.badge || 1,
            category: options.category || 'epickup_notification'
          }
        },
        headers: {
          'apns-priority': '10'
        }
      },
      webpush: {
        headers: {
          TTL: options.ttl || 86400,
          priority: 'high'
        }
      }
    };

    try {
      const response = await this.messaging.sendMulticast({
        tokens: tokens,
        ...message
      });

      console.log(`✅ FCM v1 multicast sent: ${response.successCount}/${tokens.length} successful`);
      
      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount,
        responses: response.responses
      };
    } catch (error) {
      console.error('❌ FCM v1 multicast failed:', error.message);
      throw error;
    }
  }

  /**
   * Send notification to a topic
   */
  async sendToTopic(topic, notification, data = {}, options = {}) {
    this.ensureInitialized();

    const message = {
      topic: topic,
      notification: {
        title: notification.title,
        body: notification.body,
        ...notification
      },
      data: data,
      android: {
        priority: options.priority || 'high',
        notification: {
          channelId: options.channelId || 'epickup_channel',
          notification_priority: options.priority === 'high' ? 'PRIORITY_HIGH' : 'PRIORITY_DEFAULT',
          defaultSound: true,
          defaultVibrateTimings: true,
          icon: options.icon || 'ic_notification',
          color: options.color || '#FF6B35'
        },
        ttl: options.ttl || 86400
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: options.badge || 1,
            category: options.category || 'epickup_notification'
          }
        },
        headers: {
          'apns-priority': '10'
        }
      },
      webpush: {
        headers: {
          TTL: options.ttl || 86400,
          priority: 'high'
        }
      }
    };

    try {
      const response = await this.messaging.send(message);
      console.log('✅ FCM v1 topic notification sent successfully:', response);
      return { success: true, messageId: response };
    } catch (error) {
      console.error('❌ FCM v1 topic notification failed:', error.message);
      throw error;
    }
  }

  /**
   * Subscribe tokens to a topic
   */
  async subscribeToTopic(tokens, topic) {
    this.ensureInitialized();
    
    try {
      const response = await this.messaging.subscribeToTopic(tokens, topic);
      console.log(`✅ Subscribed ${tokens.length} tokens to topic: ${topic}`);
      return { success: true, response };
    } catch (error) {
      console.error('❌ Failed to subscribe to topic:', error.message);
      throw error;
    }
  }

  /**
   * Unsubscribe tokens from a topic
   */
  async unsubscribeFromTopic(tokens, topic) {
    this.ensureInitialized();
    
    try {
      const response = await this.messaging.unsubscribeFromTopic(tokens, topic);
      console.log(`✅ Unsubscribed ${tokens.length} tokens from topic: ${topic}`);
      return { success: true, response };
    } catch (error) {
      console.error('❌ Failed to unsubscribe from topic:', error.message);
      throw error;
    }
  }

  /**
   * Validate FCM token
   */
  async validateToken(token) {
    this.ensureInitialized();
    
    try {
      // Try to send a test message to validate token
      const testMessage = {
        token,
        data: {
          test: 'validation'
        }
      };
      
      const response = await this.messaging.send(testMessage);
      return { valid: true, messageId: response };
    } catch (error) {
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        return { valid: false, error: error.message };
      }
      throw error;
    }
  }

  /**
   * Ensure service is initialized
   */
  ensureInitialized() {
    if (!this.isInitialized) {
      this.initialize();
    }
    
    // If still not initialized after trying, throw a more helpful error
    if (!this.isInitialized) {
      throw new Error('FCM service is not available. Check Firebase configuration.');
    }
  }

  /**
   * Get health status
   */
  async getHealthStatus() {
    try {
      this.ensureInitialized();
      return {
        status: 'healthy',
        service: 'FCM v1 API',
        initialized: this.isInitialized,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        service: 'FCM v1 API',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = FCMV1Service;
