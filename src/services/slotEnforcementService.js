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
      // ✅ CRITICAL FIX: Check if driver has active booking - NEVER force offline if they have active booking
      const activeBookingStatuses = ['driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff', 'delivered', 'money_collection'];
      const activeBookingQuery = await this.db.collection('bookings')
        .where('driverId', '==', driverId)
        .where('status', 'in', activeBookingStatuses)
        .limit(1)
        .get();
      
      const hasActiveBooking = !activeBookingQuery.empty;
      if (hasActiveBooking) {
        const activeBooking = activeBookingQuery.docs[0].data();
        console.log(`✅ [SLOT_ENFORCEMENT] Driver ${driverId} has active booking (${activeBooking.status}) - skipping enforcement (must stay online)`);
        return {
          driverId,
          success: true,
          action: 'skipped',
          reason: 'Driver has active booking - must stay online'
        };
      }

      // ✅ CRITICAL FIX: Check if driver manually set status recently - respect manual online status
      // This prevents slot enforcement from overriding driver's manual online choice
      // ✅ INCREASED: Grace period from 30 to 60 minutes (better for app restart scenarios)
      const lastStatusUpdate = driverData.driver?.lastStatusUpdate;
      const isManuallyOnline = (() => {
        if (!lastStatusUpdate || !driverData.driver?.isOnline) return false;
        const lastUpdateTime = lastStatusUpdate?.toDate ? lastStatusUpdate.toDate() : new Date(lastStatusUpdate);
        const timeSinceLastUpdate = currentTime - lastUpdateTime;
        const gracePeriodMs = 60 * 60 * 1000; // 60 minutes grace period (increased from 30) - covers app restart + slot gaps
        return timeSinceLastUpdate < gracePeriodMs;
      })();

      if (isManuallyOnline) {
        const lastUpdateTime = lastStatusUpdate?.toDate ? lastStatusUpdate.toDate() : new Date(lastStatusUpdate);
        const timeSinceLastUpdate = currentTime - lastUpdateTime;
        console.log(`✅ [SLOT_ENFORCEMENT] Driver ${driverId} manually went online recently (${Math.round(timeSinceLastUpdate / 60000)}m ago) - respecting manual status (grace period: 60m)`);
        return {
          driverId,
          success: true,
          action: 'skipped',
          reason: 'Driver manually set online recently - respecting manual status'
        };
      }

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

      // ✅ CRITICAL FIX: Don't enforce slots if driver has no selected slots
      // This prevents disruption when driver is testing or has admin permission
      if (selectedSlots.length === 0) {
        console.log(`⚠️ [SLOT_ENFORCEMENT] Driver ${driverId} has no selected slots but is online - skipping enforcement`);
        return {
          driverId,
          success: true,
          action: 'skipped',
          reason: 'No selected slots but driver is online'
        };
      }

      // ✅ CRITICAL FIX: Check if ALL slots have expired (not just if driver is in active slot)
      // This is the real-time enforcement that forces drivers offline when slots expire
      const activeSlot = selectedSlots.find(slot => {
        const startTime = slot.startTime?.toDate ? slot.startTime.toDate() : new Date(slot.startTime);
        const endTime = slot.endTime?.toDate ? slot.endTime.toDate() : new Date(slot.endTime);
        return currentTime >= startTime && currentTime <= endTime;
      });

      // Check for upcoming slots (not yet started)
      const upcomingSlot = selectedSlots.find(slot => {
        const startTime = slot.startTime?.toDate ? slot.startTime.toDate() : new Date(slot.startTime);
        return currentTime < startTime;
      });

      // ✅ CRITICAL FIX: Check if ALL slots have expired
      const expiredSlots = selectedSlots.filter(slot => {
        const endTime = slot.endTime?.toDate ? slot.endTime.toDate() : new Date(slot.endTime);
        return currentTime > endTime;
      });

      // ✅ CRITICAL FIX: Force offline if ALL slots have expired (real-time enforcement)
      if (expiredSlots.length === selectedSlots.length && selectedSlots.length > 0) {
        console.log(`🔴 [SLOT_ENFORCEMENT] Driver ${driverId} has ALL expired slots - forcing OFFLINE`, {
          expiredCount: expiredSlots.length,
          totalSlots: selectedSlots.length,
          expiredSlots: expiredSlots.map(s => s.label || s.slotId)
        });
        
        await this.forceDriverOffline(driverId, `All slots expired: ${expiredSlots.map(s => s.label || s.slotId).join(', ')}`);
        return {
          driverId,
          success: true,
          action: 'forced_offline',
          reason: 'All selected slots have expired'
        };
      }

      // ✅ If driver is not in active slot but has upcoming slots, allow staying online (preparation mode)
      if (!activeSlot && upcomingSlot) {
        console.log(`⏰ [SLOT_ENFORCEMENT] Driver ${driverId} has upcoming slot - allowing online (preparation mode)`, {
          upcomingSlot: upcomingSlot.label || upcomingSlot.slotId
        });
        return {
          driverId,
          success: true,
          action: 'skipped',
          reason: 'Has upcoming slot - preparation mode allowed'
        };
      }

      // ✅ If no active slot and no upcoming slots but some slots expired, check if ALL are expired (handled above)
      // If some slots are still valid (not yet started), allow staying online
      if (!activeSlot && expiredSlots.length < selectedSlots.length) {
        console.log(`✅ [SLOT_ENFORCEMENT] Driver ${driverId} has valid upcoming slots - allowing online`, {
          validSlots: selectedSlots.length - expiredSlots.length,
          expiredSlots: expiredSlots.length
        });
        return {
          driverId,
          success: true,
          action: 'skipped',
          reason: 'Has valid upcoming slots'
        };
      }

      // ✅ If no active slot and no upcoming slots and ALL slots expired (should be caught above, but safety check)
      if (!activeSlot && !upcomingSlot) {
        console.log(`🔴 [SLOT_ENFORCEMENT] Driver ${driverId} has no active or upcoming slots - forcing OFFLINE`);
        await this.forceDriverOffline(driverId, 'No active or upcoming slots');
        return {
          driverId,
          success: true,
          action: 'forced_offline',
          reason: 'No active or upcoming slots'
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
