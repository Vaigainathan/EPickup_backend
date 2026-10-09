const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('../firebase');
const { MARKETPLACE_DEFAULTS } = require('../../config/marketplaceDefaults');
const { isValidUtr, toPaise, fromPaise } = require('../../validators/marketplace');
const { presentCustomerOrder } = require('./customerOrderView');
const { appendEvent } = require('./orderEvents');
const { createRefund, refundRemainder } = require('./refunds');
const { restoreLines } = require('./stock');
const displayIdService = require('../displayIdService');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOMER_CANCEL_REASONS = new Set([
  'customer_unpaid_cancel',
  'customer_cancel',
  'amount_short_cancel'
]);

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

function orderResponse(status, data, orderId, extras) {
  const payload = {
    order: presentCustomerOrder({ ...data, id: orderId })
  };
  if (extras && extras.refund) {
    payload.refund = extras.refund;
  }
  return {
    status,
    body: {
      success: true,
      data: payload
    }
  };
}

async function notifyCustomer(customerId, template, variables) {
  if (!customerId) {
    return;
  }
  try {
    const notificationService = require('../notificationService');
    const result = await notificationService.sendTemplateNotification(customerId, 'MARKETPLACE', template, variables);
    if (result && result.success === false) {
      console.error(`❌ [MARKETPLACE_ORDER] push ${template} failed`, result.error || result);
    }
  } catch (error) {
    console.error(`❌ [MARKETPLACE_ORDER] push ${template} failed`, error);
  }
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

function receivedPaiseOf(data) {
  const payment = data && data.payment ? data.payment : {};
  if (payment.receivedAmountPaise != null && Number.isFinite(Number(payment.receivedAmountPaise))) {
    return Number(payment.receivedAmountPaise);
  }
  if (payment.receivedAmount != null) {
    return toPaise(payment.receivedAmount);
  }
  return 0;
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
    let openedReview = false;

    if (data.orderStatus === 'awaiting_payment' && payment.status === 'pending') {
      nextPayment.status = 'customer_claimed';
    } else if (data.orderStatus === 'payment_unconfirmed') {
      const startMs = millisOf(data.window && data.window.start);
      const hours = acceptHoursFrom(settingsSnap.exists ? settingsSnap.data() : null);
      if (!isWithinUtrWindow(startMs, now, hours)) {
        throw httpError(409, 'UTR_WINDOW_CLOSED', 'The UTR window is closed');
      }
      nextPayment.status = 'under_review';
      nextPayment.review = {
        status: 'open',
        openedAt: FieldValue.serverTimestamp(),
        trigger: 'customer_report',
        shopResponse: null,
        outcome: null
      };
      nextStatus = 'payment_review';
      openedReview = true;
      events.push('review_opened');
    } else {
      throw httpError(409, 'INVALID_STATE', 'Order cannot accept a UTR in its current state');
    }

    const shopRef = openedReview ? db.collection('shops').doc(data.shopId) : null;
    const shopSnap = shopRef ? await tx.get(shopRef) : null;
    const patch = {
      orderStatus: nextStatus,
      payment: nextPayment,
      updatedAt: at
    };
    const orderPatch = {
      orderStatus: nextStatus,
      'payment.customerUtr': utr,
      'payment.status': nextPayment.status,
      'payment.utrSubmittedAt': at,
      updatedAt: at
    };
    if (openedReview) {
      orderPatch['payment.review'] = nextPayment.review;
      if (shopSnap && shopSnap.exists) {
        const stats = shopSnap.data().marketplaceStats || {};
        const opened = Number(stats.reviewsOpened);
        tx.update(shopRef, {
          'marketplaceStats.reviewsOpened': (Number.isFinite(opened) ? opened : 0) + 1
        });
      }
    }
    tx.update(orderRef, orderPatch);
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
        data: type === 'review_opened' ? { trigger: 'customer_report' } : { utr }
      });
    });
    const snapshot = data.shopSnapshot && typeof data.shopSnapshot === 'object' ? data.shopSnapshot : {};
    return {
      replay: false,
      openedReview,
      data: { ...data, ...patch },
      shopId: data.shopId,
      displayId: displayLabel(data),
      orderId,
      shopName: typeof snapshot.name === 'string' ? snapshot.name : ''
    };
  });

  if (!outcome.replay && outcome.openedReview) {
    const variables = {
      displayId: outcome.displayId,
      orderId: outcome.orderId,
      shopName: outcome.shopName
    };
    await notifyCustomer(customerId, 'PAYMENT_UNDER_REVIEW', variables);
    await notifyShop(outcome.shopId, 'PAYMENT_REVIEW_SHOP', variables);
  } else if (!outcome.replay) {
    await notifyShop(outcome.shopId, 'UTR_SUBMITTED', {
      displayId: outcome.displayId,
      orderId
    });
  }
  return orderResponse(200, outcome.data, orderId);
}

async function submitBalanceUtr({ customerId, orderId, idempotencyKey, utr, nowMs }) {
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
    const balance = payment.balance && typeof payment.balance === 'object' ? payment.balance : {};
    if (payment.status !== 'short' || data.orderStatus !== 'awaiting_payment') {
      throw httpError(409, 'INVALID_STATE', 'This order is not waiting for a balance UTR');
    }
    const dueMs = millisOf(balance.dueBy);
    if (!Number.isFinite(dueMs) || now >= dueMs) {
      throw httpError(409, 'BALANCE_WINDOW_CLOSED', 'The balance window is closed');
    }
    if (balance.utr === utr) {
      return { replay: true, data };
    }
    if (balance.utr) {
      throw httpError(409, 'ALREADY_SUBMITTED', 'A balance UTR was already submitted for this order');
    }

    const registrySnap = await tx.get(registryRef);
    if (registrySnap.exists) {
      throw httpError(409, 'UTR_USED', 'This UTR is already used');
    }

    const at = Timestamp.fromMillis(now);
    const nextBalance = {
      ...balance,
      utr,
      submittedAt: at
    };
    tx.update(orderRef, {
      'payment.balance': nextBalance,
      updatedAt: at
    });
    tx.set(registryRef, {
      orderId,
      customerId,
      kind: 'balance',
      at
    });
    appendEvent(tx, orderRef, {
      type: 'balance_utr',
      actor: { type: 'customer', id: customerId },
      data: { utr }
    });
    return {
      replay: false,
      data: {
        ...data,
        payment: { ...payment, balance: nextBalance },
        updatedAt: at
      },
      shopId: data.shopId,
      displayId: displayLabel(data)
    };
  });

  if (!outcome.replay) {
    await notifyShop(outcome.shopId, 'UTR_SUBMITTED', {
      displayId: outcome.displayId,
      orderId
    });
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
    if (data.orderStatus === 'payment_review') {
      throw httpError(409, 'INVALID_STATE', 'An open payment review cannot be cancelled here');
    }
    if (data.orderStatus === 'cancelled' && CUSTOMER_CANCEL_REASONS.has(cancellation.reason)) {
      return { replay: true, data };
    }
    if (payment.status === 'short') {
      if (data.orderStatus !== 'awaiting_payment') {
        throw httpError(409, 'CANCEL_NOT_ALLOWED', 'This order cannot be cancelled');
      }
      const lockRef = db.collection('marketplaceLocks').doc(`${customerId}_${data.shopId}`);
      const userRef = db.collection('users').doc(customerId);
      const lockSnap = await tx.get(lockRef);
      const userSnap = await tx.get(userRef);
      const at = Timestamp.fromMillis(now);
      const reason = 'amount_short_cancel';
      const refundAmount = payment.receivedAmount != null ? payment.receivedAmount : null;
      const nextCancellation = {
        reason,
        cancelledBy: 'customer',
        requestedBy: 'customer',
        cancelledAt: at
      };
      const nextPayment = { ...payment, status: 'refund_pending' };
      tx.update(orderRef, {
        orderStatus: 'cancelled',
        closedReason: reason,
        cancellation: nextCancellation,
        'payment.status': 'refund_pending',
        updatedAt: at
      });
      const created = createRefund(tx, {
        orderRef,
        data,
        reason,
        amount: refundAmount,
        items: data.items,
        actor: { type: 'customer', id: customerId },
        resultingOrderStatus: 'cancelled'
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
        shortRefund: true,
        refundAmount,
        refund: {
          id: created.refundId,
          amount: created.amount,
          status: 'upi_needed'
        },
        shopId: data.shopId,
        displayId: displayLabel(data),
        data: {
          ...data,
          orderStatus: 'cancelled',
          closedReason: reason,
          cancellation: nextCancellation,
          payment: nextPayment,
          hasOpenRefund: true,
          updatedAt: at
        }
      };
    }
    if (data.orderStatus === 'preparing') {
      if (data.policyGroup !== 'B') {
        throw httpError(409, 'CANCEL_NOT_ALLOWED', 'This order cannot be cancelled');
      }
      const userRef = db.collection('users').doc(customerId);
      await tx.get(userRef);
      const paise = receivedPaiseOf(data);
      const remainder = await refundRemainder(tx, orderRef, paise);
      const restored = await restoreLines(tx, db, {
        orderRef,
        items: data.items,
        actor: { type: 'customer', id: customerId }
      });
      const at = Timestamp.fromMillis(now);
      const reason = 'customer_cancel';
      const nextCancellation = {
        reason,
        cancelledBy: 'customer',
        cancelledAt: at
      };
      tx.update(orderRef, {
        orderStatus: 'cancelled',
        closedReason: reason,
        items: restored.items,
        cancellation: nextCancellation,
        updatedAt: at
      });
      let refund = null;
      let refundAmount = null;
      if (remainder.remainderPaise > 0) {
        refundAmount = fromPaise(remainder.remainderPaise);
        const created = createRefund(tx, {
          orderRef,
          data,
          reason,
          amount: refundAmount,
          items: restored.items,
          actor: { type: 'customer', id: customerId },
          resultingOrderStatus: 'cancelled'
        });
        refund = {
          id: created.refundId,
          amount: created.amount,
          status: 'upi_needed'
        };
      }
      appendEvent(tx, orderRef, {
        type: 'cancelled',
        actor: { type: 'customer', id: customerId },
        data: { reason }
      });
      return {
        replay: false,
        groupB: true,
        refund,
        refundAmount,
        shopId: data.shopId,
        displayId: displayLabel(data),
        data: {
          ...data,
          orderStatus: 'cancelled',
          closedReason: reason,
          items: restored.items,
          cancellation: nextCancellation,
          hasOpenRefund: Boolean(refund),
          payment: refund ? { ...payment, status: 'refund_pending' } : payment,
          updatedAt: at
        }
      };
    }
    if (data.orderStatus !== 'awaiting_payment') {
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

  if (!outcome.replay && outcome.groupB) {
    const snapshot = outcome.data && outcome.data.shopSnapshot && typeof outcome.data.shopSnapshot === 'object'
      ? outcome.data.shopSnapshot
      : {};
    const shopName = typeof snapshot.name === 'string' ? snapshot.name : '';
    if (outcome.refund) {
      await notifyCustomer(customerId, 'REFUND_INITIATED', {
        displayId: outcome.displayId,
        orderId,
        shopName,
        amount: outcome.refundAmount
      });
    } else {
      await notifyCustomer(customerId, 'ORDER_CANCELLED', {
        displayId: outcome.displayId,
        orderId,
        shopName,
        reasonLine: ''
      });
    }
    await notifyShop(outcome.shopId, 'CUSTOMER_CANCELLED', {
      displayId: outcome.displayId,
      orderId,
      shopName,
      detail: 'The order was cancelled while preparing.'
    });
    return orderResponse(200, outcome.data, orderId, outcome.refund ? { refund: outcome.refund } : null);
  }
  if (!outcome.replay && outcome.shortRefund) {
    const snapshot = outcome.data && outcome.data.shopSnapshot && typeof outcome.data.shopSnapshot === 'object'
      ? outcome.data.shopSnapshot
      : {};
    await notifyCustomer(customerId, 'REFUND_INITIATED', {
      displayId: outcome.displayId,
      orderId,
      shopName: typeof snapshot.name === 'string' ? snapshot.name : '',
      amount: outcome.refundAmount
    });
    return orderResponse(200, outcome.data, orderId, { refund: outcome.refund });
  }
  if (!outcome.replay) {
    const detail = outcome.hasUtr
      ? 'Check whether you received the payment.'
      : 'No payment was recorded.';
    await notifyShop(outcome.shopId, 'CUSTOMER_CANCELLED', {
      displayId: outcome.displayId,
      orderId,
      detail
    });
  }
  return orderResponse(200, outcome.data, orderId);
}

module.exports = {
  submitCustomerUtr,
  submitBalanceUtr,
  cancelCustomerOrder,
  isWithinUtrWindow,
  acceptHoursFrom
};
