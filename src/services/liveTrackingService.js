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

      const db = this.getDb();

      // Update driver location in Firestore
      await db.collection('driverLocations').doc(driverId).set({
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
        const bookingDoc = await db.collection('bookings').doc(bookingId).get();
        if (bookingDoc.exists) {
          const bookingData = bookingDoc.data();
          
          // ✅ CRITICAL FIX: Send to multiple rooms to ensure customer receives the event
          const userRoom = `user:${bookingData.customerId}`;
          const bookingRoom = `booking:${bookingId}`;
          
          const locationUpdateData = {
            bookingId,
            driverId,
            location: {
              latitude: location.latitude,
              longitude: location.longitude,
              address: location.address,
              // Enrich with full telemetry for clients that render accuracy/speed/heading
              accuracy: typeof location.accuracy === 'number' ? location.accuracy : 0,
              speed: typeof location.speed === 'number' ? location.speed : 0,
              heading: typeof location.heading === 'number' ? location.heading : 0,
              timestamp: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
          };
          
          // ✅ CRITICAL FIX: Emit to both user room and booking room
          this.io.to(userRoom).emit('driver_location_update', locationUpdateData);
          this.io.to(bookingRoom).emit('driver_location_update', locationUpdateData);
          
          console.log(`📍 [LiveTrackingService] Updated driver location for booking ${bookingId}`, {
            userRoom,
            bookingRoom,
            location: { latitude: location.latitude, longitude: location.longitude }
          });
        }
      }

    } catch (error) {
      console.error('❌ [LiveTrackingService] Error updating driver location:', error);
    }
  }

  /**
   * Update booking status and notify customer
   */
  async updateBookingStatus(bookingId, status, driverId, additionalData = {}, options = {}) {
    try {
      if (!this.io) {
        console.error('❌ [LiveTrackingService] Socket.IO not initialized');
            return;
          }

      const db = this.getDb();
      const { persist = true, bookingDataOverride = null } = options;
      let bookingData = bookingDataOverride;

      if (persist) {
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        if (!bookingDoc.exists) {
          console.error(`❌ [LiveTrackingService] Booking ${bookingId} not found`);
          return;
        }

        bookingData = bookingDoc.data();

        await bookingRef.update({
          status,
          updatedAt: new Date(),
          ...additionalData
        });

        await db.collection('booking_status_updates').add({
          bookingId,
          status,
          driverId,
          timestamp: new Date().toISOString(),
          updatedBy: driverId,
          additionalData
        });

        const updatedDoc = await bookingRef.get();
        if (updatedDoc.exists) {
          bookingData = updatedDoc.data();
        }
      } else {
        if (!bookingData) {
          const bookingDoc = await db.collection('bookings').doc(bookingId).get();
          if (!bookingDoc.exists) {
            console.error(`❌ [LiveTrackingService] Booking ${bookingId} not found`);
            return;
          }
          bookingData = bookingDoc.data();
        }
      }

      if (!bookingData) {
        console.warn(`⚠️ [LiveTrackingService] No booking data available to broadcast for ${bookingId}`);
        return;
      }

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
            booking: bookingData, // ✅ CRITICAL: Include full booking data
            timestamp: new Date().toISOString()
          };
          break;
          
        case 'in_transit':
          eventName = 'package_in_transit_notification';
          eventData = {
            bookingId,
            driverInfo: {
              id: driverId,
              name: bookingData.driver?.name || 'Driver',
              phone: bookingData.driver?.phone || '',
              vehicleNumber: bookingData.driver?.vehicleNumber || ''
            },
            booking: bookingData, // ✅ CRITICAL: Include full booking data
            timestamp: new Date().toISOString()
          };
          break;
          
        case 'at_dropoff':
          eventName = 'driver_arrived_dropoff_notification';
          eventData = {
            bookingId,
            driverInfo: {
              id: driverId,
              name: bookingData.driver?.name || 'Driver',
              phone: bookingData.driver?.phone || '',
              vehicleNumber: bookingData.driver?.vehicleNumber || ''
            },
            booking: bookingData, // ✅ CRITICAL: Include full booking data
            timestamp: new Date().toISOString()
          };
          break;
          
        case 'delivered':
          eventName = 'package_delivered_notification';
          // ✅ CRITICAL FIX: Include full booking data in delivered notification for navigation
          eventData = {
            bookingId,
            status: 'delivered',
            driverInfo: {
              id: driverId,
              name: bookingData.driver?.name || 'Driver',
              phone: bookingData.driver?.phone || '',
              vehicleNumber: bookingData.driver?.vehicleNumber || ''
            },
            booking: bookingData, // ✅ CRITICAL: Include full booking data for navigation
            timestamp: new Date().toISOString(),
            ...additionalData // Include any additional data (photoUrl, notes, etc.)
          };
          break;
          
        case 'completed':
          eventName = 'booking_completed_notification';
          // ✅ CRITICAL FIX: Include full booking data in completed notification for navigation
          eventData = {
            bookingId,
            status: 'completed',
            driverInfo: {
              id: driverId,
              name: bookingData.driver?.name || 'Driver',
              phone: bookingData.driver?.phone || '',
              vehicleNumber: bookingData.driver?.vehicleNumber || ''
            },
            booking: bookingData, // ✅ CRITICAL: Include full booking data for navigation
            timestamp: new Date().toISOString(),
            ...additionalData // Include any additional data (payment info, etc.)
          };
          break;
      }

      // ✅ CRITICAL FIX: Send notification to customer in multiple rooms for reliability
      const userRoom = `user:${bookingData.customerId}`;
      const bookingRoom = `booking:${bookingId}`;
      
      // Send status-specific notification
      this.io.to(userRoom).emit(eventName, eventData);
      this.io.to(bookingRoom).emit(eventName, eventData);
      
      // ✅ CRITICAL FIX: Also send general status update with full booking data to both rooms
      const statusUpdateEvent = {
        bookingId,
        status,
        driverId,
        booking: bookingData, // ✅ CRITICAL: Include full booking data
        timestamp: new Date().toISOString(),
        updatedBy: driverId
      };
      
      this.io.to(userRoom).emit('booking_status_update', statusUpdateEvent);
      this.io.to(bookingRoom).emit('booking_status_update', statusUpdateEvent);
      
      // ✅ CRITICAL FIX: For 'completed' status, also emit to driver and admin
      if (status === 'completed') {
        if (driverId) {
          this.io.to(`user:${driverId}`).emit('booking_status_update', statusUpdateEvent);
        }
        this.io.to('type:admin').emit('booking_status_update', statusUpdateEvent);
      }

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
      const db = this.getDb();

      const bookingDoc = await db.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) {
        return null;
      }

      const bookingData = bookingDoc.data();
      const driverId = bookingData.driverId;
      
      if (!driverId) {
        return null;
      }

      const driverLocationDoc = await db.collection('driverLocations').doc(driverId).get();
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