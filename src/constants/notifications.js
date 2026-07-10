/**
 * Notification Channel Configuration for EPickup Backend
 * ✅ CRITICAL: Must match driver-app/constants/notifications.ts exactly
 * Used when sending push notifications via ExpoPushService and WebSocket handlers
 */

/**
 * Android notification channel ID for new order notifications
 * ✅ VERSIONED: Bumped to v4 to force fresh channel creation on all installs
 * Must match the value in driver-app/constants/notifications.ts
 */
const NEW_ORDER_CHANNEL_ID = 'new_order_v4';

/**
 * Channel name (displayed to user in Android settings)
 */
const NEW_ORDER_CHANNEL_NAME = 'New orders';

/**
 * Sound file name (without path)
 */
const NEW_ORDER_SOUND = 'new_order.wav';

/**
 * Vibration pattern for new order notifications (milliseconds)
 */
const NEW_ORDER_VIBRATION_PATTERN = [0, 500, 200, 500];

module.exports = {
  NEW_ORDER_CHANNEL_ID,
  NEW_ORDER_CHANNEL_NAME,
  NEW_ORDER_SOUND,
  NEW_ORDER_VIBRATION_PATTERN
};
