const cron = require('node-cron');
const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('./firebase');
const { ORDER_NUMBER_POOL_SIZE, COUNTER_COLLECTION, COUNTER_DOC } = require('./orderNumberPool');
const { readMp17Settings } = require('./marketplace/jobSettings');
const {
  claimPoolAlertDay,
  computePoolUsedRatio
} = require('./marketplace/cleanupJobDecisions');

const SETTINGS_DOC = ['appSettings', 'marketplace'];
const ALERT_DOC = 'order_number_pool_alert';

function istCalendarDay(nowMs) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(nowMs));
}

function alertPoolUsage(usedRatio, totalAllocated) {
  const payload = {
    usedRatio,
    totalAllocated,
    poolSize: ORDER_NUMBER_POOL_SIZE
  };
  console.warn('⚠️ [ORDER_NUMBER_POOL] Usage above alert threshold', payload);
  try {
    const Sentry = require('../../instrument.js');
    if (Sentry && typeof Sentry.captureMessage === 'function') {
      Sentry.captureMessage('Marketplace order number pool usage high', {
        level: 'warning',
        extra: payload
      });
    }
  } catch (error) {
    console.error('❌ [ORDER_NUMBER_POOL] Alert failed', error.message);
  }
}

class MarketplaceOrderNumberPoolJob {
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
        console.error('❌ [ORDER_NUMBER_POOL] Tick failed:', error.message);
      });
    });
    console.log('✅ [ORDER_NUMBER_POOL] Cron scheduled (hourly)');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  async runTick(options = {}) {
    if (this.ticking) {
      return { skipped: true, reason: 'overlap', alerted: false };
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
    const counterSnap = await db.collection(COUNTER_COLLECTION).doc(COUNTER_DOC).get();
    const counter = counterSnap.exists ? (counterSnap.data() || {}) : {};
    const totalAllocated = Number(counter.totalAllocated) || 0;
    const usedRatio = computePoolUsedRatio(totalAllocated, ORDER_NUMBER_POOL_SIZE);
    const istDay = istCalendarDay(nowMs);

    if (options.dryRun) {
      const alertSnap = await db.collection(COUNTER_COLLECTION).doc(ALERT_DOC).get();
      const lastAlertIstDay = alertSnap.exists ? (alertSnap.data() || {}).lastAlertIstDay : null;
      const preview = claimPoolAlertDay({
        usedRatio,
        threshold: settings.orderNumberAlertRatio,
        lastAlertIstDay,
        istDay
      });
      return {
        skipped: false,
        dryRun: true,
        nowMs,
        totalAllocated,
        usedRatio,
        alerted: false,
        wouldAlert: preview.claim === true
      };
    }

    const alertRef = db.collection(COUNTER_COLLECTION).doc(ALERT_DOC);
    const claim = await db.runTransaction(async (tx) => {
      const alertSnap = await tx.get(alertRef);
      const lastAlertIstDay = alertSnap.exists ? (alertSnap.data() || {}).lastAlertIstDay : null;
      const decision = claimPoolAlertDay({
        usedRatio,
        threshold: settings.orderNumberAlertRatio,
        lastAlertIstDay,
        istDay
      });
      if (!decision.claim) {
        return { claimed: false, reason: decision.reason || null };
      }
      tx.set(alertRef, {
        lastAlertIstDay: istDay,
        lastAlertAt: FieldValue.serverTimestamp(),
        usedRatio,
        totalAllocated
      }, { merge: true });
      return { claimed: true };
    });

    if (!claim.claimed) {
      return {
        skipped: false,
        dryRun: false,
        nowMs,
        totalAllocated,
        usedRatio,
        alerted: false,
        reason: claim.reason || null
      };
    }

    alertPoolUsage(usedRatio, totalAllocated);
    return {
      skipped: false,
      dryRun: false,
      nowMs,
      totalAllocated,
      usedRatio,
      alerted: true
    };
  }
}

const marketplaceOrderNumberPoolJob = new MarketplaceOrderNumberPoolJob();
marketplaceOrderNumberPoolJob.computePoolUsedRatio = computePoolUsedRatio;
marketplaceOrderNumberPoolJob.claimPoolAlertDay = claimPoolAlertDay;
marketplaceOrderNumberPoolJob.istCalendarDay = istCalendarDay;
module.exports = marketplaceOrderNumberPoolJob;
