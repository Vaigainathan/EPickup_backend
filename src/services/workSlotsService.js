const { getFirestore, Timestamp } = require('../services/firebase');

/**
 * Work Slots Service
 * Manages the new gig slot system with 2-hour blocks
 */

class WorkSlotsService {
  constructor() {
    this.db = getFirestore();
    // CRITICAL: Track ongoing generation to prevent concurrent requests
    this.ongoingGenerations = new Map(); // driverId -> timestamp
  }

  /**
   * Generate daily work slots for a driver
   * Creates 8 slots: 7-9 AM, 9-11 AM, 11-1 PM, 1-3 PM, 3-5 PM, 5-7 PM, 7-9 PM, 9-11 PM
   */
  async generateDailySlots(driverId, date = new Date()) {
    try {
      console.log(`🔄 [WORK_SLOTS] Generating daily slots for driver: ${driverId}, date: ${date.toISOString().split('T')[0]}`);
      
      // CRITICAL: Check if generation is already in progress for this driver
      if (this.ongoingGenerations.has(driverId)) {
        const ongoingStart = this.ongoingGenerations.get(driverId);
        const elapsed = Date.now() - ongoingStart;
        
        if (elapsed < 5000) { // If started less than 5 seconds ago
          console.warn(`⚠️ [WORK_SLOTS] Generation already in progress for driver ${driverId} (started ${elapsed}ms ago)`);
          return {
            success: false,
            error: {
              code: 'GENERATION_IN_PROGRESS',
              message: 'Slot generation already in progress for this driver',
              details: 'Please wait for the current generation to complete'
            }
          };
        } else {
          // If stuck for more than 5 seconds, allow new attempt
          console.warn(`⚠️ [WORK_SLOTS] Previous generation stuck for ${elapsed}ms, allowing retry`);
          this.ongoingGenerations.delete(driverId);
        }
      }
      
      // Mark generation as in progress
      this.ongoingGenerations.set(driverId, Date.now());
      
      // CRITICAL FIX: Delete existing slots for this driver and date first to prevent duplicates
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const existingQuery = this.db.collection('workSlots')
        .where('driverId', '==', driverId)
        .where('startTime', '>=', Timestamp.fromDate(startOfDay))
        .where('startTime', '<=', Timestamp.fromDate(endOfDay));

      const existingSnapshot = await existingQuery.get();
      
      if (!existingSnapshot.empty) {
        console.log(`🗑️ [WORK_SLOTS] Deleting ${existingSnapshot.size} existing slots to prevent duplicates`);
        const deleteBatch = this.db.batch();
        existingSnapshot.forEach(doc => {
          deleteBatch.delete(doc.ref);
        });
        await deleteBatch.commit();
      }

      const slots = [];
      const slotConfigs = [
        { start: 7, end: 9, label: '7–9 AM' },
        { start: 9, end: 11, label: '9–11 AM' },
        { start: 11, end: 13, label: '11 AM–1 PM' },
        { start: 13, end: 15, label: '1–3 PM' },
        { start: 15, end: 17, label: '3–5 PM' },
        { start: 17, end: 19, label: '5–7 PM' },
        { start: 19, end: 21, label: '7–9 PM' },
        { start: 21, end: 23, label: '9–11 PM' }
      ];

      for (const config of slotConfigs) {
        const startTime = new Date(date);
        startTime.setHours(config.start, 0, 0, 0);
        
        const endTime = new Date(date);
        endTime.setHours(config.end, 0, 0, 0);

        const slotId = `${driverId}_${date.toISOString().split('T')[0]}_${config.start}-${config.end}`;
        
        console.log(`🔍 [WORK_SLOTS] Creating slot: ${config.label} (${config.start}-${config.end})`);
        
        const slot = {
          slotId,
          startTime: Timestamp.fromDate(startTime),
          endTime: Timestamp.fromDate(endTime),
          label: config.label,
          status: 'available',
          isSelected: false, // 🔥 NEW: Track driver's selection
          driverId,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        slots.push(slot);
        console.log(`✅ [WORK_SLOTS] Slot added to batch: ${config.label}`);
      }
      
      console.log(`📊 [WORK_SLOTS] Total slots prepared for batch write: ${slots.length}`);

      // Batch write all slots
      const batch = this.db.batch();
      slots.forEach((slot, index) => {
        const slotRef = this.db.collection('workSlots').doc(slot.slotId);
        batch.set(slotRef, slot);
        console.log(`📝 [WORK_SLOTS] Batch item ${index + 1}/${slots.length}: ${slot.label}`);
      });

      await batch.commit();
      
      console.log(`✅ [WORK_SLOTS] Generated ${slots.length} slots successfully`);
      console.log(`📋 [WORK_SLOTS] Slot labels: ${slots.map(s => s.label).join(', ')}`);
      
      // CRITICAL: Clear the generation lock
      this.ongoingGenerations.delete(driverId);
      
      return {
        success: true,
        message: 'Daily slots generated successfully',
        slots: slots.length,
        data: slots
      };

    } catch (error) {
      console.error('Error generating daily slots:', error);
      
      // CRITICAL: Clear the generation lock on error
      this.ongoingGenerations.delete(driverId);
      
      return {
        success: false,
        error: {
          code: 'SLOT_GENERATION_ERROR',
          message: 'Failed to generate daily slots',
          details: error.message
        }
      };
    }
  }

  /**
   * Get slots for a specific driver and date
   */
  async getDriverSlots(driverId, date = new Date()) {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      console.log(`🔍 [GET_DRIVER_SLOTS] Fetching slots for driver: ${driverId}, date: ${date.toISOString().split('T')[0]}`);

      const query = this.db.collection('workSlots')
        .where('driverId', '==', driverId)
        .where('startTime', '>=', Timestamp.fromDate(startOfDay))
        .where('startTime', '<=', Timestamp.fromDate(endOfDay))
        .orderBy('startTime', 'asc');

      const snapshot = await query.get();
      const slots = [];

      snapshot.forEach(doc => {
        const slotData = doc.data();
        slots.push({
          id: doc.id,
          ...slotData
        });
        console.log(`📥 [GET_DRIVER_SLOTS] Retrieved slot: ${slotData.label}`);
      });

      console.log(`✅ [GET_DRIVER_SLOTS] Total slots retrieved: ${slots.length}`);
      console.log(`📋 [GET_DRIVER_SLOTS] Slot labels: ${slots.map(s => s.label).join(', ')}`);

      return {
        success: true,
        message: 'Driver slots retrieved successfully',
        data: slots
      };

    } catch (error) {
      console.error('Error getting driver slots:', error);
      return {
        success: false,
        error: {
          code: 'SLOT_RETRIEVAL_ERROR',
          message: 'Failed to retrieve driver slots',
          details: error.message
        }
      };
    }
  }

  /**
   * Update slot status
   */
  async updateSlotStatus(slotId, status, driverId) {
    try {
      const validStatuses = ['available', 'booked', 'completed'];
      if (!validStatuses.includes(status)) {
        return {
          success: false,
          error: {
            code: 'INVALID_STATUS',
            message: 'Invalid slot status',
            details: `Status must be one of: ${validStatuses.join(', ')}`
          }
        };
      }

      const slotRef = this.db.collection('workSlots').doc(slotId);
      const slotDoc = await slotRef.get();

      if (!slotDoc.exists) {
        return {
          success: false,
          error: {
            code: 'SLOT_NOT_FOUND',
            message: 'Slot not found',
            details: 'The specified slot does not exist'
          }
        };
      }

      const slotData = slotDoc.data();
      if (slotData.driverId !== driverId) {
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Unauthorized access',
            details: 'You can only update your own slots'
          }
        };
      }

      await slotRef.update({
        status,
        updatedAt: Timestamp.now()
      });

      return {
        success: true,
        message: 'Slot status updated successfully',
        data: {
          slotId,
          status,
          updatedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Error updating slot status:', error);
      return {
        success: false,
        error: {
          code: 'SLOT_UPDATE_ERROR',
          message: 'Failed to update slot status',
          details: error.message
        }
      };
    }
  }

  /**
   * 🔥 NEW: Update slot selection (driver selects/deselects slots)
   */
  async updateSlotSelection(slotId, isSelected, driverId) {
    try {
      const slotRef = this.db.collection('workSlots').doc(slotId);
      const slotDoc = await slotRef.get();

      if (!slotDoc.exists) {
        return {
          success: false,
          error: {
            code: 'SLOT_NOT_FOUND',
            message: 'Slot not found',
            details: 'The specified slot does not exist'
          }
        };
      }

      const slotData = slotDoc.data();
      if (slotData.driverId !== driverId) {
        return {
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Unauthorized access',
            details: 'You can only update your own slots'
          }
        };
      }

      // 🔥 CRITICAL: Check if slot time has already started
      const now = new Date();
      const slotStartTime = slotData.startTime.toDate();
      
      if (now >= slotStartTime && !isSelected) {
        // Trying to deselect a slot that has already started
        return {
          success: false,
          error: {
            code: 'SLOT_ALREADY_STARTED',
            message: 'Cannot deselect slot',
            details: 'This slot has already started and cannot be cancelled'
          }
        };
      }

      await slotRef.update({
        isSelected: isSelected,
        updatedAt: Timestamp.now()
      });

      return {
        success: true,
        message: `Slot ${isSelected ? 'selected' : 'deselected'} successfully`,
        data: {
          slotId,
          isSelected,
          updatedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Error updating slot selection:', error);
      return {
        success: false,
        error: {
          code: 'SLOT_SELECTION_ERROR',
          message: 'Failed to update slot selection',
          details: error.message
        }
      };
    }
  }

  /**
   * 🔥 NEW: Batch update slot selections
   */
  async batchUpdateSlotSelections(slotIds, isSelected, driverId) {
    try {
      const batch = this.db.batch();
      const results = [];

      for (const slotId of slotIds) {
        const slotRef = this.db.collection('workSlots').doc(slotId);
        const slotDoc = await slotRef.get();

        if (!slotDoc.exists || slotDoc.data().driverId !== driverId) {
          continue; // Skip invalid slots
        }

        const slotData = slotDoc.data();
        const now = new Date();
        const slotStartTime = slotData.startTime.toDate();
        
        // Skip if trying to deselect a started slot
        if (now >= slotStartTime && !isSelected) {
          continue;
        }

        batch.update(slotRef, {
          isSelected: isSelected,
          updatedAt: Timestamp.now()
        });

        results.push(slotId);
      }

      await batch.commit();

      return {
        success: true,
        message: `${results.length} slots updated successfully`,
        data: {
          updatedSlots: results,
          count: results.length
        }
      };

    } catch (error) {
      console.error('Error batch updating slot selections:', error);
      return {
        success: false,
        error: {
          code: 'BATCH_SELECTION_ERROR',
          message: 'Failed to batch update slot selections',
          details: error.message
        }
      };
    }
  }

  /**
   * Get available slots for booking (for customers)
   */
  async getAvailableSlots(date = new Date(), limit = 50) {
    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      const query = this.db.collection('workSlots')
        .where('status', '==', 'available')
        .where('startTime', '>=', Timestamp.fromDate(startOfDay))
        .where('startTime', '<=', Timestamp.fromDate(endOfDay))
        .orderBy('startTime', 'asc')
        .limit(limit);

      const snapshot = await query.get();
      const slots = [];

      snapshot.forEach(doc => {
        slots.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return {
        success: true,
        message: 'Available slots retrieved successfully',
        data: slots
      };

    } catch (error) {
      console.error('Error getting available slots:', error);
      return {
        success: false,
        error: {
          code: 'AVAILABLE_SLOTS_ERROR',
          message: 'Failed to retrieve available slots',
          details: error.message
        }
      };
    }
  }

  /**
   * Book a slot (change status to 'booked')
   */
  async bookSlot(slotId, customerId) {
    try {
      const slotRef = this.db.collection('workSlots').doc(slotId);
      const slotDoc = await slotRef.get();

      if (!slotDoc.exists) {
        return {
          success: false,
          error: {
            code: 'SLOT_NOT_FOUND',
            message: 'Slot not found',
            details: 'The specified slot does not exist'
          }
        };
      }

      const slotData = slotDoc.data();
      if (slotData.status !== 'available') {
        return {
          success: false,
          error: {
            code: 'SLOT_NOT_AVAILABLE',
            message: 'Slot not available',
            details: `Slot is currently ${slotData.status}`
          }
        };
      }

      await slotRef.update({
        status: 'booked',
        customerId,
        bookedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      });

      return {
        success: true,
        message: 'Slot booked successfully',
        data: {
          slotId,
          driverId: slotData.driverId,
          customerId,
          bookedAt: new Date().toISOString()
        }
      };

    } catch (error) {
      console.error('Error booking slot:', error);
      return {
        success: false,
        error: {
          code: 'SLOT_BOOKING_ERROR',
          message: 'Failed to book slot',
          details: error.message
        }
      };
    }
  }

  /**
   * Generate slots for all active drivers (admin function)
   */
  async generateSlotsForAllDrivers(date = new Date()) {
    try {
      const driversQuery = this.db.collection('users')
        .where('userType', '==', 'driver')
        .where('isActive', '==', true);

      const driversSnapshot = await driversQuery.get();
      const results = [];

      for (const driverDoc of driversSnapshot.docs) {
        const driverId = driverDoc.id;
        const result = await this.generateDailySlots(driverId, date);
        results.push({
          driverId,
          ...result
        });
      }

      return {
        success: true,
        message: 'Slots generated for all active drivers',
        data: results
      };

    } catch (error) {
      console.error('Error generating slots for all drivers:', error);
      return {
        success: false,
        error: {
          code: 'BULK_SLOT_GENERATION_ERROR',
          message: 'Failed to generate slots for all drivers',
          details: error.message
        }
      };
    }
  }

  /**
   * Delete old slots (cleanup function)
   */
  async deleteOldSlots(daysOld = 7) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);

      const query = this.db.collection('workSlots')
        .where('startTime', '<', Timestamp.fromDate(cutoffDate));

      const snapshot = await query.get();
      const batch = this.db.batch();

      snapshot.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();

      return {
        success: true,
        message: 'Old slots deleted successfully',
        deletedCount: snapshot.size
      };

    } catch (error) {
      console.error('Error deleting old slots:', error);
      return {
        success: false,
        error: {
          code: 'SLOT_DELETION_ERROR',
          message: 'Failed to delete old slots',
          details: error.message
        }
      };
    }
  }
}

module.exports = new WorkSlotsService();
