const crypto = require('crypto');
const { Timestamp } = require('firebase-admin/firestore');
const { getFirestore } = require('../firebase');
const { MARKETPLACE_DEFAULTS } = require('../../config/marketplaceDefaults');
const marketplaceMoney = require('../../validators/marketplace');
const { isValidUtr } = marketplaceMoney;
const { appendEvent } = require('./orderEvents');
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

function stockDeductionHook() {
  // MP-9 deducts stock in this confirm transaction. MP-5a writes nothing.
  return null;
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

function refundStub(reason, amount, items, at) {
  return {
    id: crypto.randomBytes(8).toString('hex'),
    reason,
    amount,
    items: Array.isArray(items) ? items : [],
    status: 'upi_needed',
    customerUpiId: null,
    createdAt: at
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
  return {
    displayId: displayIdService.formatDisplayId(data.displayId),
    orderId
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
    if (payment.status === 'confirmed' && POST_CONFIRM_ORDER.has(data.orderStatus)) {
      return { alreadyProcessed: true, customerId: data.customerId || null };
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
    stockDeductionHook();
    const userPatch = {};
    if (matched.corrected && release && release.userSnap && release.userSnap.exists) {
      const corrections = nestedNumber(release.userSnap.data(), ['customer', 'marketplace', 'stats', 'utrCorrections']);
      userPatch['customer.marketplace.stats.utrCorrections'] = corrections + 1;
    }

    const patch = {
      orderStatus: 'preparing',
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
    });
    if (matched.corrected) {
      appendEvent(tx, orderRef, {
        type: 'utr_corrected',
        actor: { type: 'shop', id: shopId },
        data: { officialUtr: matched.officialUtr }
      });
    }
    if (late) {
      appendEvent(tx, orderRef, {
        type: 'payment_confirmed_late',
        actor: { type: 'shop', id: shopId }
      });
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
    if (data.orderStatus === 'payment_review' && payment.status === 'under_review'
      && payment.review && payment.review.trigger === 'shop_not_found') {
      return { alreadyProcessed: true, customerId: data.customerId || null, notifies: [] };
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
    const at = Timestamp.fromMillis(now);
    tx.update(orderRef, {
      orderStatus: 'payment_review',
      'payment.status': 'under_review',
      'payment.review': {
        openedAt: at,
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
    });
    return {
      alreadyProcessed: false,
      customerId: data.customerId || null,
      notifies: [{
        type: 'PAYMENT_UNDER_REVIEW',
        variables: displayVariables(data, orderId)
      }]
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
      });
      return { alreadyProcessed: false, customerId: data.customerId || null, notifies: [] };
    }

    const payment = data.payment || {};
    const matched = matchOfficialUtr(payment, payload);
    const registryRef = db.collection('utrRegistry').doc(matched.officialUtr);
    const registrySnap = await tx.get(registryRef);
    assertRegistryAvailable(registrySnap, orderId);
    const amount = payment.receivedAmount != null
      ? payment.receivedAmount
      : (data.expectedAmount != null ? data.expectedAmount : null);
    const refund = {
      id: crypto.randomBytes(8).toString('hex'),
      reason: 'customer_cancel',
      amount,
      items: Array.isArray(data.items) ? data.items : [],
      status: 'upi_needed',
      customerUpiId: null,
      createdAt: at
    };
    tx.update(orderRef, {
      'cancellation.paidCheck': 'received',
      'cancellation.paidCheckAt': at,
      'payment.status': 'refund_pending',
      'payment.officialUtr': matched.officialUtr,
      'payment.utrSource': matched.utrSource,
      refunds: (Array.isArray(data.refunds) ? data.refunds : []).concat([refund])
    });
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
    });
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
  stockDeductionHook();
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
    'payment.status': 'confirmed',
    'payment.officialUtr': matched.officialUtr,
    'payment.utrSource': matched.utrSource,
    'payment.confirmedAt': at,
    'payment.confirmedByShopUid': shopId,
    'payment.receivedAmount': receivedAmount,
    'payment.receivedAmountPaise': receivedPaise,
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
  });
  if (matched.corrected) {
    appendEvent(tx, orderRef, {
      type: 'utr_corrected',
      actor: { type: 'shop', id: shopId },
      data: { officialUtr: matched.officialUtr }
    });
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
    if (payment.status === 'confirmed' && POST_CONFIRM_ORDER.has(data.orderStatus)) {
      return { alreadyProcessed: true, customerId: data.customerId || null, notifies: [] };
    }
    // MP-7: amount differs on a late payment_unconfirmed order.
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
      });
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

    stockDeductionHook();
    const storedReceived = receivedPaise === expectedPaise ? data.expectedAmount : receivedAmount;
    const confirming = {
      orderStatus: 'preparing',
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
    if (receivedPaise > expectedPaise) {
      const refundAmount = marketplaceMoney.fromPaise(receivedPaise - expectedPaise);
      const refund = refundStub('overpaid', refundAmount, data.items, at);
      confirming.refunds = (Array.isArray(data.refunds) ? data.refunds : []).concat([refund]);
      notifies.push({
        type: 'REFUND_INITIATED',
        variables: { ...variables, amount: refundAmount }
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
    writeRegistry(tx, registrySnap, registryRef, {
      orderId,
      customerId: data.customerId,
      kind: matched.utrSource === 'shop' ? 'shop' : 'customer',
      at
    });
    writeUnpaidRelease(tx, release, orderId, true, userPatch);
    appendEvent(tx, orderRef, {
      type: 'shop_confirm',
      actor: { type: 'shop', id: shopId },
      data: { officialUtr: matched.officialUtr, utrSource: matched.utrSource }
    });
    if (matched.corrected) {
      appendEvent(tx, orderRef, {
        type: 'utr_corrected',
        actor: { type: 'shop', id: shopId },
        data: { officialUtr: matched.officialUtr }
      });
    }
    if (late) {
      appendEvent(tx, orderRef, {
        type: 'payment_confirmed_late',
        actor: { type: 'shop', id: shopId }
      });
    }
    return {
      alreadyProcessed: false,
      customerId: data.customerId || null,
      notifies
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
  answerPaidCheck,
  isShortBalanceExpired,
  assertReceivedAmountShape,
  shopCancelAllowed,
  stockDeductionHook,
  httpError
};
