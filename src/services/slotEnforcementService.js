const { getFirestore } = require('firebase-admin/firestore');

/**
 * Slot Enforcement Service
 * Automatically enforces work slot constraints for drivers
 */
class SlotEnforcementService {
  constructor() {
    this.db = null;
    this.enforcementInterval = null;
    this.isRunning = false;
  }

  /**
   * Initialize the service
   */
  initialize() {
    if (this.isRunning) {
      console.log('⚠️ [SLOT_ENFORCEMENT] Service already running');
      return;
    }

    this.db = getFirestore();
    this.startEnforcement();
    console.log('✅ [SLOT_ENFORCEMENT] Service initialized and started');
  }

  /**
   * Start automatic slot enforcement
   */
  startEnforcement() {
    if (this.enforcementInterval) {
      clearInterval(this.enforcementInterval);
    }

    // Check every 2 minutes
    this.enforcementInterval = setInterval(async () => {
      await this.enforceSlotConstraints();
    }, 2 * 60 * 1000);

    this.isRunning = true;
    console.log('🔄 [SLOT_ENFORCEMENT] Started automatic enforcement (every 2 minutes)');
  }

  /**
   * Stop automatic slot enforcement
   */
  stopEnforcement() {
    if (this.enforcementInterval) {
      clearInterval(this.enforcementInterval);
      this.enforcementInterval = null;
    }
    this.isRunning = false;
    console.log('⏹️ [SLOT_ENFORCEMENT] Stopped automatic enforcement');
  }

  /**
   * Enforce slot constraints for all online drivers
   */
  async enforceSlotConstraints() {
    try {
      console.log('🔍 [SLOT_ENFORCEMENT] Checking slot constraints for all drivers');

      // Get all online drivers
      const onlineDriversQuery = await this.db.collection('users')
        .where('driver.isOnline', '==', true)
        .get();

      if (onlineDriversQuery.empty) {
        console.log('📍 [SLOT_ENFORCEMENT] No online drivers found');
        return;
      }

      const now = new Date();
      const enforcementResults = [];

      for (const driverDoc of onlineDriversQuery.docs) {
        const driverId = driverDoc.id;
        const driverData = driverDoc.data();

        try {
          const result = await this.enforceDriverSlotConstraints(driverId, driverData, now);
          enforcementResults.push(result);
        } catch (error) {
          console.error(`❌ [SLOT_ENFORCEMENT] Error enforcing constraints for driver ${driverId}:`, error);
          enforcementResults.push({
            driverId,
            success: false,
            error: error.message
          });
        }
      }

      const successful = enforcementResults.filter(r => r.success).length;
      const failed = enforcementResults.filter(r => !r.success).length;
      
      console.log(`✅ [SLOT_ENFORCEMENT] Enforcement complete: ${successful} successful, ${failed} failed`);

    } catch (error) {
      console.error('❌ [SLOT_ENFORCEMENT] Error in enforceSlotConstraints:', error);
    }
  }

  /**
   * Enforce slot constraints for a specific driver
   */
  async enforceDriverSlotConstraints(driverId, driverData, currentTime = new Date()) {
    try {
      // Get driver's work slots for today
      const workSlotsService = require('./workSlotsService');
      const slotsResult = await workSlotsService.getDriverSlots(driverId, currentTime);

      if (!slotsResult.success) {
        console.log(`⚠️ [SLOT_ENFORCEMENT] Could not fetch slots for driver ${driverId}:`, slotsResult.error);
        return {
          driverId,
          success: false,
          error: 'Could not fetch work slots'
        };
      }

      const slots = slotsResult.data || [];
      const selectedSlots = slots.filter(slot => slot.isSelected === true);

      if (selectedSlots.length === 0) {
        // Driver has no selected slots - force offline
        console.log(`❌ [SLOT_ENFORCEMENT] Driver ${driverId} has no selected slots - forcing offline`);
        await this.forceDriverOffline(driverId, 'No selected work slots');
        return {
          driverId,
          success: true,
          action: 'forced_offline',
          reason: 'No selected work slots'
        };
      }

      // Check if current time falls within any selected slot
      const activeSlot = selectedSlots.find(slot => {
        const startTime = slot.startTime?.toDate ? slot.startTime.toDate() : new Date(slot.startTime);
        const endTime = slot.endTime?.toDate ? slot.endTime.toDate() : new Date(slot.endTime);
        return currentTime >= startTime && currentTime <= endTime;
      });

      if (!activeSlot) {
        // Driver is not in any active slot - force offline
        console.log(`❌ [SLOT_ENFORCEMENT] Driver ${driverId} not in active slot time - forcing offline`);
        await this.forceDriverOffline(driverId, 'Not in active work slot time');
        return {
          driverId,
          success: true,
          action: 'forced_offline',
          reason: 'Not in active work slot time'
        };
      }

      // Driver is in active slot - ensure they're online
      if (!driverData.driver?.isOnline) {
        console.log(`✅ [SLOT_ENFORCEMENT] Driver ${driverId} is in active slot but offline - setting online`);
        await this.setDriverOnline(driverId);
        return {
          driverId,
          success: true,
          action: 'set_online',
          reason: 'In active work slot time'
        };
      }

      return {
        driverId,
        success: true,
        action: 'no_change',
        reason: 'Driver is online and in active slot'
      };

    } catch (error) {
      console.error(`❌ [SLOT_ENFORCEMENT] Error enforcing constraints for driver ${driverId}:`, error);
      return {
        driverId,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Force driver offline
   */
  async forceDriverOffline(driverId, reason) {
    try {
      const batch = this.db.batch();

      // Update driver status
      const driverRef = this.db.collection('users').doc(driverId);
      batch.update(driverRef, {
        'driver.isOnline': false,
        'driver.isAvailable': false,
        'driver.lastSeen': new Date(),
        'driver.offlineReason': reason,
        updatedAt: new Date()
      });

      // Update driver location
      const driverLocationRef = this.db.collection('driverLocations').doc(driverId);
      batch.update(driverLocationRef, {
        isOnline: false,
        isAvailable: false,
        lastUpdated: new Date()
      });

      await batch.commit();

      // Send WebSocket notification
      try {
        const socketService = require('./socket');
        const io = socketService.getSocketIO();
        io.to(`user:${driverId}`).emit('driver_status_changed', {
          isOnline: false,
          isAvailable: false,
          reason: reason,
          timestamp: new Date().toISOString()
        });
        console.log(`📡 [SLOT_ENFORCEMENT] Sent offline notification to driver ${driverId}`);
      } catch (notificationError) {
        console.error('❌ [SLOT_ENFORCEMENT] Failed to send notification:', notificationError);
      }

      console.log(`✅ [SLOT_ENFORCEMENT] Forced driver ${driverId} offline: ${reason}`);

    } catch (error) {
      console.error(`❌ [SLOT_ENFORCEMENT] Error forcing driver ${driverId} offline:`, error);
      throw error;
    }
  }

  /**
   * Set driver online (if they're in active slot)
   */
  async setDriverOnline(driverId) {
    try {
      const batch = this.db.batch();

      // Update driver status
      const driverRef = this.db.collection('users').doc(driverId);
      batch.update(driverRef, {
        'driver.isOnline': true,
        'driver.isAvailable': true,
        'driver.lastSeen': new Date(),
        updatedAt: new Date()
      });

      // Update driver location
      const driverLocationRef = this.db.collection('driverLocations').doc(driverId);
      batch.update(driverLocationRef, {
        isOnline: true,
        isAvailable: true,
        lastUpdated: new Date()
      });

      await batch.commit();

      // Send WebSocket notification
      try {
        const socketService = require('./socket');
        const io = socketService.getSocketIO();
        io.to(`user:${driverId}`).emit('driver_status_changed', {
          isOnline: true,
          isAvailable: true,
          reason: 'In active work slot time',
          timestamp: new Date().toISOString()
        });
        console.log(`📡 [SLOT_ENFORCEMENT] Sent online notification to driver ${driverId}`);
      } catch (notificationError) {
        console.error('❌ [SLOT_ENFORCEMENT] Failed to send notification:', notificationError);
      }

      console.log(`✅ [SLOT_ENFORCEMENT] Set driver ${driverId} online`);

    } catch (error) {
      console.error(`❌ [SLOT_ENFORCEMENT] Error setting driver ${driverId} online:`, error);
      throw error;
    }
  }

  /**
   * Get enforcement status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      hasInterval: !!this.enforcementInterval,
      intervalMinutes: 2
    };
  }
}

// Export singleton instance
const slotEnforcementService = new SlotEnforcementService();
module.exports = slotEnforcementService;
