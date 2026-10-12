/**
 * Marketplace push payload helpers (build rule 9).
 * Data carries ids only: type, orderId, displayId, shopName, action.
 */

const MARKETPLACE_PUSH_DATA_KEYS = ['type', 'orderId', 'displayId', 'shopName', 'action'];

const MARKETPLACE_ALLOWED_ACTIONS = new Set(['order', 'pay', 'refund', 'tracking', 'rate', 'help']);

/** §17 Tap opens → action (per MARKETPLACE template key). */
const MARKETPLACE_TEMPLATE_ACTION = {
  INCOMING_PAYMENT: 'order',
  UTR_NUDGE: 'pay',
  UTR_SUBMITTED: 'order',
  PAYMENT_REMINDER: 'order',
  PAYMENT_CONFIRMED: 'tracking',
  UTR_CORRECTED: 'order',
  PAYMENT_LATE_ACCEPTED: 'order',
  PAYMENT_UNDER_REVIEW: 'order',
  PAYMENT_REVIEW_SHOP: 'order',
  REVIEW_RESOLVED: 'order',
  NOT_VERIFIED: 'order',
  ORDER_CANCELLED: 'order',
  ITEMS_UNAVAILABLE: 'refund',
  REFUND_INITIATED: 'refund',
  REFUND_UPI_REMINDER: 'refund',
  REFUND_DUE: 'refund',
  REFUND_OVERDUE: 'refund',
  REFUND_SENT: 'refund',
  REFUND_ACK_REMINDER: 'refund',
  REFUND_CLOSED: 'refund',
  REFUND_DISPUTED: 'refund',
  PAYMENT_EXPIRED: 'pay',
  PAYMENT_NOT_CONFIRMED: 'pay',
  ORDER_CLOSED_UNCONFIRMED: 'order',
  AMOUNT_SHORT: 'order',
  CUSTOMER_CANCELLED: 'order',
  ORDER_PACKED: 'tracking',
  DRIVER_SLOW: 'tracking',
  ORDER_ASSIGNED: 'tracking',
  DRIVER_AT_SHOP: 'tracking',
  OUT_FOR_DELIVERY: 'tracking',
  ORDER_DELIVERED: 'rate',
  HELP_UPDATE: 'help',
  HELP_SHOP_RESPONSE: 'help',
  BALANCE_NOT_PAID: 'refund',
  BALANCE_NOT_PAID_SHOP: 'refund'
};

function digitsDisplayId(displayId) {
  if (displayId == null || displayId === '') {
    return '';
  }
  const raw = String(displayId).replace(/^#/, '').trim();
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    return raw.replace(/\D/g, '').slice(-5).padStart(5, '0');
  }
  return String(Math.floor(num)).padStart(5, '0');
}

function shopNameFromOrder(data) {
  const snapshot = data && data.shopSnapshot && typeof data.shopSnapshot === 'object'
    ? data.shopSnapshot
    : {};
  return typeof snapshot.name === 'string' ? snapshot.name : '';
}

function marketplacePushVariables(data, orderId) {
  const order = data && typeof data === 'object' ? data : {};
  return {
    orderId: orderId == null ? '' : String(orderId),
    displayId: digitsDisplayId(order.displayId),
    shopName: shopNameFromOrder(order)
  };
}

function isMarketplacePushData(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const keys = Object.keys(data);
  if (keys.length !== MARKETPLACE_PUSH_DATA_KEYS.length) {
    return false;
  }
  return MARKETPLACE_PUSH_DATA_KEYS.every((key) => keys.includes(key));
}

function buildMarketplacePushData(templateKey, eventType, variables) {
  const action = MARKETPLACE_TEMPLATE_ACTION[templateKey] || 'order';
  const base = variables && typeof variables === 'object' ? variables : {};
  return {
    type: String(eventType || ''),
    orderId: base.orderId == null ? '' : String(base.orderId),
    displayId: digitsDisplayId(base.displayId),
    shopName: base.shopName == null ? '' : String(base.shopName),
    action: String(action)
  };
}

module.exports = {
  MARKETPLACE_PUSH_DATA_KEYS,
  MARKETPLACE_ALLOWED_ACTIONS,
  MARKETPLACE_TEMPLATE_ACTION,
  digitsDisplayId,
  shopNameFromOrder,
  marketplacePushVariables,
  isMarketplacePushData,
  buildMarketplacePushData
};
