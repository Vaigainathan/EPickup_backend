const { getFirestore } = require('./firebase');
const errorHandlingService = require('./errorHandlingService');

/**
 * Booking State Machine Service
 * Manages booking lifecycle with strict state transitions and rollback logic
 */
class BookingStateMachine {
  constructor() {
    this.db = getFirestore();
    
    // Define valid state transitions
    this.stateTransitions = {
      'pending': ['driver_assigned', 'cancelled', 'rejected'],
      'driver_assigned': ['driver_enroute', 'rejected', 'cancelled'], // ✅ FIX: Remove 'accepted' intermediate state, allow direct transition to driver_enroute
      'accepted': ['driver_enroute', 'cancelled'], // ✅ KEEP: For backward compatibility with existing bookings
      'driver_enroute': ['driver_arrived', 'cancelled'],
      'driver_arrived': ['picked_up', 'cancelled'],
      'picked_up': ['in_transit', 'cancelled'],
      'in_transit': ['delivered', 'cancelled'],
      'delivered': ['money_collection', 'completed'], // ✅ FIX: Allow direct transition to completed for payment confirmation
      'money_collection': ['completed'], // ✅ FIX: Money collection state
      'completed': [], // Terminal state
      'cancelled': [], // Terminal state
      'rejected': ['pending', 'cancelled'] // Can be reassigned or cancelled
    };

    // Define required fields for each state
    this.stateRequirements = {
      'driver_assigned': ['driverId', 'assignedAt'],
      'accepted': ['acceptedAt', 'driverId'],
      'driver_enroute': ['enrouteAt', 'driverId'],
      'driver_arrived': ['arrivedAt', 'driverId'],
      'picked_up': ['pickedUpAt', 'driverId'],
      'in_transit': ['inTransitAt', 'driverId'],
      'delivered': ['deliveredAt', 'driverId'],
      'money_collection': ['moneyCollectionAt', 'driverId'], // ✅ FIX: Add money collection requirements
      'completed': ['completedAt', 'driverId'],
      'cancelled': ['cancelledAt', 'cancellationReason'],
      'rejected': ['rejectedAt', 'rejectionReason']
    };
  }

  /**
   * Validate state transition
   * @param {string} currentState - Current booking state
   * @param {string} newState - Desired new state
   * @returns {Object} Validation result
   */
  validateTransition(currentState, newState) {
    const validTransitions = this.stateTransitions[currentState] || [];
    
    if (!validTransitions.includes(newState)) {
      return {
        isValid: false,
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: `Cannot transition from ${currentState} to ${newState}`,
          validTransitions
        }
      };
    }

    return { isValid: true };
  }

  /**
   * Validate state requirements
   * @param {string} state - Target state
   * @param {Object} data - Booking data
   * @returns {Object} Validation result
   */
  validateStateRequirements(state, data) {
    const requiredFields = this.stateRequirements[state] || [];
    const missingFields = requiredFields.filter(field => !data[field]);

    if (missingFields.length > 0) {
      return {
        isValid: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: `Missing required fields for state ${state}: ${missingFields.join(', ')}`,
          missingFields
        }
      };
    }

    return { isValid: true };
  }

  /**
   * Transition booking to new state with validation and rollback
   * @param {string} bookingId - Booking ID
   * @param {string} newState - New state
   * @param {Object} updateData - Additional update data
   * @param {Object} context - Update context (userId, userType, etc.)
   * @returns {Promise<Object>} Transition result
   */
  async transitionBooking(bookingId, newState, updateData = {}, context = {}) {
    return errorHandlingService.executeTransactionWithRetry(async (transaction) => {
      // Get current booking state
      const bookingRef = this.db.collection('bookings').doc(bookingId);
      const bookingDoc = await transaction.get(bookingRef);
      
      if (!bookingDoc.exists) {
        throw new Error('BOOKING_NOT_FOUND');
      }

      const currentBooking = bookingDoc.data();
      const currentState = currentBooking.status;

      // Validate transition
      const transitionValidation = this.validateTransition(currentState, newState);
      if (!transitionValidation.isValid) {
        throw new Error(transitionValidation.error.message);
      }

      // Prepare update data with state-specific requirements
      const stateUpdateData = this.prepareStateUpdateData(newState, updateData, context);
      
      // Validate state requirements
      const requirementsValidation = this.validateStateRequirements(newState, stateUpdateData);
      if (!requirementsValidation.isValid) {
        throw new Error(requirementsValidation.error.message);
      }

      // Create state transition record
      const stateTransition = {
        bookingId,
        fromState: currentState,
        toState: newState,
        updatedBy: context.userId || 'system',
        userType: context.userType || 'system',
        timestamp: new Date(),
        updateData: stateUpdateData,
        context
      };

      // Update booking
      transaction.update(bookingRef, {
        status: newState,
        ...stateUpdateData,
        updatedAt: new Date(),
        lastUpdatedBy: context.userId || 'system'
      });

      // Record state transition
      transaction.set(
        this.db.collection('bookingStateTransitions').doc(),
        stateTransition
      );

      // Handle state-specific side effects
      await this.handleStateSideEffects(bookingId, newState, currentState, context, transaction);

      return {
        success: true,
        data: {
          bookingId,
          fromState: currentState,
          toState: newState,
          transitionId: stateTransition.timestamp.getTime().toString()
        }
      };
    }, {
      context: `Booking state transition: ${bookingId} -> ${newState}`
    });
  }

  /**
   * Prepare state-specific update data
   * @param {string} state - Target state
   * @param {Object} updateData - Provided update data
   * @param {Object} context - Update context
   * @returns {Object} Prepared update data
   */
  prepareStateUpdateData(state, updateData, context) {
    const now = new Date();
    const stateData = { ...updateData };

    // Add timestamp fields based on state
    switch (state) {
      case 'driver_assigned':
        stateData.assignedAt = now;
        stateData.driverId = context.driverId;
        break;
      case 'accepted':
        stateData.acceptedAt = now;
        break;
      case 'driver_enroute':
        stateData.enrouteAt = now;
        break;
      case 'driver_arrived':
        stateData.arrivedAt = now;
        break;
      case 'picked_up':
        stateData.pickedUpAt = now;
        break;
      case 'in_transit':
        stateData.inTransitAt = now;
        break;
      case 'delivered':
        stateData.deliveredAt = now;
        break;
      case 'money_collection':
        stateData.moneyCollectionAt = now;
        break;
      case 'completed':
        stateData.completedAt = now;
        break;
      case 'cancelled':
        stateData.cancelledAt = now;
        stateData.cancellationReason = updateData.cancellationReason || 'No reason provided';
        break;
    }

    return stateData;
  }

  /**
   * Handle state-specific side effects
   * @param {string} bookingId - Booking ID
   * @param {string} newState - New state
   * @param {string} oldState - Previous state
   * @param {Object} context - Update context
   * @param {Object} transaction - Firestore transaction
   */
  async handleStateSideEffects(bookingId, newState, oldState, context, transaction) {
    switch (newState) {
      case 'driver_assigned':
        // Update driver availability
        if (context.driverId) {
          const driverRef = this.db.collection('users').doc(context.driverId);
          transaction.update(driverRef, {
            'driver.isAvailable': false,
            'driver.currentBookingId': bookingId,
            updatedAt: new Date()
          });
        }
        break;

      case 'accepted':
        // Send notifications
        console.log(`📱 Booking ${bookingId} accepted by driver`);
        break;

      case 'driver_enroute':
        // Update driver status
        if (context.driverId) {
          const driverRef = this.db.collection('users').doc(context.driverId);
          transaction.update(driverRef, {
            'driver.status': 'enroute',
            updatedAt: new Date()
          });
        }
        break;

      case 'picked_up':
        // Update package status
        console.log(`📦 Package picked up for booking ${bookingId}`);
        break;

      case 'delivered':
        // ✅ NOTE: Driver remains unavailable during money_collection phase
        // Driver will be released when status transitions to 'completed'
        break;

      case 'completed':
        // ✅ FIX: Release driver availability when booking is completed
        if (context.driverId) {
          const driverRef = this.db.collection('users').doc(context.driverId);
          transaction.update(driverRef, {
            'driver.isAvailable': true,
            'driver.currentBookingId': null,
            'driver.status': 'available',
            updatedAt: new Date()
          });
          
          // Also update driverLocations collection
          const driverLocationRef = this.db.collection('driverLocations').doc(context.driverId);
          transaction.update(driverLocationRef, {
            isAvailable: true,
            currentTripId: null,
            lastUpdated: new Date()
          });
        }
        break;

      case 'cancelled':
        // Release driver if assigned
        if (context.driverId) {
          const driverRef = this.db.collection('users').doc(context.driverId);
          transaction.update(driverRef, {
            'driver.isAvailable': true,
            'driver.currentBookingId': null,
            updatedAt: new Date()
          });
        }
        break;
    }
  }

  /**
   * Rollback booking state (for error recovery)
   * @param {string} bookingId - Booking ID
   * @param {string} targetState - State to rollback to
   * @param {Object} context - Rollback context
   * @returns {Promise<Object>} Rollback result
   */
  async rollbackBooking(bookingId, targetState, context = {}) {
    return errorHandlingService.executeTransactionWithRetry(async (transaction) => {
      const bookingRef = this.db.collection('bookings').doc(bookingId);
      const bookingDoc = await transaction.get(bookingRef);
      
      if (!bookingDoc.exists) {
        throw new Error('BOOKING_NOT_FOUND');
      }

      const currentBooking = bookingDoc.data();
      const currentState = currentBooking.status;

      // Validate rollback is possible
      const rollbackValidation = this.validateTransition(targetState, currentState);
      if (!rollbackValidation.isValid) {
        throw new Error(`Cannot rollback from ${currentState} to ${targetState}`);
      }

      // Create rollback record
      const rollbackRecord = {
        bookingId,
        fromState: currentState,
        toState: targetState,
        type: 'rollback',
        reason: context.reason || 'Error recovery',
        rolledBackBy: context.userId || 'system',
        timestamp: new Date()
      };

      // Update booking state
      transaction.update(bookingRef, {
        status: targetState,
        updatedAt: new Date(),
        lastUpdatedBy: context.userId || 'system'
      });

      // Record rollback
      transaction.set(
        this.db.collection('bookingRollbacks').doc(),
        rollbackRecord
      );

      return {
        success: true,
        data: {
          bookingId,
          fromState: currentState,
          toState: targetState,
          rollbackId: rollbackRecord.timestamp.getTime().toString()
        }
      };
    }, {
      context: `Booking rollback: ${bookingId} -> ${targetState}`
    });
  }

  /**
   * Get booking state history
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Array>} State transition history
   */
  async getBookingStateHistory(bookingId) {
    try {
      const transitionsSnapshot = await this.db.collection('bookingStateTransitions')
        .where('bookingId', '==', bookingId)
        .orderBy('timestamp', 'asc')
        .get();

      return transitionsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (error) {
      console.error('❌ Failed to get booking state history:', error.message);
      return [];
    }
  }

  /**
   * Validate booking data integrity
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Object>} Validation result
   */
  async validateBookingIntegrity(bookingId) {
    try {
      const bookingDoc = await this.db.collection('bookings').doc(bookingId).get();
      
      if (!bookingDoc.exists) {
        return {
          isValid: false,
          errors: ['Booking not found']
        };
      }

      const booking = bookingDoc.data();
      const errors = [];

      // Check required fields based on current state
      const stateValidation = this.validateStateRequirements(booking.status, booking);
      if (!stateValidation.isValid) {
        errors.push(...stateValidation.error.missingFields);
      }

      // Check for orphaned driver assignments
      if (booking.driverId && booking.status === 'pending') {
        errors.push('Booking has driverId but status is pending');
      }

      // Check for missing driver assignments
      if (['accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'delivered', 'completed'].includes(booking.status) && !booking.driverId) {
        errors.push(`Booking status is ${booking.status} but no driverId assigned`);
      }

      return {
        isValid: errors.length === 0,
        errors
      };
    } catch (error) {
      return {
        isValid: false,
        errors: [`Validation failed: ${error.message}`]
      };
    }
  }
}

module.exports = new BookingStateMachine();
