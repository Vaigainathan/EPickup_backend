const cron = require('node-cron');
const { getFirestore } = require('./firebase');
const {
  pendingTimeoutMs,
  pendingTimeoutNotifyMaxAgeMs,
  isEnvEnabled,
  isEnvDryRun
} = require('../config/parcelDefaults');
const {
  planPendingTimeoutCandidate,
  cancelPendingParcelInTransaction,
  classifyPendingTimeoutScan,
  dryRunCancelPayload,
  bookingYoungEnoughToNotify
} = require('./parcel/parcelPendingCancelService');
const { notifyParcelBookingCancelled } = require('./parcel/parcelBookingCancelledNotify');

const JOB_ACTOR = 'system:parcel-pending-timeout-job';
const CANCEL_REASON = 'no_driver_timeout';
const QUERY_LIMIT = 200;
const DRY_RUN_ENV = 'PARCEL_PENDING_TIMEOUT_DRY_RUN';
const NOTIFY_MAX_AGE_ENV = 'PARCEL_PENDING_TIMEOUT_NOTIFY_MAX_AGE_MINUTES';

class ParcelPendingTimeoutJob {
  constructor() {
    this.task = null;
    this.ticking = false;
  }

  start() {
    if (!isEnvEnabled('PARCEL_PENDING_TIMEOUT_ENABLED', true)) {
      console.log('ℹ️ [PARCEL_PENDING_TIMEOUT] Disabled via PARCEL_PENDING_TIMEOUT_ENABLED');
      return;
    }
    if (this.task) {
      return;
    }
    this.task = cron.schedule('* * * * *', () => {
      this.runTick().catch((error) => {
        console.error('❌ [PARCEL_PENDING_TIMEOUT] Tick failed:', error.message);
      });
    });
    console.log('✅ [PARCEL_PENDING_TIMEOUT] Cron scheduled (every 60s)');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
    }
  }

  resolveDryRun(options) {
    if (options.dryRun === true) {
      return true;
    }
    return isEnvDryRun(DRY_RUN_ENV);
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
    const timeoutMs = Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : pendingTimeoutMs(process.env.PARCEL_PENDING_NO_DRIVER_TIMEOUT_MINUTES);
    const notifyMaxAgeMs = Number.isFinite(options.notifyMaxAgeMs)
      ? options.notifyMaxAgeMs
      : pendingTimeoutNotifyMaxAgeMs(process.env[NOTIFY_MAX_AGE_ENV]);
    const dryRun = this.resolveDryRun(options);
    const db = getFirestore();

    const snapshot = await db.collection('bookings')
      .where('status', '==', 'pending')
      .limit(QUERY_LIMIT)
      .get();

    const summary = {
      scanned: snapshot.size,
      candidates: 0,
      cancelled: 0,
      skipped_scheduled: 0,
      skipped_marketplace: 0
    };
    const actions = [];

    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      const scanKind = classifyPendingTimeoutScan(data, nowMs);
      if (scanKind === 'marketplace') {
        summary.skipped_marketplace += 1;
        continue;
      }
      if (scanKind === 'scheduled') {
        summary.skipped_scheduled += 1;
        continue;
      }

      const planned = planPendingTimeoutCandidate(data, doc.id, nowMs, timeoutMs);
      if (!planned) {
        continue;
      }
      summary.candidates += 1;

      if (dryRun) {
        const payload = dryRunCancelPayload(data, doc.id, nowMs);
        console.log('[PARCEL_PENDING_TIMEOUT][DRY_RUN] would cancel', payload);
        actions.push({ id: doc.id, kind: 'pending_timeout', wouldCancel: true, dryRun: true });
        continue;
      }

      const result = await cancelPendingParcelInTransaction(db, {
        bookingId: doc.id,
        reason: CANCEL_REASON,
        cancelledBy: JOB_ACTOR,
        now: new Date(nowMs)
      });

      if (!result.changed) {
        actions.push({ id: doc.id, kind: 'pending_timeout', changed: false, code: result.code });
        continue;
      }

      summary.cancelled += 1;

      const notify = bookingYoungEnoughToNotify(data, nowMs, notifyMaxAgeMs);
      if (notify) {
        await notifyParcelBookingCancelled({
          bookingId: doc.id,
          customerId: result.customerId,
          reason: CANCEL_REASON,
          cancelledBy: JOB_ACTOR,
          notifyCustomerPush: true
        });
      } else {
        console.log('✅ [PARCEL_PENDING_TIMEOUT] Cancelled silently (no notify)', {
          bookingId: doc.id,
          customerId: result.customerId
        });
      }

      actions.push({ id: doc.id, kind: 'pending_timeout', changed: true, notified: notify });
    }

    console.log(
      `[PARCEL_PENDING_TIMEOUT] tick summary scanned=${summary.scanned} ` +
      `candidates=${summary.candidates} cancelled=${summary.cancelled} ` +
      `skipped_scheduled=${summary.skipped_scheduled} skipped_marketplace=${summary.skipped_marketplace}`
    );

    return {
      skipped: false,
      dryRun,
      nowMs,
      timeoutMs,
      notifyMaxAgeMs,
      scanned: summary.scanned,
      summary,
      actions
    };
  }
}

const parcelPendingTimeoutJob = new ParcelPendingTimeoutJob();
parcelPendingTimeoutJob.planPendingTimeoutCandidate = planPendingTimeoutCandidate;
parcelPendingTimeoutJob.cancelPendingParcelInTransaction = cancelPendingParcelInTransaction;
parcelPendingTimeoutJob.classifyPendingTimeoutScan = classifyPendingTimeoutScan;
parcelPendingTimeoutJob.bookingYoungEnoughToNotify = bookingYoungEnoughToNotify;
parcelPendingTimeoutJob.dryRunCancelPayload = dryRunCancelPayload;
parcelPendingTimeoutJob.QUERY_LIMIT = QUERY_LIMIT;
parcelPendingTimeoutJob.resolveDryRun = ParcelPendingTimeoutJob.prototype.resolveDryRun;
module.exports = parcelPendingTimeoutJob;
