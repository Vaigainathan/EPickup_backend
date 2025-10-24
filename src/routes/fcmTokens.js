const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const { getFirestore } = require('../services/firebase');

const db = getFirestore();

/**
 * @route   POST /api/fcm-tokens/register
 * @desc    Register FCM token for user
 * @access  Private
 */
router.post('/register', [
  requireRole(['customer', 'driver']),
  body('token').isString().notEmpty().withMessage('FCM token is required'),
  body('deviceId').optional().isString(),
  body('platform').optional().isIn(['android', 'ios', 'web'])
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

    const { token: fcmToken, deviceId, platform, userType } = req.body;
    const userId = req.user.uid; // This is the role-based UID from JWT

    // ✅ FIX: Use role-based UID for FCM token storage
    console.log(`🔔 [FCM_TOKEN] Registering FCM token for user: ${userId} (role-based UID)`);
    console.log(`🔔 [FCM_TOKEN] Token data:`, { fcmToken: fcmToken?.substring(0, 20) + '...', deviceId, platform, userType });
    
    // Update user's FCM token (use set with merge to create document if it doesn't exist)
    await db.collection('users').doc(userId).set({
      fcmToken,
      deviceId,
      platform,
      userType: userType || req.user.userType,
      tokenUpdatedAt: new Date(),
      // ✅ FIX: Store additional metadata for debugging
      registrationSource: 'customer_app',
      lastSeen: new Date()
    }, { merge: true });

    console.log(`✅ [FCM_TOKEN] FCM token registered successfully for user: ${userId}`);

    res.status(200).json({
      success: true,
      message: 'FCM token registered successfully'
    });
  } catch (error) {
    console.error('FCM token registration error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FCM_REGISTRATION_ERROR',
        message: 'Failed to register FCM token'
      }
    });
  }
});

/**
 * @route   POST /api/fcm-tokens/unregister
 * @desc    Unregister FCM token for user
 * @access  Private
 */
router.post('/unregister', [
  requireRole(['customer', 'driver'])
], async (req, res) => {
  try {
    const userId = req.user.uid;

    // Remove FCM token from user (use set with merge to avoid errors if document doesn't exist)
    await db.collection('users').doc(userId).set({
      fcmToken: null,
      deviceId: null,
      platform: null,
      tokenUpdatedAt: new Date()
    }, { merge: true });

    res.status(200).json({
      success: true,
      message: 'FCM token unregistered successfully'
    });
  } catch (error) {
    console.error('FCM token unregistration error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FCM_UNREGISTRATION_ERROR',
        message: 'Failed to unregister FCM token'
      }
    });
  }
});

module.exports = router;
