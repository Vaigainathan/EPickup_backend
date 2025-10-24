const { getFirestore } = require('firebase-admin/firestore');

/**
 * Active Booking Service - Industry Standard Customer Order Management
 * ✅ ZOMATO/PORTER STANDARD: One active booking per customer, atomic checks
 */
class ActiveBookingService {
  constructor() {
    this.db = null; // Initialize lazily
  }

  /**
   * Get Firestore instance (lazy initialization)
   */
  getDb() {
    if (!this.db) {
      try {
        this.db = getFirestore();
      } catch (error) {
        console.error('❌ [ActiveBookingService] Failed to get Firestore:', error);
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using ActiveBookingService.');
      }
    }
    return this.db;
  }

  /**
   * Check if customer has active booking
   * ✅ ZOMATO STANDARD: Prevents multiple active bookings per customer
   */
  async hasActiveBooking(customerId) {
    try {
      const activeStatuses = [
        'pending', 
        'driver_assigned', 
        'accepted', 
        'driver_enroute', 
        'driver_arrived', 
        'picked_up', 
        'in_transit',
        'at_dropoff',
        'money_collection'
      ];

      const activeBookingsSnapshot = await this.db.collection('bookings')
        .where('customerId', '==', customerId)
        .where('status', 'in', activeStatuses)
        .limit(1)
        .get();

      if (!activeBookingsSnapshot.empty) {
        const activeBooking = activeBookingsSnapshot.docs[0].data();
        return {
          hasActive: true,
          bookingId: activeBookingsSnapshot.docs[0].id,
          status: activeBooking.status,
          createdAt: activeBooking.createdAt,
          driverId: activeBooking.driverId
        };
      }

      return { hasActive: false };
    } catch (error) {
      console.error('❌ [ActiveBookingService] Error checking active booking:', error);
      throw error;
    }
  }

  /**
   * Create booking with atomic active booking check
   * ✅ ZOMATO STANDARD: Atomic transaction prevents race conditions
   */
  async createBookingAtomically(bookingData) {
    try {
      const result = await this.db.runTransaction(async (transaction) => {
        const customerId = bookingData.customerId;
        
        // Check for active bookings within transaction
        const activeBookingsQuery = this.db.collection('bookings')
          .where('customerId', '==', customerId)
          .where('status', 'in', ['pending', 'driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff', 'money_collection'])
          .limit(1);

        const activeBookingsSnapshot = await transaction.get(activeBookingsQuery);

        if (!activeBookingsSnapshot.empty) {
          // const existingBooking = activeBookingsSnapshot.docs[0].data();
          throw new Error('CUSTOMER_ACTIVE_BOOKING_EXISTS');
        }

        // Create new booking
        const bookingRef = this.db.collection('bookings').doc();
        const newBooking = {
          ...bookingData,
          id: bookingRef.id,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date()
        };

        transaction.set(bookingRef, newBooking);

        return {
          success: true,
          bookingId: bookingRef.id,
          booking: newBooking
        };
      });

      console.log(`✅ [ActiveBookingService] Created booking ${result.bookingId} for customer ${bookingData.customerId}`);
      return result;

    } catch (error) {
      if (error.message === 'CUSTOMER_ACTIVE_BOOKING_EXISTS') {
        throw new Error('You already have an active booking. Please complete or cancel it before creating a new one.');
      }
      
      console.error('❌ [ActiveBookingService] Error creating booking atomically:', error);
      throw error;
    }
  }

  /**
   * Cancel active booking atomically
   * ✅ ZOMATO STANDARD: Proper cleanup when canceling active booking
   */
  async cancelActiveBooking(customerId, reason = 'Cancelled by customer') {
    try {
      const result = await this.db.runTransaction(async (transaction) => {
        // Find active booking
        const activeBookingsQuery = this.db.collection('bookings')
          .where('customerId', '==', customerId)
          .where('status', 'in', ['pending', 'driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff', 'money_collection'])
          .limit(1);

        const activeBookingsSnapshot = await transaction.get(activeBookingsQuery);

        if (activeBookingsSnapshot.empty) {
          throw new Error('NO_ACTIVE_BOOKING');
        }

        const bookingDoc = activeBookingsSnapshot.docs[0];
        const bookingData = bookingDoc.data();

        // Update booking status
        transaction.update(bookingDoc.ref, {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancellationReason: reason,
          updatedAt: new Date()
        });

        // If driver was assigned, update driver status
        if (bookingData.driverId) {
          const driverRef = this.db.collection('users').doc(bookingData.driverId);
          transaction.update(driverRef, {
            'driver.isAvailable': true,
            'driver.currentBookingId': null,
            updatedAt: new Date()
          });
        }

        return {
          success: true,
          bookingId: bookingDoc.id,
          previousStatus: bookingData.status
        };
      });

      console.log(`✅ [ActiveBookingService] Cancelled active booking for customer ${customerId}`);
      return result;

    } catch (error) {
      console.error('❌ [ActiveBookingService] Error cancelling active booking:', error);
      throw error;
    }
  }

  /**
   * Get customer's booking history
   * ✅ ZOMATO STANDARD: Complete booking history with pagination
   */
  async getCustomerBookingHistory(customerId, limit = 20, offset = 0) {
    try {
      const bookingsSnapshot = await this.db.collection('bookings')
        .where('customerId', '==', customerId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .offset(offset)
        .get();

      const bookings = bookingsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return {
        success: true,
        bookings,
        hasMore: bookings.length === limit
      };
    } catch (error) {
      console.error('❌ [ActiveBookingService] Error getting booking history:', error);
      throw error;
    }
  }

  /**
   * Get current active booking for customer
   * ✅ ZOMATO STANDARD: Real-time active booking status
   */
  async getCurrentActiveBooking(customerId) {
    try {
      const activeBooking = await this.hasActiveBooking(customerId);
      
      if (!activeBooking.hasActive) {
        return { success: true, booking: null };
      }

      // Get full booking details
      const bookingDoc = await this.db.collection('bookings').doc(activeBooking.bookingId).get();
      
      if (!bookingDoc.exists) {
        return { success: true, booking: null };
      }

      const bookingData = bookingDoc.data();
      
      // Get driver details if assigned
      let driverDetails = null;
      if (activeBooking.driverId) {
        const driverDoc = await this.db.collection('users').doc(activeBooking.driverId).get();
        if (driverDoc.exists) {
          const driverData = driverDoc.data();
          driverDetails = {
            id: activeBooking.driverId,
            name: driverData.name,
            phone: driverData.phone,
            vehicleNumber: driverData.driver?.vehicleNumber,
            rating: driverData.driver?.rating || 4.5
          };
        }
      }

      return {
        success: true,
        booking: {
          id: activeBooking.bookingId,
          ...bookingData,
          driver: driverDetails
        }
      };
    } catch (error) {
      console.error('❌ [ActiveBookingService] Error getting current active booking:', error);
      throw error;
    }
  }
}

module.exports = ActiveBookingService;
