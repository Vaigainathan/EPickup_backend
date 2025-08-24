const express = require('express');
const router = express.Router();
const notificationService = require('../services/notificationService');
const { requireRole, requireOwnership } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

/**
 * @route   POST /api/notifications/send
 * @desc    Send notification to a single user
 * @access  Private (Admin, Driver for their bookings)
 */
router.post('/send', [
  body('userId').isString().notEmpty().withMessage('User ID is required'),
  body('type').isString().notEmpty().withMessage('Notification type is required'),
  body('data').optional().isObject().withMessage('Data must be an object'),
  body('options').optional().isObject().withMessage('Options must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const { userId, type, data = {}, options = {} } = req.body;
    const { user } = req;

    // Check permissions
    if (user.role !== 'admin' && user.id !== userId) {
      // Drivers can only send notifications related to their bookings
      if (user.role === 'driver' && data.bookingId) {
        // Verify driver owns this booking
        const bookingDoc = await req.app.locals.db.collection('bookings').doc(data.bookingId).get();
        if (!bookingDoc.exists || bookingDoc.data().driverId !== user.id) {
          return res.status(403).json({
            success: false,
            error: {
              code: 'ACCESS_DENIED',
              message: 'You can only send notifications for your own bookings'
            }
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          error: {
            code: 'ACCESS_DENIED',
            message: 'Insufficient permissions'
          }
        });
      }
    }

    const result = await notificationService.sendComprehensiveNotification(userId, type, data, options);
    
    res.json({
      success: true,
      message: 'Notification sent successfully',
      data: result
    });

  } catch (error) {
    console.error('Send notification error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATION_SEND_ERROR',
        message: 'Failed to send notification',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/notifications/send-multicast
 * @desc    Send notification to multiple users
 * @access  Private (Admin only)
 */
router.post('/send-multicast', [
  body('userIds').isArray().notEmpty().withMessage('User IDs array is required'),
  body('type').isString().notEmpty().withMessage('Notification type is required'),
  body('data').optional().isObject().withMessage('Data must be an object'),
  body('options').optional().isObject().withMessage('Options must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const { userIds, type, data = {}, options = {} } = req.body;

    const result = await notificationService.sendMulticastNotification(userIds, type, data, options);
    
    res.json({
      success: true,
      message: 'Multicast notification sent successfully',
      data: result
    });

  } catch (error) {
    console.error('Send multicast notification error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'MULTICAST_NOTIFICATION_ERROR',
        message: 'Failed to send multicast notification',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/notifications/send-to-role
 * @desc    Send notification to all users of a specific role
 * @access  Private (Admin only)
 */
router.post('/send-to-role', [
  body('role').isIn(['customer', 'driver', 'admin']).withMessage('Valid role is required'),
  body('type').isString().notEmpty().withMessage('Notification type is required'),
  body('data').optional().isObject().withMessage('Data must be an object'),
  body('options').optional().isObject().withMessage('Options must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const { role, type, data = {}, options = {} } = req.body;

    const result = await notificationService.sendNotificationToRole(role, type, data, options);
    
    res.json({
      success: true,
      message: 'Role-based notification sent successfully',
      data: result
    });

  } catch (error) {
    console.error('Send role-based notification error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ROLE_NOTIFICATION_ERROR',
        message: 'Failed to send role-based notification',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/notifications/send-to-area
 * @desc    Send notification to users in a specific area
 * @access  Private (Admin only)
 */
router.post('/send-to-area', [
  body('center.latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  body('center.longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  body('radius').isFloat({ min: 0.1, max: 100 }).withMessage('Valid radius is required'),
  body('type').isString().notEmpty().withMessage('Notification type is required'),
  body('data').optional().isObject().withMessage('Data must be an object'),
  body('options').optional().isObject().withMessage('Options must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const { center, radius, type, data = {}, options = {} } = req.body;

    const result = await notificationService.sendNotificationToArea(center, radius, type, data, options);
    
    res.json({
      success: true,
      message: 'Area-based notification sent successfully',
      data: result
    });

  } catch (error) {
    console.error('Send area-based notification error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'AREA_NOTIFICATION_ERROR',
        message: 'Failed to send area-based notification',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/notifications/schedule
 * @desc    Schedule notification for future delivery
 * @access  Private (Admin only)
 */
router.post('/schedule', [
  body('userId').isString().notEmpty().withMessage('User ID is required'),
  body('type').isString().notEmpty().withMessage('Notification type is required'),
  body('scheduledTime').isISO8601().withMessage('Valid scheduled time is required'),
  body('data').optional().isObject().withMessage('Data must be an object'),
  body('options').optional().isObject().withMessage('Options must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const { userId, type, scheduledTime, data = {}, options = {} } = req.body;

    const result = await notificationService.scheduleNotification(userId, type, scheduledTime, data, options);
    
    res.json({
      success: true,
      message: 'Notification scheduled successfully',
      data: result
    });

  } catch (error) {
    console.error('Schedule notification error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATION_SCHEDULING_ERROR',
        message: 'Failed to schedule notification',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/notifications/process-scheduled
 * @desc    Process scheduled notifications (admin endpoint)
 * @access  Private (Admin only)
 */
router.post('/process-scheduled', [
  requireRole(['admin'])
], async (req, res) => {
  try {
    const result = await notificationService.processScheduledNotifications();
    
    res.json({
      success: true,
      message: 'Scheduled notifications processed successfully',
      data: result
    });

  } catch (error) {
    console.error('Process scheduled notifications error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SCHEDULED_NOTIFICATION_ERROR',
        message: 'Failed to process scheduled notifications',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/notifications/preferences
 * @desc    Get user's notification preferences
 * @access  Private
 */
router.get('/preferences', async (req, res) => {
  try {
    const { user } = req;
    const result = await notificationService.getUserNotificationPreferences(user.id);
    
    res.json(result);

  } catch (error) {
    console.error('Get notification preferences error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PREFERENCES_RETRIEVAL_ERROR',
        message: 'Failed to get notification preferences',
        details: error.message
      }
    });
  }
});

/**
 * @route   PUT /api/notifications/preferences
 * @desc    Update user's notification preferences
 * @access  Private
 */
router.put('/preferences', [
  body('preferences').isObject().withMessage('Preferences object is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const { preferences } = req.body;
    const { user } = req;

    const result = await notificationService.updateUserNotificationPreferences(user.id, preferences);
    
    res.json(result);

  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PREFERENCES_UPDATE_ERROR',
        message: 'Failed to update notification preferences',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/notifications
 * @desc    Get user's notifications
 * @access  Private
 */
router.get('/', [
  requireOwnership
], async (req, res) => {
  try {
    const { user } = req;
    const { limit, offset, unreadOnly, type } = req.query;

    const options = {
      limit: limit ? parseInt(limit) : 50,
      offset: offset ? parseInt(offset) : 0,
      unreadOnly: unreadOnly === 'true',
      type: type || null
    };

    const result = await notificationService.getUserNotifications(user.id, options);
    
    res.json(result);

  } catch (error) {
    console.error('Get user notifications error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATIONS_RETRIEVAL_ERROR',
        message: 'Failed to get notifications',
        details: error.message
      }
    });
  }
});

/**
 * @route   PUT /api/notifications/:id/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.put('/:id/read', [
  requireOwnership
], async (req, res) => {
  try {
    const { user } = req;
    const { id } = req.params;

    const result = await notificationService.markNotificationAsRead(user.id, id);
    
    res.json(result);

  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATION_UPDATE_ERROR',
        message: 'Failed to mark notification as read',
        details: error.message
      }
    });
  }
});

/**
 * @route   PUT /api/notifications/read-all
 * @desc    Mark all notifications as read
 * @access  Private
 */
router.put('/read-all', [
  requireOwnership
], async (req, res) => {
  try {
    const { user } = req;

    const result = await notificationService.markAllNotificationsAsRead(user.id);
    
    res.json(result);

  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATION_UPDATE_ERROR',
        message: 'Failed to mark all notifications as read',
        details: error.message
      }
    });
  }
});

/**
 * @route   DELETE /api/notifications/:id
 * @desc    Delete notification
 * @access  Private
 */
router.delete('/:id', [
  requireOwnership
], async (req, res) => {
  try {
    const { user } = req;
    const { id } = req.params;

    const result = await notificationService.deleteNotification(user.id, id);
    
    res.json(result);

  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATION_DELETION_ERROR',
        message: 'Failed to delete notification',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/notifications/statistics
 * @desc    Get notification statistics
 * @access  Private (Admin or own user)
 */
router.get('/statistics', async (req, res) => {
  try {
    const { user } = req;
    const { startDate, endDate } = req.query;

    const timeRange = {};
    if (startDate) timeRange.startDate = startDate;
    if (endDate) timeRange.endDate = endDate;

    // Users can only see their own stats, admins can see all
    const userId = user.role === 'admin' ? null : user.id;
    const result = await notificationService.getNotificationStatistics(userId, timeRange);
    
    res.json(result);

  } catch (error) {
    console.error('Get notification statistics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'STATISTICS_RETRIEVAL_ERROR',
        message: 'Failed to get notification statistics',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/notifications/cleanup-logs
 * @desc    Clean up old notification logs (admin endpoint)
 * @access  Private (Admin only)
 */
router.post('/cleanup-logs', [
  requireRole(['admin']),
  body('maxAge').optional().isInt({ min: 1 }).withMessage('Max age must be a positive integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        }
      });
    }

    const { maxAge } = req.body;
    const maxAgeMs = maxAge ? maxAge * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000; // Convert days to ms

    const result = await notificationService.cleanupOldLogs(maxAgeMs);
    
    res.json({
      success: true,
      message: 'Old logs cleaned up successfully',
      data: result
    });

  } catch (error) {
    console.error('Cleanup logs error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGS_CLEANUP_ERROR',
        message: 'Failed to cleanup old logs',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/notifications/templates
 * @desc    Get available notification templates
 * @access  Private (Admin only)
 */
router.get('/templates', [
  requireRole(['admin'])
], async (req, res) => {
  try {
    res.json({
      success: true,
      data: notificationService.templates
    });

  } catch (error) {
    console.error('Get templates error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TEMPLATES_RETRIEVAL_ERROR',
        message: 'Failed to get notification templates',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/notifications/health
 * @desc    Health check for notification service
 * @access  Private (Admin)
 */
router.get('/health', async (req, res) => {
  try {
    const health = await notificationService.checkFCMHealth();
    res.json(health);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error.message
    });
  }
});

/**
 * FCM Token Management Routes
 */

/**
 * @route   POST /api/notifications/fcm/token
 * @desc    Save/Update FCM token for user
 * @access  Private
 */
router.post('/fcm/token', [
  body('fcmToken').isString().notEmpty().withMessage('FCM token is required'),
  body('deviceInfo').optional().isObject().withMessage('Device info must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { fcmToken, deviceInfo } = req.body;
    const userId = req.user.uid;

    const result = await notificationService.saveFCMToken(userId, fcmToken, deviceInfo);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to save FCM token',
      error: error.message
    });
  }
});

/**
 * @route   DELETE /api/notifications/fcm/token
 * @desc    Remove FCM token for user
 * @access  Private
 */
router.delete('/fcm/token', async (req, res) => {
  try {
    const userId = req.user.uid;
    const result = await notificationService.removeFCMToken(userId);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to remove FCM token',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/notifications/fcm/token
 * @desc    Get FCM token for user
 * @access  Private
 */
router.get('/fcm/token', async (req, res) => {
  try {
    const userId = req.user.uid;
    const token = await notificationService.getFCMToken(userId);
    res.json({
      success: true,
      data: { fcmToken: token }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get FCM token',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/notifications/fcm/token/validate
 * @desc    Validate FCM token
 * @access  Private
 */
router.post('/fcm/token/validate', [
  body('fcmToken').isString().notEmpty().withMessage('FCM token is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { fcmToken } = req.body;
    const isValid = await notificationService.validateFCMToken(fcmToken);
    
    res.json({
      success: true,
      data: { isValid }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to validate FCM token',
      error: error.message
    });
  }
});

/**
 * FCM Topic Management Routes
 */

/**
 * @route   POST /api/notifications/fcm/topics/subscribe
 * @desc    Subscribe user to FCM topics
 * @access  Private
 */
router.post('/fcm/topics/subscribe', [
  body('topics').isArray().notEmpty().withMessage('Topics array is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { topics } = req.body;
    const userId = req.user.uid;

    const result = await notificationService.subscribeUserToTopics(userId, topics);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to subscribe to topics',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/notifications/fcm/topics/unsubscribe
 * @desc    Unsubscribe user from FCM topics
 * @access  Private
 */
router.post('/fcm/topics/unsubscribe', [
  body('topics').isArray().notEmpty().withMessage('Topics array is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { topics } = req.body;
    const userId = req.user.uid;

    const result = await notificationService.unsubscribeUserFromTopics(userId, topics);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to unsubscribe from topics',
      error: error.message
    });
  }
});

/**
 * FCM Analytics and Management Routes
 */

/**
 * @route   GET /api/notifications/fcm/analytics
 * @desc    Get FCM token analytics
 * @access  Private (Admin)
 */
router.get('/fcm/analytics', [requireRole('admin')], async (req, res) => {
  try {
    const result = await notificationService.getFCMTokenAnalytics();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get FCM analytics',
      error: error.message
    });
  }
});

/**
 * @route   GET /api/notifications/fcm/statistics
 * @desc    Get FCM delivery statistics
 * @access  Private (Admin)
 */
router.get('/fcm/statistics', [requireRole('admin')], async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const timeRange = {};
    
    if (startDate) timeRange.startDate = startDate;
    if (endDate) timeRange.endDate = endDate;

    const result = await notificationService.getFCMDeliveryStatistics(timeRange);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get FCM statistics',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/notifications/fcm/cleanup
 * @desc    Clean up expired FCM tokens
 * @access  Private (Admin)
 */
router.post('/fcm/cleanup', [requireRole('admin')], async (req, res) => {
  try {
    const result = await notificationService.cleanupExpiredFCMTokens();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup expired FCM tokens',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/notifications/fcm/refresh
 * @desc    Refresh FCM tokens
 * @access  Private (Admin)
 */
router.post('/fcm/refresh', [requireRole('admin')], async (req, res) => {
  try {
    const result = await notificationService.refreshFCMTokens();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to refresh FCM tokens',
      error: error.message
    });
  }
});

/**
 * @route   POST /api/notifications/fcm/optimize
 * @desc    Optimize FCM topic subscriptions
 * @access  Private (Admin)
 */
router.post('/fcm/optimize', [requireRole('admin')], async (req, res) => {
  try {
    const result = await notificationService.optimizeFCMTopicSubscriptions();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to optimize FCM topics',
      error: error.message
    });
  }
});

/**
 * Enhanced Topic Notification Routes
 */

/**
 * @route   POST /api/notifications/fcm/topic/filtered
 * @desc    Send notification to FCM topic with user filtering
 * @access  Private (Admin)
 */
router.post('/fcm/topic/filtered', [
  requireRole('admin'),
  body('topic').isString().notEmpty().withMessage('Topic is required'),
  body('notificationType').isString().notEmpty().withMessage('Notification type is required'),
  body('data').optional().isObject().withMessage('Data must be an object'),
  body('options').optional().isObject().withMessage('Options must be an object'),
  body('userFilter').optional().isObject().withMessage('User filter must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { topic, notificationType, data, options, userFilter } = req.body;

    const result = await notificationService.sendNotificationToTopicWithFilter(
      topic, notificationType, data, options, userFilter
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to send filtered topic notification',
      error: error.message
    });
  }
});

// Enhanced User Preference Management
router.get('/preferences/enhanced', async (req, res) => {
  try {
    const userId = req.user.uid;
    const preferences = await notificationService.getUserNotificationPreferences(userId);
    res.json(preferences);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get enhanced preferences',
      error: error.message
    });
  }
});

router.put('/preferences/enhanced', [
  body('preferences').isObject().withMessage('Preferences must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.uid;
    const { preferences } = req.body;
    const result = await notificationService.updateUserNotificationPreferences(userId, preferences);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update enhanced preferences',
      error: error.message
    });
  }
});

// Quiet Hours Management
router.get('/preferences/quiet-hours', async (req, res) => {
  try {
    const userId = req.user.uid;
    const preferences = await notificationService.getUserNotificationPreferences(userId);
    res.json({
      success: true,
      data: preferences.data.quietHours
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get quiet hours',
      error: error.message
    });
  }
});

router.put('/preferences/quiet-hours', [
  body('quietHours').isObject().withMessage('Quiet hours must be an object'),
  body('quietHours.enabled').isBoolean().withMessage('Enabled must be a boolean'),
  body('quietHours.startHour').isInt({ min: 0, max: 23 }).withMessage('Start hour must be 0-23'),
  body('quietHours.endHour').isInt({ min: 0, max: 23 }).withMessage('End hour must be 0-23')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.uid;
    const { quietHours } = req.body;
    
    const currentPreferences = await notificationService.getUserNotificationPreferences(userId);
    const updatedPreferences = {
      ...currentPreferences.data,
      quietHours: {
        ...currentPreferences.data.quietHours,
        ...quietHours
      }
    };

    const result = await notificationService.updateUserNotificationPreferences(userId, updatedPreferences);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update quiet hours',
      error: error.message
    });
  }
});

// Channel Preferences Management
router.get('/preferences/channels', async (req, res) => {
  try {
    const userId = req.user.uid;
    const preferences = await notificationService.getUserNotificationPreferences(userId);
    res.json({
      success: true,
      data: preferences.data.channels
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get channel preferences',
      error: error.message
    });
  }
});

router.put('/preferences/channels', [
  body('channels').isObject().withMessage('Channels must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.uid;
    const { channels } = req.body;
    
    const currentPreferences = await notificationService.getUserNotificationPreferences(userId);
    const updatedPreferences = {
      ...currentPreferences.data,
      channels: {
        ...currentPreferences.data.channels,
        ...channels
      }
    };

    const result = await notificationService.updateUserNotificationPreferences(userId, updatedPreferences);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update channel preferences',
      error: error.message
    });
  }
});

// Notification Type Preferences
router.get('/preferences/types', async (req, res) => {
  try {
    const userId = req.user.uid;
    const preferences = await notificationService.getUserNotificationPreferences(userId);
    res.json({
      success: true,
      data: preferences.data.types
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get type preferences',
      error: error.message
    });
  }
});

router.put('/preferences/types', [
  body('types').isObject().withMessage('Types must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.uid;
    const { types } = req.body;
    
    const currentPreferences = await notificationService.getUserNotificationPreferences(userId);
    const updatedPreferences = {
      ...currentPreferences.data,
      types: {
        ...currentPreferences.data.types,
        ...types
      }
    };

    const result = await notificationService.updateUserNotificationPreferences(userId, updatedPreferences);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update type preferences',
      error: error.message
    });
  }
});

// Smart Notification Sending with Preferences
router.post('/send-with-preferences', [
  body('notificationType').isString().notEmpty().withMessage('Notification type is required'),
  body('data').optional().isObject().withMessage('Data must be an object'),
  body('options').optional().isObject().withMessage('Options must be an object')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const userId = req.user.uid;
    const { notificationType, data = {}, options = {} } = req.body;
    
    const result = await notificationService.sendNotificationWithPreferences(
      userId, 
      notificationType, 
      data, 
      options
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to send notification with preferences',
      error: error.message
    });
  }
});

// Check if user is in quiet hours
router.get('/quiet-hours/check', async (req, res) => {
  try {
    const userId = req.user.uid;
    const preferences = await notificationService.getUserNotificationPreferences(userId);
    const inQuietHours = notificationService.checkQuietHours(preferences.data.quietHours);
    
    res.json({
      success: true,
      data: {
        inQuietHours,
        quietHours: preferences.data.quietHours
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to check quiet hours',
      error: error.message
    });
  }
});

// Reset preferences to default
router.post('/preferences/reset', async (req, res) => {
  try {
    const userId = req.user.uid;
    const defaultPreferences = notificationService.getDefaultPreferences();
    const result = await notificationService.updateUserNotificationPreferences(userId, defaultPreferences);
    
    res.json({
      success: true,
      message: 'Preferences reset to default successfully',
      data: result.data
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to reset preferences',
      error: error.message
    });
  }
});

// Get notification statistics for user
router.get('/statistics/user', async (req, res) => {
  try {
    const userId = req.user.uid;
    const { startDate, endDate } = req.query;
    
    const timeRange = {};
    if (startDate) timeRange.startDate = startDate;
    if (endDate) timeRange.endDate = endDate;
    
    const stats = await notificationService.getNotificationStatistics(userId, timeRange);
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get user statistics',
      error: error.message
    });
  }
});

module.exports = router;
