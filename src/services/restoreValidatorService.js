const { getFirestore } = require('./firebase');
const workSlotsService = require('./workSlotsService');

const db = getFirestore();

class RestoreValidatorService {
  constructor() {
    this.DEFAULT_DELAY_MS = 10 * 1000; // 10s delay before validation
  }

  async scheduleRestoreValidation(driverId, options = {}) {
    const delay = options.delayMs || this.DEFAULT_DELAY_MS;
    const context = options.context || 'restoreFromAppRestart';

    console.log(`🔔 [RESTORE_VALIDATOR] Scheduling restore validation for ${driverId} in ${delay}ms (ctx=${context})`);

    setTimeout(async () => {
      try {
        console.log(`🔎 [RESTORE_VALIDATOR] Running restore validation for ${driverId} (ctx=${context})`);

        const slotsResult = await workSlotsService.getDriverSlots(driverId, new Date());

        if (!slotsResult || !slotsResult.success) {
          console.warn('⚠️ [RESTORE_VALIDATOR] Could not fetch slots during validation, will retry once');
          // Retry once after short backoff
          await new Promise(r => setTimeout(r, 5000));
          const retry = await workSlotsService.getDriverSlots(driverId, new Date());
          if (!retry || !retry.success) {
            console.error('❌ [RESTORE_VALIDATOR] Retry failed - leaving driver state as-is and logging');
            await this._writeAudit(driverId, context, 'SLOTS_FETCH_FAILED');
            return;
          }
          // use retry
          slotsResult.data = retry.data;
        }

        const slots = slotsResult.data || [];
        const selected = slots.filter(s => s.isSelected === true);

        if (!selected || selected.length === 0) {
          // Before forcing offline, ensure driver does not have an active booking
          try {
            const activeBookingStatuses = ['driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff', 'delivered', 'money_collection'];
            const activeBookingQuery = await db.collection('bookings')
              .where('driverId', '==', driverId)
              .where('status', 'in', activeBookingStatuses)
              .limit(1)
              .get();

            if (!activeBookingQuery.empty) {
              console.log(`🔔 [RESTORE_VALIDATOR] Active booking present for ${driverId} - skipping forced offline`);
              await this._writeAudit(driverId, context, 'SKIPPED_ACTIVE_BOOKING');
              return;
            }
          } catch (bookingCheckErr) {
            console.warn('⚠️ [RESTORE_VALIDATOR] Failed to check active bookings:', bookingCheckErr && bookingCheckErr.message);
            // If check fails, conservatively skip forcing offline to avoid disrupting deliveries
            await this._writeAudit(driverId, context, 'BOOKING_CHECK_FAILED');
            return;
          }

          // Don't force offline if driver just reconnected (killed and reopened app)
          try {
            const userDoc = await db.collection('users').doc(driverId).get();
            const userData = userDoc.exists ? userDoc.data() : null;
            const lastSeenRaw = userData?.driver?.lastSeen;
            let lastSeenDate = null;
            if (lastSeenRaw) {
              lastSeenDate = lastSeenRaw.toDate ? lastSeenRaw.toDate() : new Date(lastSeenRaw);
            }
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            if (lastSeenDate && lastSeenDate > fiveMinutesAgo) {
              console.log(`🔔 [RESTORE_VALIDATOR] Recent lastSeen detected for ${driverId} (${lastSeenDate.toISOString()}) - skipping forced offline`);
              await this._writeAudit(driverId, context, 'SKIPPED_RECENT_RECONNECT');
              return;
            }
          } catch (recentCheckErr) {
            console.warn('⚠️ [RESTORE_VALIDATOR] Failed to check recent lastSeen (non-critical):', recentCheckErr && recentCheckErr.message);
            // If this check fails, be conservative and skip forcing offline to avoid disrupting deliveries
            await this._writeAudit(driverId, context, 'RECENT_SEEN_CHECK_FAILED');
            return;
          }

          console.log('🔔 [RESTORE_VALIDATOR] No selected slots found - forcing driver offline');
          await db.collection('users').doc(driverId).update({
            'driver.isOnline': false,
            'driver.isAvailable': false,
            updatedAt: new Date()
          });
          
          // ✅ NEW: Emit force_offline event to frontend
          try {
            const socketService = require('./socket');
            const io = socketService.getSocketIO();
            io.to(`driver:${driverId}`).emit('force_offline', {
              reason: 'restore_validation_failed',
              message: 'Your offline status was restored but you have no active work slots. Please select slots to go online.',
              timestamp: new Date().toISOString(),
              details: 'NO_SELECTED_SLOTS'
            });
            console.log(`📡 [RESTORE_VALIDATOR] Emitted force_offline to driver ${driverId}`);
          } catch (socketErr) {
            console.warn('⚠️ [RESTORE_VALIDATOR] Failed to emit force_offline event (non-critical):', socketErr && socketErr.message);
          }
          
          await this._writeAudit(driverId, context, 'NO_SELECTED_SLOTS');
          return;
        }

        // If we reach here, validation passed
        console.log('✅ [RESTORE_VALIDATOR] Restore validation passed for', driverId);
        await this._writeAudit(driverId, context, 'VALIDATION_PASSED');
      } catch (err) {
        console.error('❌ [RESTORE_VALIDATOR] Error during restore validation for', driverId, err);
        await this._writeAudit(driverId, context, 'VALIDATION_ERROR', err && err.message);
      }
    }, delay);
  }

  async _writeAudit(driverId, context, result, details = null) {
    try {
      await db.collection('onlineStatusAudit').add({
        driverId,
        context,
        result,
        details,
        timestamp: new Date()
      });
    } catch (err) {
      console.warn('⚠️ [RESTORE_VALIDATOR] Failed to write audit record:', err && err.message);
    }
  }
}

module.exports = new RestoreValidatorService();
