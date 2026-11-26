const { NEW_ORDER_CHANNEL_ID } = require('./notifications');

const DRIVER_OFFER_TEMPLATES = new Set([
  'NEW_BOOKING',
  'new_booking',
  'new_booking_display'
]);

const SHOP_RING_TEMPLATE = 'INCOMING_PAYMENT';

const SHOP_ORDER_RING_TEMPLATES = new Set(['INCOMING_PAYMENT', 'UTR_SUBMITTED']);

const SHOP_PAYMENT_TEMPLATES = new Set([
  'PAYMENT_REVIEW_SHOP',
  'PAYMENT_UNDER_REVIEW'
]);

/**
 * Resolve Android channel + sound for Expo push (iOS ignores channelId).
 * Old apps without these channels still receive notifications on the OS default channel.
 */
function resolvePushDeliveryOptions({
  userType,
  category,
  templateKey,
  isDriverOffer = false
}) {
  const key = templateKey || '';
  const base = {
    priority: 'high',
    sound: 'default'
  };

  if (isDriverOffer || (userType === 'driver' && DRIVER_OFFER_TEMPLATES.has(key))) {
    return {
      ...base,
      channelId: NEW_ORDER_CHANNEL_ID,
      sound: 'new_order.wav'
    };
  }

  if (userType === 'driver') {
    return {
      ...base,
      channelId: 'driver_updates'
    };
  }

  if (userType === 'shop') {
    if (SHOP_ORDER_RING_TEMPLATES.has(key)) {
      return {
        ...base,
        channelId: 'shop_orders_v2',
        sound: 'shop_new_order_v2.wav'
      };
    }
    if (key === 'PAYMENT_REMINDER') {
      return {
        ...base,
        channelId: 'shop_reminders_v2',
        sound: 'shop_reminder_v2.wav'
      };
    }
    if (SHOP_PAYMENT_TEMPLATES.has(key)) {
      return {
        ...base,
        channelId: 'shop_payments'
      };
    }
    return {
      ...base,
      channelId: 'shop_updates'
    };
  }

  if (userType === 'customer') {
    return {
      ...base,
      channelId: 'customer_updates'
    };
  }

  return {
    ...base,
    channelId: NEW_ORDER_CHANNEL_ID
  };
}

module.exports = {
  DRIVER_OFFER_TEMPLATES,
  SHOP_RING_TEMPLATE,
  SHOP_ORDER_RING_TEMPLATES,
  SHOP_PAYMENT_TEMPLATES,
  resolvePushDeliveryOptions
};
