const { NEW_ORDER_CHANNEL_ID } = require('./notifications');

const DRIVER_OFFER_TEMPLATES = new Set([
  'NEW_BOOKING',
  'new_booking',
  'new_booking_display'
]);

const SHOP_RING_TEMPLATE = 'INCOMING_PAYMENT';

const SHOP_PAYMENT_TEMPLATES = new Set([
  'UTR_SUBMITTED',
  'PAYMENT_REMINDER',
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
  isDriverOffer = false,
  shopRingDowngrade = false
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
    if (key === SHOP_RING_TEMPLATE && !shopRingDowngrade) {
      return {
        ...base,
        channelId: 'shop_orders',
        sound: 'default'
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
  SHOP_PAYMENT_TEMPLATES,
  resolvePushDeliveryOptions
};
