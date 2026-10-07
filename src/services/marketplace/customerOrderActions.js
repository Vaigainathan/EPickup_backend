const { Timestamp } = require('firebase-admin/firestore');
const { getFirestore } = require('../firebase');
const { MARKETPLACE_DEFAULTS } = require('../../config/marketplaceDefaults');
const { isValidUtr } = require('../../validators/marketplace');
const { presentCustomerOrder } = require('./customerOrderView');
const { appendEvent } = require('./orderEvents');
const displayIdService = require('../displayIdService');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOMER_CANCEL_REASONS = new Set(['customer_unpaid_cancel', 'customer_cancel']);

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
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
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function acceptHoursFrom(settingsData) {
  const source = settingsData && typeof settingsData === 'object' ? settingsData : {};
  const raw = Object.prototype.hasOwnProperty.call(source, 'UTR_ACCEPT_HOURS')
    ? source.UTR_ACCEPT_HOURS
    : MARKETPLACE_DEFAULTS.UTR_ACCEPT_HOURS;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    return MARKETPLACE_DEFAULTS.UTR_ACCEPT_HOURS;
  }
  return hours;
}

function isWithinUtrWindow(startMs, nowMs, hours) {
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs) || !Number.isFinite(hours)) {
    return false;
  }
  return nowMs <= startMs + (hours * 60 * 60 * 1000);
}

function requireUuid(idempotencyKey) {
  if (typeof idempotencyKey !== 'string' || !UUID_PATTERN.test(idempotencyKey.trim())) {
    throw httpError(400, 'VALIDATION', 'Idempotency-Key must be a UUID');
  }
}

function ownedOrder(snapshot, customerId) {
  if (!snapshot.exists) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const data = snapshot.data() || {};
  if (data.customerId !== customerId) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  return data;
}

function unpaidCountOf(userSnap) {
  if (!userSnap || !userSnap.exists) {
    return 0;
  }
  const data = userSnap.data() || {};
  const value = data.customer && data.customer.marketplace
    ? data.customer.marketplace.unpaidCount
    : 0;
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function orderResponse(status, data, orderId) {
  return {
    status,
    body: {
      success: true,
      data: {
        order: presentCustomerOrder({ ...data, id: orderId })
      }
    }
  };
}

async function notifyShop(shopId, template, variables) {
  if (!shopId) {
    return;
  }
  try {
    const notificationService = require('../notificationService');
    const result = await notificationService.sendTemplateNotification(shopId, 'MARKETPLACE', template, variables);
    if (result && result.success === false) {
      console.error(`❌ [MARKETPLACE_ORDER] push ${template} failed`, result.error || result);
    }
  } catch (error) {
    console.error(`❌ [MARKETPLACE_ORDER] push ${template} failed`, error);
  }
}

function displayLabel(data) {
  return displayIdService.formatDisplayId(data.displayId);
}

async function submitCustomerUtr({ customerId, orderId, idempotencyKey, utr, nowMs }) {
  requireUuid(idempotencyKey);
  if (!isValidUtr(utr)) {
    throw httpError(400, 'INVALID_UTR', 'UTR must be exactly 12 digits');
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const registryRef = db.collection('utrRegistry').doc(String(utr));

  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const data = ownedOrder(orderSnap, customerId);
    const payment = data.payment || {};
    const storedUtr = payment.customerUtr || null;
    if (storedUtr === utr) {
      return { replay: true, data };
    }
    if (storedUtr) {
      throw httpError(409, 'ALREADY_SUBMITTED', 'A UTR was already submitted for this order');
    }

    const registrySnap = await tx.get(registryRef);
    const settingsSnap = await tx.get(db.collection('appSettings').doc('marketplace'));
    if (registrySnap.exists) {
      const registry = registrySnap.data() || {};
      if (registry.orderId === orderId) {
        return { replay: true, data };
      }
      throw httpError(409, 'UTR_USED', 'This UTR is already used');
    }

    const at = Timestamp.fromMillis(now);
    const nextPayment = {
      ...payment,
      customerUtr: utr,
      utrSubmittedAt: at
    };
    let nextStatus = data.orderStatus;
    const events = ['utr_submitted'];

    if (data.orderStatus === 'awaiting_payment' && payment.status === 'pending') {
      nextPayment.status = 'customer_claimed';
    } else if (data.orderStatus === 'payment_unconfirmed') {
      const startMs = millisOf(data.window && data.window.start);
      const hours = acceptHoursFrom(settingsSnap.exists ? settingsSnap.data() : null);
      if (!isWithinUtrWindow(startMs, now, hours)) {
        throw httpError(409, 'UTR_WINDOW_CLOSED', 'The UTR window is closed');
      }
      nextPayment.status = 'under_review';
      nextStatus = 'payment_review';
      events.push('review_opened');
    } else {
      throw httpError(409, 'INVALID_STATE', 'Order cannot accept a UTR in its current state');
    }

    const patch = {
      orderStatus: nextStatus,
      payment: nextPayment,
      updatedAt: at
    };
    tx.update(orderRef, {
      orderStatus: nextStatus,
      'payment.customerUtr': utr,
      'payment.status': nextPayment.status,
      'payment.utrSubmittedAt': at,
      updatedAt: at
    });
    tx.set(registryRef, {
      orderId,
      customerId,
      kind: 'customer',
      at
    });
    events.forEach((type) => {
      appendEvent(tx, orderRef, {
        type,
        actor: { type: 'customer', id: customerId },
        data: { utr }
      });
    });
    return {
      replay: false,
      data: { ...data, ...patch },
      shopId: data.shopId,
      displayId: displayLabel(data)
    };
  });

  if (!outcome.replay) {
    await notifyShop(outcome.shopId, 'UTR_SUBMITTED', { displayId: outcome.displayId });
  }
  return orderResponse(200, outcome.data, orderId);
}

async function cancelCustomerOrder({ customerId, orderId, idempotencyKey, nowMs }) {
  requireUuid(idempotencyKey);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);

  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    const data = ownedOrder(orderSnap, customerId);
    const payment = data.payment || {};
    const cancellation = data.cancellation || {};
    if (data.orderStatus === 'cancelled' && CUSTOMER_CANCEL_REASONS.has(cancellation.reason)) {
      return { replay: true, data };
    }
    if (payment.status === 'short' || data.orderStatus !== 'awaiting_payment') {
      throw httpError(409, 'CANCEL_NOT_ALLOWED', 'This order cannot be cancelled');
    }

    const lockRef = db.collection('marketplaceLocks').doc(`${customerId}_${data.shopId}`);
    const userRef = db.collection('users').doc(customerId);
    const lockSnap = await tx.get(lockRef);
    const userSnap = await tx.get(userRef);
    const hasUtr = Boolean(payment.customerUtr);
    const reason = hasUtr ? 'customer_cancel' : 'customer_unpaid_cancel';
    const at = Timestamp.fromMillis(now);
    const nextCancellation = {
      reason,
      cancelledBy: 'customer',
      requestedBy: 'customer',
      cancelledAt: at
    };
    if (hasUtr) {
      nextCancellation.paidCheck = 'pending';
      nextCancellation.paidCheckAt = at;
    }
    const nextPayment = {
      ...payment,
      status: hasUtr ? payment.status : 'cancelled'
    };
    tx.update(orderRef, {
      orderStatus: 'cancelled',
      closedReason: reason,
      cancellation: nextCancellation,
      'payment.status': nextPayment.status,
      updatedAt: at
    });
    const lockData = lockSnap.exists ? (lockSnap.data() || {}) : null;
    if (lockData && lockData.orderId === orderId) {
      tx.delete(lockRef);
    }
    const unpaidCount = unpaidCountOf(userSnap);
    if (unpaidCount > 0) {
      tx.update(userRef, {
        'customer.marketplace.unpaidCount': unpaidCount - 1
      });
    }
    appendEvent(tx, orderRef, {
      type: 'cancelled',
      actor: { type: 'customer', id: customerId },
      data: { reason }
    });
    return {
      replay: false,
      hasUtr,
      shopId: data.shopId,
      displayId: displayLabel(data),
      data: {
        ...data,
        orderStatus: 'cancelled',
        closedReason: reason,
        cancellation: nextCancellation,
        payment: nextPayment,
        updatedAt: at
      }
    };
  });

  if (!outcome.replay) {
    const detail = outcome.hasUtr
      ? 'Check whether you received the payment.'
      : 'No payment was recorded.';
    await notifyShop(outcome.shopId, 'CUSTOMER_CANCELLED', {
      displayId: outcome.displayId,
      detail
    });
  }
  return orderResponse(200, outcome.data, orderId);
}

module.exports = {
  submitCustomerUtr,
  cancelCustomerOrder,
  isWithinUtrWindow,
  acceptHoursFrom
};
