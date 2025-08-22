const { getFirestore } = require('./firebase');
const axios = require('axios');
const { EventEmitter } = require('events');

/**
 * Real-time Tracking Service for EPickup delivery platform
 * Handles live location updates, trip progress, ETA calculations, and route optimization
 */
class TrackingService extends EventEmitter {
  constructor() {
    super();
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    this.activeTrips = new Map(); // tripId -> trip data
    this.locationSubscriptions = new Map(); // tripId -> subscription
    this.geofenceRadius = {
      pickup: 0.1, // 100 meters
      dropoff: 0.1 // 100 meters
    };
    this.updateInterval = 10000; // 10 seconds
    this.maxLocationHistory = 100; // Keep last 100 location points
  }

  get db() {
    return getFirestore();
  }

  /**
   * Start tracking a trip
   * @param {string} tripId - Trip identifier
   * @param {Object} tripData - Trip information
   * @returns {Object} Tracking status
   */
  async startTripTracking(tripId, tripData) {
    try {
      console.log(`🚀 Starting trip tracking for: ${tripId}`);

      // Validate trip data
      const validation = this.validateTripData(tripData);
      if (!validation.isValid) {
        throw new Error(`Invalid trip data: ${validation.errors.join(', ')}`);
      }

      // Initialize trip tracking
      const trackingData = {
        tripId,
        bookingId: tripData.bookingId,
        driverId: tripData.driverId,
        customerId: tripData.customerId,
        status: 'tracking_started',
        startTime: new Date(),
        lastUpdate: new Date(),
        currentLocation: null,
        locations: [],
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
            radius: this.geofenceRadius.pickup,
            triggered: false,
            triggeredAt: null
          },
          dropoff: {
            center: tripData.dropoff.coordinates,
            radius: this.geofenceRadius.dropoff,
            triggered: false,
            triggeredAt: null
          }
        }
      };

      // Store in active trips
      this.activeTrips.set(tripId, trackingData);

      // Create trip tracking document in Firestore
      await this.createTripTrackingDocument(tripId, trackingData);

      // Start location updates
      await this.startLocationUpdates(tripId, tripData);

      // Calculate initial route
      await this.calculateRoute(tripId, tripData);

      console.log(`✅ Trip tracking started for: ${tripId}`);
      
      // Emit tracking started event
      this.emit('tripStarted', { tripId, trackingData });

      return {
        success: true,
        message: 'Trip tracking started successfully',
        data: {
          tripId,
          status: 'tracking_started',
          startTime: trackingData.startTime
        }
      };

    } catch (error) {
      console.error(`❌ Failed to start trip tracking for ${tripId}:`, error.message);
      throw error;
    }
  }

  /**
   * Update driver location for a trip
   * @param {string} tripId - Trip identifier
   * @param {Object} location - Location data
   * @returns {Object} Update status
   */
  async updateDriverLocation(tripId, location) {
    try {
      const trip = this.activeTrips.get(tripId);
      if (!trip) {
        throw new Error(`Trip ${tripId} not found in active tracking`);
      }

      // Validate location data
      const validation = this.validateLocationData(location);
      if (!validation.isValid) {
        throw new Error(`Invalid location data: ${validation.errors.join(', ')}`);
      }

      // Update current location
      trip.currentLocation = {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy || 10,
        timestamp: new Date(),
        speed: location.speed || 0,
        heading: location.heading || 0
      };

      // Add to location history
      trip.locations.push({
        ...trip.currentLocation,
        index: trip.locations.length
      });

      // Keep only recent locations
      if (trip.locations.length > this.maxLocationHistory) {
        trip.locations = trip.locations.slice(-this.maxLocationHistory);
      }

      // Update progress
      await this.updateTripProgress(tripId);

      // Check geofence triggers
      await this.checkGeofenceTriggers(tripId);

      // Update last update time
      trip.lastUpdate = new Date();

      // Update Firestore
      await this.updateTripTrackingDocument(tripId, trip);

      // Emit location update event
      this.emit('locationUpdated', { tripId, location: trip.currentLocation, progress: trip.progress });

      return {
        success: true,
        message: 'Location updated successfully',
        data: {
          tripId,
          location: trip.currentLocation,
          progress: trip.progress
        }
      };

    } catch (error) {
      console.error(`❌ Failed to update location for trip ${tripId}:`, error.message);
      throw error;
    }
  }

  /**
   * Update trip progress based on current location
   * @param {string} tripId - Trip identifier
   */
  async updateTripProgress(tripId) {
    try {
      const trip = this.activeTrips.get(tripId);
      if (!trip || !trip.currentLocation) return;

      const currentLocation = trip.currentLocation;
      const pickupLocation = trip.geofence.pickup.center;
      const dropoffLocation = trip.geofence.dropoff.center;

      // Calculate distances
      const distanceToPickup = this.calculateHaversineDistance(
        currentLocation.latitude, currentLocation.longitude,
        pickupLocation.latitude, pickupLocation.longitude
      );

      const distanceToDropoff = this.calculateHaversineDistance(
        currentLocation.latitude, currentLocation.longitude,
        dropoffLocation.latitude, dropoffLocation.longitude
      );

      // Calculate ETAs
      const etaToPickup = this.calculateETA(distanceToPickup, '2_wheeler');
      const etaToDropoff = this.calculateETA(distanceToDropoff, '2_wheeler');

      // Update progress
      trip.progress = {
        distanceToPickup: Math.round(distanceToPickup * 1000) / 1000, // 3 decimal places
        distanceToDropoff: Math.round(distanceToDropoff * 1000) / 1000,
        etaToPickup: Math.round(etaToPickup),
        etaToDropoff: Math.round(etaToDropoff),
        isAtPickup: distanceToPickup <= this.geofenceRadius.pickup,
        isAtDropoff: distanceToDropoff <= this.geofenceRadius.dropoff,
        currentStage: this.determineCurrentStage(trip)
      };

      // Update route if needed
      if (trip.route.polyline) {
        await this.updateRouteProgress(tripId);
      }

    } catch (error) {
      console.error(`❌ Failed to update trip progress for ${tripId}:`, error.message);
    }
  }

  /**
   * Check geofence triggers for pickup and dropoff
   * @param {string} tripId - Trip identifier
   */
  async checkGeofenceTriggers(tripId) {
    try {
      const trip = this.activeTrips.get(tripId);
      if (!trip || !trip.currentLocation) return;

      const currentLocation = trip.currentLocation;

      // Check pickup geofence
      if (!trip.geofence.pickup.triggered) {
        const distanceToPickup = this.calculateHaversineDistance(
          currentLocation.latitude, currentLocation.longitude,
          trip.geofence.pickup.center.latitude, trip.geofence.pickup.center.longitude
        );

        if (distanceToPickup <= this.geofenceRadius.pickup) {
          trip.geofence.pickup.triggered = true;
          trip.geofence.pickup.triggeredAt = new Date();
          
          console.log(`📍 Driver arrived at pickup location for trip: ${tripId}`);
          this.emit('geofenceTriggered', { tripId, type: 'pickup', location: currentLocation });
        }
      }

      // Check dropoff geofence
      if (!trip.geofence.dropoff.triggered && trip.geofence.pickup.triggered) {
        const distanceToDropoff = this.calculateHaversineDistance(
          currentLocation.latitude, currentLocation.longitude,
          trip.geofence.dropoff.center.latitude, trip.geofence.dropoff.center.longitude
        );

        if (distanceToDropoff <= this.geofenceRadius.dropoff) {
          trip.geofence.dropoff.triggered = true;
          trip.geofence.dropoff.triggeredAt = new Date();
          
          console.log(`🎯 Driver arrived at dropoff location for trip: ${tripId}`);
          this.emit('geofenceTriggered', { tripId, type: 'dropoff', location: currentLocation });
        }
      }

    } catch (error) {
      console.error(`❌ Failed to check geofence triggers for ${tripId}:`, error.message);
    }
  }

  /**
   * Calculate route using Google Maps Directions API
   * @param {string} tripId - Trip identifier
   * @param {Object} tripData - Trip information
   */
  async calculateRoute(tripId, tripData) {
    try {
      if (!this.googleMapsApiKey) {
        console.warn('⚠️ Google Maps API key not configured, using fallback route calculation');
        return;
      }

      const origin = tripData.driverLocation || tripData.pickup.coordinates;
      const destination = tripData.dropoff.coordinates;
      const waypoints = [tripData.pickup.coordinates];

      const url = `https://maps.googleapis.com/maps/api/directions/json`;
      const params = {
        origin: `${origin.latitude},${origin.longitude}`,
        destination: `${destination.latitude},${destination.longitude}`,
        waypoints: `optimize:true|${waypoints.map(wp => `${wp.latitude},${wp.longitude}`).join('|')}`,
        key: this.googleMapsApiKey,
        mode: 'driving',
        units: 'metric'
      };

      const response = await axios.get(url, { params });
      
      if (response.data.status === 'OK' && response.data.routes.length > 0) {
        const route = response.data.routes[0];
        const leg = route.legs[0];

        const trip = this.activeTrips.get(tripId);
        if (trip) {
          trip.route = {
            polyline: route.overview_polyline.points,
            distance: leg.distance.value / 1000, // Convert to km
            duration: Math.round(leg.duration.value / 60), // Convert to minutes
            waypoints: waypoints,
            googleRouteId: route.overview_polyline.points.substring(0, 10)
          };

          console.log(`🗺️ Route calculated for trip ${tripId}: ${trip.route.distance.toFixed(2)}km, ${trip.route.duration}min`);
        }
      }

    } catch (error) {
      console.error(`❌ Failed to calculate route for trip ${tripId}:`, error.message);
      // Fallback to direct distance calculation
      await this.calculateFallbackRoute(tripId, tripData);
    }
  }

  /**
   * Calculate fallback route using direct distance
   * @param {string} tripId - Trip identifier
   * @param {Object} tripData - Trip information
   */
  async calculateFallbackRoute(tripId, tripData) {
    try {
      const trip = this.activeTrips.get(tripId);
      if (!trip) return;

      const pickupToDropoff = this.calculateHaversineDistance(
        tripData.pickup.coordinates.latitude, tripData.pickup.coordinates.longitude,
        tripData.dropoff.coordinates.latitude, tripData.dropoff.coordinates.longitude
      );

      trip.route = {
        polyline: null,
        distance: Math.round(pickupToDropoff * 1000) / 1000,
        duration: Math.round(this.calculateETA(pickupToDropoff, '2_wheeler')),
        waypoints: [tripData.pickup.coordinates],
        googleRouteId: null
      };

      console.log(`🗺️ Fallback route calculated for trip ${tripId}: ${trip.route.distance.toFixed(2)}km, ${trip.route.duration}min`);

    } catch (error) {
      console.error(`❌ Failed to calculate fallback route for trip ${tripId}:`, error.message);
    }
  }

  /**
   * Update route progress based on current location
   * @param {string} tripId - Trip identifier
   */
  async updateRouteProgress(tripId) {
    try {
      const trip = this.activeTrips.get(tripId);
      if (!trip || !trip.route.polyline || !trip.currentLocation) return;

      // For now, we'll use the progress we already calculated
      // In a more advanced implementation, you could decode the polyline
      // and calculate the exact progress along the route
      
      // This could involve:
      // 1. Decoding the polyline to get route waypoints
      // 2. Finding the closest point on the route to current location
      // 3. Calculating progress percentage along the route
      
      // For simplicity, we're using the direct distance calculations
      // from updateTripProgress method

    } catch (error) {
      console.error(`❌ Failed to update route progress for trip ${tripId}:`, error.message);
    }
  }

  /**
   * Get current trip status and progress
   * @param {string} tripId - Trip identifier
   * @returns {Object} Trip status and progress
   */
  async getTripStatus(tripId) {
    try {
      const trip = this.activeTrips.get(tripId);
      if (!trip) {
        throw new Error(`Trip ${tripId} not found`);
      }

      return {
        success: true,
        message: 'Trip status retrieved successfully',
        data: {
          tripId,
          status: trip.status,
          currentLocation: trip.currentLocation,
          progress: trip.progress,
          route: trip.route,
          geofence: trip.geofence,
          lastUpdate: trip.lastUpdate,
          startTime: trip.startTime
        }
      };

    } catch (error) {
      console.error(`❌ Failed to get trip status for ${tripId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get trip location history
   * @param {string} tripId - Trip identifier
   * @param {Object} options - Query options
   * @returns {Object} Location history
   */
  async getTripLocationHistory(tripId, options = {}) {
    try {
      const trip = this.activeTrips.get(tripId);
      if (!trip) {
        throw new Error(`Trip ${tripId} not found`);
      }

      const { limit = 50, startTime, endTime } = options;
      let locations = [...trip.locations];

      // Filter by time range if specified
      if (startTime || endTime) {
        locations = locations.filter(location => {
          const timestamp = location.timestamp;
          if (startTime && timestamp < startTime) return false;
          if (endTime && timestamp > endTime) return false;
          return true;
        });
      }

      // Apply limit
      locations = locations.slice(-limit);

      return {
        success: true,
        message: 'Location history retrieved successfully',
        data: {
          tripId,
          locations,
          total: locations.length,
          startTime: trip.startTime,
          lastUpdate: trip.lastUpdate
        }
      };

    } catch (error) {
      console.error(`❌ Failed to get location history for trip ${tripId}:`, error.message);
      throw error;
    }
  }

  /**
   * Stop tracking a trip
   * @param {string} tripId - Trip identifier
   * @param {string} reason - Reason for stopping
   * @returns {Object} Stop status
   */
  async stopTripTracking(tripId, reason = 'completed') {
    try {
      console.log(`🛑 Stopping trip tracking for: ${tripId} (Reason: ${reason})`);

      const trip = this.activeTrips.get(tripId);
      if (!trip) {
        throw new Error(`Trip ${tripId} not found in active tracking`);
      }

      // Update final status
      trip.status = 'tracking_stopped';
      trip.endTime = new Date();
      trip.stopReason = reason;
      trip.lastUpdate = new Date();

      // Stop location updates
      this.stopLocationUpdates(tripId);

      // Update Firestore
      await this.updateTripTrackingDocument(tripId, trip);

      // Remove from active trips
      this.activeTrips.delete(tripId);

      // Emit tracking stopped event
      this.emit('tripStopped', { tripId, reason, trip });

      console.log(`✅ Trip tracking stopped for: ${tripId}`);

      return {
        success: true,
        message: 'Trip tracking stopped successfully',
        data: {
          tripId,
          status: 'tracking_stopped',
          endTime: trip.endTime,
          reason: reason
        }
      };

    } catch (error) {
      console.error(`❌ Failed to stop trip tracking for ${tripId}:`, error.message);
      throw error;
    }
  }

  /**
   * Start location updates for a trip
   * @param {string} tripId - Trip identifier
   * @param {Object} tripData - Trip information
   */
  async startLocationUpdates(tripId, tripData) {
    try {
      // In a real implementation, this would integrate with the driver app
      // to receive location updates via WebSocket or HTTP
      
      // For now, we'll simulate location updates
      const interval = setInterval(async () => {
        try {
          // Simulate driver movement towards pickup/dropoff
          const simulatedLocation = this.simulateDriverMovement(tripId, tripData);
          if (simulatedLocation) {
            await this.updateDriverLocation(tripId, simulatedLocation);
          }
        } catch (error) {
          console.error(`❌ Error in location update simulation for trip ${tripId}:`, error.message);
        }
      }, this.updateInterval);

      // Store the interval reference
      this.locationSubscriptions.set(tripId, interval);

    } catch (error) {
      console.error(`❌ Failed to start location updates for trip ${tripId}:`, error.message);
    }
  }

  /**
   * Stop location updates for a trip
   * @param {string} tripId - Trip identifier
   */
  stopLocationUpdates(tripId) {
    try {
      const interval = this.locationSubscriptions.get(tripId);
      if (interval) {
        clearInterval(interval);
        this.locationSubscriptions.delete(tripId);
        console.log(`📍 Location updates stopped for trip: ${tripId}`);
      }
    } catch (error) {
      console.error(`❌ Failed to stop location updates for trip ${tripId}:`, error.message);
    }
  }

  /**
   * Simulate driver movement for testing purposes
   * @param {string} tripId - Trip identifier
   * @param {Object} tripData - Trip information
   * @returns {Object|null} Simulated location or null
   */
  simulateDriverMovement(tripId, tripData) {
    try {
      const trip = this.activeTrips.get(tripId);
      if (!trip || !trip.currentLocation) return null;

      // Simple simulation: move towards pickup first, then dropoff
      const currentLocation = trip.currentLocation;
      let targetLocation;

      if (!trip.geofence.pickup.triggered) {
        targetLocation = trip.geofence.pickup.center;
      } else if (!trip.geofence.dropoff.triggered) {
        targetLocation = trip.geofence.dropoff.center;
      } else {
        return null; // Trip completed
      }

      // Calculate direction vector
      const latDiff = targetLocation.latitude - currentLocation.latitude;
      const lngDiff = targetLocation.longitude - currentLocation.longitude;
      const distance = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);

      if (distance < 0.001) return null; // Very close to target

      // Move towards target (simulate 10-20 meters per update)
      const moveDistance = 0.0001 + Math.random() * 0.0001; // 10-20 meters
      const ratio = moveDistance / distance;

      const newLat = currentLocation.latitude + (latDiff * ratio);
      const newLng = currentLocation.longitude + (lngDiff * ratio);

      return {
        latitude: newLat,
        longitude: newLng,
        accuracy: 5 + Math.random() * 10,
        speed: 5 + Math.random() * 15, // 5-20 km/h
        heading: Math.atan2(lngDiff, latDiff) * 180 / Math.PI
      };

    } catch (error) {
      console.error(`❌ Failed to simulate driver movement for trip ${tripId}:`, error.message);
      return null;
    }
  }

  /**
   * Get all active trips
   * @returns {Array} List of active trips
   */
  getActiveTrips() {
    return Array.from(this.activeTrips.values());
  }

  /**
   * Get trip analytics
   * @param {string} tripId - Trip identifier
   * @returns {Object} Trip analytics
   */
  async getTripAnalytics(tripId) {
    try {
      const trip = this.activeTrips.get(tripId);
      if (!trip) {
        throw new Error(`Trip ${tripId} not found`);
      }

      const locations = trip.locations;
      if (locations.length < 2) {
        return {
          success: true,
          message: 'Insufficient data for analytics',
          data: { tripId, analytics: null }
        };
      }

      // Calculate analytics
      const totalDistance = this.calculateTotalDistance(locations);
      const averageSpeed = this.calculateAverageSpeed(locations);
      const totalTime = (trip.lastUpdate - trip.startTime) / 1000 / 60; // minutes
      const stops = this.detectStops(locations);

      const analytics = {
        totalDistance: Math.round(totalDistance * 1000) / 1000, // km
        averageSpeed: Math.round(averageSpeed * 100) / 100, // km/h
        totalTime: Math.round(totalTime), // minutes
        stops: stops.length,
        efficiency: Math.round((trip.route.distance / totalDistance) * 100), // %
        locationUpdates: locations.length,
        lastUpdate: trip.lastUpdate
      };

      return {
        success: true,
        message: 'Trip analytics retrieved successfully',
        data: { tripId, analytics }
      };

    } catch (error) {
      console.error(`❌ Failed to get trip analytics for ${tripId}:`, error.message);
      throw error;
    }
  }

  /**
   * Calculate total distance from location history
   * @param {Array} locations - Location history
   * @returns {number} Total distance in km
   */
  calculateTotalDistance(locations) {
    let totalDistance = 0;
    
    for (let i = 1; i < locations.length; i++) {
      const prev = locations[i - 1];
      const curr = locations[i];
      
      totalDistance += this.calculateHaversineDistance(
        prev.latitude, prev.longitude,
        curr.latitude, curr.longitude
      );
    }
    
    return totalDistance;
  }

  /**
   * Calculate average speed from location history
   * @param {Array} locations - Location history
   * @returns {number} Average speed in km/h
   */
  calculateAverageSpeed(locations) {
    if (locations.length < 2) return 0;
    
    const totalDistance = this.calculateTotalDistance(locations);
    const totalTime = (locations[locations.length - 1].timestamp - locations[0].timestamp) / 1000 / 3600; // hours
    
    return totalTime > 0 ? totalDistance / totalTime : 0;
  }

  /**
   * Detect stops in location history
   * @param {Array} locations - Location history
   * @returns {Array} Array of stop locations
   */
  detectStops(locations) {
    const stops = [];
    const stopThreshold = 0.001; // 1 meter
    const timeThreshold = 30000; // 30 seconds
    
    for (let i = 1; i < locations.length; i++) {
      const prev = locations[i - 1];
      const curr = locations[i];
      
      const distance = this.calculateHaversineDistance(
        prev.latitude, prev.longitude,
        curr.latitude, curr.longitude
      );
      
      const timeDiff = curr.timestamp - prev.timestamp;
      
      if (distance < stopThreshold && timeDiff > timeThreshold) {
        stops.push({
          location: curr,
          duration: timeDiff / 1000, // seconds
          index: i
        });
      }
    }
    
    return stops;
  }

  /**
   * Determine current trip stage
   * @param {Object} trip - Trip data
   * @returns {string} Current stage
   */
  determineCurrentStage(trip) {
    if (!trip.geofence.pickup.triggered) {
      return 'enroute';
    } else if (trip.geofence.pickup.triggered && !trip.geofence.dropoff.triggered) {
      return 'at_pickup';
    } else if (trip.geofence.dropoff.triggered) {
      return 'at_dropoff';
    }
    return 'enroute';
  }

  /**
   * Validate trip data
   * @param {Object} tripData - Trip data to validate
   * @returns {Object} Validation result
   */
  validateTripData(tripData) {
    const errors = [];
    
    if (!tripData.bookingId) errors.push('bookingId is required');
    if (!tripData.driverId) errors.push('driverId is required');
    if (!tripData.customerId) errors.push('customerId is required');
    if (!tripData.pickup?.coordinates) errors.push('pickup coordinates are required');
    if (!tripData.dropoff?.coordinates) errors.push('dropoff coordinates are required');
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate location data
   * @param {Object} location - Location data to validate
   * @returns {Object} Validation result
   */
  validateLocationData(location) {
    const errors = [];
    
    if (typeof location.latitude !== 'number' || location.latitude < -90 || location.latitude > 90) {
      errors.push('latitude must be a valid number between -90 and 90');
    }
    if (typeof location.longitude !== 'number' || location.longitude < -180 || location.longitude > 180) {
      errors.push('longitude must be a valid number between -180 and 180');
    }
    if (location.accuracy && (typeof location.accuracy !== 'number' || location.accuracy < 0)) {
      errors.push('accuracy must be a positive number');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Calculate Haversine distance between two points
   * @param {number} lat1 - First latitude
   * @param {number} lon1 - First longitude
   * @param {number} lat2 - Second latitude
   * @param {number} lon2 - Second longitude
   * @returns {number} Distance in kilometers
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
   * Calculate ETA based on distance and vehicle type
   * @param {number} distance - Distance in kilometers
   * @param {string} vehicleType - Vehicle type
   * @returns {number} ETA in minutes
   */
  calculateETA(distance, vehicleType) {
    // Only 2-wheeler speeds supported
    const speeds = {
      '2_wheeler': 25,    // km/h
      'motorcycle': 25,   // km/h
      'scooter': 20,      // km/h
      'electric': 20      // km/h
    };
    
    const speed = speeds[vehicleType] || 25; // default to 2-wheeler speed
    const timeInHours = distance / speed;
    const timeInMinutes = Math.round(timeInHours * 60);
    const bufferTime = Math.round(timeInMinutes * 0.2); // 20% buffer
    
    return timeInMinutes + bufferTime;
  }

  /**
   * Create trip tracking document in Firestore
   * @param {string} tripId - Trip identifier
   * @param {Object} trackingData - Tracking data
   */
  async createTripTrackingDocument(tripId, trackingData) {
    try {
      const tripTrackingRef = this.db.collection('tripTracking').doc(tripId);
      await tripTrackingRef.set(trackingData);
      console.log(`📝 Trip tracking document created for: ${tripId}`);
    } catch (error) {
      console.error(`❌ Failed to create trip tracking document for ${tripId}:`, error.message);
      throw error;
    }
  }

  /**
   * Update trip tracking document in Firestore
   * @param {string} tripId - Trip identifier
   * @param {Object} trackingData - Updated tracking data
   */
  async updateTripTrackingDocument(tripId, trackingData) {
    try {
      const tripTrackingRef = this.db.collection('tripTracking').doc(tripId);
      await tripTrackingRef.update({
        currentLocation: trackingData.currentLocation,
        locations: trackingData.locations,
        progress: trackingData.progress,
        route: trackingData.route,
        geofence: trackingData.geofence,
        lastUpdate: trackingData.lastUpdate,
        status: trackingData.status
      });
    } catch (error) {
      console.error(`❌ Failed to update trip tracking document for ${tripId}:`, error.message);
      throw error;
    }
  }

  /**
   * Get tracking statistics
   * @returns {Object} Tracking statistics
   */
  getTrackingStatistics() {
    const activeTrips = this.activeTrips.size;
    const totalSubscriptions = this.locationSubscriptions.size;
    
    return {
      activeTrips,
      totalSubscriptions,
      totalEvents: this.listenerCount('tripStarted') + this.listenerCount('locationUpdated') + this.listenerCount('tripStopped'),
      uptime: process.uptime()
    };
  }

  /**
   * Clean up expired trips
   * @param {number} maxAge - Maximum age in milliseconds
   */
  async cleanupExpiredTrips(maxAge = 24 * 60 * 60 * 1000) { // 24 hours
    try {
      const now = Date.now();
      const expiredTrips = [];
      
      for (const [tripId, trip] of this.activeTrips.entries()) {
        if (now - trip.lastUpdate.getTime() > maxAge) {
          expiredTrips.push(tripId);
        }
      }
      
      for (const tripId of expiredTrips) {
        await this.stopTripTracking(tripId, 'expired');
      }
      
      if (expiredTrips.length > 0) {
        console.log(`🧹 Cleaned up ${expiredTrips.length} expired trips`);
      }
      
    } catch (error) {
      console.error('❌ Failed to cleanup expired trips:', error.message);
    }
  }
}

module.exports = TrackingService;
