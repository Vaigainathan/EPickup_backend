const admin = require('firebase-admin');
const { getFirestore } = require('./firebase');
const { NotificationBuilder, NotificationTemplateProcessor } = require('./notificationTemplates');

/**
 * Push Notification Service for EPickup
 * Handles Firebase Cloud Messaging for real-time notifications
 */
class NotificationService {
  constructor() {
    this.db = getFirestore();
    this.messaging = admin.messaging();
  }

  /**
   * Send notification to specific user
   * @param {string} userId - User ID
   * @param {Object} notification - Notification data
   * @returns {Object} Send result
   */
  async sendToUser(userId, notification) {
    try {
      // Get user's FCM token
      const userDoc = await this.db.collection('users').doc(userId).get();
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
      if (!userData.fcmToken) {
        return {
          success: false,
          error: {
            code: 'NO_FCM_TOKEN',
            message: 'User has no FCM token'
          }
        };
      }

      // Send notification
      const message = {
        token: userData.fcmToken,
        notification: {
          title: notification.title,
          body: notification.body
        },
        data: {
          type: notification.type,
          bookingId: notification.bookingId || '',
          driverId: notification.driverId || '',
          paymentId: notification.paymentId || '',
          timestamp: new Date().toISOString()
        },
        android: {
          notification: {
            sound: 'default',
            priority: 'high',
            channelId: 'epickup_notifications'
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

      const response = await this.messaging.send(message);

      // Save notification to database
      await this.saveNotification(userId, notification, 'sent');

      return {
        success: true,
        messageId: response,
        data: {
          userId,
          notification,
          sentAt: new Date()
        }
      };
    } catch (error) {
      console.error('Send notification error:', error);
      
      // Save failed notification to database
      await this.saveNotification(userId, notification, 'failed', error.message);

      return {
        success: false,
        error: {
          code: 'NOTIFICATION_SEND_ERROR',
          message: 'Failed to send notification',
          details: error.message
        }
      };
    }
  }

  /**
   * Send notification to multiple users
   * @param {Array} userIds - Array of user IDs
   * @param {Object} notification - Notification data
   * @returns {Object} Send result
   */
  async sendToMultipleUsers(userIds, notification) {
    try {
      const results = [];
      const promises = userIds.map(userId => this.sendToUser(userId, notification));
      
      const responses = await Promise.allSettled(promises);
      
      responses.forEach((response, index) => {
        if (response.status === 'fulfilled') {
          results.push({
            userId: userIds[index],
            success: response.value.success,
            data: response.value.data,
            error: response.value.error
          });
        } else {
          results.push({
            userId: userIds[index],
            success: false,
            error: {
              code: 'PROMISE_REJECTED',
              message: response.reason
            }
          });
        }
      });

      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return {
        success: true,
        data: {
          results,
          summary: {
            total: userIds.length,
            successful,
            failed
          }
        }
      };
    } catch (error) {
      console.error('Send to multiple users error:', error);
      return {
        success: false,
        error: {
          code: 'BULK_NOTIFICATION_ERROR',
          message: 'Failed to send bulk notifications',
          details: error.message
        }
      };
    }
  }

  /**
   * Send notification to topic subscribers
   * @param {string} topic - Topic name
   * @param {Object} notification - Notification data
   * @returns {Object} Send result
   */
  async sendToTopic(topic, notification) {
    try {
      const message = {
        topic,
        notification: {
          title: notification.title,
          body: notification.body
        },
        data: {
          type: notification.type,
          bookingId: notification.bookingId || '',
          timestamp: new Date().toISOString()
        },
        android: {
          notification: {
            sound: 'default',
            priority: 'high',
            channelId: 'epickup_notifications'
          }
        }
      };

      const response = await this.messaging.send(message);

      return {
        success: true,
        messageId: response,
        data: {
          topic,
          notification,
          sentAt: new Date()
        }
      };
    } catch (error) {
      console.error('Send to topic error:', error);
      return {
        success: false,
        error: {
          code: 'TOPIC_NOTIFICATION_ERROR',
          message: 'Failed to send topic notification',
          details: error.message
        }
      };
    }
  }

  /**
   * Subscribe user to topic
   * @param {string} userId - User ID
   * @param {string} topic - Topic name
   * @returns {Object} Subscription result
   */
  async subscribeToTopic(userId, topic) {
    try {
      const userDoc = await this.db.collection('users').doc(userId).get();
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
      if (!userData.fcmToken) {
        return {
          success: false,
          error: {
            code: 'NO_FCM_TOKEN',
            message: 'User has no FCM token'
          }
        };
      }

      const response = await this.messaging.subscribeToTopic([userData.fcmToken], topic);

      // Update user's subscribed topics
      await this.db.collection('users').doc(userId).update({
        subscribedTopics: admin.firestore.FieldValue.arrayUnion(topic),
        updatedAt: new Date()
      });

      return {
        success: true,
        data: {
          userId,
          topic,
          successCount: response.successCount,
          failureCount: response.failureCount
        }
      };
    } catch (error) {
      console.error('Subscribe to topic error:', error);
      return {
        success: false,
        error: {
          code: 'TOPIC_SUBSCRIPTION_ERROR',
          message: 'Failed to subscribe to topic',
          details: error.message
        }
      };
    }
  }

  /**
   * Unsubscribe user from topic
   * @param {string} userId - User ID
   * @param {string} topic - Topic name
   * @returns {Object} Unsubscription result
   */
  async unsubscribeFromTopic(userId, topic) {
    try {
      const userDoc = await this.db.collection('users').doc(userId).get();
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
      if (!userData.fcmToken) {
        return {
          success: false,
          error: {
            code: 'NO_FCM_TOKEN',
            message: 'User has no FCM token'
          }
        };
      }

      const response = await this.messaging.unsubscribeFromTopic([userData.fcmToken], topic);

      // Update user's subscribed topics
      await this.db.collection('users').doc(userId).update({
        subscribedTopics: admin.firestore.FieldValue.arrayRemove(topic),
        updatedAt: new Date()
      });

      return {
        success: true,
        data: {
          userId,
          topic,
          successCount: response.successCount,
          failureCount: response.failureCount
        }
      };
    } catch (error) {
      console.error('Unsubscribe from topic error:', error);
      return {
        success: false,
        error: {
          code: 'TOPIC_UNSUBSCRIPTION_ERROR',
          message: 'Failed to unsubscribe from topic',
          details: error.message
        }
      };
    }
  }

  /**
   * Save notification to database
   * @param {string} userId - User ID
   * @param {Object} notification - Notification data
   * @param {string} status - Notification status
   * @param {string} errorMessage - Error message if failed
   */
  async saveNotification(userId, notification, status, errorMessage = null) {
    try {
      await this.db.collection('notifications').add({
        userId,
        title: notification.title,
        body: notification.body,
        type: notification.type,
        bookingId: notification.bookingId || null,
        driverId: notification.driverId || null,
        paymentId: notification.paymentId || null,
        status,
        errorMessage,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Save notification error:', error);
    }
  }

  /**
   * Send booking status notification
   * @param {string} userId - User ID
   * @param {string} bookingId - Booking ID
   * @param {string} status - Booking status
   * @param {Object} bookingData - Booking data
   * @returns {Object} Send result
   */
  async sendBookingStatusNotification(userId, bookingId, status, bookingData = {}) { // eslint-disable-line no-unused-vars
    const statusMessages = {
      'confirmed': {
        title: 'Booking Confirmed',
        body: 'Your booking has been confirmed and is being processed.'
      },
      'assigned': {
        title: 'Driver Assigned',
        body: 'A driver has been assigned to your booking.'
      },
      'picked_up': {
        title: 'Package Picked Up',
        body: 'Your package has been picked up and is on its way.'
      },
      'delivering': {
        title: 'Out for Delivery',
        body: 'Your package is out for delivery.'
      },
      'delivered': {
        title: 'Package Delivered',
        body: 'Your package has been successfully delivered.'
      },
      'cancelled': {
        title: 'Booking Cancelled',
        body: 'Your booking has been cancelled.'
      }
    };

    const message = statusMessages[status] || {
      title: 'Booking Update',
      body: `Your booking status has been updated to ${status}.`
    };

    return await this.sendToUser(userId, {
      ...message,
      type: 'booking_status',
      bookingId
    });
  }

  /**
   * Send payment status notification
   * @param {string} userId - User ID
   * @param {string} paymentId - Payment ID
   * @param {string} status - Payment status
   * @param {Object} paymentData - Payment data
   * @returns {Object} Send result
   */
  async sendPaymentStatusNotification(userId, paymentId, status, paymentData = {}) { // eslint-disable-line no-unused-vars
    const statusMessages = {
      'completed': {
        title: 'Payment Successful',
        body: 'Your payment has been processed successfully.'
      },
      'failed': {
        title: 'Payment Failed',
        body: 'Your payment has failed. Please try again.'
      },
      'refunded': {
        title: 'Payment Refunded',
        body: 'Your payment has been refunded.'
      }
    };

    const message = statusMessages[status] || {
      title: 'Payment Update',
      body: `Your payment status has been updated to ${status}.`
    };

    return await this.sendToUser(userId, {
      ...message,
      type: 'payment_status',
      paymentId
    });
  }

  /**
   * Send driver assignment notification
   * @param {string} driverId - Driver ID
   * @param {string} bookingId - Booking ID
   * @param {Object} bookingData - Booking data
   * @returns {Object} Send result
   */
  async sendDriverAssignmentNotification(driverId, bookingId, bookingData = {}) { // eslint-disable-line no-unused-vars
    return await this.sendToUser(driverId, {
      title: 'New Booking Assigned',
      body: `You have been assigned a new booking (${bookingId}).`,
      type: 'driver_assignment',
      bookingId
    });
  }

  /**
   * Send driver location update notification
   * @param {string} customerId - Customer ID
   * @param {string} bookingId - Booking ID
   * @param {Object} locationData - Location data
   * @returns {Object} Send result
   */
  async sendDriverLocationNotification(customerId, bookingId, locationData = {}) { // eslint-disable-line no-unused-vars
    return await this.sendToUser(customerId, {
      title: 'Driver Location Update',
      body: 'Your driver\'s location has been updated.',
      type: 'driver_location',
      bookingId
    });
  }

  /**
   * Send promotional notification
   * @param {Array} userIds - Array of user IDs
   * @param {Object} promotionalData - Promotional data
   * @returns {Object} Send result
   */
  async sendPromotionalNotification(userIds, promotionalData) {
    return await this.sendToMultipleUsers(userIds, {
      title: promotionalData.title,
      body: promotionalData.body,
      type: 'promotional',
      ...promotionalData
    });
  }

  /**
   * Get user's notification history
   * @param {string} userId - User ID
   * @param {Object} filters - Filter options
   * @returns {Object} Notification history
   */
  async getNotificationHistory(userId, filters = {}) {
    try {
      let query = this.db.collection('notifications').where('userId', '==', userId);

      if (filters.type) {
        query = query.where('type', '==', filters.type);
      }

      if (filters.status) {
        query = query.where('status', '==', filters.status);
      }

      query = query.orderBy('createdAt', 'desc');

      if (filters.limit) {
        query = query.limit(filters.limit);
      }

      if (filters.offset) {
        query = query.offset(filters.offset);
      }

      const snapshot = await query.get();
      const notifications = [];

      snapshot.forEach(doc => {
        notifications.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return {
        success: true,
        data: {
          notifications,
          total: notifications.length
        }
      };
    } catch (error) {
      console.error('Get notification history error:', error);
      return {
        success: false,
        error: {
          code: 'NOTIFICATION_HISTORY_ERROR',
          message: 'Failed to get notification history',
          details: error.message
        }
      };
    }
  }

  /**
   * Mark notification as read
   * @param {string} userId - User ID
   * @param {string} notificationId - Notification ID
   * @returns {Object} Update result
   */
  async markNotificationAsRead(userId, notificationId) {
    try {
      await this.db.collection('notifications').doc(notificationId).update({
        read: true,
        readAt: new Date(),
        updatedAt: new Date()
      });

      return {
        success: true,
        data: {
          notificationId,
          read: true,
          readAt: new Date()
        }
      };
    } catch (error) {
      console.error('Mark notification as read error:', error);
      return {
        success: false,
        error: {
          code: 'MARK_READ_ERROR',
          message: 'Failed to mark notification as read',
          details: error.message
        }
      };
    }
  }

  /**
   * Delete notification
   * @param {string} userId - User ID
   * @param {string} notificationId - Notification ID
   * @returns {Object} Delete result
   */
  async deleteNotification(userId, notificationId) {
    try {
      await this.db.collection('notifications').doc(notificationId).delete();

      return {
        success: true,
        data: {
          notificationId,
          deleted: true,
          deletedAt: new Date()
        }
      };
    } catch (error) {
      console.error('Delete notification error:', error);
      return {
        success: false,
        error: {
          code: 'DELETE_NOTIFICATION_ERROR',
          message: 'Failed to delete notification',
          details: error.message
        }
      };
    }
  }

  /**
   * Get notification statistics
   * @param {Object} filters - Filter options
   * @returns {Object} Notification statistics
   */
  async getNotificationStatistics(filters = {}) {
    try {
      let query = this.db.collection('notifications');

      if (filters.startDate) {
        query = query.where('createdAt', '>=', new Date(filters.startDate));
      }

      if (filters.endDate) {
        query = query.where('createdAt', '<=', new Date(filters.endDate));
      }

      if (filters.type) {
        query = query.where('type', '==', filters.type);
      }

      const snapshot = await query.get();
      const notifications = [];

      snapshot.forEach(doc => {
        notifications.push(doc.data());
      });

      const stats = {
        total: notifications.length,
        sent: notifications.filter(n => n.status === 'sent').length,
        failed: notifications.filter(n => n.status === 'failed').length,
        byType: {},
        byStatus: {}
      };

      // Group by type
      notifications.forEach(notification => {
        const type = notification.type || 'unknown';
        stats.byType[type] = (stats.byType[type] || 0) + 1;
      });

      // Group by status
      notifications.forEach(notification => {
        const status = notification.status || 'unknown';
        stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
      });

      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error('Get notification statistics error:', error);
      return {
        success: false,
        error: {
          code: 'STATISTICS_ERROR',
          message: 'Failed to get notification statistics',
          details: error.message
        }
      };
    }
  }

  // ==================== TEMPLATE-BASED NOTIFICATIONS ====================

  /**
   * Send customer booking created notification
   */
  async notifyCustomerBookingCreated(bookingData) {
    try {
      const notification = NotificationBuilder.customerBookingCreated(bookingData);
      return await this.sendToUser(bookingData.customerId, notification);
    } catch (error) {
      console.error('Error sending customer booking created notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send driver assigned notification to customer
   */
  async notifyCustomerDriverAssigned(bookingData, driverData) {
    try {
      const notification = NotificationBuilder.customerDriverAssigned(bookingData, driverData);
      return await this.sendToUser(bookingData.customerId, notification);
    } catch (error) {
      console.error('Error sending driver assigned notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send new booking request notification to driver
   */
  async notifyDriverNewBookingRequest(bookingData, driverId) {
    try {
      const notification = NotificationBuilder.driverNewBookingRequest(bookingData);
      return await this.sendToUser(driverId, notification);
    } catch (error) {
      console.error('Error sending new booking request notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send package delivered notification to customer
   */
  async notifyCustomerPackageDelivered(bookingData) {
    try {
      const notification = NotificationBuilder.customerPackageDelivered(bookingData);
      return await this.sendToUser(bookingData.customerId, notification);
    } catch (error) {
      console.error('Error sending package delivered notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send emergency alert notification to admin
   */
  async notifyAdminEmergencyAlert(driverData, location) {
    try {
      const notification = NotificationBuilder.adminEmergencyAlert(driverData, location);
      
      // Get all admin users
      const adminQuery = await this.db.collection('users')
        .where('userType', '==', 'admin')
        .get();

      const results = [];
      for (const doc of adminQuery.docs) {
        const result = await this.sendToUser(doc.id, notification);
        results.push({ adminId: doc.id, result });
      }

      return { success: true, results };
    } catch (error) {
      console.error('Error sending emergency alert notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send custom template notification
   */
  async sendTemplateNotification(userId, category, type, variables = {}) {
    try {
      const template = NotificationTemplateProcessor.getTemplate(category, type);
      const notification = NotificationTemplateProcessor.process(template, variables);
      return await this.sendToUser(userId, notification);
    } catch (error) {
      console.error('Error sending template notification:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send notification to multiple users with template
   */
  async sendTemplateNotificationToMultiple(userIds, category, type, variables = {}) {
    try {
      const template = NotificationTemplateProcessor.getTemplate(category, type);
      const notification = NotificationTemplateProcessor.process(template, variables);
      
      const results = [];
      for (const userId of userIds) {
        const result = await this.sendToUser(userId, notification);
        results.push({ userId, result });
      }

      return { success: true, results };
    } catch (error) {
      console.error('Error sending template notification to multiple users:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new NotificationService();
