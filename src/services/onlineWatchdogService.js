const { getFirestore, Timestamp } = require('./firebase');

class OnlineWatchdogService {
  constructor() {
    this.db = null;
    this.intervalId = null;
    this.DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    this.DEFAULT_LASTSEEN_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
  }

  init(dbInstance) {
    this.db = dbInstance || getFirestore();
  }

  start(options = {}) {
    try {
      const enabled = process.env.FEATURE_ENABLE_ONLINE_WATCHDOG !== 'false';
      if (!enabled) {
        console.log('ℹ️ [WATCHDOG] Online watchdog disabled via env');
        return;
      }

      const intervalMs = options.intervalMs || this.DEFAULT_INTERVAL_MS;
      if (this.intervalId) {
        clearInterval(this.intervalId);
      }

      this.intervalId = setInterval(() => this.runCheck(), intervalMs);
      console.log(`✅ [WATCHDOG] Online watchdog started (interval=${intervalMs}ms)`);
    } catch (err) {
      console.warn('⚠️ [WATCHDOG] Failed to start watchdog:', err && err.message);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('✅ [WATCHDOG] Online watchdog stopped');
    }
  }

  async runCheck() {
    try {
      if (!this.db) this.db = getFirestore();

      console.log('🔎 [WATCHDOG] Running online consistency check...');

      // Query drivers that are currently marked online
      const driversQuery = await this.db.collection('users')
        .where('driver.isOnline', '==', true)
        .limit(200)
        .get();

      if (driversQuery.empty) {
        console.log('🔍 [WATCHDOG] No drivers currently online (skipping)');
        return;
      }

      const batch = this.db.batch();
      const audits = [];
      const now = Date.now();
      const lastSeenThreshold = parseInt(process.env.WATCHDOG_LASTSEEN_THRESHOLD_MS, 10) || this.DEFAULT_LASTSEEN_THRESHOLD_MS;

      for (const doc of driversQuery.docs) {
        const driverId = doc.id;
        const data = doc.data();
        const lastSeen = data.driver?.lastSeen ? new Date(data.driver.lastSeen).getTime() : null;

        // If lastSeen is null or too old, verify selected slots
        let needsOffline = false;
        if (!lastSeen || (now - lastSeen) > lastSeenThreshold) {
          // Check if driver has any selected slots for today
          const slotsSnap = await this.db.collection('workSlots')
            .where('driverId', '==', driverId)
            .where('isSelected', '==', true)
            .where('startTime', '>=', Timestamp.fromDate(new Date(new Date().setHours(0,0,0,0))))
            .where('startTime', '<=', Timestamp.fromDate(new Date(new Date().setHours(23,59,59,999))))
            .limit(1)
            .get();

          if (slotsSnap.empty) {
            needsOffline = true;
          }
        }

        if (needsOffline) {
          const userRef = this.db.collection('users').doc(driverId);
          batch.set(userRef, {
            'driver.isOnline': false,
            'driver.isAvailable': false,
            'driver.lastWatchdogForcedAt': new Date(),
            updatedAt: new Date()
          }, { merge: true });

          audits.push({ driverId, reason: 'STALE_OR_NO_SELECTED_SLOTS' });
          console.log(`🛡️ [WATCHDOG] Forcing offline for driver ${driverId} due to stale/no slots`);
        }
      }

      if (audits.length > 0) {
        // Commit batch updates
        await batch.commit();

        // Write audit entries
        const auditBatch = this.db.batch();
        const auditCollection = this.db.collection('onlineStatusAudit');
        audits.forEach(a => {
          const ref = auditCollection.doc();
          auditBatch.set(ref, {
            driverId: a.driverId,
            context: 'watchdog_forced_offline',
            result: 'FORCED_OFFLINE',
            details: a.reason,
            timestamp: new Date()
          });
        });
        await auditBatch.commit();
        console.log(`✅ [WATCHDOG] Wrote ${audits.length} audit records`);
      } else {
        console.log('✅ [WATCHDOG] No inconsistent drivers found');
      }

    } catch (err) {
      console.error('❌ [WATCHDOG] Error during runCheck:', err && err.message);
    }
  }
}

module.exports = new OnlineWatchdogService();
