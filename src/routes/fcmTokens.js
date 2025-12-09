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

    // ✅ FIX: Detect token type and store in correct field
    // Expo tokens start with "ExponentPushToken[" and FCM tokens are long strings without brackets
    const isExpoToken = fcmToken && fcmToken.startsWith('ExponentPushToken[');
    const isFCMToken = fcmToken && fcmToken.length > 100 && !fcmToken.includes('[');

    console.log(`🔔 [PUSH_TOKEN] Registering push token for user: ${userId} (role-based UID)`);
    console.log(`🔔 [PUSH_TOKEN] Token type: ${isExpoToken ? 'Expo' : isFCMToken ? 'FCM' : 'Unknown'}`);
    console.log(`🔔 [PUSH_TOKEN] Token data:`, { token: fcmToken?.substring(0, 20) + '...', deviceId, platform, userType });
    
    // Build update data
    const updateData = {
      deviceId,
      platform,
      userType: userType || req.user.userType,
      tokenUpdatedAt: new Date(),
      registrationSource: userType || 'unknown',
      lastSeen: new Date()
    };

    // ✅ Store in correct field based on token type
    if (isExpoToken) {
      updateData.expoPushToken = fcmToken; // Store Expo token in expoPushToken field
      // Keep existing fcmToken if it exists (backward compatibility)
      console.log(`✅ [PUSH_TOKEN] Expo push token stored for user: ${userId}`);
    } else if (isFCMToken) {
      updateData.fcmToken = fcmToken; // Store FCM token in fcmToken field
      console.log(`✅ [PUSH_TOKEN] FCM token stored for user: ${userId}`);
    } else {
      // Unknown token type - store in both fields for backward compatibility
      updateData.expoPushToken = fcmToken;
      updateData.fcmToken = fcmToken;
      console.warn(`⚠️ [PUSH_TOKEN] Unknown token type, stored in both fields for user: ${userId}`);
    }

    // Update user's push token (use set with merge to create document if it doesn't exist)
    await db.collection('users').doc(userId).set(updateData, { merge: true });

    console.log(`✅ [PUSH_TOKEN] Push token registered successfully for user: ${userId}`);

    res.status(200).json({
      success: true,
      message: 'Push token registered successfully',
      data: {
        tokenType: isExpoToken ? 'expo' : isFCMToken ? 'fcm' : 'unknown'
      }
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

    // Remove push tokens from user (use set with merge to avoid errors if document doesn't exist)
    await db.collection('users').doc(userId).set({
      expoPushToken: null,
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
