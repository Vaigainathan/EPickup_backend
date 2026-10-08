const crypto = require('crypto');
const cron = require('node-cron');
const admin = require('firebase-admin');
const { getFirestore } = require('./firebase');
const displayIdService = require('./displayIdService');
const shopOrderService = require('./shopOrderService');
const { MARKETPLACE_DEFAULTS } = require('../config/marketplaceDefaults');
const { getMarketplaceEnforcement } = require('./marketplace/orderStateMachine');
const { appendEvent } = require('./marketplace/orderEvents');
const { isShortBalanceExpired } = require('./marketplace/shopPaymentVerification');

const SETTINGS_DOC = ['appSettings', 'marketplace'];
// short is not expireable. MP-6 owns balance dueBy via isShortBalanceExpired.
const EXPIREABLE = new Set(['pending', 'initiated']);
const AWAITING_PAYMENT_STATUSES = new Set(['pending', 'initiated', 'customer_claimed']);
const JOB_ACTOR = { type: 'system', id: 'payment-job' };

class MarketplacePaymentTimeoutJob {
  constructor() {
    this.task = null;
    this.ticking = false;
  }

  start() {
    if (this.task) {
      console.log('ℹ️ [MARKETPLACE_TIMEOUT] Cron already scheduled');
      return;
    }
    this.task = cron.schedule('* * * * *', () => {
      this.runTick().catch((error) => {
        console.error('❌ [MARKETPLACE_TIMEOUT] Tick failed:', error.message);
      });
    });
    console.log('✅ [MARKETPLACE_TIMEOUT] Cron scheduled (every 60s)');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('ℹ️ [MARKETPLACE_TIMEOUT] Cron stopped');
    }
  }

  async runTick(options = {}) {
    if (this.ticking) {
      return { skipped: true, reason: 'overlap', actions: [] };
    }
    this.ticking = true;
    try {
      return await this.executeTick(options);
    } finally {
      this.ticking = false;
    }
  }

  async executeTick(options) {
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const enforcement = options.enforcement !== undefined && options.enforcement !== null
      ? options.enforcement
      : await getMarketplaceEnforcement();
    const newStatuses = enforcement.newStatuses === true;
    const settings = await this.readSettings();
    const only = options.only && options.only.customerId && options.only.shopId
      ? options.only
      : null;

    if (!newStatuses) {
      if (!Number.isFinite(settings.timeoutMs) || settings.timeoutMs <= 0) {
        console.warn(`⚠️ [MARKETPLACE_TIMEOUT] Skipping tick: ${settings.timeoutReason}`);
        return {
          skipped: true,
          reason: settings.timeoutReason,
          newStatuses: false,
          actions: []
        };
      }
      const cutoff = admin.firestore.Timestamp.fromMillis(nowMs - settings.timeoutMs);
      const snapshot = await getFirestore()
        .collection('marketplaceOrders')
        // pending and initiated only. A short balance is left for the ON balance rule.
        .where('payment.status', 'in', ['pending', 'initiated'])
        .where('createdAt', '<', cutoff)
        .get();
      const actions = [];
      for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        if (only && (data.customerId !== only.customerId || data.shopId !== only.shopId)) {
          continue;
        }
        if (options.dryRun) {
          actions.push({
            id: doc.id,
            displayId: data.displayId ?? null,
            kind: 'legacy_expire',
            orderStatus: data.orderStatus || null,
            paymentStatus: data.payment ? data.payment.status : null
          });
          continue;
        }
        const result = await this.expireOne(doc.ref);
        if (!result.expired) {
          continue;
        }
        await shopOrderService.notifyCustomer(result.customerId, 'PAYMENT_EXPIRED', {
          displayId: displayIdService.formatDisplayId(result.displayId),
          orderId: doc.id
        });
        actions.push({ id: doc.id, kind: 'legacy_expire', changed: true });
      }
      return { skipped: false, dryRun: Boolean(options.dryRun), newStatuses: false, nowMs, actions };
    }

    const db = getFirestore();
    const candidates = [];
    const awaitingSnap = await db.collection('marketplaceOrders')
      .where('orderStatus', '==', 'awaiting_payment')
      .where('window.start', '<=', admin.firestore.Timestamp.fromMillis(nowMs))
      .get();
    awaitingSnap.docs.forEach((doc) => candidates.push({ doc, lane: 'awaiting' }));

    const balanceSnap = await db.collection('marketplaceOrders')
      .where('payment.status', '==', 'short')
      .where('payment.balance.dueBy', '<=', admin.firestore.Timestamp.fromMillis(nowMs))
      .get();
    balanceSnap.docs.forEach((doc) => candidates.push({ doc, lane: 'balance' }));

    const paidSnap = await db.collection('marketplaceOrders')
      .where('cancellation.paidCheck', '==', 'pending')
      .where('cancellation.paidCheckAt', '<', admin.firestore.Timestamp.fromMillis(nowMs - settings.paidCheckMs))
      .get();
    paidSnap.docs.forEach((doc) => candidates.push({ doc, lane: 'paid_check' }));

    const closeSnap = await db.collection('marketplaceOrders')
      .where('orderStatus', '==', 'payment_unconfirmed')
      .where('window.start', '<', admin.firestore.Timestamp.fromMillis(nowMs - settings.unconfirmedCloseMs))
      .get();
    closeSnap.docs.forEach((doc) => candidates.push({ doc, lane: 'unconfirmed' }));

    const reviewSnap = await db.collection('marketplaceOrders')
      .where('orderStatus', '==', 'payment_review')
      .where('payment.review.openedAt', '<', admin.firestore.Timestamp.fromMillis(nowMs - settings.reviewEscalateMs))
      .get();
    reviewSnap.docs.forEach((doc) => candidates.push({ doc, lane: 'review' }));

    const actions = [];
    for (let index = 0; index < candidates.length; index += 1) {
      const item = candidates[index];
      const preview = item.doc.data() || {};
      if (only && (preview.customerId !== only.customerId || preview.shopId !== only.shopId)) {
        continue;
      }
      if (options.dryRun) {
        const action = decideForLane(item.lane, preview, nowMs, settings);
        if (!action) {
          continue;
        }
        actions.push({
          id: item.doc.id,
          displayId: preview.displayId ?? null,
          kind: action.kind,
          orderStatus: preview.orderStatus || null,
          paymentStatus: preview.payment ? preview.payment.status : null
        });
        continue;
      }
      const result = await this.applyOne(item.doc.ref, item.lane, nowMs, settings);
      if (!result.changed) {
        continue;
      }
      await this.sendNotifies(result.notifies);
      actions.push({ id: item.doc.id, kind: result.kind, changed: true });
    }

    return { skipped: false, dryRun: Boolean(options.dryRun), newStatuses: true, nowMs, actions };
  }

  async readSettings() {
    const snap = await getFirestore().collection(SETTINGS_DOC[0]).doc(SETTINGS_DOC[1]).get();
    const data = snap.exists ? (snap.data() || {}) : null;
    const timeoutMs = Number(data && data.PAYMENT_TIMEOUT_MS);
    return {
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : null,
      timeoutReason: !snap.exists
        ? 'appSettings/marketplace document is missing'
        : 'appSettings/marketplace.PAYMENT_TIMEOUT_MS is missing or invalid',
      nudgeMs: minutesOf(data, 'UTR_NUDGE_MINUTES', MARKETPLACE_DEFAULTS.UTR_NUDGE_MINUTES) * 60 * 1000,
      reminderMinutes: reminderMinutesOf(data),
      paidCheckMs: hoursOf(data, 'PAID_CHECK_ESCALATE_HOURS', MARKETPLACE_DEFAULTS.PAID_CHECK_ESCALATE_HOURS) * 60 * 60 * 1000,
      unconfirmedCloseMs: hoursOf(data, 'UNCONFIRMED_AUTO_CLOSE_HOURS', MARKETPLACE_DEFAULTS.UNCONFIRMED_AUTO_CLOSE_HOURS) * 60 * 60 * 1000,
      reviewEscalateHours: hoursOf(data, 'REVIEW_ESCALATE_HOURS', MARKETPLACE_DEFAULTS.REVIEW_ESCALATE_HOURS),
      reviewEscalateMs: hoursOf(data, 'REVIEW_ESCALATE_HOURS', MARKETPLACE_DEFAULTS.REVIEW_ESCALATE_HOURS) * 60 * 60 * 1000
    };
  }

  async readTimeoutMs() {
    const settings = await this.readSettings();
    if (!settings.timeoutMs) {
      return { ok: false, reason: settings.timeoutReason };
    }
    return { ok: true, timeoutMs: settings.timeoutMs };
  }

  async expireOne(orderRef) {
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) {
        return { expired: false, reason: 'missing' };
      }
      const data = snap.data() || {};
      const paymentStatus = data.payment && data.payment.status;
      if (!EXPIREABLE.has(paymentStatus)) {
        return { expired: false, reason: 'not-expireable', paymentStatus, orderStatus: data.orderStatus };
      }
      const db = getFirestore();
      const customerId = data.customerId || null;
      const shopId = data.shopId || null;
      const lockRef = customerId && shopId
        ? db.collection('marketplaceLocks').doc(`${customerId}_${shopId}`)
        : null;
      const userRef = customerId ? db.collection('users').doc(customerId) : null;
      const lockSnap = lockRef ? await tx.get(lockRef) : null;
      const userSnap = userRef ? await tx.get(userRef) : null;
      const at = serverStamp();
      tx.update(orderRef, {
        orderStatus: 'cancelled',
        'payment.status': 'expired',
        'payment.expiredAt': at,
        updatedAt: at
      });
      releaseLock(tx, lockRef, lockSnap, userRef, userSnap, orderRef.id);
      appendEvent(tx, orderRef, {
        type: 'timed_out',
        actor: JOB_ACTOR,
        data: { mode: 'legacy' }
      });
      return {
        expired: true,
        customerId: data.customerId || null,
        displayId: data.displayId,
        paymentStatus
      };
    });
  }

  async applyOne(orderRef, lane, nowMs, settings) {
    return getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) {
        return { changed: false };
      }
      const data = snap.data() || {};
      const action = decideForLane(lane, data, nowMs, settings);
      if (!action) {
        return { changed: false };
      }
      const db = getFirestore();
      const customerId = data.customerId || null;
      const shopId = data.shopId || null;
      const leavesAwaiting = action.kind === 'timeout_review'
        || action.kind === 'timeout_unconfirmed'
        || action.kind === 'balance_expired';
      const lockRef = leavesAwaiting && customerId && shopId
        ? db.collection('marketplaceLocks').doc(`${customerId}_${shopId}`)
        : null;
      const userRef = leavesAwaiting && customerId ? db.collection('users').doc(customerId) : null;
      const shopRef = action.kind === 'timeout_review' && shopId
        ? db.collection('shops').doc(shopId)
        : null;
      const lockSnap = lockRef ? await tx.get(lockRef) : null;
      const userSnap = userRef ? await tx.get(userRef) : null;
      const shopSnap = shopRef ? await tx.get(shopRef) : null;
      const at = serverStamp();
      const variables = pushVariables(data, orderRef.id);
      let notifies = [];

      if (action.kind === 'nudge') {
        tx.update(orderRef, { 'payment.nudges.utr3min': at, updatedAt: at });
        appendEvent(tx, orderRef, { type: 'utr_nudge', actor: JOB_ACTOR, data: null });
        notifies = [{ audience: 'customer', id: customerId, template: 'UTR_NUDGE', variables }];
      } else if (action.kind === 'reminder') {
        tx.update(orderRef, {
          [`payment.remindersSent.${action.flag}`]: at,
          updatedAt: at
        });
        appendEvent(tx, orderRef, {
          type: 'reminder_sent',
          actor: JOB_ACTOR,
          data: { minute: action.minute }
        });
        notifies = [{ audience: 'shop', id: shopId, template: 'PAYMENT_REMINDER', variables }];
      } else if (action.kind === 'timeout_review') {
        tx.update(orderRef, {
          orderStatus: 'payment_review',
          'payment.status': 'under_review',
          'payment.review': {
            status: 'open',
            openedAt: at,
            trigger: 'utr_timeout',
            shopResponse: null,
            outcome: null
          },
          updatedAt: at
        });
        releaseLock(tx, lockRef, lockSnap, userRef, userSnap, orderRef.id);
        if (shopSnap && shopSnap.exists) {
          const stats = (shopSnap.data() || {}).marketplaceStats || {};
          const opened = Number(stats.reviewsOpened);
          tx.update(shopRef, {
            'marketplaceStats.reviewsOpened': (Number.isFinite(opened) ? opened : 0) + 1
          });
        }
        appendEvent(tx, orderRef, {
          type: 'review_opened',
          actor: JOB_ACTOR,
          data: { trigger: 'utr_timeout' }
        });
        notifies = [
          { audience: 'customer', id: customerId, template: 'PAYMENT_UNDER_REVIEW', variables },
          { audience: 'shop', id: shopId, template: 'PAYMENT_REVIEW_SHOP', variables }
        ];
      } else if (action.kind === 'timeout_unconfirmed') {
        tx.update(orderRef, {
          orderStatus: 'payment_unconfirmed',
          'payment.status': 'expired',
          'payment.expiredAt': at,
          updatedAt: at
        });
        releaseLock(tx, lockRef, lockSnap, userRef, userSnap, orderRef.id);
        appendEvent(tx, orderRef, {
          type: 'timed_out',
          actor: JOB_ACTOR,
          data: { mode: 'unconfirmed' }
        });
        notifies = [{ audience: 'customer', id: customerId, template: 'PAYMENT_NOT_CONFIRMED', variables }];
      } else if (action.kind === 'balance_expired') {
        const payment = data.payment || {};
        const refund = {
          id: crypto.randomBytes(8).toString('hex'),
          reason: 'balance_expired',
          amount: payment.receivedAmount != null ? payment.receivedAmount : null,
          items: Array.isArray(data.items) ? data.items : [],
          status: 'upi_needed',
          customerUpiId: null,
          // Firestore rejects serverTimestamp() inside an array. This is the real
          // server clock, not the simulated tick clock used for comparisons.
          createdAt: admin.firestore.Timestamp.now()
        };
        tx.update(orderRef, {
          orderStatus: 'cancelled',
          closedReason: 'balance_expired',
          'cancellation.reason': 'balance_expired',
          'cancellation.cancelledAt': at,
          'cancellation.cancelledBy': 'system',
          'payment.status': 'refund_pending',
          refunds: (Array.isArray(data.refunds) ? data.refunds : []).concat([refund]),
          updatedAt: at
        });
        releaseLock(tx, lockRef, lockSnap, userRef, userSnap, orderRef.id);
        appendEvent(tx, orderRef, {
          type: 'cancelled',
          actor: JOB_ACTOR,
          reason: 'balance_expired',
          data: { reason: 'balance_expired' }
        });
        notifies = [{
          audience: 'customer',
          id: customerId,
          template: 'REFUND_INITIATED',
          variables: { ...variables, amount: refund.amount }
        }];
      } else if (action.kind === 'paid_check_alert') {
        tx.update(orderRef, { 'cancellation.paidCheckEscalatedAt': at, updatedAt: at });
        appendEvent(tx, orderRef, {
          type: 'paid_check',
          actor: JOB_ACTOR,
          data: { escalated: true }
        });
        notifies = [{ audience: 'support', id: orderRef.id, displayId: data.displayId ?? null }];
      } else if (action.kind === 'unconfirmed_close') {
        tx.update(orderRef, {
          orderStatus: 'cancelled',
          closedReason: 'unconfirmed_expired',
          'cancellation.reason': 'unconfirmed_expired',
          'cancellation.cancelledAt': at,
          'cancellation.cancelledBy': 'system',
          updatedAt: at
        });
        appendEvent(tx, orderRef, {
          type: 'cancelled',
          actor: JOB_ACTOR,
          reason: 'unconfirmed_expired',
          data: { reason: 'unconfirmed_expired' }
        });
        notifies = [{ audience: 'customer', id: customerId, template: 'ORDER_CLOSED_UNCONFIRMED', variables }];
      } else if (action.kind === 'review_escalated') {
        tx.update(orderRef, {
          'payment.review.escalatedAt': at,
          updatedAt: at
        });
        appendEvent(tx, orderRef, {
          type: 'review_escalated',
          actor: JOB_ACTOR,
          data: { hoursOpen: action.hoursOpen }
        });
        notifies = [{
          audience: 'review',
          id: orderRef.id,
          displayId: data.displayId ?? null,
          hoursOpen: action.hoursOpen
        }];
      }

      return { changed: true, kind: action.kind, notifies };
    });
  }

  async sendNotifies(notifies) {
    const notes = Array.isArray(notifies) ? notifies : [];
    for (let index = 0; index < notes.length; index += 1) {
      const note = notes[index];
      if (note.audience === 'support') {
        alertPaidCheck(note.id, note.displayId);
        continue;
      }
      if (note.audience === 'review') {
        alertReviewEscalated(note.id, note.displayId, note.hoursOpen);
        continue;
      }
      if (note.audience === 'shop') {
        await notifyShop(note.id, note.template, note.variables);
        continue;
      }
      await shopOrderService.notifyCustomer(note.id, note.template, note.variables || {});
    }
  }
}

function serverStamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function minutesOf(data, key, fallback) {
  const raw = data && Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
  const minutes = Number(raw);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : fallback;
}

function hoursOf(data, key, fallback) {
  const raw = data && Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
  const hours = Number(raw);
  return Number.isFinite(hours) && hours > 0 ? hours : fallback;
}

function reminderMinutesOf(data) {
  const raw = data && data.REMINDER_MINUTES;
  if (!Array.isArray(raw)) {
    return MARKETPLACE_DEFAULTS.REMINDER_MINUTES.slice();
  }
  const minutes = raw.map((value) => Number(value)).filter((value) => value === 5 || value === 10);
  const chosen = minutes.length > 0 ? minutes : MARKETPLACE_DEFAULTS.REMINDER_MINUTES.slice();
  return chosen.sort((left, right) => left - right);
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

function releaseLock(tx, lockRef, lockSnap, userRef, userSnap, orderId) {
  const lockData = lockSnap && lockSnap.exists ? (lockSnap.data() || {}) : null;
  if (lockRef && lockData && lockData.orderId === orderId) {
    tx.delete(lockRef);
  }
  const marketplace = userSnap && userSnap.exists && userSnap.data()
    && userSnap.data().customer && userSnap.data().customer.marketplace;
  const unpaidCount = marketplace ? Number(marketplace.unpaidCount) : 0;
  if (userRef && Number.isFinite(unpaidCount) && unpaidCount > 0) {
    tx.update(userRef, { 'customer.marketplace.unpaidCount': unpaidCount - 1 });
  }
}

function pushVariables(data, orderId) {
  const snapshot = data.shopSnapshot && typeof data.shopSnapshot === 'object' ? data.shopSnapshot : {};
  return {
    displayId: displayIdService.formatDisplayId(data.displayId),
    orderId,
    shopName: typeof snapshot.name === 'string' ? snapshot.name : ''
  };
}

function hasCustomerUtr(payment) {
  return Boolean(payment && payment.customerUtr);
}

function windowStillOpen(data, nowMs) {
  const endMs = millisOf(data.window && data.window.end);
  return Number.isFinite(endMs) && nowMs < endMs;
}

function decideAwaiting(data, nowMs, settings) {
  if (data.orderStatus !== 'awaiting_payment') {
    return null;
  }
  const payment = data.payment || {};
  if (payment.status === 'short' || payment.status === 'confirmed') {
    return null;
  }
  if (!AWAITING_PAYMENT_STATUSES.has(payment.status)) {
    return null;
  }
  const endMs = millisOf(data.window && data.window.end);
  if (Number.isFinite(endMs) && nowMs >= endMs) {
    if (hasCustomerUtr(payment)) {
      return { kind: 'timeout_review' };
    }
    return { kind: 'timeout_unconfirmed' };
  }
  const startMs = millisOf(data.window && data.window.start);
  if (!Number.isFinite(startMs) || !windowStillOpen(data, nowMs)) {
    return null;
  }
  const nudges = payment.nudges && typeof payment.nudges === 'object' ? payment.nudges : {};
  if (!hasCustomerUtr(payment) && !nudges.utr3min && nowMs >= startMs + settings.nudgeMs) {
    return { kind: 'nudge' };
  }
  const sent = payment.remindersSent && typeof payment.remindersSent === 'object' ? payment.remindersSent : {};
  const minutes = settings.reminderMinutes;
  for (let index = 0; index < minutes.length; index += 1) {
    const minute = minutes[index];
    const flag = minute === 5 ? 'min5' : 'min10';
    if (sent[flag]) {
      continue;
    }
    if (nowMs >= startMs + (minute * 60 * 1000)) {
      return { kind: 'reminder', minute, flag };
    }
  }
  return null;
}

function decideBalance(data, nowMs) {
  if (data.orderStatus !== 'awaiting_payment') {
    return null;
  }
  if (!isShortBalanceExpired(data, nowMs)) {
    return null;
  }
  return { kind: 'balance_expired' };
}

function decidePaidCheck(data, nowMs, settings) {
  const cancellation = data.cancellation || {};
  if (cancellation.paidCheck !== 'pending' || cancellation.paidCheckEscalatedAt) {
    return null;
  }
  const atMs = millisOf(cancellation.paidCheckAt);
  if (!Number.isFinite(atMs) || nowMs <= atMs + settings.paidCheckMs) {
    return null;
  }
  return { kind: 'paid_check_alert' };
}

function decideReview(data, nowMs, settings) {
  if (data.orderStatus !== 'payment_review') {
    return null;
  }
  const review = data.payment && data.payment.review ? data.payment.review : null;
  if (!review || review.status !== 'open' || review.escalatedAt) {
    return null;
  }
  const openedMs = millisOf(review.openedAt);
  if (!Number.isFinite(openedMs) || nowMs <= openedMs + settings.reviewEscalateMs) {
    return null;
  }
  return { kind: 'review_escalated', hoursOpen: settings.reviewEscalateHours };
}

function decideUnconfirmed(data, nowMs, settings) {
  if (data.orderStatus !== 'payment_unconfirmed') {
    return null;
  }
  const startMs = millisOf(data.window && data.window.start);
  if (!Number.isFinite(startMs) || nowMs <= startMs + settings.unconfirmedCloseMs) {
    return null;
  }
  return { kind: 'unconfirmed_close' };
}

function decideForLane(lane, data, nowMs, settings) {
  if (lane === 'awaiting') {
    return decideAwaiting(data, nowMs, settings);
  }
  if (lane === 'balance') {
    return decideBalance(data, nowMs);
  }
  if (lane === 'paid_check') {
    return decidePaidCheck(data, nowMs, settings);
  }
  if (lane === 'unconfirmed') {
    return decideUnconfirmed(data, nowMs, settings);
  }
  if (lane === 'review') {
    return decideReview(data, nowMs, settings);
  }
  return null;
}

function alertReviewEscalated(orderId, displayId, hoursOpen) {
  console.warn('⚠️ [MARKETPLACE_TIMEOUT] Payment review open past the escalate window', {
    orderId,
    displayId,
    hoursOpen
  });
  try {
    const Sentry = require('../../instrument.js');
    if (Sentry && typeof Sentry.captureMessage === 'function') {
      Sentry.captureMessage('Marketplace payment review escalated', {
        level: 'warning',
        extra: { orderId, displayId, hoursOpen }
      });
    }
  } catch (error) {
    console.error('❌ [MARKETPLACE_TIMEOUT] Review escalate alert failed', error.message);
  }
}

function alertPaidCheck(orderId, displayId) {
  // Log and Sentry only. An admin "overdue paid checks" list is a later phase.
  console.warn('⚠️ [MARKETPLACE_TIMEOUT] Paid check overdue', { orderId, displayId });
  try {
    const Sentry = require('../../instrument.js');
    if (Sentry && typeof Sentry.captureMessage === 'function') {
      Sentry.captureMessage('Marketplace paid check overdue', {
        level: 'warning',
        extra: { orderId, displayId }
      });
    }
  } catch (error) {
    console.error('❌ [MARKETPLACE_TIMEOUT] Paid check alert failed', error.message);
  }
}

async function notifyShop(shopId, template, variables) {
  if (!shopId) {
    return;
  }
  try {
    const notificationService = require('./notificationService');
    const result = await notificationService.sendTemplateNotification(shopId, 'MARKETPLACE', template, variables);
    if (result && result.success === false) {
      console.error('❌ [MARKETPLACE_TIMEOUT] Shop push failed', (result.error && result.error.code) || result.error);
    }
  } catch (error) {
    console.error('❌ [MARKETPLACE_TIMEOUT] Shop push failed', error.message);
  }
}

const marketplacePaymentTimeoutJob = new MarketplacePaymentTimeoutJob();
marketplacePaymentTimeoutJob.isLegacyPaymentExpireable = (status) => EXPIREABLE.has(status);
marketplacePaymentTimeoutJob.decideForLane = decideForLane;
module.exports = marketplacePaymentTimeoutJob;
