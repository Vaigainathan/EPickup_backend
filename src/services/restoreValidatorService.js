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
          console.log('🔔 [RESTORE_VALIDATOR] No selected slots found - forcing driver offline');
          await db.collection('users').doc(driverId).update({
            'driver.isOnline': false,
            'driver.isAvailable': false,
            updatedAt: new Date()
          });
          await this._writeAudit(driverId, context, 'NO_SELECTED_SLOTS');
          // Optionally emit websocket event here via websocketEventHandler (not imported to avoid circular deps)
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
