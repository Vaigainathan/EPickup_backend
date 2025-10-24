const { getFirestore } = require('firebase-admin/firestore');

/**
 * Live Tracking Service - Handles real-time driver location updates and booking status
 * ✅ FIXED: Provides live tracking for customers and status updates
 */
class LiveTrackingService {
  constructor() {
    this.db = null; // Initialize lazily
    this.io = null;
  }

  /**
   * Get Firestore instance (lazy initialization)
   */
  getDb() {
    if (!this.db) {
      try {
        this.db = getFirestore();
    } catch (error) {
        console.error('❌ [LiveTrackingService] Failed to get Firestore:', error);
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using LiveTrackingService.');
      }
    }
    return this.db;
  }

  /**
   * Initialize with Socket.IO instance
   */
  initialize(io) {
    this.io = io;
    console.log('✅ [LiveTrackingService] Initialized with Socket.IO');
  }

  /**
   * Update driver location and notify customer
   */
  async updateDriverLocation(driverId, location, bookingId = null) {
    try {
      if (!this.io) {
        console.error('❌ [LiveTrackingService] Socket.IO not initialized');
        return;
      }

      // Update driver location in Firestore
      await this.db.collection('driverLocations').doc(driverId).set({
        latitude: location.latitude,
        longitude: location.longitude,
        address: location.address || 'Current Location',
        timestamp: new Date(),
        lastUpdated: new Date(),
        currentTripId: bookingId
      }, { merge: true });

      // If driver is on a trip, notify customer
      if (bookingId) {
        // Get booking details
        const bookingDoc = await this.db.collection('bookings').doc(bookingId).get();
        if (bookingDoc.exists) {
          const bookingData = bookingDoc.data();
          
          // Notify customer of driver location update
          this.io.to(`user:${bookingData.customerId}`).emit('driver_location_update', {
            bookingId,
            driverId,
            location: {
        latitude: location.latitude,
        longitude: location.longitude,
              address: location.address,
              timestamp: new Date().toISOString()
            },
        timestamp: new Date().toISOString()
          });

          console.log(`📍 [LiveTrackingService] Updated driver location for booking ${bookingId}`);
        }
      }

    } catch (error) {
      console.error('❌ [LiveTrackingService] Error updating driver location:', error);
    }
  }

  /**
   * Update booking status and notify customer
   */
  async updateBookingStatus(bookingId, status, driverId, additionalData = {}) {
    try {
      if (!this.io) {
        console.error('❌ [LiveTrackingService] Socket.IO not initialized');
            return;
          }

      // Get booking details
      const bookingDoc = await this.db.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) {
        console.error(`❌ [LiveTrackingService] Booking ${bookingId} not found`);
            return;
          }

      const bookingData = bookingDoc.data();
      
      // Update booking status
      await this.db.collection('bookings').doc(bookingId).update({
        status,
        updatedAt: new Date(),
        ...additionalData
      });

      // Create status update record
      await this.db.collection('booking_status_updates').add({
        bookingId,
        status,
        driverId,
        timestamp: new Date().toISOString(),
        updatedBy: driverId,
        additionalData
      });

      // Notify customer based on status
      let eventName = 'booking_status_update';
      let eventData = {
        bookingId,
        status,
        driverId,
        timestamp: new Date().toISOString(),
        updatedBy: driverId
      };

      // Add status-specific notifications
      switch (status) {
        case 'driver_enroute':
          eventName = 'driver_enroute_notification';
          eventData = {
            bookingId,
            driverInfo: {
              id: driverId,
              name: bookingData.driver?.name || 'Driver',
              phone: bookingData.driver?.phone || '',
              vehicleNumber: bookingData.driver?.vehicleNumber || ''
            },
            eta: additionalData.eta || 15, // Default 15 minutes
            timestamp: new Date().toISOString()
          };
          break;
          
        case 'driver_arrived':
          eventName = 'driver_arrived_notification';
          eventData = {
            bookingId,
            driverInfo: {
              id: driverId,
              name: bookingData.driver?.name || 'Driver',
              phone: bookingData.driver?.phone || '',
              vehicleNumber: bookingData.driver?.vehicleNumber || ''
            },
            timestamp: new Date().toISOString()
          };
          break;
          
        case 'picked_up':
          eventName = 'package_picked_up_notification';
          eventData = {
            bookingId,
            driverInfo: {
              id: driverId,
              name: bookingData.driver?.name || 'Driver',
              phone: bookingData.driver?.phone || '',
              vehicleNumber: bookingData.driver?.vehicleNumber || ''
            },
            timestamp: new Date().toISOString()
          };
          break;
          
        case 'delivered':
          eventName = 'package_delivered_notification';
          eventData = {
            bookingId,
            driverInfo: {
              id: driverId,
              name: bookingData.driver?.name || 'Driver',
              phone: bookingData.driver?.phone || '',
              vehicleNumber: bookingData.driver?.vehicleNumber || ''
            },
            timestamp: new Date().toISOString()
          };
          break;
      }

      // Send notification to customer
      this.io.to(`user:${bookingData.customerId}`).emit(eventName, eventData);
      
      // Also send general status update
      this.io.to(`user:${bookingData.customerId}`).emit('booking_status_update', {
        bookingId,
        status,
        driverId,
        timestamp: new Date().toISOString(),
        updatedBy: driverId
      });

      console.log(`📊 [LiveTrackingService] Updated booking ${bookingId} status to ${status}`);

    } catch (error) {
      console.error('❌ [LiveTrackingService] Error updating booking status:', error);
    }
  }

  /**
   * Get driver location for a booking
   */
  async getDriverLocation(bookingId) {
    try {
      const bookingDoc = await this.db.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) {
        return null;
      }

      const bookingData = bookingDoc.data();
      const driverId = bookingData.driverId;
      
      if (!driverId) {
        return null;
      }

      const driverLocationDoc = await this.db.collection('driverLocations').doc(driverId).get();
      if (!driverLocationDoc.exists) {
        return null;
      }

      return driverLocationDoc.data();
    } catch (error) {
      console.error('❌ [LiveTrackingService] Error getting driver location:', error);
      return null;
    }
  }
}

module.exports = new LiveTrackingService();