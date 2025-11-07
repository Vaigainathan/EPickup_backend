const { getFirestore } = require('./firebase');
const errorHandlingService = require('./errorHandlingService');
const monitoringService = require('./monitoringService');
const bookingStateMachine = require('./bookingStateMachine');

/**
 * Assignment Edge Case Handler
 * Handles complex scenarios in driver assignment like no drivers, rejections, timeouts
 */
class AssignmentEdgeCaseHandler {
  constructor() {
    this.db = getFirestore();
    this.maxReassignmentAttempts = 3;
    this.reassignmentDelay = 30000; // 30 seconds
    this.assignmentTimeout = 300000; // 5 minutes
    this.gracePeriod = 60000; // 1 minute for driver to accept
  }

  /**
   * Handle no drivers available scenario
   * @param {string} bookingId - Booking ID
   * @param {Object} pickupLocation - Pickup location
   * @returns {Promise<Object>} Handling result
   */
  async handleNoDriversAvailable(bookingId, pickupLocation) {
    try {
      console.log(`🚫 No drivers available for booking ${bookingId}`);

      // Log the event
      await monitoringService.logDriverAssignment('no_drivers_available', {
        bookingId,
        pickupLocation,
        timestamp: new Date()
      });

      // Check if this is a retry attempt
      const retryCount = await this.getRetryCount(bookingId);
      
      if (retryCount < this.maxReassignmentAttempts) {
        // Schedule retry
        await this.scheduleReassignment(bookingId, pickupLocation, retryCount + 1);
        
        return {
          success: true,
          action: 'scheduled_retry',
          retryCount: retryCount + 1,
          nextAttempt: new Date(Date.now() + this.reassignmentDelay)
        };
      } else {
        // Max retries reached, cancel booking
        await this.cancelBookingDueToNoDrivers(bookingId);
        
        return {
          success: true,
          action: 'cancelled',
          reason: 'No drivers available after maximum retry attempts'
        };
      }
    } catch (error) {
      console.error('❌ Error in AssignmentEdgeCaseHandler.handleNoDriversAvailable:', error);
      throw error;
    }
  }

  /**
   * Handle driver rejection scenario
   * @param {string} bookingId - Booking ID
   * @param {string} driverId - Driver ID who rejected
   * @param {string} reason - Rejection reason
   * @returns {Promise<Object>} Handling result
   */
  async handleDriverRejection(bookingId, driverId, reason = 'No reason provided') {
    try {
      console.log(`❌ Driver ${driverId} rejected booking ${bookingId}: ${reason}`);

      // Log the rejection
      await monitoringService.logDriverAssignment('driver_rejected', {
        bookingId,
        driverId,
        reason,
        timestamp: new Date()
      });

      // Update booking status to rejected
      await bookingStateMachine.transitionBooking(
        bookingId,
        'rejected',
        {
          rejectedBy: driverId,
          rejectionReason: reason,
          rejectedAt: new Date()
        },
        {
          userId: driverId,
          userType: 'driver'
        }
      );

      // Check if we should try reassignment
      const retryCount = await this.getRetryCount(bookingId);
      
      if (retryCount < this.maxReassignmentAttempts) {
        // Get booking details for reassignment
        const booking = await this.getBooking(bookingId);
        if (booking) {
          // Schedule reassignment
          await this.scheduleReassignment(bookingId, booking.pickup.coordinates, retryCount + 1);
          
          return {
            success: true,
            action: 'scheduled_reassignment',
            retryCount: retryCount + 1,
            nextAttempt: new Date(Date.now() + this.reassignmentDelay)
          };
        }
      } else {
        // Max retries reached, cancel booking
        await this.cancelBookingDueToRejections(bookingId);
        
        return {
          success: true,
          action: 'cancelled',
          reason: 'Maximum reassignment attempts reached'
        };
      }
    } catch (error) {
      console.error('❌ Error in AssignmentEdgeCaseHandler.handleDriverRejection:', error);
      throw error;
    }
  }

  /**
   * Handle driver timeout scenario
   * @param {string} bookingId - Booking ID
   * @param {string} driverId - Driver ID who timed out
   * @returns {Promise<Object>} Handling result
   */
  async handleDriverTimeout(bookingId, driverId) {
    try {
      console.log(`⏰ Driver ${driverId} timed out for booking ${bookingId}`);

      // Log the timeout
      await monitoringService.logDriverAssignment('driver_timeout', {
        bookingId,
        driverId,
        timestamp: new Date()
      });

      // Update booking status to rejected due to timeout
      await bookingStateMachine.transitionBooking(
        bookingId,
        'rejected',
        {
          rejectedBy: driverId,
          rejectionReason: 'Driver timeout - no response',
          rejectedAt: new Date()
        },
        {
          userId: 'system',
          userType: 'system'
        }
      );

      // Try reassignment
      const booking = await this.getBooking(bookingId);
      if (booking) {
        return await this.handleNoDriversAvailable(bookingId, booking.pickup.coordinates);
      }
    } catch (error) {
      console.error('❌ Error in AssignmentEdgeCaseHandler.handleDriverTimeout:', error);
      throw error;
    }
  }

  /**
   * Handle driver disconnection scenario
   * @param {string} driverId - Driver ID who disconnected
   * @returns {Promise<Object>} Handling result
   */
  async handleDriverDisconnection(driverId) {
    try {
      console.log(`🔌 Driver ${driverId} disconnected`);

      // Find active bookings for this driver
      const activeBookings = await this.getActiveBookingsForDriver(driverId);
      
      if (activeBookings.length > 0) {
        console.log(`🔄 Reassigning ${activeBookings.length} active bookings for disconnected driver ${driverId}`);
        
        // Reassign each booking
        for (const booking of activeBookings) {
          await this.handleDriverRejection(booking.id, driverId, 'Driver disconnected');
        }
      }

      // ✅ CRITICAL FIX: Don't auto-offline driver on disconnection
      // This function is for handling booking reassignment, not status management
      // Driver status should only be changed via explicit API call (PUT /api/driver/status)
      // WebSocket disconnect handler already handles lastSeen update
      // Only update lastSeen here, preserve driver.isOnline status
      await this.db.collection('users').doc(driverId).update({
        'driver.lastSeen': new Date(),
        updatedAt: new Date()
      });

      console.log(`✅ [ASSIGNMENT_HANDLER] Driver ${driverId} disconnection handled - bookings reassigned, status preserved`);

      return {
        success: true,
        action: 'bookings_reassigned',
        reassignedBookings: activeBookings.length
      };
    } catch (error) {
      console.error('❌ Error in AssignmentEdgeCaseHandler.handleDriverDisconnection:', error);
      throw error;
    }
  }

  /**
   * Handle concurrent driver acceptance
   * @param {string} bookingId - Booking ID
   * @param {Array} driverIds - Array of driver IDs who accepted
   * @returns {Promise<Object>} Handling result
   */
  async handleConcurrentAcceptance(bookingId, driverIds) {
    try {
      console.log(`⚡ Concurrent acceptance for booking ${bookingId} by drivers: ${driverIds.join(', ')}`);

      // Use Firestore transaction to ensure only one driver gets assigned
      const result = await errorHandlingService.executeTransactionWithRetry(async (transaction) => {
        const bookingRef = this.db.collection('bookings').doc(bookingId);
        const bookingDoc = await transaction.get(bookingRef);
        
        if (!bookingDoc.exists) {
          throw new Error('BOOKING_NOT_FOUND');
        }

        const booking = bookingDoc.data();
        
        if (booking.status !== 'driver_assigned') {
          throw new Error('BOOKING_ALREADY_ASSIGNED');
        }

        // Select the first driver (could implement more sophisticated selection)
        const selectedDriverId = driverIds[0];
        const otherDrivers = driverIds.slice(1);

        // Update booking with selected driver
        transaction.update(bookingRef, {
          driverId: selectedDriverId,
          status: 'accepted',
          acceptedAt: new Date(),
          updatedAt: new Date()
        });

        // Notify other drivers of rejection
        for (const driverId of otherDrivers) {
          await this.notifyDriverRejection(driverId, bookingId, 'Another driver was selected');
        }

        return { selectedDriverId, otherDrivers };
      }, {
        context: `Concurrent acceptance for booking ${bookingId}`
      });

      await monitoringService.logDriverAssignment('concurrent_acceptance_resolved', {
        bookingId,
        selectedDriver: result.selectedDriverId,
        rejectedDrivers: result.otherDrivers
      });

      return {
        success: true,
        action: 'concurrent_resolved',
        selectedDriver: result.selectedDriverId,
        rejectedDrivers: result.otherDrivers
      };
    } catch (error) {
      console.error('❌ Error in AssignmentEdgeCaseHandler.handleConcurrentAcceptance:', error);
      throw error;
    }
  }

  /**
   * Schedule reassignment for a booking
   * @param {string} bookingId - Booking ID
   * @param {Object} pickupLocation - Pickup location
   * @param {number} retryCount - Current retry count
   */
  async scheduleReassignment(bookingId, pickupLocation, retryCount) {
    try {
      // Store reassignment task
      await this.db.collection('reassignmentTasks').add({
        bookingId,
        pickupLocation,
        retryCount,
        scheduledFor: new Date(Date.now() + this.reassignmentDelay),
        status: 'pending',
        createdAt: new Date()
      });

      // Schedule the actual reassignment
      setTimeout(async () => {
        await this.processReassignment(bookingId);
      }, this.reassignmentDelay);

      console.log(`📅 Scheduled reassignment for booking ${bookingId} (attempt ${retryCount})`);
    } catch (error) {
      console.error('❌ Failed to schedule reassignment:', error);
    }
  }

  /**
   * Process scheduled reassignment
   * @param {string} bookingId - Booking ID
   */
  async processReassignment(bookingId) {
    try {
      // Get the reassignment task
      const taskQuery = await this.db.collection('reassignmentTasks')
        .where('bookingId', '==', bookingId)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (taskQuery.empty) {
        console.log(`⚠️ No pending reassignment task found for booking ${bookingId}`);
        return;
      }

      const task = taskQuery.docs[0];
      const taskData = task.data();

      // Mark task as processing
      await task.ref.update({
        status: 'processing',
        processedAt: new Date()
      });

      // Try reassignment
      const driverAssignmentService = require('./driverAssignmentService');
      const result = await driverAssignmentService.autoAssignDriver(
        bookingId, 
        taskData.pickupLocation
      );

      if (result.success) {
        // Mark task as completed
        await task.ref.update({
          status: 'completed',
          completedAt: new Date(),
          assignedDriver: result.data.driverId
        });
      } else {
        // Mark task as failed
        await task.ref.update({
          status: 'failed',
          failedAt: new Date(),
          error: result.error
        });
      }
    } catch (error) {
      console.error('❌ Failed to process reassignment:', error);
    }
  }

  /**
   * Get retry count for a booking
   * @param {string} bookingId - Booking ID
   * @returns {Promise<number>} Retry count
   */
  async getRetryCount(bookingId) {
    try {
      const retryQuery = await this.db.collection('reassignmentTasks')
        .where('bookingId', '==', bookingId)
        .get();

      return retryQuery.size;
    } catch (error) {
      console.error('❌ Failed to get retry count:', error);
      return 0;
    }
  }

  /**
   * Cancel booking due to no drivers
   * @param {string} bookingId - Booking ID
   */
  async cancelBookingDueToNoDrivers(bookingId) {
    await bookingStateMachine.transitionBooking(
      bookingId,
      'cancelled',
      {
        cancellationReason: 'No drivers available in your area',
        cancelledAt: new Date()
      },
      {
        userId: 'system',
        userType: 'system'
      }
    );
  }

  /**
   * Cancel booking due to rejections
   * @param {string} bookingId - Booking ID
   */
  async cancelBookingDueToRejections(bookingId) {
    await bookingStateMachine.transitionBooking(
      bookingId,
      'cancelled',
      {
        cancellationReason: 'No drivers available to accept your booking',
        cancelledAt: new Date()
      },
      {
        userId: 'system',
        userType: 'system'
      }
    );
  }

  /**
   * Get active bookings for a driver
   * @param {string} driverId - Driver ID
   * @returns {Promise<Array>} Active bookings
   */
  async getActiveBookingsForDriver(driverId) {
    try {
      const bookingsQuery = await this.db.collection('bookings')
        .where('driverId', '==', driverId)
        .where('status', 'in', ['driver_assigned', 'accepted', 'driver_enroute', 'picked_up', 'in_transit'])
        .get();

      return bookingsQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('❌ Failed to get active bookings for driver:', error);
      return [];
    }
  }

  /**
   * Get booking details
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Object|null>} Booking data
   */
  async getBooking(bookingId) {
    try {
      const bookingDoc = await this.db.collection('bookings').doc(bookingId).get();
      return bookingDoc.exists ? { id: bookingDoc.id, ...bookingDoc.data() } : null;
    } catch (error) {
      console.error('❌ Failed to get booking:', error);
      return null;
    }
  }

  /**
   * Notify driver of rejection
   * @param {string} driverId - Driver ID
   * @param {string} bookingId - Booking ID
   * @param {string} reason - Rejection reason
   */
  async notifyDriverRejection(driverId, bookingId, reason) {
    try {
      const socketService = require('./socket');
      socketService.sendToUser(driverId, 'booking_rejected', {
        bookingId,
        reason,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Failed to notify driver rejection:', error);
    }
  }

  /**
   * Clean up expired reassignment tasks
   */
  async cleanupExpiredTasks() {
    try {
      const expiredTasks = await this.db.collection('reassignmentTasks')
        .where('status', '==', 'pending')
        .where('scheduledFor', '<', new Date())
        .get();

      const batch = this.db.batch();
      expiredTasks.docs.forEach(doc => {
        batch.update(doc.ref, {
          status: 'expired',
          expiredAt: new Date()
        });
      });

      await batch.commit();
      console.log(`🧹 Cleaned up ${expiredTasks.size} expired reassignment tasks`);
    } catch (error) {
      console.error('❌ Failed to cleanup expired tasks:', error);
    }
  }
}

module.exports = new AssignmentEdgeCaseHandler();
