const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const messaging = admin.messaging();

/**
 * Firebase Cloud Function for processing scheduled notifications
 * Triggered by Cloud Scheduler or manually
 */
exports.processScheduledNotifications = functions.pubsub
  .schedule('every 1 minutes')
  .onRun(async (context) => {
    try {
      console.log('Processing scheduled notifications...');
      
      const now = admin.firestore.Timestamp.now();
      const scheduledNotifications = await db
        .collection('scheduledNotifications')
        .where('scheduledTime', '<=', now)
        .where('status', '==', 'pending')
        .limit(100) // Process in batches
        .get();

      if (scheduledNotifications.empty) {
        console.log('No scheduled notifications to process');
        return null;
      }

      console.log(`Processing ${scheduledNotifications.size} scheduled notifications`);

      const batch = db.batch();
      const results = [];

      for (const doc of scheduledNotifications.docs) {
        const notification = doc.data();
        
        try {
          // Process the notification
          const result = await processNotification(notification);
          
          // Mark as processed
          batch.update(doc.ref, {
            status: 'processed',
            processedAt: now,
            result: result
          });

          results.push({
            id: doc.id,
            status: 'success',
            result: result
          });

        } catch (error) {
          console.error(`Failed to process notification ${doc.id}:`, error);
          
          // Mark as failed
          batch.update(doc.ref, {
            status: 'failed',
            processedAt: now,
            error: error.message,
            retryCount: (notification.retryCount || 0) + 1
          });

          results.push({
            id: doc.id,
            status: 'failed',
            error: error.message
          });
        }
      }

      // Commit all updates
      await batch.commit();

      console.log(`Processed ${results.length} notifications`);
      return { processed: results.length, results };

    } catch (error) {
      console.error('Error processing scheduled notifications:', error);
      throw error;
    }
  });

/**
 * Process a single scheduled notification
 */
async function processNotification(notification) {
  const { userId, type, data, channels, options } = notification;

  // Get user's FCM token and preferences
  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) {
    throw new Error('User not found');
  }

  const userData = userDoc.data();
  const userPreferences = userData.notificationPreferences || {};

  // Check quiet hours
  if (isInQuietHours(userPreferences)) {
    console.log(`Skipping notification for user ${userId} - quiet hours`);
    return { skipped: true, reason: 'quiet_hours' };
  }

  // Check channel preferences
  const enabledChannels = getEnabledChannels(userPreferences, channels);
  if (enabledChannels.length === 0) {
    console.log(`No enabled channels for user ${userId}`);
    return { skipped: true, reason: 'no_enabled_channels' };
  }

  const results = {};

  // Send push notification if enabled
  if (enabledChannels.includes('push') && userData.fcmToken) {
    try {
      const pushResult = await sendPushNotification(userId, type, data, options);
      results.push = pushResult;
    } catch (error) {
      console.error('Push notification failed:', error);
      results.push = { error: error.message };
    }
  }

  // Send in-app notification if enabled
  if (enabledChannels.includes('in_app')) {
    try {
      const inAppResult = await createInAppNotification(userId, type, data, options);
      results.in_app = inAppResult;
    } catch (error) {
      console.error('In-app notification failed:', error);
      results.in_app = { error: error.message };
    }
  }

  // Send email if enabled (placeholder for future implementation)
  if (enabledChannels.includes('email')) {
    results.email = { status: 'not_implemented' };
  }

  return results;
}

/**
 * Send push notification using FCM
 */
async function sendPushNotification(userId, type, data, options) {
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();
  
  if (!userData.fcmToken) {
    throw new Error('No FCM token available');
  }

  const message = {
    token: userData.fcmToken,
    notification: {
      title: data.title || 'EPickup Notification',
      body: data.body || 'You have a new notification'
    },
    data: {
      type: type,
      ...data,
      timestamp: Date.now().toString()
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'epickup_general',
        priority: 'high',
        defaultSound: true,
        defaultVibrateTimings: true
      }
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          category: 'epickup_notification'
        }
      }
    }
  };

  const response = await messaging.send(message);
  return { messageId: response, status: 'sent' };
}

/**
 * Create in-app notification
 */
async function createInAppNotification(userId, type, data, options) {
  const notificationData = {
    userId: userId,
    type: type,
    title: data.title || 'EPickup Notification',
    body: data.body || 'You have a new notification',
    data: data,
    status: 'unread',
    createdAt: admin.firestore.Timestamp.now(),
    readAt: null,
    expiresAt: options?.expiresAt || null
  };

  const docRef = await db.collection('inAppNotifications').add(notificationData);
  return { id: docRef.id, status: 'created' };
}

/**
 * Check if current time is within user's quiet hours
 */
function isInQuietHours(preferences) {
  if (!preferences.quietHours || !preferences.quietHours.enabled) {
    return false;
  }

  const now = new Date();
  const currentHour = now.getHours();
  const { startHour, endHour } = preferences.quietHours;

  if (startHour <= endHour) {
    // Same day (e.g., 22:00 to 06:00)
    return currentHour >= startHour || currentHour < endHour;
  } else {
    // Overnight (e.g., 22:00 to 06:00)
    return currentHour >= startHour || currentHour < endHour;
  }
}

/**
 * Get enabled channels based on user preferences
 */
function getEnabledChannels(userPreferences, requestedChannels) {
  const enabledChannels = [];
  
  if (userPreferences.push !== false && requestedChannels.includes('push')) {
    enabledChannels.push('push');
  }
  
  if (userPreferences.inApp !== false && requestedChannels.includes('in_app')) {
    enabledChannels.push('in_app');
  }
  
  if (userPreferences.email !== false && requestedChannels.includes('email')) {
    enabledChannels.push('email');
  }
  
  if (userPreferences.sms !== false && requestedChannels.includes('sms')) {
    enabledChannels.push('sms');
  }

  return enabledChannels;
}

/**
 * Manual trigger for testing
 */
exports.manualProcessScheduledNotifications = functions.https.onRequest(async (req, res) => {
  try {
    const result = await exports.processScheduledNotifications.run();
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Clean up old scheduled notifications
 */
exports.cleanupOldScheduledNotifications = functions.pubsub
  .schedule('0 2 * * *') // Daily at 2 AM
  .onRun(async (context) => {
    try {
      const thirtyDaysAgo = admin.firestore.Timestamp.fromDate(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      );

      const oldNotifications = await db
        .collection('scheduledNotifications')
        .where('createdAt', '<', thirtyDaysAgo)
        .get();

      if (oldNotifications.empty) {
        console.log('No old notifications to clean up');
        return null;
      }

      const batch = db.batch();
      oldNotifications.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      console.log(`Cleaned up ${oldNotifications.size} old notifications`);
      return { cleaned: oldNotifications.size };

    } catch (error) {
      console.error('Error cleaning up old notifications:', error);
      throw error;
    }
  });
