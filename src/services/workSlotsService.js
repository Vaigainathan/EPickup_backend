const { getFirestore, Timestamp } = require('../services/firebase');

/**
 * Work Slots Service
 * Manages the new gig slot system with 2-hour blocks
 */

class WorkSlotsService {
  constructor() {
    this.db = getFirestore();
  }

  /**
   * Generate daily work slots for a driver
   * Creates 6 slots: 7-9 AM, 9-11 AM, 11-1 PM, 1-3 PM, 3-5 PM, 5-7 PM
   */
  async generateDailySlots(driverId, date = new Date()) {
    try {
      console.log(`🔄 [WORK_SLOTS] Generating daily slots for driver: ${driverId}, date: ${date.toISOString().split('T')[0]}`);
      
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
        { start: 11, end: 13, label: '11–1 PM' },
        { start: 13, end: 15, label: '1–3 PM' },
        { start: 15, end: 17, label: '3–5 PM' },
        { start: 17, end: 19, label: '5–7 PM' }
      ];

      for (const config of slotConfigs) {
        const startTime = new Date(date);
        startTime.setHours(config.start, 0, 0, 0);
        
        const endTime = new Date(date);
        endTime.setHours(config.end, 0, 0, 0);

        const slotId = `${driverId}_${date.toISOString().split('T')[0]}_${config.start}-${config.end}`;
        
        const slot = {
          slotId,
          startTime: Timestamp.fromDate(startTime),
          endTime: Timestamp.fromDate(endTime),
          label: config.label,
          status: 'available',
          driverId,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now()
        };

        slots.push(slot);
      }

      // Batch write all slots
      const batch = this.db.batch();
      slots.forEach(slot => {
        const slotRef = this.db.collection('workSlots').doc(slot.slotId);
        batch.set(slotRef, slot);
      });

      await batch.commit();
      
      console.log(`✅ [WORK_SLOTS] Generated ${slots.length} slots successfully`);
      
      return {
        success: true,
        message: 'Daily slots generated successfully',
        slots: slots.length,
        data: slots
      };

    } catch (error) {
      console.error('Error generating daily slots:', error);
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

      const query = this.db.collection('workSlots')
        .where('driverId', '==', driverId)
        .where('startTime', '>=', Timestamp.fromDate(startOfDay))
        .where('startTime', '<=', Timestamp.fromDate(endOfDay))
        .orderBy('startTime', 'asc');

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
