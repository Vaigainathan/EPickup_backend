// The customer app can read the main marketplaceOrders document directly via Firestore rules; never store shop-internal or secret data on it — use private/ subdocuments.
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
  'refund_created',
  'refund_upi',
  'refund_sent',
  'refund_ack',
  'refund_disputed',
  'refund_auto_closed',
  'refund_reminder',
  'marked_ready',
  'delivery_stage',
  'handed_over',
  'delivered',
  'rated',
  'help_request',
  'help_resolved',
  'evidence_deleted'
];

const EVENT_TYPE_SET = new Set(EVENT_TYPES);

function appendEvent(transaction, orderRef, event) {
  const type = event && event.type;
  if (!EVENT_TYPE_SET.has(type)) {
    const error = new Error(`Unknown marketplace event type: ${type}`);
    error.code = 'UNKNOWN_EVENT_TYPE';
    throw error;
  }

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
  return ref.id;
}

module.exports = {
  EVENT_TYPES,
  appendEvent
};
