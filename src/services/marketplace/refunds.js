const crypto = require('crypto');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('../firebase');
const { MARKETPLACE_DEFAULTS } = require('../../config/marketplaceDefaults');
const { isValidUtr, isValidUpiId, toPaise } = require('../../validators/marketplace');
const { appendEvent } = require('./orderEvents');
const displayIdService = require('../displayIdService');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN_STATUSES = new Set(['upi_needed', 'due', 'sent', 'disputed']);
const SENT_OR_LATER = new Set(['sent', 'confirmed', 'disputed', 'closed']);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function requireUuid(idempotencyKey) {
  if (typeof idempotencyKey !== 'string' || !UUID_PATTERN.test(idempotencyKey.trim())) {
    throw httpError(400, 'VALIDATION', 'Idempotency-Key must be a UUID');
  }
}

function millisOf(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function toIso(value) {
  const ms = millisOf(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function blankReminders() {
  return {
    upi24: false,
    upi72: false,
    upiAlert7d: false,
    due24: false,
    due48: false,
    ack24: false
  };
}

function isCancelled(orderStatus) {
  return orderStatus === 'cancelled';
}

function displayVariables(data, orderId) {
  const snapshot = data && data.shopSnapshot && typeof data.shopSnapshot === 'object' ? data.shopSnapshot : {};
  return {
    displayId: displayIdService.formatDisplayId(data && data.displayId),
    orderId,
    shopName: typeof snapshot.name === 'string' ? snapshot.name : ''
  };
}

function sameMoney(left, right) {
  if (typeof left !== 'number' || typeof right !== 'number') {
    return false;
  }
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }
  return Math.round(left * 100) === Math.round(right * 100);
}

function last4(value) {
  return typeof value === 'string' && value.length >= 4 ? value.slice(-4) : null;
}

function refundsCollection(orderRef) {
  return orderRef.collection('refunds');
}

async function readRefundDocs(tx, orderRef) {
  const snap = await tx.get(refundsCollection(orderRef));
  return snap.docs.map((doc) => ({
    id: doc.id,
    ref: doc.ref,
    data: doc.data() || {}
  }));
}

function sumStoredRefundPaise(refunds) {
  return refunds.reduce((sum, refund) => {
    const amount = refund.data ? refund.data.amount : null;
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      return sum;
    }
    return sum + toPaise(amount);
  }, 0);
}

async function refundRemainder(tx, orderRef, receivedPaise) {
  const refunds = await readRefundDocs(tx, orderRef);
  const base = Number.isFinite(receivedPaise) ? receivedPaise : 0;
  return {
    refunds,
    remainderPaise: Math.max(0, base - sumStoredRefundPaise(refunds))
  };
}

function statusAfter(refunds, refundId, nextStatus) {
  return refunds.some((refund) => {
    const status = refund.id === refundId ? nextStatus : refund.data.status;
    return OPEN_STATUSES.has(status);
  });
}

function mirrorPatch(data, hasOpen) {
  const patch = { hasOpenRefund: hasOpen };
  if (!isCancelled(data.orderStatus)) {
    return patch;
  }
  patch['payment.status'] = hasOpen ? 'refund_pending' : 'refunded';
  return patch;
}

function createRefund(tx, {
  orderRef,
  data,
  reason,
  amount,
  items,
  actor,
  eventReason,
  resultingOrderStatus
}) {
  const orderStatus = resultingOrderStatus || (data && data.orderStatus);
  const refundId = crypto.randomBytes(8).toString('hex');
  const refundRef = refundsCollection(orderRef).doc(refundId);
  const stamp = FieldValue.serverTimestamp();
  tx.set(refundRef, {
    id: refundId,
    orderId: orderRef.id,
    shopId: data.shopId || null,
    customerId: data.customerId || null,
    reason,
    amount: amount == null ? null : amount,
    items: Array.isArray(items) ? items : [],
    status: 'upi_needed',
    customerUpiId: null,
    upiSubmittedAt: null,
    dueBy: null,
    refundUtr: null,
    sentAmount: null,
    sentAt: null,
    ackAt: null,
    autoClosedAt: null,
    upiChaseFrom: stamp,
    reminders: blankReminders(),
    overdueCounted: false,
    createdAt: stamp,
    updatedAt: stamp
  });
  const patch = {
    hasOpenRefund: true,
    updatedAt: stamp
  };
  if (isCancelled(orderStatus)) {
    patch['payment.status'] = 'refund_pending';
  }
  tx.update(orderRef, patch);
  appendEvent(tx, orderRef, {
    type: 'refund_created',
    actor,
    reason: eventReason == null ? null : eventReason,
    data: { reason }
  });
  return { refundId, amount };
}

async function hasReason(tx, orderRef, reason) {
  const refunds = await readRefundDocs(tx, orderRef);
  return refunds.some((refund) => refund.data.reason === reason);
}

function presentCustomerRefund(refund) {
  const source = refund && typeof refund === 'object' ? refund : {};
  const status = source.status ?? null;
  return {
    id: source.id ?? null,
    reason: source.reason ?? null,
    status,
    amount: source.amount ?? null,
    dueBy: toIso(source.dueBy),
    customerUpiId: source.customerUpiId ?? null,
    refundUtr: SENT_OR_LATER.has(status) ? (source.refundUtr ?? null) : null
  };
}

function presentShopRefund(refund, orderId) {
  const source = refund && typeof refund === 'object' ? refund : {};
  const status = source.status ?? null;
  const sent = SENT_OR_LATER.has(status);
  return {
    id: source.id ?? null,
    orderId: orderId ?? source.orderId ?? null,
    reason: source.reason ?? null,
    status,
    amount: source.amount ?? null,
    dueBy: toIso(source.dueBy),
    customerUpiId: source.customerUpiId ?? null,
    refundUtr: sent ? (source.refundUtr ?? null) : null,
    sentAmount: sent ? (source.sentAmount ?? null) : null
  };
}

async function loadRefundDocs(orderRef) {
  if (!orderRef || typeof orderRef.collection !== 'function') {
    return [];
  }
  const collection = orderRef.collection('refunds');
  if (!collection || typeof collection.get !== 'function') {
    return [];
  }
  const snap = await collection.get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

function ownedRefund(orderSnap, refundSnap, customerId) {
  if (!orderSnap.exists) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const data = orderSnap.data() || {};
  if (customerId && data.customerId !== customerId) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  if (!refundSnap.exists) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Refund not found');
  }
  return { data, refund: refundSnap.data() || {} };
}

async function notifyUser(userId, template, variables) {
  if (!userId) {
    return;
  }
  try {
    const result = await require('../notificationService').sendTemplateNotification(
      userId,
      'MARKETPLACE',
      template,
      variables
    );
    if (result && result.success === false) {
      console.error('❌ [REFUNDS] Notification failed', template);
    }
  } catch (error) {
    console.error('❌ [REFUNDS] Notification failed', error.message);
  }
}

async function submitCustomerUpi({
  customerId,
  orderId,
  refundId,
  idempotencyKey,
  upiId,
  upiIdConfirm,
  save,
  nowMs
}) {
  requireUuid(idempotencyKey);
  const left = typeof upiId === 'string' ? upiId.trim() : '';
  const right = typeof upiIdConfirm === 'string' ? upiIdConfirm.trim() : '';
  if (!isValidUpiId(left) || !isValidUpiId(right)) {
    throw httpError(400, 'INVALID_UPI', 'Enter a valid UPI ID');
  }
  if (left !== right) {
    throw httpError(400, 'MISMATCH', 'UPI IDs do not match');
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const refundRef = refundsCollection(orderRef).doc(refundId);
  const userRef = db.collection('users').doc(customerId);

  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const refundSnap = await tx.get(refundRef);
    const userSnap = save === true ? await tx.get(userRef) : null;
    const { data, refund } = ownedRefund(orderSnap, refundSnap, customerId);
    if (refund.upiIdempotencyKey === idempotencyKey.trim() && refund.status !== 'upi_needed') {
      return { replay: true, data, refund, shopId: data.shopId };
    }
    if (refund.status !== 'upi_needed') {
      throw httpError(409, 'ALREADY_SUBMITTED', 'A UPI ID is already on this refund');
    }
    const dueBy = Timestamp.fromMillis(now + (MARKETPLACE_DEFAULTS.REFUND_DUE_HOURS * HOUR_MS));
    const stamp = FieldValue.serverTimestamp();
    tx.update(refundRef, {
      customerUpiId: left,
      upiSubmittedAt: Timestamp.fromMillis(now),
      dueBy,
      status: 'due',
      upiIdempotencyKey: idempotencyKey.trim(),
      updatedAt: stamp
    });
    if (save === true && userSnap) {
      const patch = { 'customer.marketplace.refundUpiId': left };
      if (userSnap.exists) {
        tx.update(userRef, patch);
      } else {
        tx.set(userRef, { customer: { marketplace: { refundUpiId: left } } });
      }
    }
    appendEvent(tx, orderRef, {
      type: 'refund_upi',
      actor: { type: 'customer', id: customerId },
      data: null
    });
    return {
      replay: false,
      data,
      refund: { ...refund, status: 'due', customerUpiId: left, dueBy },
      shopId: data.shopId
    };
  });

  if (!outcome.replay) {
    await notifyUser(outcome.shopId, 'REFUND_DUE', displayVariables(outcome.data, orderId));
  }
  return {
    status: 200,
    body: {
      success: true,
      data: { refund: presentCustomerRefund({ ...outcome.refund, id: refundId }) }
    }
  };
}

async function acknowledgeRefund({
  customerId,
  orderId,
  refundId,
  received,
  idempotencyKey,
  nowMs
}) {
  requireUuid(idempotencyKey);
  if (typeof received !== 'boolean') {
    throw httpError(400, 'VALIDATION', 'received must be true or false');
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const refundRef = refundsCollection(orderRef).doc(refundId);

  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const refundSnap = await tx.get(refundRef);
    const { data, refund } = ownedRefund(orderSnap, refundSnap, customerId);
    const refunds = await readRefundDocs(tx, orderRef);
    if (refund.ackIdempotencyKey === idempotencyKey.trim()
      && refund.status !== 'sent'
      && refund.status !== 'closed') {
      return { replay: true, data, refund, notifies: [] };
    }
    const lateWindow = MARKETPLACE_DEFAULTS.REFUND_LATE_DISPUTE_DAYS * DAY_MS;
    const closedMs = millisOf(refund.autoClosedAt);
    const lateOpen = refund.status === 'closed'
      && Number.isFinite(closedMs)
      && now < closedMs + lateWindow;
    let nextStatus;
    let late = false;
    if (received === true && refund.status === 'sent') {
      nextStatus = 'confirmed';
    } else if (received === false && refund.status === 'sent') {
      nextStatus = 'disputed';
    } else if (received === false && lateOpen) {
      nextStatus = 'disputed';
      late = true;
    } else {
      throw httpError(409, 'INVALID_STATE', 'This refund cannot be acknowledged');
    }
    const stamp = FieldValue.serverTimestamp();
    const patch = {
      status: nextStatus,
      ackIdempotencyKey: idempotencyKey.trim(),
      updatedAt: stamp
    };
    if (nextStatus === 'confirmed') {
      patch.ackAt = stamp;
    }
    tx.update(refundRef, patch);
    const hasOpen = statusAfter(refunds, refundId, nextStatus);
    tx.update(orderRef, {
      ...mirrorPatch(data, hasOpen),
      updatedAt: stamp
    });
    appendEvent(tx, orderRef, {
      type: nextStatus === 'confirmed' ? 'refund_ack' : 'refund_disputed',
      actor: { type: 'customer', id: customerId },
      data: nextStatus === 'confirmed' ? { received: true } : { late }
    });
    const variables = displayVariables(data, orderId);
    const notifies = nextStatus === 'confirmed'
      ? [{ template: 'REFUND_CLOSED', variables }]
      : [{ template: 'REFUND_DISPUTED', variables }];
    return {
      replay: false,
      data,
      refund: { ...refund, status: nextStatus },
      notifies,
      alert: nextStatus === 'disputed'
    };
  });

  if (!outcome.replay) {
    await notifyUser(outcome.data.customerId, outcome.notifies[0].template, outcome.notifies[0].variables);
    await notifyUser(outcome.data.shopId, outcome.notifies[0].template, outcome.notifies[0].variables);
    if (outcome.alert) {
      alertRefund('Marketplace refund disputed', orderId, refundId);
    }
  }
  return {
    status: 200,
    body: {
      success: true,
      data: { refund: presentCustomerRefund({ ...outcome.refund, id: refundId }) }
    }
  };
}

async function markRefundSent({
  shopId,
  orderId,
  refundId,
  refundUtr,
  amount,
  actor,
  eventReason,
  nowMs
}) {
  if (!isValidUtr(refundUtr)) {
    throw httpError(400, 'VALIDATION', 'Refund UTR must be 12 digits');
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw httpError(400, 'VALIDATION', 'amount must be a number');
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const refundRef = refundsCollection(orderRef).doc(refundId);
  const registryRef = db.collection('utrRegistry').doc(refundUtr);

  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const refundSnap = await tx.get(refundRef);
    const registrySnap = await tx.get(registryRef);
    if (!orderSnap.exists || (shopId && (orderSnap.data() || {}).shopId !== shopId)) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    if (!refundSnap.exists) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Refund not found');
    }
    const data = orderSnap.data() || {};
    const refund = refundSnap.data() || {};
    if (refund.status === 'sent' && refund.refundUtr === refundUtr) {
      return { alreadyProcessed: true, data, refund };
    }
    if (refund.status === 'sent') {
      throw httpError(409, 'ALREADY_SUBMITTED', 'This refund was already marked sent');
    }
    if (refund.status !== 'due') {
      throw httpError(409, 'INVALID_STATE', 'A refund UTR can only be recorded while it is due');
    }
    if (!sameMoney(amount, refund.amount)) {
      throw httpError(400, 'AMOUNT_MISMATCH', 'Amount must equal the refund due');
    }
    if (registrySnap.exists) {
      throw httpError(409, 'UTR_USED', 'This UTR is already used');
    }
    const at = Timestamp.fromMillis(now);
    const stamp = FieldValue.serverTimestamp();
    tx.set(registryRef, {
      orderId,
      customerId: data.customerId || null,
      kind: 'refund',
      at
    });
    tx.update(refundRef, {
      refundUtr,
      sentAmount: amount,
      sentAt: stamp,
      status: 'sent',
      updatedAt: stamp
    });
    appendEvent(tx, orderRef, {
      type: 'refund_sent',
      actor,
      reason: eventReason == null ? null : eventReason,
      data: { refundUtrLast4: last4(refundUtr) }
    });
    return { alreadyProcessed: false, data, refund: { ...refund, status: 'sent', refundUtr, sentAmount: amount } };
  });

  if (!outcome.alreadyProcessed) {
    await notifyUser(outcome.data.customerId, 'REFUND_SENT', {
      ...displayVariables(outcome.data, orderId),
      refundUtr
    });
  }
  return {
    alreadyProcessed: outcome.alreadyProcessed,
    refund: presentShopRefund({ ...outcome.refund, id: refundId }, orderId)
  };
}

async function resolveRefundDispute({
  orderId,
  refundId,
  outcome,
  to,
  operator,
  nowMs
}) {
  if (outcome !== 'received' && outcome !== 'resend') {
    throw httpError(400, 'VALIDATION', 'outcome must be received or resend');
  }
  if (outcome === 'resend' && to !== 'due' && to !== 'upi_needed') {
    throw httpError(400, 'VALIDATION', 'resend requires --to due or upi_needed');
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const refundRef = refundsCollection(orderRef).doc(refundId);
  const actor = { type: 'support', id: operator || 'support' };

  const result = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const refundSnap = await tx.get(refundRef);
    if (!orderSnap.exists || !refundSnap.exists) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Refund not found');
    }
    const data = orderSnap.data() || {};
    const refund = refundSnap.data() || {};
    const refunds = await readRefundDocs(tx, orderRef);
    if (refund.status !== 'disputed') {
      throw httpError(409, 'INVALID_STATE', 'Only a disputed refund can be resolved');
    }
    const stamp = FieldValue.serverTimestamp();
    if (outcome === 'received') {
      tx.update(refundRef, { status: 'confirmed', ackAt: stamp, updatedAt: stamp });
      const hasOpen = statusAfter(refunds, refundId, 'confirmed');
      tx.update(orderRef, { ...mirrorPatch(data, hasOpen), updatedAt: stamp });
      appendEvent(tx, orderRef, {
        type: 'refund_ack',
        actor,
        data: { received: true }
      });
      return { data, template: 'REFUND_CLOSED', refund: { ...refund, status: 'confirmed' } };
    }
    const reminders = {
      ...(refund.reminders && typeof refund.reminders === 'object' ? refund.reminders : blankReminders()),
      due24: false,
      due48: false
    };
    const patch = {
      refundUtr: null,
      sentAmount: null,
      sentAt: null,
      status: to,
      reminders,
      updatedAt: stamp
    };
    if (to === 'due') {
      patch.dueBy = Timestamp.fromMillis(now + (MARKETPLACE_DEFAULTS.REFUND_DUE_HOURS * HOUR_MS));
    } else {
      patch.customerUpiId = null;
      patch.upiSubmittedAt = null;
      patch.dueBy = null;
      patch.upiChaseFrom = stamp;
      patch.reminders = {
        ...reminders,
        upi24: false,
        upi72: false,
        upiAlert7d: false
      };
    }
    appendEvent(tx, orderRef, {
      type: 'refund_resent',
      actor,
      data: {
        to,
        refundUtrLast4: last4(refund.refundUtr),
        sentAt: toIso(refund.sentAt)
      }
    });
    tx.update(refundRef, patch);
    tx.update(orderRef, { ...mirrorPatch(data, true), updatedAt: stamp });
    return { data, template: null, refund: { ...refund, ...patch, id: refundId } };
  });

  if (result.template) {
    const variables = displayVariables(result.data, orderId);
    await notifyUser(result.data.customerId, result.template, variables);
    await notifyUser(result.data.shopId, result.template, variables);
  }
  return { wrote: true, refund: presentShopRefund(result.refund, orderId) };
}

async function recordFoundRefund({ orderId, amount, operator, reason }) {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    throw httpError(400, 'VALIDATION', 'amount must be a positive number');
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw httpError(400, 'VALIDATION', 'reason text is required');
  }
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const note = reason.trim();
  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    const data = orderSnap.data() || {};
    const payment = data.payment || {};
    const review = payment.review && typeof payment.review === 'object' ? payment.review : null;
    if (data.orderStatus === 'payment_review' || (review && review.status === 'open')) {
      throw httpError(409, 'INVALID_STATE', 'An open review cannot be refunded from here');
    }
    const existing = (await readRefundDocs(tx, orderRef))
      .find((refund) => refund.data.reason === 'support_decision');
    if (existing) {
      throw httpError(409, 'INVALID_STATE', `A found refund is already recorded (refund ${existing.id})`);
    }
    if (data.closedReason !== 'payment_not_verified' || payment.status !== 'not_verified') {
      throw httpError(409, 'INVALID_STATE', 'Only a not-verified cancellation can record a found refund');
    }
    const created = createRefund(tx, {
      orderRef,
      data,
      reason: 'support_decision',
      amount,
      items: Array.isArray(data.items) ? data.items : [],
      actor: { type: 'support', id: operator || 'support' },
      eventReason: note,
      resultingOrderStatus: 'cancelled'
    });
    tx.update(orderRef, {
      'payment.receivedAmount': amount,
      'payment.receivedAmountPaise': toPaise(amount)
    });
    return { data, refundId: created.refundId };
  });
  await notifyUser(outcome.data.customerId, 'REFUND_INITIATED', displayVariables(outcome.data, orderId));
  return { wrote: true, refundId: outcome.refundId, orderStatus: 'cancelled' };
}

function matchesShopFilter(refund, status, nowMs) {
  if (status === 'sent') {
    return refund.status === 'sent';
  }
  if (status === 'due') {
    return refund.status === 'due';
  }
  if (status === 'overdue') {
    const dueMs = millisOf(refund.dueBy);
    return refund.status === 'due' && Number.isFinite(dueMs) && nowMs > dueMs;
  }
  return OPEN_STATUSES.has(refund.status);
}

async function listShopRefunds(shopId, status, nowMs) {
  const allowed = new Set(['due', 'overdue', 'sent']);
  if (status !== undefined && status !== null && String(status).trim() !== '' && !allowed.has(String(status))) {
    throw httpError(400, 'VALIDATION', 'status must be due, overdue, or sent');
  }
  const filter = status ? String(status) : null;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const db = getFirestore();
  const snap = await db.collection('marketplaceOrders')
    .where('shopId', '==', shopId)
    .where('hasOpenRefund', '==', true)
    .get();
  const rows = [];
  for (let index = 0; index < snap.docs.length; index += 1) {
    const orderDoc = snap.docs[index];
    const refundSnap = await orderDoc.ref.collection('refunds').get();
    refundSnap.docs.forEach((refundDoc) => {
      const refund = { id: refundDoc.id, ...(refundDoc.data() || {}) };
      if (matchesShopFilter(refund, filter, now)) {
        rows.push(presentShopRefund(refund, orderDoc.id));
      }
    });
  }
  return rows;
}

function alertRefund(message, orderId, refundId) {
  console.warn(`⚠️ [REFUNDS] ${message}`, { orderId, refundId });
  try {
    const Sentry = require('../../../instrument.js');
    if (Sentry && typeof Sentry.captureMessage === 'function') {
      Sentry.captureMessage(message, {
        level: 'warning',
        extra: { orderId, refundId }
      });
    }
  } catch (error) {
    console.error('❌ [REFUNDS] Alert failed', error.message);
  }
}

module.exports = {
  OPEN_STATUSES,
  createRefund,
  hasReason,
  refundRemainder,
  presentCustomerRefund,
  presentShopRefund,
  loadRefundDocs,
  submitCustomerUpi,
  acknowledgeRefund,
  markRefundSent,
  resolveRefundDispute,
  recordFoundRefund,
  listShopRefunds,
  alertRefund,
  millisOf,
  mirrorPatch
};
