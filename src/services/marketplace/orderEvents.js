// Customers and shops read marketplace orders through the API. The signal
// document is the only client-readable change notice. Secrets stay in private/.
const admin = require('firebase-admin');

const EVENT_TYPES = [
  'created',
  'payment_details_issued',
  'utr_submitted',
  'utr_nudge',
  'reminder_sent',
  'shop_confirm',
  'utr_corrected',
  'amount_differs',
  'balance_utr',
  'balance_confirmed',
  'payment_confirmed_late',
  'unpaid_cancelled',
  'customer_cancel',
  'paid_check',
  'timed_out',
  'review_opened',
  'shop_response',
  'review_resolved',
  'review_escalated',
  'rejected',
  'cancelled',
  'items_unavailable',
  'stock_deducted',
  'stock_short',
  'stock_restored',
  'refund_created',
  'refund_upi',
  'refund_sent',
  'refund_ack',
  'refund_disputed',
  'refund_auto_closed',
  'refund_reminder',
  'refund_resent',
  'marked_ready',
  'delivery_stage',
  'handed_over',
  'completed',
  'delivered',
  'payment_refunded',
  'rated',
  'help_request',
  'help_resolved',
  'evidence_deleted'
];

const EVENT_TYPE_SET = new Set(EVENT_TYPES);
const signalTouched = new WeakMap();

function requireCustomerId(customerId) {
  if (typeof customerId !== 'string' || customerId.trim() === '') {
    const error = new Error('Marketplace signal requires customerId');
    error.code = 'MISSING_CUSTOMER';
    throw error;
  }
  return customerId;
}

function touchOrderSignal(transaction, orderRef, customerId, type) {
  const id = requireCustomerId(customerId);
  if (typeof type !== 'string' || type.trim() === '') {
    const error = new Error('Marketplace signal requires a type');
    error.code = 'MISSING_SIGNAL_TYPE';
    throw error;
  }
  let touched = signalTouched.get(transaction);
  if (!touched) {
    touched = new Set();
    signalTouched.set(transaction, touched);
  }
  const key = (orderRef && (orderRef.path || orderRef.id)) || 'order';
  if (touched.has(key)) {
    return false;
  }
  touched.add(key);
  transaction.set(orderRef.collection('signal').doc('latest'), {
    customerId: id,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    type
  });
  return true;
}

function appendEvent(transaction, orderRef, event, customerId) {
  const type = event && event.type;
  if (!EVENT_TYPE_SET.has(type)) {
    const error = new Error(`Unknown marketplace event type: ${type}`);
    error.code = 'UNKNOWN_EVENT_TYPE';
    throw error;
  }
  requireCustomerId(customerId);

  const actor = event.actor || {};
  const storedActor = {
    type: actor.type,
    id: actor.id
  };
  if (actor.operator !== undefined) {
    storedActor.operator = actor.operator;
  }

  const ref = orderRef.collection('events').doc();
  transaction.set(ref, {
    type,
    actor: storedActor,
    data: event.data === undefined ? null : event.data,
    reason: event.reason === undefined ? null : event.reason,
    at: admin.firestore.FieldValue.serverTimestamp()
  });
  touchOrderSignal(transaction, orderRef, customerId, type);
  return ref.id;
}

module.exports = {
  EVENT_TYPES,
  appendEvent,
  touchOrderSignal
};
