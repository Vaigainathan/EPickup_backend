const { getFirestore } = require('./firebase');

/**
 * Transaction Service
 * Provides atomic operations and fixes race conditions
 */
class TransactionService {
  constructor() {
    this.db = getFirestore();
  }

  /**
   * Create user with atomic transaction
   * @param {Object} userData - User data to create
   * @returns {Object} Transaction result
   */
  async createUserAtomically(userData) {
    const { uid, phone, userType } = userData;
    
    // Validate required fields
    if (!uid || !phone || !userType) {
      throw new Error('Missing required user data: uid, phone, userType');
    }
    
    try {
      const result = await this.db.runTransaction(async (transaction) => {
        // Check if user already exists
        const userRef = this.db.collection('users').doc(uid);
        const userDoc = await transaction.get(userRef);
        
        if (userDoc.exists) {
          throw new Error('USER_ALREADY_EXISTS');
        }

        // Check if phone number is already in use
        const phoneQuery = this.db.collection('users').where('phone', '==', phone);
        const phoneSnapshot = await transaction.get(phoneQuery);
        
        if (!phoneSnapshot.empty) {
          throw new Error('PHONE_ALREADY_EXISTS');
        }

        // Create user with standardized timestamp
        const now = this.db.FieldValue.serverTimestamp();
        const newUserData = {
          ...userData,
          createdAt: now,
          updatedAt: now,
          isActive: true
        };

        transaction.set(userRef, newUserData);

        return { success: true, userId: uid };
      });

      return result;
    } catch (error) {
      console.error('Error in createUserAtomically:', error);
      throw error;
    }
  }

  /**
   * Update booking status atomically
   * @param {string} bookingId - Booking ID
   * @param {string} newStatus - New status
   * @param {string} updatedBy - User ID who updated
   * @param {Object} additionalData - Additional data to update
   * @returns {Object} Transaction result
   */
  async updateBookingStatusAtomically(bookingId, newStatus, updatedBy, additionalData = {}) {
    try {
      const result = await this.db.runTransaction(async (transaction) => {
        const bookingRef = this.db.collection('bookings').doc(bookingId);
        const bookingDoc = await transaction.get(bookingRef);
        
        if (!bookingDoc.exists) {
          throw new Error('BOOKING_NOT_FOUND');
        }

        const currentData = bookingDoc.data();
        const currentStatus = currentData.status;

        // Validate status transition
        if (!this.isValidStatusTransition(currentStatus, newStatus)) {
          throw new Error('INVALID_STATUS_TRANSITION');
        }

        // Update booking with standardized timestamp
        const now = this.db.FieldValue.serverTimestamp();
        const updateData = {
          status: newStatus,
          updatedAt: now,
          updatedBy,
          ...additionalData
        };

        transaction.update(bookingRef, updateData);

        // Update driver status if needed
        if (currentData.driverId && this.shouldUpdateDriverStatus(newStatus)) {
          const driverRef = this.db.collection('users').doc(currentData.driverId);
          const driverUpdateData = {
            'driver.isOnline': newStatus === 'in_transit' || newStatus === 'delivered',
            'driver.isAvailable': newStatus === 'delivered' || newStatus === 'cancelled',
            updatedAt: now
          };
          transaction.update(driverRef, driverUpdateData);
        }

        return { 
          success: true, 
          bookingId, 
          oldStatus: currentStatus, 
          newStatus 
        };
      });

      return result;
    } catch (error) {
      console.error('Error in updateBookingStatusAtomically:', error);
      throw error;
    }
  }

  /**
   * Assign driver to booking atomically
   * @param {string} bookingId - Booking ID
   * @param {string} driverId - Driver ID
   * @param {string} assignedBy - User ID who assigned
   * @returns {Object} Transaction result
   */
  async assignDriverAtomically(bookingId, driverId, assignedBy) {
    try {
      const result = await this.db.runTransaction(async (transaction) => {
        const bookingRef = this.db.collection('bookings').doc(bookingId);
        const driverRef = this.db.collection('users').doc(driverId);
        
        // Get both documents
        const [bookingDoc, driverDoc] = await Promise.all([
          transaction.get(bookingRef),
          transaction.get(driverRef)
        ]);

        if (!bookingDoc.exists) {
          throw new Error('BOOKING_NOT_FOUND');
        }

        if (!driverDoc.exists) {
          throw new Error('DRIVER_NOT_FOUND');
        }

        const bookingData = bookingDoc.data();
        const driverData = driverDoc.data();

        // Validate booking can be assigned
        if (bookingData.status !== 'pending') {
          throw new Error('BOOKING_NOT_AVAILABLE');
        }

        // ✅ USE VALIDATION UTILITY: Comprehensive check for all driverId edge cases
        const bookingValidation = require('../utils/bookingValidation');
        if (!bookingValidation.isDriverIdEmpty(bookingData.driverId)) {
          throw new Error('BOOKING_ALREADY_ASSIGNED');
        }

        // Validate driver is available
        if (driverData.driver?.isOnline !== true || driverData.driver?.isAvailable !== true) {
          throw new Error('DRIVER_NOT_AVAILABLE');
        }

        // Update booking
        const now = this.db.FieldValue.serverTimestamp();
        transaction.update(bookingRef, {
          driverId,
          status: 'driver_assigned',
          assignedAt: now,
          assignedBy,
          updatedAt: now
        });

        // Update driver
        transaction.update(driverRef, {
          'driver.isAvailable': false,
          updatedAt: now
        });

        // Create driver assignment record
        const assignmentRef = this.db.collection('driverAssignments').doc();
        transaction.set(assignmentRef, {
          id: assignmentRef.id,
          bookingId,
          driverId,
          assignedAt: now,
          assignedBy,
          status: 'assigned',
          createdAt: now
        });

        return { 
          success: true, 
          bookingId, 
          driverId, 
          assignmentId: assignmentRef.id 
        };
      });

      return result;
    } catch (error) {
      console.error('Error in assignDriverAtomically:', error);
      throw error;
    }
  }

  /**
   * Process payment atomically
   * @param {Object} paymentData - Payment data
   * @returns {Object} Transaction result
   */
  async processPaymentAtomically(paymentData) {
    const { bookingId, amount, paymentMethod, paymentId, customerId } = paymentData;
    
    try {
      const result = await this.db.runTransaction(async (transaction) => {
        const bookingRef = this.db.collection('bookings').doc(bookingId);
        const customerRef = this.db.collection('users').doc(customerId);
        
        // Get both documents
        const [bookingDoc, customerDoc] = await Promise.all([
          transaction.get(bookingRef),
          transaction.get(customerRef)
        ]);

        if (!bookingDoc.exists) {
          throw new Error('BOOKING_NOT_FOUND');
        }

        if (!customerDoc.exists) {
          throw new Error('CUSTOMER_NOT_FOUND');
        }

        const bookingData = bookingDoc.data();

        // Validate booking can be paid
        if (bookingData.status !== 'delivered') {
          throw new Error('BOOKING_NOT_READY_FOR_PAYMENT');
        }

        if (bookingData.paymentStatus === 'completed') {
          throw new Error('PAYMENT_ALREADY_COMPLETED');
        }

        // Create payment record
        const paymentRef = this.db.collection('payments').doc();
        const now = this.db.FieldValue.serverTimestamp();
        
        transaction.set(paymentRef, {
          id: paymentRef.id,
          bookingId,
          customerId,
          amount,
          paymentMethod,
          paymentId,
          status: 'completed',
          createdAt: now,
          completedAt: now
        });

        // Update booking payment status
        transaction.update(bookingRef, {
          paymentStatus: 'completed',
          paymentId: paymentRef.id,
          paidAt: now,
          updatedAt: now
        });

        // Update customer wallet if applicable
        if (paymentMethod === 'wallet') {
          const currentBalance = customerDoc.data().wallet?.balance || 0;
          const newBalance = currentBalance - amount;
          
          if (newBalance < 0) {
            throw new Error('INSUFFICIENT_WALLET_BALANCE');
          }

          transaction.update(customerRef, {
            'wallet.balance': newBalance,
            'wallet.updatedAt': now,
            updatedAt: now
          });
        }

        return { 
          success: true, 
          paymentId: paymentRef.id, 
          bookingId 
        };
      });

      return result;
    } catch (error) {
      console.error('Error in processPaymentAtomically:', error);
      throw error;
    }
  }

  /**
   * Update driver location atomically
   * @param {string} driverId - Driver ID
   * @param {Object} location - Location data
   * @param {string} bookingId - Optional booking ID
   * @returns {Object} Transaction result
   */
  async updateDriverLocationAtomically(driverId, location, bookingId = null) {
    try {
      const result = await this.db.runTransaction(async (transaction) => {
        const driverRef = this.db.collection('users').doc(driverId);
        const locationRef = this.db.collection('driverLocations').doc(driverId);
        
        // Get driver document
        const driverDoc = await transaction.get(driverRef);
        
        if (!driverDoc.exists) {
          throw new Error('DRIVER_NOT_FOUND');
        }

        const now = this.db.FieldValue.serverTimestamp();
        const locationData = {
          driverId,
          currentLocation: location,
          lastUpdated: now,
          isOnline: true
        };

        // Update driver location in users collection
        transaction.update(driverRef, {
          'driver.currentLocation': location,
          'driver.lastLocationUpdate': now,
          updatedAt: now
        });

        // Update or create driver location record
        transaction.set(locationRef, locationData, { merge: true });

        // Update booking if provided
        if (bookingId) {
          const bookingRef = this.db.collection('bookings').doc(bookingId);
          transaction.update(bookingRef, {
            'driver.currentLocation': location,
            'driver.lastLocationUpdate': now,
            updatedAt: now
          });
        }

        return { 
          success: true, 
          driverId, 
          location 
        };
      });

      return result;
    } catch (error) {
      console.error('Error in updateDriverLocationAtomically:', error);
      throw error;
    }
  }

  /**
   * Validate status transition
   * ✅ CRITICAL FIX: Use bookingStateMachine for validation to ensure consistency
   * @param {string} currentStatus - Current status
   * @param {string} newStatus - New status
   * @returns {boolean} True if transition is valid
   */
  isValidStatusTransition(currentStatus, newStatus) {
    // ✅ CRITICAL FIX: Use the centralized state machine for validation
    // This ensures all validation logic is consistent across the application
    try {
      const bookingStateMachine = require('./bookingStateMachine');
      const validation = bookingStateMachine.validateTransition(currentStatus, newStatus);
      return validation.isValid;
    } catch (error) {
      console.error('❌ [TRANSACTION_SERVICE] Error validating status transition:', error);
      // Fallback to basic check if state machine fails
      return currentStatus === newStatus || false;
    }
  }

  /**
   * Check if driver status should be updated
   * @param {string} bookingStatus - Booking status
   * @returns {boolean} True if driver status should be updated
   */
  shouldUpdateDriverStatus(bookingStatus) {
    return ['in_transit', 'delivered', 'cancelled'].includes(bookingStatus);
  }

  /**
   * Batch write operations
   * @param {Array} operations - Array of write operations
   * @returns {Object} Batch write result
   */
  async batchWrite(operations) {
    try {
      const batch = this.db.batch();
      const now = this.db.FieldValue.serverTimestamp();

      operations.forEach(operation => {
        const { type, collection, docId, data } = operation;
        const docRef = this.db.collection(collection).doc(docId);
        
        // Add standardized timestamps
        const dataWithTimestamps = {
          ...data,
          updatedAt: now
        };

        switch (type) {
          case 'set':
            batch.set(docRef, dataWithTimestamps);
            break;
          case 'update':
            batch.update(docRef, dataWithTimestamps);
            break;
          case 'delete':
            batch.delete(docRef);
            break;
          default:
            throw new Error(`Unknown operation type: ${type}`);
        }
      });

      await batch.commit();

      return {
        success: true,
        operationsProcessed: operations.length
      };
    } catch (error) {
      console.error('Error in batchWrite:', error);
      throw error;
    }
  }

  /**
   * Get standardized timestamp
   * @returns {Object} Firestore server timestamp
   */
  getServerTimestamp() {
    return this.db.FieldValue.serverTimestamp();
  }
}

// Create singleton instance
const transactionService = new TransactionService();

module.exports = transactionService;
