const { getFirestore } = require('./firebase');
const { getRedisClient } = require('./redis');
const RealTimeService = require('./realTimeService');
const { getSocketIO } = require('./socket');

/**
 * Live Tracking Service for EPickup
 * Handles real-time location updates, trip progress, and live tracking
 */
class LiveTrackingService {
  constructor() {
    this.db = null;
    this.redis = null;
    this.realTimeService = null;
    this.io = null;
    this.activeTrips = new Map(); // tripId -> tracking data
    this.locationUpdateInterval = 10000; // 10 seconds
    this.initialize();
  }

  /**
   * Initialize the live tracking service
   */
  async initialize() {
    try {
      this.db = getFirestore();
      this.redis = getRedisClient();
      this.realTimeService = new RealTimeService();
      this.io = getSocketIO();
      
      console.log('✅ Live tracking service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize live tracking service:', error);
    }
  }

  /**
   * Start live tracking for a trip
   * @param {string} tripId - Trip identifier
   * @param {Object} tripData - Trip information
   * @param {Object} options - Tracking options
   */
  async startLiveTracking(tripId, tripData, options = {}) {
    try {
      console.log(`🚀 Starting live tracking for trip: ${tripId}`);

      // Validate trip data
      if (!tripData.driverId || !tripData.pickup || !tripData.dropoff) {
        throw new Error('Invalid trip data for live tracking');
      }

      // Initialize tracking data
      const trackingData = {
        tripId,
        bookingId: tripData.bookingId || tripId,
        driverId: tripData.driverId,
        customerId: tripData.customerId,
        status: 'tracking_started',
        startTime: new Date(),
        lastUpdate: new Date(),
        currentLocation: null,
        locationHistory: [],
        progress: {
          distanceToPickup: 0,
          distanceToDropoff: 0,
          etaToPickup: 0,
          etaToDropoff: 0,
          isAtPickup: false,
          isAtDropoff: false,
          currentStage: 'enroute'
        },
        route: {
          polyline: null,
          distance: 0,
          duration: 0,
          waypoints: []
        },
        geofence: {
          pickup: {
            center: tripData.pickup.coordinates,
            radius: 0.1, // 100 meters
            triggered: false,
            triggeredAt: null
          },
          dropoff: {
            center: tripData.dropoff.coordinates,
            radius: 0.1, // 100 meters
            triggered: false,
            triggeredAt: null
          }
        },
        options: {
          updateInterval: options.updateInterval || this.locationUpdateInterval,
          enableGeofencing: options.enableGeofencing !== false,
          enableRouteOptimization: options.enableRouteOptimization !== false,
          maxLocationHistory: options.maxLocationHistory || 100
        }
      };

      // Store in active trips
      this.activeTrips.set(tripId, trackingData);

      // Store in Redis for persistence
      if (this.redis) {
        await this.redis.set(
          `live_tracking:${tripId}`,
          JSON.stringify(trackingData),
          'EX',
          3600 // 1 hour expiry
        );
      }

      // Create tracking document in Firestore
      await this.createTrackingDocument(tripId, trackingData);

      // Send tracking started notification
      await this.realTimeService.sendTripStatusUpdate(tripId, 'tracking_started', {
        startTime: trackingData.startTime,
        driverId: tripData.driverId
      });

      // Start location update monitoring
      this.startLocationMonitoring(tripId);

      console.log(`✅ Live tracking started for trip: ${tripId}`);
      return trackingData;

    } catch (error) {
      console.error('Error starting live tracking:', error);
      throw error;
    }
  }

  /**
   * Update driver location for a trip
   * @param {string} tripId - Trip identifier
   * @param {string} driverId - Driver identifier
   * @param {Object} location - Location data
   * @param {Object} options - Update options
   */
  async updateDriverLocation(tripId, driverId, location, options = {}) {
    try {
      // Validate location data
      if (!location.latitude || !location.longitude) {
        throw new Error('Invalid location coordinates');
      }

      // Get tracking data
      const trackingData = this.activeTrips.get(tripId);
      if (!trackingData) {
        throw new Error('Trip not being tracked');
      }

      // Verify driver
      if (trackingData.driverId !== driverId) {
        throw new Error('Driver not authorized for this trip');
      }

      // Create location update
      const locationUpdate = {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy || 10,
        speed: location.speed || 0,
        bearing: location.bearing || 0,
        altitude: location.altitude || null,
        timestamp: new Date().toISOString()
      };

      // Update tracking data
      trackingData.currentLocation = locationUpdate;
      trackingData.lastUpdate = new Date();

      // Add to location history
      trackingData.locationHistory.push(locationUpdate);

      // Limit location history size
      if (trackingData.locationHistory.length > trackingData.options.maxLocationHistory) {
        trackingData.locationHistory = trackingData.locationHistory.slice(-trackingData.options.maxLocationHistory);
      }

      // Calculate progress
      await this.calculateTripProgress(tripId, locationUpdate);

      // Check geofence triggers
      if (trackingData.options.enableGeofencing) {
        await this.checkGeofenceTriggers(tripId, locationUpdate);
      }

      // Update Redis
      if (this.redis) {
        await this.redis.set(
          `live_tracking:${tripId}`,
          JSON.stringify(trackingData),
          'EX',
          3600
        );
      }

      // Update Firestore
      await this.updateTrackingDocument(tripId, trackingData);

      // Send real-time update
      await this.realTimeService.sendLocationUpdate(tripId, driverId, locationUpdate, {
        progress: trackingData.progress,
        geofence: trackingData.geofence
      });

      console.log(`📍 Location updated for trip ${tripId}`);
      return true;

    } catch (error) {
      console.error('Error updating driver location:', error);
      return false;
    }
  }

  /**
   * Calculate trip progress based on current location
   * @param {string} tripId - Trip identifier
   * @param {Object} currentLocation - Current location
   */
  async calculateTripProgress(tripId, currentLocation) {
    try {
      const trackingData = this.activeTrips.get(tripId);
      if (!trackingData) return;

      const { pickup, dropoff } = trackingData.geofence;

      // Calculate distance to pickup
      const distanceToPickup = this.calculateHaversineDistance(
        currentLocation.latitude,
        currentLocation.longitude,
        pickup.center.latitude,
        pickup.center.longitude
      );

      // Calculate distance to dropoff
      const distanceToDropoff = this.calculateHaversineDistance(
        currentLocation.latitude,
        currentLocation.longitude,
        dropoff.center.latitude,
        dropoff.center.longitude
      );

      // Calculate ETA based on average speed
      const avgSpeed = this.calculateAverageSpeed(trackingData.locationHistory);
      const etaToPickup = avgSpeed > 0 ? Math.round((distanceToPickup / avgSpeed) * 60) : 0;
      const etaToDropoff = avgSpeed > 0 ? Math.round((distanceToDropoff / avgSpeed) * 60) : 0;

      // Update progress
      trackingData.progress = {
        distanceToPickup: Math.round(distanceToPickup * 1000) / 1000, // Round to 3 decimal places
        distanceToDropoff: Math.round(distanceToDropoff * 1000) / 1000,
        etaToPickup,
        etaToDropoff,
        isAtPickup: distanceToPickup <= pickup.radius,
        isAtDropoff: distanceToDropoff <= dropoff.radius,
        currentStage: this.determineCurrentStage(trackingData)
      };

      // Send ETA update if significant change
      if (this.shouldSendETAUpdate(tripId, trackingData.progress)) {
        await this.realTimeService.sendETAUpdate(tripId, trackingData.progress);
      }

    } catch (error) {
      console.error('Error calculating trip progress:', error);
    }
  }

  /**
   * Check geofence triggers
   * @param {string} tripId - Trip identifier
   * @param {Object} currentLocation - Current location
   */
  async checkGeofenceTriggers(tripId, currentLocation) {
    try {
      const trackingData = this.activeTrips.get(tripId);
      if (!trackingData) return;

      const { pickup, dropoff } = trackingData.geofence;

      // Check pickup geofence
      if (!pickup.triggered) {
        const distanceToPickup = this.calculateHaversineDistance(
          currentLocation.latitude,
          currentLocation.longitude,
          pickup.center.latitude,
          pickup.center.longitude
        );

        if (distanceToPickup <= pickup.radius) {
          pickup.triggered = true;
          pickup.triggeredAt = new Date().toISOString();

          // Send pickup arrival notification
          await this.realTimeService.sendTripStatusUpdate(tripId, 'driver_arrived_at_pickup', {
            location: currentLocation,
            triggeredAt: pickup.triggeredAt
          });

          console.log(`📍 Driver arrived at pickup for trip ${tripId}`);
        }
      }

      // Check dropoff geofence
      if (!dropoff.triggered) {
        const distanceToDropoff = this.calculateHaversineDistance(
          currentLocation.latitude,
          currentLocation.longitude,
          dropoff.center.latitude,
          dropoff.center.longitude
        );

        if (distanceToDropoff <= dropoff.radius) {
          dropoff.triggered = true;
          dropoff.triggeredAt = new Date().toISOString();

          // Send dropoff arrival notification
          await this.realTimeService.sendTripStatusUpdate(tripId, 'driver_arrived_at_dropoff', {
            location: currentLocation,
            triggeredAt: dropoff.triggeredAt
          });

          console.log(`📍 Driver arrived at dropoff for trip ${tripId}`);
        }
      }

    } catch (error) {
      console.error('Error checking geofence triggers:', error);
    }
  }

  /**
   * Start location monitoring for a trip
   * @param {string} tripId - Trip identifier
   */
  startLocationMonitoring(tripId) {
    try {
      const trackingData = this.activeTrips.get(tripId);
      if (!trackingData) return;

      const interval = setInterval(async () => {
        try {
          // Check if trip is still active
          if (!this.activeTrips.has(tripId)) {
            clearInterval(interval);
            return;
          }

          // Check for location timeout
          const lastUpdate = new Date(trackingData.lastUpdate);
          const now = new Date();
          const timeSinceUpdate = now - lastUpdate;

          if (timeSinceUpdate > 60000) { // 1 minute timeout
            console.warn(`⚠️ Location update timeout for trip ${tripId}`);
            
            // Send location timeout notification
            await this.realTimeService.sendTripStatusUpdate(tripId, 'location_timeout', {
              lastUpdate: trackingData.lastUpdate,
              timeoutDuration: timeSinceUpdate
            });
          }

        } catch (error) {
          console.error('Error in location monitoring:', error);
        }
      }, trackingData.options.updateInterval);

      // Store interval reference
      trackingData.monitoringInterval = interval;

    } catch (error) {
      console.error('Error starting location monitoring:', error);
    }
  }

  /**
   * Stop live tracking for a trip
   * @param {string} tripId - Trip identifier
   * @param {string} reason - Reason for stopping
   */
  async stopLiveTracking(tripId, reason = 'completed') {
    try {
      console.log(`🛑 Stopping live tracking for trip: ${tripId} - Reason: ${reason}`);

      const trackingData = this.activeTrips.get(tripId);
      if (!trackingData) {
        console.warn(`⚠️ Trip ${tripId} not being tracked`);
        return false;
      }

      // Clear monitoring interval
      if (trackingData.monitoringInterval) {
        clearInterval(trackingData.monitoringInterval);
      }

      // Update final status
      trackingData.status = 'tracking_stopped';
      trackingData.endTime = new Date();
      trackingData.stopReason = reason;

      // Remove from active trips
      this.activeTrips.delete(tripId);

      // Remove from Redis
      if (this.redis) {
        await this.redis.del(`live_tracking:${tripId}`);
      }

      // Update Firestore
      await this.updateTrackingDocument(tripId, trackingData);

      // Send tracking stopped notification
      await this.realTimeService.sendTripStatusUpdate(tripId, 'tracking_stopped', {
        reason,
        endTime: trackingData.endTime,
        totalDistance: this.calculateTotalDistance(trackingData.locationHistory),
        totalDuration: trackingData.endTime - trackingData.startTime
      });

      console.log(`✅ Live tracking stopped for trip: ${tripId}`);
      return true;

    } catch (error) {
      console.error('Error stopping live tracking:', error);
      return false;
    }
  }

  /**
   * Get live tracking data for a trip
   * @param {string} tripId - Trip identifier
   */
  async getLiveTrackingData(tripId) {
    try {
      // Try active trips first
      let trackingData = this.activeTrips.get(tripId);
      
      if (!trackingData && this.redis) {
        // Try Redis
        const cachedData = await this.redis.get(`live_tracking:${tripId}`);
        if (cachedData) {
          trackingData = JSON.parse(cachedData);
        }
      }

      if (!trackingData && this.db) {
        // Try Firestore
        const doc = await this.db.collection('liveTracking').doc(tripId).get();
        if (doc.exists) {
          trackingData = doc.data();
        }
      }

      return trackingData;

    } catch (error) {
      console.error('Error getting live tracking data:', error);
      return null;
    }
  }

  /**
   * Get all active trips
   */
  async getActiveTrips() {
    try {
      const activeTrips = [];
      
      for (const [tripId, trackingData] of this.activeTrips.entries()) {
        activeTrips.push({
          tripId,
          ...trackingData
        });
      }

      return activeTrips;

    } catch (error) {
      console.error('Error getting active trips:', error);
      return [];
    }
  }

  /**
   * Calculate Haversine distance between two points
   */
  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Calculate average speed from location history
   */
  calculateAverageSpeed(locationHistory) {
    if (locationHistory.length < 2) return 0;

    let totalSpeed = 0;
    let validSpeedCount = 0;

    for (let i = 1; i < locationHistory.length; i++) {
      const prev = locationHistory[i - 1];
      const curr = locationHistory[i];

      if (prev.speed && prev.speed > 0) {
        totalSpeed += prev.speed;
        validSpeedCount++;
      }
    }

    return validSpeedCount > 0 ? totalSpeed / validSpeedCount : 0;
  }

  /**
   * Determine current stage of the trip
   */
  determineCurrentStage(trackingData) {
    if (trackingData.progress.isAtDropoff) return 'at_dropoff';
    if (trackingData.progress.isAtPickup) return 'at_pickup';
    if (trackingData.geofence.pickup.triggered) return 'picked_up';
    return 'enroute';
  }

  /**
   * Check if ETA update should be sent
   */
  shouldSendETAUpdate(tripId, progress) {
    // Send ETA update if there's a significant change (>1 minute)
    const lastETA = this.lastETAUpdates.get(tripId);
    if (!lastETA) {
      this.lastETAUpdates.set(tripId, progress);
      return true;
    }

    const etaChange = Math.abs(progress.etaToPickup - lastETA.etaToPickup);
    if (etaChange > 1) {
      this.lastETAUpdates.set(tripId, progress);
      return true;
    }

    return false;
  }

  /**
   * Calculate total distance from location history
   */
  calculateTotalDistance(locationHistory) {
    if (locationHistory.length < 2) return 0;

    let totalDistance = 0;
    for (let i = 1; i < locationHistory.length; i++) {
      const prev = locationHistory[i - 1];
      const curr = locationHistory[i];
      
      totalDistance += this.calculateHaversineDistance(
        prev.latitude,
        prev.longitude,
        curr.latitude,
        curr.longitude
      );
    }

    return Math.round(totalDistance * 1000) / 1000; // Round to 3 decimal places
  }

  /**
   * Create tracking document in Firestore
   */
  async createTrackingDocument(tripId, trackingData) {
    try {
      if (!this.db) return;

      await this.db.collection('liveTracking').doc(tripId).set({
        ...trackingData,
        createdAt: new Date(),
        updatedAt: new Date()
      });

    } catch (error) {
      console.error('Error creating tracking document:', error);
    }
  }

  /**
   * Update tracking document in Firestore
   */
  async updateTrackingDocument(tripId, trackingData) {
    try {
      if (!this.db) return;

      await this.db.collection('liveTracking').doc(tripId).update({
        ...trackingData,
        updatedAt: new Date()
      });

    } catch (error) {
      console.error('Error updating tracking document:', error);
    }
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      const status = {
        service: 'LiveTrackingService',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        activeTrips: this.activeTrips.size,
        components: {
          firestore: this.db ? 'connected' : 'disconnected',
          redis: this.redis ? 'connected' : 'disconnected',
          realTimeService: this.realTimeService ? 'connected' : 'disconnected',
          socketIO: this.io ? 'connected' : 'disconnected'
        }
      };

      return status;

    } catch (error) {
      return {
        service: 'LiveTrackingService',
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = LiveTrackingService;
