const cron = require('node-cron');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('./firebase');
const { readMp17Settings } = require('./marketplace/jobSettings');
const {
  claimSlowDriverInTransaction,
  planSlowDriverTickItem,
  shouldNotifySlowDriver
} = require('./marketplace/slowDriverJobDecisions');
const { STAGING_TEST_PAIR } = require('./marketplace/mp17StagingPair');

const SETTINGS_DOC = ['appSettings', 'marketplace'];

class MarketplaceSlowDriverJob {
  constructor() {
    this.task = null;
    this.ticking = false;
  }

  start() {
    if (this.task) {
      return;
    }
    this.task = cron.schedule('* * * * *', () => {
      this.runTick().catch((error) => {
        console.error('❌ [MARKETPLACE_SLOW_DRIVER] Tick failed:', error.message);
      });
    });
    console.log('✅ [MARKETPLACE_SLOW_DRIVER] Cron scheduled (every 60s)');
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

  async executeTick(options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const db = getFirestore();
    const settingsSnap = await db.collection(SETTINGS_DOC[0]).doc(SETTINGS_DOC[1]).get();
    const settings = readMp17Settings(settingsSnap.exists ? settingsSnap.data() : null);
    const only = options.only && options.only.customerId && options.only.shopId ? options.only : null;
    const stagingPair = options.stagingPair || STAGING_TEST_PAIR;
    const stagingApplyLock = options.stagingApplyLock === true;
    const reportStagingSkips = options.reportStagingSkips === true;

    const snapshot = await db.collection('marketplaceOrders')
      .where('orderStatus', '==', 'ready')
      .get();

    const actions = [];
    const skippedNotTestPair = [];
    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      if (only && (data.customerId !== only.customerId || data.shopId !== only.shopId)) {
        continue;
      }
      const planned = planSlowDriverTickItem({
        orderId: doc.id,
        data,
        nowMs,
        slowMs: settings.driverSlowMs,
        stagingPair,
        stagingApplyLock,
        reportStagingSkips
      });
      if (planned && planned.skipped) {
        skippedNotTestPair.push(planned);
        continue;
      }
      if (!planned) {
        continue;
      }
      if (options.dryRun) {
        actions.push({ id: doc.id, kind: 'slow_driver', changed: false, wouldApply: true });
        continue;
      }
      const outcome = await this.applyOne(doc.ref, nowMs, settings.driverSlowMs);
      if (outcome.notify) {
        await this.notifyCustomer(outcome);
      }
      if (outcome.claimed) {
        actions.push({ id: doc.id, kind: 'slow_driver', changed: true, notified: outcome.notify });
      }
    }

    const result = { skipped: false, dryRun: Boolean(options.dryRun), nowMs, actions };
    if (reportStagingSkips) {
      result.skippedNotTestPair = skippedNotTestPair;
    }
    return result;
  }

  async applyOne(orderRef, nowMs, slowMs) {
    const db = getFirestore();
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) {
        return { claimed: false, notify: false };
      }
      const data = snap.data() || {};
      const decision = claimSlowDriverInTransaction(data, nowMs, slowMs);
      if (!decision.claim) {
        return { claimed: false, notify: false };
      }
      tx.update(orderRef, {
        'delivery.slowNotifiedAt': FieldValue.serverTimestamp(),
        'delivery.updatedAt': FieldValue.serverTimestamp()
      });
      const { marketplacePushVariables } = require('./marketplace/marketplacePush');
      return {
        claimed: true,
        notify: decision.notify,
        customerId: data.customerId || null,
        variables: marketplacePushVariables(data, orderRef.id)
      };
    });
  }

  async notifyCustomer(outcome) {
    if (!outcome.customerId) {
      return;
    }
    try {
      const notificationService = require('./notificationService');
      const result = await notificationService.sendTemplateNotification(
        outcome.customerId,
        'MARKETPLACE',
        'DRIVER_SLOW',
        outcome.variables
      );
      if (result && result.success === false) {
        console.error('❌ [MARKETPLACE_SLOW_DRIVER] Push failed', result.error || result);
      }
    } catch (error) {
      console.error('❌ [MARKETPLACE_SLOW_DRIVER] Push failed', error.message);
    }
  }
}

const marketplaceSlowDriverJob = new MarketplaceSlowDriverJob();
marketplaceSlowDriverJob.shouldNotifySlowDriver = shouldNotifySlowDriver;
marketplaceSlowDriverJob.claimSlowDriverInTransaction = claimSlowDriverInTransaction;
marketplaceSlowDriverJob.planSlowDriverTickItem = planSlowDriverTickItem;
module.exports = marketplaceSlowDriverJob;
