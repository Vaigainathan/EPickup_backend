/**
 * Real-time Location Tracking Service
 * Handles driver location updates and customer tracking
 */

const { getFirestore } = require('./firebase');
const notificationService = require('./notificationService');

class LocationTrackingService {
  constructor() {
    this.db = getFirestore();
    this.activeTrackings = new Map(); // Map of bookingId -> tracking data
    this.locationUpdateInterval = 10000; // 10 seconds
    this.maxTrackingDuration = 2 * 60 * 60 * 1000; // 2 hours
  }

  /**
   * Start tracking a driver for a specific booking
   * @param {string} bookingId - Booking ID
   * @param {string} driverId - Driver ID
   * @param {string} customerId - Customer ID
   */
  async startTracking(bookingId, driverId, customerId) {
    try {
      console.log(`📍 [LOCATION_TRACKING] Starting tracking for booking ${bookingId}`);

      const trackingData = {
        bookingId,
        driverId,
        customerId,
        startTime: new Date(),
        lastUpdate: new Date(),
        isActive: true,
        locationHistory: [],
        currentLocation: null
      };

      // Store in memory for quick access
      this.activeTrackings.set(bookingId, trackingData);

      // Store in Firestore for persistence
      await this.db.collection('locationTracking').doc(bookingId).set({
        ...trackingData,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Notify customer that tracking has started
      await notificationService.sendTemplateNotification(
        customerId,
        'CUSTOMER',
        'DRIVER_ASSIGNED',
        {
          bookingId,
          driverName: 'Your driver',
          eta: '15 mins'
        }
      );

      console.log(`✅ [LOCATION_TRACKING] Tracking started for booking ${bookingId}`);
      return { success: true, trackingData };

    } catch (error) {
      console.error('❌ [LOCATION_TRACKING] Error starting tracking:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update driver location
   * @param {string} driverId - Driver ID
   * @param {Object} location - Location data
   */
  async updateDriverLocation(driverId, location) {
    try {
      const { latitude, longitude, timestamp } = location;
      
      if (!latitude || !longitude) {
        throw new Error('Invalid location data');
      }

      const locationData = {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        timestamp: timestamp || new Date(),
        accuracy: location.accuracy || 0,
        speed: location.speed || 0,
        heading: location.heading || 0
      };

      // Update driver's current location
      await this.db.collection('driverLocations').doc(driverId).set({
        driverId,
        currentLocation: locationData,
        lastUpdated: new Date(),
        isOnline: true,
        isAvailable: true
      }, { merge: true });

      // Update all active trackings for this driver
      const activeTrackings = Array.from(this.activeTrackings.values())
        .filter(tracking => tracking.driverId === driverId && tracking.isActive);

      for (const tracking of activeTrackings) {
        await this.updateTrackingLocation(tracking.bookingId, locationData);
      }

      console.log(`📍 [LOCATION_TRACKING] Updated location for driver ${driverId}`);
      return { success: true };

    } catch (error) {
      console.error('❌ [LOCATION_TRACKING] Error updating driver location:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update tracking location for a specific booking
   * @param {string} bookingId - Booking ID
   * @param {Object} locationData - Location data
   */
  async updateTrackingLocation(bookingId, locationData) {
    try {
      const tracking = this.activeTrackings.get(bookingId);
      if (!tracking) {
        console.warn(`⚠️ [LOCATION_TRACKING] No active tracking found for booking ${bookingId}`);
        return { success: false, error: 'No active tracking found' };
      }

      // Add to location history
      tracking.locationHistory.push({
        ...locationData,
        timestamp: new Date()
      });

      // Keep only last 100 locations to prevent memory issues
      if (tracking.locationHistory.length > 100) {
        tracking.locationHistory = tracking.locationHistory.slice(-100);
      }

      tracking.currentLocation = locationData;
      tracking.lastUpdate = new Date();

      // Update Firestore
      await this.db.collection('locationTracking').doc(bookingId).update({
        currentLocation: locationData,
        locationHistory: tracking.locationHistory,
        lastUpdate: new Date(),
        updatedAt: new Date()
      });

      // Notify customer of location update
      await this.notifyCustomerLocationUpdate(bookingId, locationData);

      return { success: true };

    } catch (error) {
      console.error('❌ [LOCATION_TRACKING] Error updating tracking location:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Notify customer of location update
   * @param {string} bookingId - Booking ID
   * @param {Object} locationData - Location data
   */
  async notifyCustomerLocationUpdate(bookingId, locationData) {
    try {
      const tracking = this.activeTrackings.get(bookingId);
      if (!tracking) return;

      // Send WebSocket update to customer
      const io = require('./socket').getIO();
      if (io) {
        // ✅ CRITICAL FIX: Use consistent event name and room format
        const userRoom = `user:${tracking.customerId}`;
        const bookingRoom = `booking:${bookingId}`;
        
        const locationUpdateData = {
          bookingId,
          driverId: tracking.driverId,
          location: {
            latitude: locationData.latitude,
            longitude: locationData.longitude,
            address: locationData.address || 'Current Location',
            timestamp: new Date().toISOString()
          },
          timestamp: new Date().toISOString()
        };
        
        // ✅ CRITICAL FIX: Emit to both user room and booking room with consistent event name
        io.to(userRoom).emit('driver_location_update', locationUpdateData);
        io.to(bookingRoom).emit('driver_location_update', locationUpdateData);
      }

    } catch (error) {
      console.error('❌ [LOCATION_TRACKING] Error notifying customer:', error);
    }
  }

  /**
   * Stop tracking for a booking
   * @param {string} bookingId - Booking ID
   * @param {string} reason - Reason for stopping
   */
  async stopTracking(bookingId, reason = 'completed') {
    try {
      const tracking = this.activeTrackings.get(bookingId);
      if (!tracking) {
        console.warn(`⚠️ [LOCATION_TRACKING] No active tracking found for booking ${bookingId}`);
        return { success: false, error: 'No active tracking found' };
      }

      tracking.isActive = false;
      tracking.endTime = new Date();
      tracking.endReason = reason;

      // Update Firestore
      await this.db.collection('locationTracking').doc(bookingId).update({
        isActive: false,
        endTime: new Date(),
        endReason: reason,
        updatedAt: new Date()
      });

      // Remove from memory
      this.activeTrackings.delete(bookingId);

      console.log(`🛑 [LOCATION_TRACKING] Stopped tracking for booking ${bookingId}: ${reason}`);
      return { success: true };

    } catch (error) {
      console.error('❌ [LOCATION_TRACKING] Error stopping tracking:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current tracking data for a booking
   * @param {string} bookingId - Booking ID
   */
  async getTrackingData(bookingId) {
    try {
      const tracking = this.activeTrackings.get(bookingId);
      if (tracking) {
        return { success: true, data: tracking };
      }

      // Try to get from Firestore
      const doc = await this.db.collection('locationTracking').doc(bookingId).get();
      if (doc.exists) {
        return { success: true, data: doc.data() };
      }

      return { success: false, error: 'No tracking data found' };

    } catch (error) {
      console.error('❌ [LOCATION_TRACKING] Error getting tracking data:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get location history for a booking
   * @param {string} bookingId - Booking ID
   * @param {number} limit - Number of locations to return
   */
  async getLocationHistory(bookingId, limit = 50) {
    try {
      const tracking = this.activeTrackings.get(bookingId);
      if (tracking && tracking.locationHistory) {
        return {
          success: true,
          data: tracking.locationHistory.slice(-limit)
        };
      }

      // Get from Firestore
      const doc = await this.db.collection('locationTracking').doc(bookingId).get();
      if (doc.exists) {
        const data = doc.data();
        return {
          success: true,
          data: data.locationHistory ? data.locationHistory.slice(-limit) : []
        };
      }

      return { success: false, error: 'No location history found' };

    } catch (error) {
      console.error('❌ [LOCATION_TRACKING] Error getting location history:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Calculate ETA to destination
   * @param {Object} currentLocation - Current location
   * @param {Object} destination - Destination location
   */
  calculateETA(currentLocation, destination) {
    try {
      // Simple ETA calculation based on distance and average speed
      const distance = this.calculateDistance(
        currentLocation.latitude,
        currentLocation.longitude,
        destination.latitude,
        destination.longitude
      );

      const averageSpeed = 30; // km/h
      const etaMinutes = Math.round((distance / averageSpeed) * 60);
      
      return {
        distance: Math.round(distance * 100) / 100, // km
        etaMinutes,
        eta: etaMinutes < 60 ? `${etaMinutes} mins` : `${Math.round(etaMinutes / 60)}h ${etaMinutes % 60}m`
      };

    } catch (error) {
      console.error('❌ [LOCATION_TRACKING] Error calculating ETA:', error);
      return { distance: 0, etaMinutes: 0, eta: 'Unknown' };
    }
  }

  /**
   * Calculate distance between two points
   * @param {number} lat1 - Latitude 1
   * @param {number} lon1 - Longitude 1
   * @param {number} lat2 - Latitude 2
   * @param {number} lon2 - Longitude 2
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Clean up old tracking data
   */
  async cleanupOldTrackings() {
    try {
      const cutoffTime = new Date(Date.now() - this.maxTrackingDuration);
      
      // Clean up memory
      for (const [bookingId, tracking] of this.activeTrackings.entries()) {
        if (tracking.startTime < cutoffTime) {
          await this.stopTracking(bookingId, 'timeout');
        }
      }

      // Clean up Firestore
      const oldTrackings = await this.db.collection('locationTracking')
        .where('createdAt', '<', cutoffTime)
        .where('isActive', '==', true)
        .get();

      const batch = this.db.batch();
      oldTrackings.docs.forEach(doc => {
        batch.update(doc.ref, {
          isActive: false,
          endTime: new Date(),
          endReason: 'cleanup',
          updatedAt: new Date()
        });
      });

      if (oldTrackings.docs.length > 0) {
        await batch.commit();
        console.log(`🧹 [LOCATION_TRACKING] Cleaned up ${oldTrackings.docs.length} old trackings`);
      }

    } catch (error) {
      console.error('❌ [LOCATION_TRACKING] Error cleaning up old trackings:', error);
    }
  }

  /**
   * Get all active trackings
   */
  getActiveTrackings() {
    return Array.from(this.activeTrackings.values());
  }

  /**
   * Get tracking statistics
   */
  async getTrackingStatistics() {
    try {
      const activeCount = this.activeTrackings.size;
      
      const totalTrackings = await this.db.collection('locationTracking')
        .where('createdAt', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000))
        .get();

      return {
        activeTrackings: activeCount,
        totalTrackings24h: totalTrackings.size,
        memoryUsage: process.memoryUsage()
      };

    } catch (error) {
      console.error('❌ [LOCATION_TRACKING] Error getting statistics:', error);
      return { activeTrackings: 0, totalTrackings24h: 0, memoryUsage: {} };
    }
  }
}

module.exports = new LocationTrackingService();
