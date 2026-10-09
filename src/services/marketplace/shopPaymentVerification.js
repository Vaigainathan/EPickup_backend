const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('../firebase');
const { MARKETPLACE_DEFAULTS } = require('../../config/marketplaceDefaults');
const marketplaceMoney = require('../../validators/marketplace');
const { isValidUtr } = marketplaceMoney;
const { appendEvent } = require('./orderEvents');
const { deductStock } = require('./stock');
const { createRefund, hasReason, refundRemainder } = require('./refunds');
const { getMarketplaceEnforcement } = require('./orderStateMachine');
const displayIdService = require('../displayIdService');

const POST_CONFIRM_ORDER = new Set(['preparing', 'ready', 'handed_over', 'completed']);
const BLOCKED_CANCEL = new Set(['handed_over', 'completed', 'delivery_failed']);

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
  return null;
}

function nestedNumber(source, path) {
  let cursor = source;
  path.forEach((key) => {
    cursor = cursor && typeof cursor === 'object' ? cursor[key] : undefined;
  });
  const value = Number(cursor);
  return Number.isFinite(value) ? value : 0;
}

async function resolveEnforcement(enforcement) {
  if (enforcement !== undefined && enforcement !== null) {
    return {
      newStatuses: enforcement.newStatuses === true,
      utrBlocksReject: enforcement.utrBlocksReject === true
    };
  }
  return getMarketplaceEnforcement();
}

function graceMsFrom(settingsData) {
  const source = settingsData && typeof settingsData === 'object' ? settingsData : {};
  const raw = Object.prototype.hasOwnProperty.call(source, 'PAYMENT_GRACE_MINUTES')
    ? source.PAYMENT_GRACE_MINUTES
    : MARKETPLACE_DEFAULTS.PAYMENT_GRACE_MINUTES;
  const minutes = Number(raw);
  const safe = Number.isFinite(minutes) && minutes >= 0
    ? minutes
    : MARKETPLACE_DEFAULTS.PAYMENT_GRACE_MINUTES;
  return safe * 60 * 1000;
}

function isPastPaymentGrace(endMs, nowMs, graceMs) {
  if (!Number.isFinite(endMs) || !Number.isFinite(nowMs) || !Number.isFinite(graceMs)) {
    return true;
  }
  return nowMs > endMs + graceMs;
}

async function deductOnPreparing(tx, db, { orderRef, data, actor }) {
  return deductStock(tx, db, {
    orderRef,
    items: data && data.items,
    actor,
    customerId: data && data.customerId
  });
}

function stockOrderFields(result) {
  return {
    items: result.items,
    stockShort: result.stockShort === true,
    stockDeducted: result.orderStockDeducted === true
  };
}

function matchOfficialUtr(payment, body) {
  const payload = body && typeof body === 'object' ? body : {};
  const customerUtr = payment && payment.customerUtr ? String(payment.customerUtr) : '';
  const utrLast4 = payload.utrLast4;
  const fullUtr = payload.fullUtr;
  if (customerUtr) {
    const last4Matches = typeof utrLast4 === 'string'
      && /^\d{4}$/.test(utrLast4)
      && customerUtr.endsWith(utrLast4);
    if (last4Matches) {
      return { officialUtr: customerUtr, utrSource: 'customer', corrected: false };
    }
    if (!isValidUtr(fullUtr)) {
      throw httpError(400, 'FULL_UTR_REQUIRED', 'A 12-digit UTR is required');
    }
    if (fullUtr === customerUtr) {
      return { officialUtr: customerUtr, utrSource: 'customer', corrected: false };
    }
    return { officialUtr: fullUtr, utrSource: 'shop', corrected: true };
  }
  if (!isValidUtr(fullUtr)) {
    throw httpError(400, 'FULL_UTR_REQUIRED', 'A 12-digit UTR is required');
  }
  return { officialUtr: fullUtr, utrSource: 'shop', corrected: false };
}

function assertNoAmountDiffers(body) {
  if (body && body.receivedAmount !== undefined && body.receivedAmount !== null) {
    throw httpError(409, 'AMOUNT_DIFFERS_UNAVAILABLE', 'Amount differs is not available yet');
  }
}

function assertReceivedAmountShape(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw httpError(400, 'VALIDATION', 'receivedAmount must be a positive number with at most 2 decimal places');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) {
    throw httpError(400, 'VALIDATION', 'receivedAmount must be a positive number with at most 2 decimal places');
  }
  return value;
}

function balanceWindowMs(settingsData) {
  const source = settingsData && typeof settingsData === 'object' ? settingsData : {};
  const raw = Object.prototype.hasOwnProperty.call(source, 'BALANCE_WINDOW_MINUTES')
    ? source.BALANCE_WINDOW_MINUTES
    : MARKETPLACE_DEFAULTS.BALANCE_WINDOW_MINUTES;
  const minutes = Number(raw);
  const safe = Number.isFinite(minutes) && minutes >= 0
    ? minutes
    : MARKETPLACE_DEFAULTS.BALANCE_WINDOW_MINUTES;
  return safe * 60 * 1000;
}

function isShortBalanceExpired(data, nowMs) {
  // MP-6 cancels a short order once dueBy has passed and refunds the amount received.
  // A submitted balance UTR does not pause that expiry. Nothing calls this yet.
  const payment = data && data.payment ? data.payment : {};
  if (payment.status !== 'short') {
    return false;
  }
  const dueMs = millisOf(payment.balance && payment.balance.dueBy);
  if (!Number.isFinite(dueMs) || !Number.isFinite(nowMs)) {
    return false;
  }
  return nowMs >= dueMs;
}

function expectedReceivedFields(data) {
  return {
    'payment.receivedAmount': data.expectedAmount != null ? data.expectedAmount : null,
    'payment.receivedAmountPaise': data.expectedAmountPaise != null ? data.expectedAmountPaise : null
  };
}

function receivedPaise(data) {
  const payment = data && data.payment ? data.payment : {};
  if (payment.receivedAmountPaise != null && Number.isFinite(Number(payment.receivedAmountPaise))) {
    return Number(payment.receivedAmountPaise);
  }
  if (payment.receivedAmount != null) {
    return marketplaceMoney.toPaise(payment.receivedAmount);
  }
  if (data && data.expectedAmountPaise != null && Number.isFinite(Number(data.expectedAmountPaise))) {
    return Number(data.expectedAmountPaise);
  }
  if (data && data.expectedAmount != null) {
    return marketplaceMoney.toPaise(data.expectedAmount);
  }
  return 0;
}

function receivedWrite(data) {
  const payment = data && data.payment ? data.payment : {};
  if (payment.receivedAmount != null || payment.receivedAmountPaise != null) {
    return {};
  }
  return expectedReceivedFields(data);
}

const PAID_ON_CANCELLED_REASONS = new Set([
  'customer_unpaid_cancel',
  'unconfirmed_expired',
  'shop_rejected'
]);
const PAID_ON_CANCELLED_BLOCKED = new Set([
  'customer_cancel',
  'balance_expired',
  'payment_not_verified',
  'shop_cancelled',
  'late_unfulfilled',
  'support_cancelled'
]);
const BLOCKED_PAID_PAYMENT = new Set(['confirmed', 'refund_pending', 'refunded']);

function paidOnCancelledKind(data) {
  const payment = data.payment || {};
  const cancellation = data.cancellation || {};
  const reason = cancellation.reason || null;
  const closed = data.closedReason || null;
  if (payment.late && payment.late.onCancelledOrder === true) {
    return 'done';
  }
  if (BLOCKED_PAID_PAYMENT.has(payment.status)) {
    return 'refuse';
  }
  if (PAID_ON_CANCELLED_BLOCKED.has(reason) || PAID_ON_CANCELLED_BLOCKED.has(closed)) {
    return 'refuse';
  }
  const legacyTimeout = payment.status === 'expired' && !closed && !reason;
  const qualifying = PAID_ON_CANCELLED_REASONS.has(reason)
    || PAID_ON_CANCELLED_REASONS.has(closed)
    || legacyTimeout;
  if (!qualifying) {
    return 'refuse';
  }
  return 'allow';
}

async function confirmLateUnfulfilled(tx, {
  db, orderRef, shopId, orderId, data, payment, body, now
}) {
  const matched = matchOfficialUtr(payment, body);
  const registryRef = db.collection('utrRegistry').doc(matched.officialUtr);
  const registrySnap = await tx.get(registryRef);
  const release = await readUnpaidRelease(tx, db, {
    customerId: data.customerId,
    shopId: data.shopId
  });
  const paise = receivedPaise(data);
  const remainder = await refundRemainder(tx, orderRef, paise);
  assertRegistryAvailable(registrySnap, orderId);
  const at = Timestamp.fromMillis(now);
  const userPatch = {};
  if (matched.corrected && release && release.userSnap && release.userSnap.exists) {
    const corrections = nestedNumber(release.userSnap.data(), ['customer', 'marketplace', 'stats', 'utrCorrections']);
    userPatch['customer.marketplace.stats.utrCorrections'] = corrections + 1;
  }
  const reason = 'late_unfulfilled';
  tx.update(orderRef, {
    orderStatus: 'cancelled',
    closedReason: reason,
    'cancellation.reason': reason,
    'cancellation.cancelledAt': at,
    'cancellation.cancelledBy': shopId,
    'payment.officialUtr': matched.officialUtr,
    'payment.utrSource': matched.utrSource,
    'payment.confirmedAt': at,
    'payment.confirmedByShopUid': shopId,
    'payment.late': {
      receivedAt: at,
      confirmedByShopUid: shopId,
      onCancelledOrder: false,
      fulfilled: false
    },
    ...receivedWrite(data),
    updatedAt: at
  });
  writeRegistry(tx, registrySnap, registryRef, {
    orderId,
    customerId: data.customerId,
    kind: matched.utrSource === 'shop' ? 'shop' : 'customer',
    at
  });
  writeUnpaidRelease(tx, release, orderId, false, userPatch);
  appendEvent(tx, orderRef, {
    type: 'shop_confirm',
    actor: { type: 'shop', id: shopId },
    data: { officialUtr: matched.officialUtr, utrSource: matched.utrSource }
  }, data.customerId);
  if (matched.corrected) {
    appendEvent(tx, orderRef, {
      type: 'utr_corrected',
      actor: { type: 'shop', id: shopId },
      data: { officialUtr: matched.officialUtr }
    }, data.customerId);
  }
  appendEvent(tx, orderRef, {
    type: 'cancelled',
    actor: { type: 'shop', id: shopId },
    data: { reason }
  }, data.customerId);
  const variables = displayVariables(data, orderId);
  const notifies = [];
  if (matched.corrected) {
    notifies.push({
      type: 'UTR_CORRECTED',
      variables: { ...variables, utr: matched.officialUtr }
    });
  }
  if (remainder.remainderPaise > 0) {
    const amount = marketplaceMoney.fromPaise(remainder.remainderPaise);
    createRefund(tx, {
      orderRef,
      data,
      reason,
      amount,
      items: data.items,
      actor: { type: 'shop', id: shopId },
      resultingOrderStatus: 'cancelled'
    });
    notifies.push({
      type: 'REFUND_INITIATED',
      variables: { ...variables, amount }
    });
  } else {
    notifies.push({ type: 'ORDER_CANCELLED', variables });
  }
  return {
    alreadyProcessed: false,
    customerId: data.customerId || null,
    notifies
  };
}

async function confirmPaidOnCancelled(tx, {
  db, orderRef, shopId, orderId, data, payment, body, now
}) {
  const kind = paidOnCancelledKind(data);
  if (kind === 'refuse') {
    throw httpError(409, 'INVALID_STATE', 'Order cannot be confirmed in its current state');
  }
  const paise = receivedPaise(data);
  const remainder = await refundRemainder(tx, orderRef, paise);
  const alreadyRefunded = remainder.refunds.some((refund) => refund.data.reason === 'paid_on_cancelled');
  if (kind === 'done' || alreadyRefunded) {
    return { alreadyProcessed: true, customerId: data.customerId || null, notifies: [] };
  }
  const matched = matchOfficialUtr(payment, body);
  const registryRef = db.collection('utrRegistry').doc(matched.officialUtr);
  const registrySnap = await tx.get(registryRef);
  assertRegistryAvailable(registrySnap, orderId);
  const at = Timestamp.fromMillis(now);
  tx.update(orderRef, {
    'payment.officialUtr': matched.officialUtr,
    'payment.utrSource': matched.utrSource,
    'payment.confirmedAt': at,
    'payment.confirmedByShopUid': shopId,
    'payment.late': {
      receivedAt: at,
      confirmedByShopUid: shopId,
      onCancelledOrder: true,
      fulfilled: false
    },
    ...receivedWrite(data),
    updatedAt: at
  });
  writeRegistry(tx, registrySnap, registryRef, {
    orderId,
    customerId: data.customerId,
    kind: matched.utrSource === 'shop' ? 'shop' : 'customer',
    at
  });
  appendEvent(tx, orderRef, {
    type: 'shop_confirm',
    actor: { type: 'shop', id: shopId },
    data: { officialUtr: matched.officialUtr, utrSource: matched.utrSource }
  }, data.customerId);
  const notifies = [];
  if (remainder.remainderPaise > 0) {
    const amount = marketplaceMoney.fromPaise(remainder.remainderPaise);
    createRefund(tx, {
      orderRef,
      data,
      reason: 'paid_on_cancelled',
      amount,
      items: data.items,
      actor: { type: 'shop', id: shopId },
      resultingOrderStatus: 'cancelled'
    });
    notifies.push({
      type: 'REFUND_INITIATED',
      variables: { ...displayVariables(data, orderId), amount }
    });
  }
  return {
    alreadyProcessed: false,
    customerId: data.customerId || null,
    notifies
  };
}

async function readUnpaidRelease(tx, db, { customerId, shopId }) {
  if (!customerId || !shopId) {
    return null;
  }
  const lockRef = db.collection('marketplaceLocks').doc(`${customerId}_${shopId}`);
  const userRef = db.collection('users').doc(customerId);
  const lockSnap = await tx.get(lockRef);
  const userSnap = await tx.get(userRef);
  return {
    lockRef,
    lockSnap,
    userRef,
    userSnap,
    unpaidCount: nestedNumber(userSnap.exists ? userSnap.data() : null, ['customer', 'marketplace', 'unpaidCount'])
  };
}

function writeUnpaidRelease(tx, release, orderId, decrement, extraUserPatch) {
  if (!release) {
    return;
  }
  const lockData = release.lockSnap && release.lockSnap.exists ? (release.lockSnap.data() || {}) : null;
  if (lockData && lockData.orderId === orderId) {
    tx.delete(release.lockRef);
  }
  const userPatch = extraUserPatch ? { ...extraUserPatch } : {};
  if (decrement && release.userSnap && release.userSnap.exists && release.unpaidCount > 0) {
    userPatch['customer.marketplace.unpaidCount'] = release.unpaidCount - 1;
  }
  if (release.userSnap && release.userSnap.exists && Object.keys(userPatch).length > 0) {
    tx.update(release.userRef, userPatch);
  }
}

function assertRegistryAvailable(registrySnap, orderId) {
  if (registrySnap.exists && (registrySnap.data() || {}).orderId !== orderId) {
    throw httpError(409, 'UTR_USED', 'This UTR is already used');
  }
}

function writeRegistry(tx, registrySnap, registryRef, { orderId, customerId, kind, at }) {
  if (registrySnap.exists) {
    return;
  }
  tx.set(registryRef, {
    orderId,
    customerId,
    kind,
    at
  });
}

function displayVariables(data, orderId) {
  const snapshot = data.shopSnapshot && typeof data.shopSnapshot === 'object' ? data.shopSnapshot : {};
  return {
    displayId: displayIdService.formatDisplayId(data.displayId),
    orderId,
    shopName: typeof snapshot.name === 'string' ? snapshot.name : ''
  };
}

function reviewOf(payment) {
  return payment && payment.review && typeof payment.review === 'object' ? payment.review : null;
}

function shopHadDisputed(review) {
  if (!review) {
    return false;
  }
  if (review.trigger === 'shop_not_found') {
    return true;
  }
  return Boolean(review.shopResponse && review.shopResponse.result === 'not_found');
}

function bumpShopStat(tx, shopSnap, shopRef, field) {
  if (!shopSnap || !shopSnap.exists) {
    return;
  }
  const current = nestedNumber(shopSnap.data(), ['marketplaceStats', field]);
  tx.update(shopRef, { [`marketplaceStats.${field}`]: current + 1 });
}

function bumpCustomerStat(tx, userSnap, userRef, field) {
  if (!userSnap || !userSnap.exists) {
    return;
  }
  const current = nestedNumber(userSnap.data(), ['customer', 'marketplace', 'stats', field]);
  tx.update(userRef, { [`customer.marketplace.stats.${field}`]: current + 1 });
}

function reviewRefundAmount(data, payment, review) {
  const response = review && review.shopResponse;
  if (response && response.result === 'short' && response.receivedAmount != null) {
    return response.receivedAmount;
  }
  if (payment && payment.receivedAmount != null) {
    return payment.receivedAmount;
  }
  return data.expectedAmount != null ? data.expectedAmount : null;
}

function arrivedAmountFields(amount, data) {
  const sameAsExpected = amount === data.expectedAmount && data.expectedAmountPaise != null;
  return {
    'payment.receivedAmount': amount,
    'payment.receivedAmountPaise': amount == null
      ? null
      : (sameAsExpected ? data.expectedAmountPaise : marketplaceMoney.toPaise(amount))
  };
}

async function readReviewContext(tx, db, { shopId, customerId, officialUtr }) {
  const registryRef = officialUtr ? db.collection('utrRegistry').doc(officialUtr) : null;
  const shopRef = db.collection('shops').doc(shopId);
  const userRef = customerId ? db.collection('users').doc(customerId) : null;
  const settingsSnap = await tx.get(db.collection('appSettings').doc('marketplace'));
  const registrySnap = registryRef ? await tx.get(registryRef) : null;
  const shopSnap = await tx.get(shopRef);
  const userSnap = userRef ? await tx.get(userRef) : null;
  return {
    registryRef, registrySnap, shopRef, shopSnap, userRef, userSnap, settingsSnap
  };
}

function rememberUtrCorrection(tx, userSnap, userRef, corrected) {
  if (!corrected || !userSnap || !userSnap.exists || !userRef) {
    return;
  }
  const corrections = nestedNumber(userSnap.data(), ['customer', 'marketplace', 'stats', 'utrCorrections']);
  tx.update(userRef, { 'customer.marketplace.stats.utrCorrections': corrections + 1 });
}

async function confirmOpenReview(tx, context) {
  const { db, orderRef, shopId, orderId, data, payment, body, now } = context;
  const review = reviewOf(payment);
  if (!review || review.status !== 'open') {
    throw httpError(409, 'INVALID_STATE', 'Order cannot be confirmed in its current state');
  }
  const matched = matchOfficialUtr(payment, body);
  const reads = await readReviewContext(tx, db, {
    shopId,
    customerId: data.customerId,
    officialUtr: matched.officialUtr
  });
  assertRegistryAvailable(reads.registrySnap, orderId);
  const at = Timestamp.fromMillis(now);
  const fulfil = !(body && body.fulfil === false);
  const disputed = shopHadDisputed(review);
  const variables = displayVariables(data, orderId);
  const attested = body && body.withinWindowAttested === true;
  const endMs = millisOf(data.window && data.window.end);
  const graceMs = graceMsFrom(reads.settingsSnap.exists ? reads.settingsSnap.data() : null);
  const late = !attested && isPastPaymentGrace(endMs, now, graceMs);
  const shopNotifies = [{ type: 'REVIEW_RESOLVED', variables }];

  if (!fulfil) {
    const amount = reviewRefundAmount(data, payment, review);
    tx.update(orderRef, {
      orderStatus: 'cancelled',
      closedReason: 'shop_cancelled',
      'cancellation.reason': 'shop_cancelled',
      'cancellation.cancelledAt': FieldValue.serverTimestamp(),
      'cancellation.cancelledBy': shopId,
      'payment.status': 'refund_pending',
      ...arrivedAmountFields(amount, data),
      'payment.officialUtr': matched.officialUtr,
      'payment.utrSource': matched.utrSource,
      'payment.review.status': 'resolved',
      'payment.review.shopResponse': { result: 'received', at },
      'payment.review.outcome': {
        result: 'refund',
        reason: 'shop_cancelled',
        decidedBy: shopId,
        decidedAt: FieldValue.serverTimestamp()
      }
    });
    createRefund(tx, {
      orderRef,
      data,
      reason: 'review_refund',
      amount,
      items: data.items,
      actor: { type: 'shop', id: shopId },
      resultingOrderStatus: 'cancelled'
    });
    writeRegistry(tx, reads.registrySnap, reads.registryRef, {
      orderId,
      customerId: data.customerId,
      kind: matched.utrSource === 'shop' ? 'shop' : 'customer',
      at
    });
    if (disputed) {
      bumpShopStat(tx, reads.shopSnap, reads.shopRef, 'reviewsFoundAgainstShop');
    }
    rememberUtrCorrection(tx, reads.userSnap, reads.userRef, matched.corrected);
    appendEvent(tx, orderRef, {
      type: 'shop_confirm',
      actor: { type: 'shop', id: shopId },
      data: { officialUtr: matched.officialUtr, utrSource: matched.utrSource }
    }, data.customerId);
    appendEvent(tx, orderRef, {
      type: 'review_resolved',
      actor: { type: 'shop', id: shopId },
      data: { result: 'refund' }
    }, data.customerId);
    appendEvent(tx, orderRef, {
      type: 'cancelled',
      actor: { type: 'shop', id: shopId },
      reason: 'shop_cancelled'
    }, data.customerId);
    return {
      alreadyProcessed: false,
      customerId: data.customerId || null,
      notifies: [{ type: 'REFUND_INITIATED', variables: { ...variables, amount } }],
      shopNotifies
    };
  }

  const stock = await deductOnPreparing(tx, db, {
    orderRef,
    data,
    actor: { type: 'shop', id: shopId }
  });
  const patch = {
    orderStatus: 'preparing',
    ...stockOrderFields(stock),
    'payment.status': 'confirmed',
    'payment.officialUtr': matched.officialUtr,
    'payment.utrSource': matched.utrSource,
    'payment.confirmedAt': at,
    'payment.confirmedByShopUid': shopId,
    'payment.review.status': 'resolved',
    'payment.review.shopResponse': { result: 'received', at },
    'payment.review.outcome': {
      result: 'found',
      reason: null,
      decidedBy: shopId,
      decidedAt: FieldValue.serverTimestamp()
    },
    ...expectedReceivedFields(data)
  };
  if (late) {
    patch['payment.late'] = {
      receivedAt: at,
      confirmedByShopUid: shopId,
      onCancelledOrder: false,
      fulfilled: true
    };
  }
  tx.update(orderRef, patch);
  writeRegistry(tx, reads.registrySnap, reads.registryRef, {
    orderId,
    customerId: data.customerId,
    kind: matched.utrSource === 'shop' ? 'shop' : 'customer',
    at
  });
  if (disputed) {
    bumpShopStat(tx, reads.shopSnap, reads.shopRef, 'reviewsFoundAgainstShop');
  }
  rememberUtrCorrection(tx, reads.userSnap, reads.userRef, matched.corrected);
  appendEvent(tx, orderRef, {
    type: 'shop_confirm',
    actor: { type: 'shop', id: shopId },
    data: { officialUtr: matched.officialUtr, utrSource: matched.utrSource }
  }, data.customerId);
  if (matched.corrected) {
    appendEvent(tx, orderRef, {
      type: 'utr_corrected',
      actor: { type: 'shop', id: shopId },
      data: { officialUtr: matched.officialUtr }
    }, data.customerId);
  }
  if (late) {
    appendEvent(tx, orderRef, {
      type: 'payment_confirmed_late',
      actor: { type: 'shop', id: shopId }
    }, data.customerId);
  }
  appendEvent(tx, orderRef, {
    type: 'review_resolved',
    actor: { type: 'shop', id: shopId },
    data: { result: 'found' }
  }, data.customerId);
  const notifies = [];
  if (matched.corrected) {
    notifies.push({ type: 'UTR_CORRECTED', variables: { ...variables, utr: matched.officialUtr } });
  } else if (!late) {
    notifies.push({ type: 'PAYMENT_CONFIRMED', variables });
  }
  if (late) {
    notifies.push({ type: 'PAYMENT_LATE_ACCEPTED', variables });
  }
  return {
    alreadyProcessed: false,
    customerId: data.customerId || null,
    notifies,
    shopNotifies
  };
}

async function confirmShopPayment({ shopId, orderId, body, nowMs }) {
  assertNoAmountDiffers(body);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists || (orderSnap.data() || {}).shopId !== shopId) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    const data = orderSnap.data() || {};
    const payment = data.payment || {};
    if (payment.review && payment.review.status === 'resolved') {
      throw httpError(409, 'INVALID_STATE', 'Order cannot be confirmed in its current state');
    }
    if (payment.status === 'confirmed' && POST_CONFIRM_ORDER.has(data.orderStatus)) {
      return { alreadyProcessed: true, customerId: data.customerId || null };
    }
    if (data.orderStatus === 'cancelled' && data.closedReason === 'late_unfulfilled') {
      return { alreadyProcessed: true, customerId: data.customerId || null, notifies: [] };
    }
    if (data.orderStatus === 'payment_review') {
      return confirmOpenReview(tx, {
        db, orderRef, shopId, orderId, data, payment, body, now
      });
    }
    if (body && body.fulfil === false) {
      if (data.orderStatus === 'payment_unconfirmed') {
        return confirmLateUnfulfilled(tx, {
          db, orderRef, shopId, orderId, data, payment, body, now
        });
      }
      throw httpError(409, 'INVALID_STATE', 'Order cannot be confirmed in its current state');
    }
    if (payment.status === 'short') {
      if (data.orderStatus !== 'awaiting_payment') {
        throw httpError(409, 'INVALID_STATE', 'Order cannot be confirmed in its current state');
      }
      return confirmShortBalance(tx, {
        db,
        orderRef,
        shopId,
        orderId,
        data,
        payment,
        body,
        now
      });
    }
    if (data.orderStatus === 'cancelled') {
      return confirmPaidOnCancelled(tx, {
        db, orderRef, shopId, orderId, data, payment, body, now
      });
    }
    const allowed = (data.orderStatus === 'awaiting_payment'
        && (payment.status === 'pending' || payment.status === 'customer_claimed'))
      || data.orderStatus === 'payment_unconfirmed';
    if (!allowed) {
      throw httpError(409, 'INVALID_STATE', 'Order cannot be confirmed in its current state');
    }

    const matched = matchOfficialUtr(payment, body);
    const registryRef = db.collection('utrRegistry').doc(matched.officialUtr);
    const settingsSnap = await tx.get(db.collection('appSettings').doc('marketplace'));
    const registrySnap = await tx.get(registryRef);
    const release = await readUnpaidRelease(tx, db, {
      customerId: data.customerId,
      shopId: data.shopId
    });
    const attested = body && body.withinWindowAttested === true;
    const endMs = millisOf(data.window && data.window.end);
    const graceMs = graceMsFrom(settingsSnap.exists ? settingsSnap.data() : null);
    const late = !attested && isPastPaymentGrace(endMs, now, graceMs);
    const at = Timestamp.fromMillis(now);
    assertRegistryAvailable(registrySnap, orderId);
    const stock = await deductOnPreparing(tx, db, {
      orderRef,
      data,
      actor: { type: 'shop', id: shopId }
    });
    const userPatch = {};
    if (matched.corrected && release && release.userSnap && release.userSnap.exists) {
      const corrections = nestedNumber(release.userSnap.data(), ['customer', 'marketplace', 'stats', 'utrCorrections']);
      userPatch['customer.marketplace.stats.utrCorrections'] = corrections + 1;
    }

    const patch = {
      orderStatus: 'preparing',
      ...stockOrderFields(stock),
      'payment.status': 'confirmed',
      'payment.officialUtr': matched.officialUtr,
      'payment.utrSource': matched.utrSource,
      'payment.confirmedAt': at,
      'payment.confirmedByShopUid': shopId,
      ...expectedReceivedFields(data)
    };
    if (late) {
      patch['payment.late'] = {
        receivedAt: at,
        confirmedByShopUid: shopId,
        onCancelledOrder: false,
        fulfilled: true
      };
    }
    tx.update(orderRef, patch);
    writeRegistry(tx, registrySnap, registryRef, {
      orderId,
      customerId: data.customerId,
      kind: matched.utrSource === 'shop' ? 'shop' : 'customer',
      at
    });
    writeUnpaidRelease(tx, release, orderId, data.orderStatus === 'awaiting_payment', userPatch);
    appendEvent(tx, orderRef, {
      type: 'shop_confirm',
      actor: { type: 'shop', id: shopId },
      data: { officialUtr: matched.officialUtr, utrSource: matched.utrSource }
    }, data.customerId);
    if (matched.corrected) {
      appendEvent(tx, orderRef, {
        type: 'utr_corrected',
        actor: { type: 'shop', id: shopId },
        data: { officialUtr: matched.officialUtr }
      }, data.customerId);
    }
    if (late) {
      appendEvent(tx, orderRef, {
        type: 'payment_confirmed_late',
        actor: { type: 'shop', id: shopId }
      }, data.customerId);
    }
    const variables = displayVariables(data, orderId);
    const notifies = [];
    if (matched.corrected) {
      notifies.push({
        type: 'UTR_CORRECTED',
        variables: { ...variables, utr: matched.officialUtr }
      });
    } else if (!late) {
      notifies.push({ type: 'PAYMENT_CONFIRMED', variables });
    }
    if (late) {
      notifies.push({ type: 'PAYMENT_LATE_ACCEPTED', variables });
    }
    return {
      alreadyProcessed: false,
      customerId: data.customerId || null,
      notifies
    };
  });
  return outcome;
}

async function reportPaymentNotFound({ shopId, orderId, nowMs }) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists || (orderSnap.data() || {}).shopId !== shopId) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    const data = orderSnap.data() || {};
    const payment = data.payment || {};
    if (data.orderStatus === 'payment_review') {
      const review = reviewOf(payment);
      if (!review || review.status !== 'open') {
        throw httpError(409, 'INVALID_STATE', 'Payment review cannot be opened for this order');
      }
      if (review.shopResponse && review.shopResponse.result === 'not_found') {
        return { alreadyProcessed: true, customerId: data.customerId || null, notifies: [], shopNotifies: [] };
      }
      const at = Timestamp.fromMillis(now);
      tx.update(orderRef, {
        'payment.review.shopResponse': { result: 'not_found', at }
      });
      appendEvent(tx, orderRef, {
        type: 'shop_response',
        actor: { type: 'shop', id: shopId },
        data: { result: 'not_found' }
      }, data.customerId);
      return { alreadyProcessed: false, customerId: data.customerId || null, notifies: [], shopNotifies: [] };
    }
    if (!payment.customerUtr) {
      throw httpError(409, 'NOT_FOUND_REQUIRES_UTR', 'Not found requires a customer UTR');
    }
    const allowed = data.orderStatus === 'awaiting_payment' || data.orderStatus === 'payment_unconfirmed';
    if (!allowed) {
      throw httpError(409, 'INVALID_STATE', 'Payment review cannot be opened for this order');
    }
    const release = await readUnpaidRelease(tx, db, {
      customerId: data.customerId,
      shopId: data.shopId
    });
    const shopRef = db.collection('shops').doc(shopId);
    const shopSnap = await tx.get(shopRef);
    tx.update(orderRef, {
      orderStatus: 'payment_review',
      'payment.status': 'under_review',
      'payment.review': {
        status: 'open',
        openedAt: FieldValue.serverTimestamp(),
        trigger: 'shop_not_found',
        shopResponse: null,
        outcome: null
      }
    });
    writeUnpaidRelease(tx, release, orderId, data.orderStatus === 'awaiting_payment');
    if (shopSnap.exists) {
      const opened = nestedNumber(shopSnap.data(), ['marketplaceStats', 'reviewsOpened']);
      tx.update(shopRef, { 'marketplaceStats.reviewsOpened': opened + 1 });
    }
    appendEvent(tx, orderRef, {
      type: 'review_opened',
      actor: { type: 'shop', id: shopId },
      data: { trigger: 'shop_not_found' }
    }, data.customerId);
    const variables = displayVariables(data, orderId);
    return {
      alreadyProcessed: false,
      customerId: data.customerId || null,
      notifies: [{ type: 'PAYMENT_UNDER_REVIEW', variables }],
      shopNotifies: [{ type: 'PAYMENT_REVIEW_SHOP', variables }]
    };
  });
}

function paidCheckAnswer(data, received) {
  const cancellation = data.cancellation || {};
  if (cancellation.paidCheck === 'received' && received === true) {
    return 'same';
  }
  if (cancellation.paidCheck === 'not_received' && received === false) {
    return 'same';
  }
  if (cancellation.paidCheck && cancellation.paidCheck !== 'pending') {
    return 'different';
  }
  return 'pending';
}

async function answerPaidCheck({ shopId, orderId, body, nowMs }) {
  const payload = body && typeof body === 'object' ? body : {};
  if (typeof payload.received !== 'boolean') {
    throw httpError(400, 'VALIDATION', 'received must be true or false');
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists || (orderSnap.data() || {}).shopId !== shopId) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    const data = orderSnap.data() || {};
    const cancellation = data.cancellation || {};
    const eligible = data.orderStatus === 'cancelled'
      && cancellation.reason === 'customer_cancel'
      && (cancellation.paidCheck === 'pending'
        || cancellation.paidCheck === 'received'
        || cancellation.paidCheck === 'not_received');
    if (!eligible) {
      throw httpError(409, 'INVALID_STATE', 'This order is not waiting for a paid check');
    }
    const answer = paidCheckAnswer(data, payload.received);
    if (answer === 'same') {
      return { alreadyProcessed: true, customerId: data.customerId || null, notifies: [] };
    }
    if (answer === 'different') {
      throw httpError(409, 'ALREADY_ANSWERED', 'This paid check was already answered');
    }

    const at = Timestamp.fromMillis(now);
    if (payload.received === false) {
      tx.update(orderRef, {
        'cancellation.paidCheck': 'not_received',
        'cancellation.paidCheckAt': at
      });
      appendEvent(tx, orderRef, {
        type: 'paid_check',
        actor: { type: 'shop', id: shopId },
        data: { received: false }
      }, data.customerId);
      return { alreadyProcessed: false, customerId: data.customerId || null, notifies: [] };
    }

    const payment = data.payment || {};
    const matched = matchOfficialUtr(payment, payload);
    const registryRef = db.collection('utrRegistry').doc(matched.officialUtr);
    const registrySnap = await tx.get(registryRef);
    assertRegistryAvailable(registrySnap, orderId);
    const alreadyRefund = await hasReason(tx, orderRef, 'customer_cancel');
    const amount = payment.receivedAmount != null
      ? payment.receivedAmount
      : (data.expectedAmount != null ? data.expectedAmount : null);
    tx.update(orderRef, {
      'cancellation.paidCheck': 'received',
      'cancellation.paidCheckAt': at,
      'payment.status': 'refund_pending',
      'payment.officialUtr': matched.officialUtr,
      'payment.utrSource': matched.utrSource
    });
    if (!alreadyRefund) {
      createRefund(tx, {
        orderRef,
        data,
        reason: 'customer_cancel',
        amount,
        items: data.items,
        actor: { type: 'shop', id: shopId },
        resultingOrderStatus: 'cancelled'
      });
    }
    writeRegistry(tx, registrySnap, registryRef, {
      orderId,
      customerId: data.customerId,
      kind: matched.utrSource === 'shop' ? 'shop' : 'customer',
      at
    });
    appendEvent(tx, orderRef, {
      type: 'paid_check',
      actor: { type: 'shop', id: shopId },
      data: { received: true, officialUtr: matched.officialUtr }
    }, data.customerId);
    return {
      alreadyProcessed: false,
      customerId: data.customerId || null,
      notifies: [{
        type: 'REFUND_INITIATED',
        variables: {
          ...displayVariables(data, orderId),
          amount
        }
      }]
    };
  });
}

async function confirmShortBalance(tx, context) {
  const { db, orderRef, shopId, orderId, data, payment, body, now } = context;
  const balance = payment.balance && typeof payment.balance === 'object' ? payment.balance : {};
  const balanceUtr = balance.utr ? String(balance.utr) : '';
  const matched = matchOfficialUtr({ customerUtr: balanceUtr }, body);
  const registryRef = db.collection('utrRegistry').doc(matched.officialUtr);
  const registrySnap = await tx.get(registryRef);
  const release = await readUnpaidRelease(tx, db, {
    customerId: data.customerId,
    shopId: data.shopId
  });
  assertRegistryAvailable(registrySnap, orderId);
  if (registrySnap.exists) {
    const existing = registrySnap.data() || {};
    const sameBalance = existing.kind === 'balance' && balanceUtr === matched.officialUtr;
    if (!sameBalance) {
      throw httpError(409, 'UTR_USED', 'This UTR is already used');
    }
  }
  const stock = await deductOnPreparing(tx, db, {
    orderRef,
    data,
    actor: { type: 'shop', id: shopId }
  });
  const at = Timestamp.fromMillis(now);
  const receivedPaise = Number(payment.receivedAmountPaise) + Number(balance.amountPaise);
  const receivedAmount = marketplaceMoney.fromPaise(receivedPaise);
  const userPatch = {};
  if (matched.corrected && release && release.userSnap && release.userSnap.exists) {
    const corrections = nestedNumber(release.userSnap.data(), ['customer', 'marketplace', 'stats', 'utrCorrections']);
    userPatch['customer.marketplace.stats.utrCorrections'] = corrections + 1;
  }
  tx.update(orderRef, {
    orderStatus: 'preparing',
    ...stockOrderFields(stock),
    'payment.status': 'confirmed',
    'payment.confirmedAt': at,
    'payment.confirmedByShopUid': shopId,
    'payment.receivedAmount': receivedAmount,
    'payment.receivedAmountPaise': receivedPaise,
    'payment.balance.officialUtr': matched.officialUtr,
    'payment.balance.utrSource': matched.utrSource,
    'payment.balance.confirmedAt': at
  });
  writeRegistry(tx, registrySnap, registryRef, {
    orderId,
    customerId: data.customerId,
    kind: matched.utrSource === 'shop' ? 'shop' : 'customer',
    at
  });
  writeUnpaidRelease(tx, release, orderId, true, userPatch);
  appendEvent(tx, orderRef, {
    type: 'balance_confirmed',
    actor: { type: 'shop', id: shopId },
    data: { officialUtr: matched.officialUtr, utrSource: matched.utrSource }
  }, data.customerId);
  if (matched.corrected) {
    appendEvent(tx, orderRef, {
      type: 'utr_corrected',
      actor: { type: 'shop', id: shopId },
      data: { officialUtr: matched.officialUtr }
    }, data.customerId);
  }
  return {
    alreadyProcessed: false,
    customerId: data.customerId || null,
    notifies: [{
      type: 'PAYMENT_CONFIRMED',
      variables: displayVariables(data, orderId)
    }]
  };
}

async function differOnOpenReview(tx, context) {
  const { db, orderRef, shopId, orderId, data, payment, body, now, receivedPaise, rupees } = context;
  const review = reviewOf(payment);
  if (!review || review.status !== 'open') {
    throw httpError(409, 'INVALID_STATE', 'Amount differs is not available for this order');
  }
  const expectedPaise = data.expectedAmountPaise;
  if (!Number.isInteger(expectedPaise)) {
    throw httpError(409, 'INVALID_STATE', 'Amount differs is not available for this order');
  }
  if (receivedPaise > expectedPaise * 2) {
    throw httpError(400, 'VALIDATION', 'receivedAmount must be at most 2 times the expected amount');
  }
  const at = Timestamp.fromMillis(now);
  if (receivedPaise < expectedPaise) {
    const previous = review.shopResponse;
    if (previous && previous.result === 'short' && Number(previous.receivedAmount) === rupees) {
      return { alreadyProcessed: true, customerId: data.customerId || null, notifies: [], shopNotifies: [] };
    }
    tx.update(orderRef, {
      'payment.review.shopResponse': { result: 'short', receivedAmount: rupees, at }
    });
    appendEvent(tx, orderRef, {
      type: 'shop_response',
      actor: { type: 'shop', id: shopId },
      data: { result: 'short', receivedAmount: rupees }
    }, data.customerId);
    appendEvent(tx, orderRef, {
      type: 'amount_differs',
      actor: { type: 'shop', id: shopId },
      data: { receivedAmount: rupees, expectedAmount: data.expectedAmount ?? null }
    }, data.customerId);
    return { alreadyProcessed: false, customerId: data.customerId || null, notifies: [], shopNotifies: [] };
  }

  const matched = matchOfficialUtr(payment, body);
  const reads = await readReviewContext(tx, db, {
    shopId,
    customerId: data.customerId,
    officialUtr: matched.officialUtr
  });
  assertRegistryAvailable(reads.registrySnap, orderId);
  const stock = await deductOnPreparing(tx, db, {
    orderRef,
    data,
    actor: { type: 'shop', id: shopId }
  });
  const receivedAmount = marketplaceMoney.fromPaise(receivedPaise);
  const storedReceived = receivedPaise === expectedPaise ? data.expectedAmount : receivedAmount;
  const disputed = shopHadDisputed(review);
  const variables = displayVariables(data, orderId);
  const patch = {
    orderStatus: 'preparing',
    ...stockOrderFields(stock),
    'payment.status': 'confirmed',
    'payment.receivedAmount': storedReceived,
    'payment.receivedAmountPaise': receivedPaise,
    'payment.officialUtr': matched.officialUtr,
    'payment.utrSource': matched.utrSource,
    'payment.confirmedAt': at,
    'payment.confirmedByShopUid': shopId,
    'payment.review.status': 'resolved',
    'payment.review.shopResponse': { result: 'received', receivedAmount: rupees, at },
    'payment.review.outcome': {
      result: 'found',
      reason: null,
      decidedBy: shopId,
      decidedAt: FieldValue.serverTimestamp()
    }
  };
  const notifies = [];
  let overpaidAmount = null;
  if (receivedPaise > expectedPaise) {
    overpaidAmount = marketplaceMoney.fromPaise(receivedPaise - expectedPaise);
    notifies.push({ type: 'REFUND_INITIATED', variables: { ...variables, amount: overpaidAmount } });
  } else if (matched.corrected) {
    notifies.push({ type: 'UTR_CORRECTED', variables: { ...variables, utr: matched.officialUtr } });
  } else {
    notifies.push({ type: 'PAYMENT_CONFIRMED', variables });
  }
  tx.update(orderRef, patch);
  if (overpaidAmount != null) {
    createRefund(tx, {
      orderRef,
      data,
      reason: 'overpaid',
      amount: overpaidAmount,
      items: data.items,
      actor: { type: 'shop', id: shopId },
      resultingOrderStatus: 'preparing'
    });
  }
  writeRegistry(tx, reads.registrySnap, reads.registryRef, {
    orderId,
    customerId: data.customerId,
    kind: matched.utrSource === 'shop' ? 'shop' : 'customer',
    at
  });
  if (disputed) {
    bumpShopStat(tx, reads.shopSnap, reads.shopRef, 'reviewsFoundAgainstShop');
  }
  rememberUtrCorrection(tx, reads.userSnap, reads.userRef, matched.corrected);
  appendEvent(tx, orderRef, {
    type: 'amount_differs',
    actor: { type: 'shop', id: shopId },
    data: { receivedAmount: rupees, expectedAmount: data.expectedAmount ?? null }
  }, data.customerId);
  appendEvent(tx, orderRef, {
    type: 'shop_confirm',
    actor: { type: 'shop', id: shopId },
    data: { officialUtr: matched.officialUtr, utrSource: matched.utrSource }
  }, data.customerId);
  if (matched.corrected) {
    appendEvent(tx, orderRef, {
      type: 'utr_corrected',
      actor: { type: 'shop', id: shopId },
      data: { officialUtr: matched.officialUtr }
    }, data.customerId);
  }
  appendEvent(tx, orderRef, {
    type: 'review_resolved',
    actor: { type: 'shop', id: shopId },
    data: { result: 'found' }
  }, data.customerId);
  return {
    alreadyProcessed: false,
    customerId: data.customerId || null,
    notifies,
    shopNotifies: [{ type: 'REVIEW_RESOLVED', variables }]
  };
}

async function reportAmountDiffers({ shopId, orderId, body, nowMs }) {
  const payload = body && typeof body === 'object' ? body : {};
  const rupees = assertReceivedAmountShape(payload.receivedAmount);
  const receivedPaise = marketplaceMoney.toPaise(rupees);
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists || (orderSnap.data() || {}).shopId !== shopId) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    const data = orderSnap.data() || {};
    const payment = data.payment || {};
    if (payment.review && payment.review.status === 'resolved') {
      throw httpError(409, 'INVALID_STATE', 'Amount differs is not available for this order');
    }
    if (payment.status === 'confirmed' && POST_CONFIRM_ORDER.has(data.orderStatus)) {
      return { alreadyProcessed: true, customerId: data.customerId || null, notifies: [] };
    }
    if (data.orderStatus === 'payment_review') {
      return differOnOpenReview(tx, {
        db, orderRef, shopId, orderId, data, payment, body, now, receivedPaise, rupees
      });
    }
    // Amount differs on payment_unconfirmed stays unavailable.
    const allowed = data.orderStatus === 'awaiting_payment'
      && (payment.status === 'pending' || payment.status === 'customer_claimed');
    if (!allowed) {
      throw httpError(409, 'INVALID_STATE', 'Amount differs is not available for this order');
    }
    const expectedPaise = data.expectedAmountPaise;
    if (!Number.isInteger(expectedPaise)) {
      throw httpError(409, 'INVALID_STATE', 'Amount differs is not available for this order');
    }
    if (receivedPaise > expectedPaise * 2) {
      throw httpError(400, 'VALIDATION', 'receivedAmount must be at most 2 times the expected amount');
    }

    const matched = matchOfficialUtr(payment, payload);
    const registryRef = db.collection('utrRegistry').doc(matched.officialUtr);
    const settingsSnap = await tx.get(db.collection('appSettings').doc('marketplace'));
    const registrySnap = await tx.get(registryRef);
    const release = await readUnpaidRelease(tx, db, {
      customerId: data.customerId,
      shopId: data.shopId
    });
    const endMs = millisOf(data.window && data.window.end);
    const graceMs = graceMsFrom(settingsSnap.exists ? settingsSnap.data() : null);
    const late = isPastPaymentGrace(endMs, now, graceMs);
    const at = Timestamp.fromMillis(now);
    assertRegistryAvailable(registrySnap, orderId);
    const receivedAmount = marketplaceMoney.fromPaise(receivedPaise);
    const userPatch = {};
    if (matched.corrected && release && release.userSnap && release.userSnap.exists) {
      const corrections = nestedNumber(release.userSnap.data(), ['customer', 'marketplace', 'stats', 'utrCorrections']);
      userPatch['customer.marketplace.stats.utrCorrections'] = corrections + 1;
    }
    const variables = displayVariables(data, orderId);

    if (receivedPaise < expectedPaise) {
      const balancePaise = expectedPaise - receivedPaise;
      const shortPatch = {
        'payment.status': 'short',
        'payment.receivedAmount': receivedAmount,
        'payment.receivedAmountPaise': receivedPaise,
        'payment.officialUtr': matched.officialUtr,
        'payment.utrSource': matched.utrSource,
        'payment.balance': {
          amount: marketplaceMoney.fromPaise(balancePaise),
          amountPaise: balancePaise,
          dueBy: Timestamp.fromMillis(now + balanceWindowMs(settingsSnap.exists ? settingsSnap.data() : null)),
          utr: null,
          submittedAt: null,
          confirmedAt: null
        }
      };
      if (late) {
        shortPatch['payment.late'] = {
          receivedAt: at,
          confirmedByShopUid: shopId,
          onCancelledOrder: false,
          fulfilled: false
        };
      }
      tx.update(orderRef, shortPatch);
      writeRegistry(tx, registrySnap, registryRef, {
        orderId,
        customerId: data.customerId,
        kind: matched.utrSource === 'shop' ? 'shop' : 'customer',
        at
      });
      if (release && release.userSnap && release.userSnap.exists && Object.keys(userPatch).length > 0) {
        tx.update(release.userRef, userPatch);
      }
      appendEvent(tx, orderRef, {
        type: 'amount_differs',
        actor: { type: 'shop', id: shopId },
        data: { receivedAmountPaise: receivedPaise, balanceAmountPaise: balancePaise }
      }, data.customerId);
      return {
        alreadyProcessed: false,
        customerId: data.customerId || null,
        notifies: [{
          type: 'AMOUNT_SHORT',
          variables: {
            ...variables,
            receivedAmount,
            balanceAmount: marketplaceMoney.fromPaise(balancePaise)
          }
        }]
      };
    }

    const stock = await deductOnPreparing(tx, db, {
      orderRef,
      data,
      actor: { type: 'shop', id: shopId }
    });
    const storedReceived = receivedPaise === expectedPaise ? data.expectedAmount : receivedAmount;
    const confirming = {
      orderStatus: 'preparing',
      ...stockOrderFields(stock),
      'payment.status': 'confirmed',
      'payment.receivedAmount': storedReceived,
      'payment.receivedAmountPaise': receivedPaise,
      'payment.officialUtr': matched.officialUtr,
      'payment.utrSource': matched.utrSource,
      'payment.confirmedAt': at,
      'payment.confirmedByShopUid': shopId
    };
    if (late) {
      confirming['payment.late'] = {
        receivedAt: at,
        confirmedByShopUid: shopId,
        onCancelledOrder: false,
        fulfilled: true
      };
    }
    const notifies = [];
    let overpaidAmount = null;
    if (receivedPaise > expectedPaise) {
      overpaidAmount = marketplaceMoney.fromPaise(receivedPaise - expectedPaise);
      notifies.push({
        type: 'REFUND_INITIATED',
        variables: { ...variables, amount: overpaidAmount }
      });
    } else if (matched.corrected) {
      notifies.push({
        type: 'UTR_CORRECTED',
        variables: { ...variables, utr: matched.officialUtr }
      });
    } else if (!late) {
      notifies.push({ type: 'PAYMENT_CONFIRMED', variables });
    }
    if (late && receivedPaise === expectedPaise) {
      notifies.push({ type: 'PAYMENT_LATE_ACCEPTED', variables });
    }
    tx.update(orderRef, confirming);
    if (overpaidAmount != null) {
      createRefund(tx, {
        orderRef,
        data,
        reason: 'overpaid',
        amount: overpaidAmount,
        items: data.items,
        actor: { type: 'shop', id: shopId },
        resultingOrderStatus: 'preparing'
      });
    }
    writeRegistry(tx, registrySnap, registryRef, {
      orderId,
      customerId: data.customerId,
      kind: matched.utrSource === 'shop' ? 'shop' : 'customer',
      at
    });
    writeUnpaidRelease(tx, release, orderId, true, userPatch);
    if (overpaidAmount != null) {
      appendEvent(tx, orderRef, {
        type: 'amount_differs',
        actor: { type: 'shop', id: shopId },
        data: { receivedAmount: rupees, expectedAmount: data.expectedAmount ?? null }
      }, data.customerId);
    }
    appendEvent(tx, orderRef, {
      type: 'shop_confirm',
      actor: { type: 'shop', id: shopId },
      data: { officialUtr: matched.officialUtr, utrSource: matched.utrSource }
    }, data.customerId);
    if (matched.corrected) {
      appendEvent(tx, orderRef, {
        type: 'utr_corrected',
        actor: { type: 'shop', id: shopId },
        data: { officialUtr: matched.officialUtr }
      }, data.customerId);
    }
    if (late) {
      appendEvent(tx, orderRef, {
        type: 'payment_confirmed_late',
        actor: { type: 'shop', id: shopId }
      }, data.customerId);
    }
    return {
      alreadyProcessed: false,
      customerId: data.customerId || null,
      notifies
    };
  });
}

async function resolvePaymentReview({ orderId, outcome, reason, operator }) {
  const result = outcome;
  if (result !== 'found' && result !== 'not_found' && result !== 'refund') {
    throw httpError(400, 'VALIDATION', 'outcome must be found, not_found, or refund');
  }
  const operatorId = typeof operator === 'string' ? operator.trim() : '';
  if (!operatorId) {
    throw httpError(400, 'VALIDATION', 'operator is required');
  }
  const note = typeof reason === 'string' ? reason.trim() : '';
  if (!note) {
    throw httpError(400, 'VALIDATION', 'reason is required');
  }
  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  return db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
    }
    const data = orderSnap.data() || {};
    const payment = data.payment || {};
    const review = reviewOf(payment);
    if (data.orderStatus !== 'payment_review' || !review || review.status !== 'open') {
      return { alreadyProcessed: true, wrote: false, customerId: data.customerId || null, shopId: data.shopId || null };
    }
    if (result === 'found' && review.shopResponse && review.shopResponse.result === 'short') {
      throw httpError(409, 'REVIEW_SHORT', 'A short review cannot be closed as found. Use outcome refund.');
    }
    const shopRef = db.collection('shops').doc(data.shopId);
    const userRef = data.customerId ? db.collection('users').doc(data.customerId) : null;
    const shopSnap = data.shopId ? await tx.get(shopRef) : null;
    const userSnap = userRef ? await tx.get(userRef) : null;
    const actor = { type: 'support', id: operatorId };
    const variables = displayVariables(data, orderId);
    const disputed = shopHadDisputed(review);
    const outcomeDoc = {
      result,
      reason: note,
      decidedBy: operatorId,
      decidedAt: FieldValue.serverTimestamp()
    };

    if (result === 'found') {
      if (!payment.customerUtr) {
        throw httpError(409, 'FULL_UTR_REQUIRED', 'Shop must confirm-payment with a full UTR');
      }
      const officialUtr = String(payment.customerUtr);
      const registryRef = db.collection('utrRegistry').doc(officialUtr);
      const registrySnap = await tx.get(registryRef);
      assertRegistryAvailable(registrySnap, orderId);
      const at = Timestamp.now();
      const stock = await deductOnPreparing(tx, db, {
        orderRef,
        data,
        actor
      });
      tx.update(orderRef, {
        orderStatus: 'preparing',
        ...stockOrderFields(stock),
        'payment.status': 'confirmed',
        'payment.officialUtr': officialUtr,
        'payment.utrSource': 'customer',
        'payment.confirmedAt': at,
        'payment.review.status': 'resolved',
        'payment.review.outcome': outcomeDoc,
        ...expectedReceivedFields(data)
      });
      writeRegistry(tx, registrySnap, registryRef, {
        orderId,
        customerId: data.customerId,
        kind: 'customer',
        at
      });
      if (disputed) {
        bumpShopStat(tx, shopSnap, shopRef, 'reviewsFoundAgainstShop');
      }
      appendEvent(tx, orderRef, {
        type: 'review_resolved',
        actor,
        reason: note,
        data: { result: 'found' }
      }, data.customerId);
      return {
        alreadyProcessed: false,
        wrote: true,
        customerId: data.customerId || null,
        shopId: data.shopId || null,
        notifies: [{ type: 'PAYMENT_CONFIRMED', variables }],
        shopNotifies: [{ type: 'REVIEW_RESOLVED', variables }]
      };
    }

    if (result === 'not_found') {
      // MP7-1: money found after support not_found is a refund only, never a reopen (MP-8/help).
      tx.update(orderRef, {
        orderStatus: 'cancelled',
        closedReason: 'payment_not_verified',
        'cancellation.reason': 'payment_not_verified',
        'cancellation.cancelledAt': FieldValue.serverTimestamp(),
        'cancellation.cancelledBy': 'support',
        'payment.status': 'not_verified',
        'payment.review.status': 'resolved',
        'payment.review.outcome': outcomeDoc
      });
      bumpCustomerStat(tx, userSnap, userRef, 'reportsNotVerified');
      appendEvent(tx, orderRef, {
        type: 'review_resolved',
        actor,
        reason: note,
        data: { result: 'not_found' }
      }, data.customerId);
      appendEvent(tx, orderRef, {
        type: 'cancelled',
        actor,
        reason: 'payment_not_verified'
      }, data.customerId);
      return {
        alreadyProcessed: false,
        wrote: true,
        customerId: data.customerId || null,
        shopId: data.shopId || null,
        notifies: [{ type: 'NOT_VERIFIED', variables }],
        shopNotifies: [{ type: 'REVIEW_RESOLVED', variables }]
      };
    }

    const amount = reviewRefundAmount(data, payment, review);
    tx.update(orderRef, {
      orderStatus: 'cancelled',
      closedReason: 'support_cancelled',
      'cancellation.reason': 'support_cancelled',
      'cancellation.cancelledAt': FieldValue.serverTimestamp(),
      'cancellation.cancelledBy': 'support',
      'payment.status': 'refund_pending',
      ...arrivedAmountFields(amount, data),
      'payment.review.status': 'resolved',
      'payment.review.outcome': outcomeDoc
    });
    createRefund(tx, {
      orderRef,
      data,
      reason: 'review_refund',
      amount,
      items: data.items,
      actor,
      eventReason: note,
      resultingOrderStatus: 'cancelled'
    });
    if (disputed) {
      bumpShopStat(tx, shopSnap, shopRef, 'reviewsFoundAgainstShop');
    }
    appendEvent(tx, orderRef, {
      type: 'review_resolved',
      actor,
      reason: note,
      data: { result: 'refund' }
    }, data.customerId);
    appendEvent(tx, orderRef, {
      type: 'cancelled',
      actor,
      reason: 'support_cancelled'
    }, data.customerId);
    return {
      alreadyProcessed: false,
      wrote: true,
      customerId: data.customerId || null,
      shopId: data.shopId || null,
      notifies: [{ type: 'REFUND_INITIATED', variables: { ...variables, amount } }],
      shopNotifies: [{ type: 'REVIEW_RESOLVED', variables }]
    };
  });
}

function shopCancelAllowed(data, enforcement) {
  if (data.orderStatus === 'cancelled') {
    return { ok: true, already: true };
  }
  if (BLOCKED_CANCEL.has(data.orderStatus)) {
    return { ok: false };
  }
  if (enforcement && enforcement.newStatuses === true) {
    const stage = data.delivery && data.delivery.stage;
    const allowed = data.orderStatus === 'preparing'
      || (data.orderStatus === 'ready' && stage === 'searching');
    if (!allowed) {
      return { ok: false };
    }
  }
  return { ok: true, already: false };
}

module.exports = {
  resolveEnforcement,
  isPastPaymentGrace,
  graceMsFrom,
  matchOfficialUtr,
  readUnpaidRelease,
  writeUnpaidRelease,
  confirmShopPayment,
  reportAmountDiffers,
  reportPaymentNotFound,
  resolvePaymentReview,
  answerPaidCheck,
  isShortBalanceExpired,
  assertReceivedAmountShape,
  shopCancelAllowed,
  httpError
};
