const cron = require('node-cron');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('./firebase');
const { MARKETPLACE_DEFAULTS } = require('../config/marketplaceDefaults');
const { getMarketplaceEnforcement } = require('./marketplace/orderStateMachine');
const { appendEvent } = require('./marketplace/orderEvents');
const {
  alertRefund,
  millisOf,
  mirrorPatch
} = require('./marketplace/refunds');
const displayIdService = require('./displayIdService');
const notificationService = require('./notificationService');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const JOB_ACTOR = { type: 'system', id: 'refund-job' };

class MarketplaceRefundJob {
  constructor() {
    this.task = null;
    this.ticking = false;
  }

  start() {
    if (this.task) {
      return;
    }
    this.task = cron.schedule('0 * * * *', () => {
      this.runTick().catch((error) => {
        console.error('❌ [REFUNDS] Tick failed:', error.message);
      });
    });
    console.log('✅ [REFUNDS] Cron scheduled (hourly)');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
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
    if (enforcement.newStatuses !== true) {
      return { skipped: false, dryRun: Boolean(options.dryRun), newStatuses: false, nowMs, actions: [] };
    }
    const db = getFirestore();
    const snap = await db.collection('marketplaceOrders').where('hasOpenRefund', '==', true).get();
    const only = options.only && options.only.customerId && options.only.shopId ? options.only : null;
    const actions = [];
    for (let index = 0; index < snap.docs.length; index += 1) {
      const doc = snap.docs[index];
      const data = doc.data() || {};
      if (only && (data.customerId !== only.customerId || data.shopId !== only.shopId)) {
        continue;
      }
      if (options.dryRun) {
        const refundSnap = await doc.ref.collection('refunds').get();
        const planned = planRefundActions(data, refundSnap.docs.map((refundDoc) => ({
          id: refundDoc.id,
          data: refundDoc.data() || {}
        })), nowMs);
        planned.forEach((action) => {
          actions.push({ id: doc.id, refundId: action.refundId, kind: action.kind, changed: false });
        });
        continue;
      }
      const applied = await this.applyOrder(doc.ref, nowMs);
      applied.forEach((action) => actions.push(action));
    }
    return { skipped: false, dryRun: Boolean(options.dryRun), newStatuses: true, nowMs, actions };
  }

  async applyOrder(orderRef, nowMs) {
    const db = getFirestore();
    const outcome = await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists || (orderSnap.data() || {}).hasOpenRefund !== true) {
        return { actions: [], notifies: [] };
      }
      const data = orderSnap.data() || {};
      const refundSnap = await tx.get(orderRef.collection('refunds'));
      const refunds = refundSnap.docs.map((doc) => ({
        id: doc.id,
        ref: doc.ref,
        data: doc.data() || {}
      }));
      const planned = planRefundActions(data, refunds, nowMs);
      if (planned.length === 0) {
        return { actions: [], notifies: [] };
      }
      const needsShop = planned.some((action) => action.kind === 'due48');
      const shopRef = needsShop && data.shopId ? db.collection('shops').doc(data.shopId) : null;
      const shopSnap = shopRef ? await tx.get(shopRef) : null;
      const stamp = FieldValue.serverTimestamp();
      const notifies = [];
      const actions = [];
      let overdueAdded = 0;
      planned.forEach((action) => {
        const refund = refunds.find((item) => item.id === action.refundId);
        if (!refund) {
          return;
        }
        const reminders = {
          upi24: false,
          upi72: false,
          upiAlert7d: false,
          due24: false,
          due48: false,
          ack24: false,
          ...(refund.data.reminders && typeof refund.data.reminders === 'object' ? refund.data.reminders : {})
        };
        const row = { id: orderRef.id, refundId: refund.id, kind: action.kind, changed: true };
        if (action.kind === 'auto_close') {
          tx.update(refund.ref, { status: 'closed', autoClosedAt: stamp, updatedAt: stamp });
          refund.data.status = 'closed';
          appendEvent(tx, orderRef, { type: 'refund_auto_closed', actor: JOB_ACTOR, data: null }, data.customerId);
          notifies.push({ template: 'REFUND_CLOSED', customerId: data.customerId, shopId: data.shopId });
        } else if (action.kind === 'upi7d') {
          reminders.upiAlert7d = true;
          tx.update(refund.ref, { reminders, updatedAt: stamp });
          refund.data.reminders = reminders;
          appendEvent(tx, orderRef, {
            type: 'refund_reminder',
            actor: JOB_ACTOR,
            data: { which: 'upi7d' }
          }, data.customerId);
          row.alert = true;
        } else if (action.kind === 'due48') {
          reminders.due48 = true;
          const counted = refund.data.overdueCounted === true;
          tx.update(refund.ref, { reminders, overdueCounted: true, updatedAt: stamp });
          refund.data.reminders = reminders;
          refund.data.overdueCounted = true;
          if (!counted) {
            overdueAdded += 1;
          }
          appendEvent(tx, orderRef, {
            type: 'refund_reminder',
            actor: JOB_ACTOR,
            data: { which: 'due48' }
          }, data.customerId);
          notifies.push({ template: 'REFUND_OVERDUE', customerId: data.customerId, shopId: data.shopId });
        } else {
          reminders[action.kind] = true;
          tx.update(refund.ref, { reminders, updatedAt: stamp });
          refund.data.reminders = reminders;
          const which = action.kind;
          appendEvent(tx, orderRef, {
            type: 'refund_reminder',
            actor: JOB_ACTOR,
            data: { which }
          }, data.customerId);
          if (which === 'upi24' || which === 'upi72') {
            notifies.push({ template: 'REFUND_UPI_REMINDER', customerId: data.customerId, shopId: null });
          } else if (which === 'due24') {
            notifies.push({ template: 'REFUND_OVERDUE', customerId: null, shopId: data.shopId });
          } else if (which === 'ack24') {
            notifies.push({ template: 'REFUND_ACK_REMINDER', customerId: data.customerId, shopId: null });
          }
        }
        actions.push(row);
      });
      if (overdueAdded > 0 && shopSnap && shopSnap.exists && shopRef) {
        const stats = (shopSnap.data() || {}).marketplaceStats || {};
        const count = typeof stats.refundsOverdue === 'number' ? stats.refundsOverdue : 0;
        tx.update(shopRef, { 'marketplaceStats.refundsOverdue': count + overdueAdded });
      }
      const open = refunds.some((refund) => ['upi_needed', 'due', 'sent', 'disputed'].includes(refund.data.status));
      tx.update(orderRef, { ...mirrorPatch(data, open), updatedAt: stamp });
      return {
        actions,
        notifies,
        variables: {
          displayId: displayIdService.formatDisplayId(data.displayId),
          orderId: orderRef.id,
          shopName: ''
        }
      };
    });
    const variables = outcome.variables;
    for (let index = 0; index < outcome.notifies.length; index += 1) {
      const note = outcome.notifies[index];
      await notifyUser(note.customerId, note.template, variables);
      await notifyUser(note.shopId, note.template, variables);
    }
    outcome.actions.filter((action) => action.alert).forEach((action) => {
      alertRefund('Marketplace refund UPI still missing', action.id, action.refundId);
    });
    outcome.actions.filter((action) => action.kind === 'due48').forEach((action) => {
      alertRefund('Marketplace refund overdue', action.id, action.refundId);
    });
    return outcome.actions;
  }
}

function olderThan(nowMs, startMs, durationMs) {
  return Number.isFinite(startMs) && nowMs > startMs + durationMs;
}

function planRefundActions(data, refunds, nowMs) {
  const actions = [];
  refunds.forEach((refund) => {
    const source = refund.data || {};
    const reminders = source.reminders && typeof source.reminders === 'object' ? source.reminders : {};
    const chaseMs = millisOf(source.upiChaseFrom);
    if (source.status === 'upi_needed') {
      if (!reminders.upi24 && olderThan(nowMs, chaseMs, MARKETPLACE_DEFAULTS.REFUND_UPI_REMINDER_HOURS * HOUR_MS)) {
        actions.push({ refundId: refund.id, kind: 'upi24' });
      }
      if (!reminders.upi72 && olderThan(nowMs, chaseMs, MARKETPLACE_DEFAULTS.REFUND_UPI_SECOND_REMINDER_HOURS * HOUR_MS)) {
        actions.push({ refundId: refund.id, kind: 'upi72' });
      }
      if (!reminders.upiAlert7d && olderThan(nowMs, chaseMs, MARKETPLACE_DEFAULTS.REFUND_UPI_ALERT_DAYS * DAY_MS)) {
        actions.push({ refundId: refund.id, kind: 'upi7d' });
      }
    }
    if (source.status === 'due') {
      const dueMs = millisOf(source.dueBy);
      const submittedMs = millisOf(source.upiSubmittedAt);
      if (!reminders.due24 && Number.isFinite(dueMs) && nowMs > dueMs) {
        actions.push({ refundId: refund.id, kind: 'due24' });
      }
      if (!reminders.due48
        && olderThan(nowMs, submittedMs, MARKETPLACE_DEFAULTS.REFUND_ESCALATE_HOURS * HOUR_MS)) {
        actions.push({ refundId: refund.id, kind: 'due48' });
      }
    }
    if (source.status === 'sent') {
      const sentMs = millisOf(source.sentAt);
      const auto = olderThan(nowMs, sentMs, MARKETPLACE_DEFAULTS.REFUND_ACK_AUTO_CLOSE_HOURS * HOUR_MS);
      if (auto) {
        actions.push({ refundId: refund.id, kind: 'auto_close' });
      } else if (!reminders.ack24 && olderThan(nowMs, sentMs, MARKETPLACE_DEFAULTS.REFUND_ACK_REMINDER_HOURS * HOUR_MS)) {
        actions.push({ refundId: refund.id, kind: 'ack24' });
      }
    }
  });
  return actions;
}

async function notifyUser(userId, template, variables) {
  if (!userId || !template) {
    return;
  }
  try {
    await notificationService.sendTemplateNotification(userId, 'MARKETPLACE', template, variables);
  } catch (error) {
    console.error('❌ [REFUNDS] Notification failed', error.message);
  }
}

const marketplaceRefundJob = new MarketplaceRefundJob();
marketplaceRefundJob.planRefundActions = planRefundActions;
module.exports = marketplaceRefundJob;
