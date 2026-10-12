const cron = require('node-cron');
const { getFirestore } = require('./firebase');
const { readHelpSettings, alertHelp } = require('./marketplace/helpRequests');
const { millisOf } = require('./marketplace/evidenceCommon');

const MINUTE_MS = 60 * 1000;

class MarketplaceHelpJob {
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
        console.error('❌ [MARKETPLACE_HELP_JOB] Tick failed:', error.message);
      });
    });
    console.log('✅ [MARKETPLACE_HELP_JOB] Cron scheduled (hourly)');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  async runTick(options = {}) {
    if (this.ticking) {
      return { skipped: true, reason: 'overlap', alerts: [] };
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
    const settingsSnap = await db.collection('appSettings').doc('marketplace').get();
    const settings = readHelpSettings(settingsSnap.exists ? settingsSnap.data() : null);
    const alertMs = settings.alertMinutes * MINUTE_MS;
    if (!Number.isFinite(alertMs) || alertMs <= 0) {
      return { skipped: false, nowMs, alerts: [] };
    }

    const snap = await db.collection('supportTickets')
      .where('status', '==', 'open')
      .get();

    const alerts = [];
    snap.docs.forEach((doc) => {
      const row = doc.data() || {};
      if (row.category !== 'marketplace_order') {
        return;
      }
      if (row.priority !== 'high') {
        return;
      }
      if (row.assignedTo != null && row.assignedTo !== '') {
        return;
      }
      const createdMs = millisOf(row.createdAt);
      if (!Number.isFinite(createdMs) || nowMs - createdMs <= alertMs) {
        return;
      }
      if (options.dryRun) {
        alerts.push({ ticketId: doc.id, orderId: row.orderId || null, dryRun: true });
        return;
      }
      alertHelp('High-priority help ticket unassigned', doc.id, row.orderId || null);
      alerts.push({ ticketId: doc.id, orderId: row.orderId || null });
    });

    return { skipped: false, nowMs, alerts };
  }
}

const marketplaceHelpJob = new MarketplaceHelpJob();
module.exports = marketplaceHelpJob;
