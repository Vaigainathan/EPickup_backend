const cron = require('node-cron');
const { getFirestore } = require('./firebase');
const {
  midTripStuckMs,
  driverSilentMs,
  stuckDedupMs,
  isEnvEnabled
} = require('../config/parcelDefaults');
const { PARCEL_MIDTRIP_MONITOR_STATUSES } = require('../constants/parcelMonitorStatuses');
const { resolveBookingSourceType } = require('../utils/bookingSourceType');
const { planStatusStuck, planDriverSilent } = require('./parcel/stuckMonitorDecisions');

const QUERY_LIMIT = 200;
const dedupCache = new Map();

function dedupKey(bookingId, alertType) {
  return `${bookingId}:${alertType}`;
}

function shouldEmitAlert(key, nowMs, dedupMs) {
  const last = dedupCache.get(key);
  if (Number.isFinite(last) && nowMs - last < dedupMs) {
    return false;
  }
  dedupCache.set(key, nowMs);
  return true;
}

function captureStuckAlert(payload) {
  console.warn('⚠️ [PARCEL_STUCK_MONITOR]', payload);
  try {
    const Sentry = require('../../instrument.js'); // backend/instrument.js
    if (Sentry && typeof Sentry.captureMessage === 'function') {
      Sentry.captureMessage('Parcel booking monitor alert', {
        level: 'warning',
        extra: payload
      });
    }
  } catch (error) {
    console.error('❌ [PARCEL_STUCK_MONITOR] Sentry failed:', error.message);
  }
}

class ParcelStuckMonitorJob {
  constructor() {
    this.task = null;
    this.ticking = false;
  }

  start() {
    if (!isEnvEnabled('PARCEL_STUCK_MONITOR_ENABLED', true)) {
      console.log('ℹ️ [PARCEL_STUCK_MONITOR] Disabled via PARCEL_STUCK_MONITOR_ENABLED');
      return;
    }
    if (this.task) {
      return;
    }
    this.task = cron.schedule('* * * * *', () => {
      this.runTick().catch((error) => {
        console.error('❌ [PARCEL_STUCK_MONITOR] Tick failed:', error.message);
      });
    });
    console.log('✅ [PARCEL_STUCK_MONITOR] Cron scheduled (every 60s)');
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
    const stuckMs = Number.isFinite(options.stuckMs)
      ? options.stuckMs
      : midTripStuckMs(process.env.PARCEL_MIDTRIP_STUCK_MINUTES);
    const silentMs = Number.isFinite(options.silentMs)
      ? options.silentMs
      : driverSilentMs(process.env.PARCEL_DRIVER_SILENT_MINUTES);
    const dedupMs = Number.isFinite(options.dedupMs)
      ? options.dedupMs
      : stuckDedupMs(process.env.PARCEL_STUCK_ALERT_DEDUP_MINUTES);

    const db = getFirestore();
    const snapshot = await db.collection('bookings')
      .where('status', 'in', PARCEL_MIDTRIP_MONITOR_STATUSES)
      .limit(QUERY_LIMIT)
      .get();

    const alerts = [];
    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      if (resolveBookingSourceType(data) === 'marketplace') {
        continue;
      }

      const statusPlan = planStatusStuck(data, doc.id, nowMs, stuckMs);
      if (statusPlan) {
        const key = dedupKey(doc.id, statusPlan.alertType);
        if (shouldEmitAlert(key, nowMs, dedupMs)) {
          const payload = { ...statusPlan, detectedAt: new Date(nowMs).toISOString() };
          if (!options.dryRun) {
            captureStuckAlert(payload);
          }
          alerts.push({ ...payload, dryRun: Boolean(options.dryRun) });
        }
      }

      if (data.driverId) {
        const locationSnap = await db.collection('driverLocations').doc(data.driverId).get();
        const location = locationSnap.exists ? (locationSnap.data() || {}) : null;
        const silentPlan = planDriverSilent(data, location, doc.id, nowMs, silentMs);
        if (silentPlan) {
          const key = dedupKey(doc.id, silentPlan.alertType);
          if (shouldEmitAlert(key, nowMs, dedupMs)) {
            const payload = { ...silentPlan, detectedAt: new Date(nowMs).toISOString() };
            if (!options.dryRun) {
              captureStuckAlert(payload);
            }
            alerts.push({ ...payload, dryRun: Boolean(options.dryRun) });
          }
        }
      }
    }

    return {
      skipped: false,
      dryRun: Boolean(options.dryRun),
      nowMs,
      scanned: snapshot.size,
      alerts
    };
  }
}

const parcelStuckMonitorJob = new ParcelStuckMonitorJob();
parcelStuckMonitorJob.shouldEmitAlert = shouldEmitAlert;
parcelStuckMonitorJob.dedupKey = dedupKey;
parcelStuckMonitorJob._resetDedupCache = () => dedupCache.clear();
module.exports = parcelStuckMonitorJob;
