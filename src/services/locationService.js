const { getFirestore } = require('./firebase');
const monitoringService = require('./monitoringService');

/**
 * Enhanced Location and Distance Service
 * Handles location validation, distance calculations, and Google Maps API fallbacks
 */
class LocationService {
  constructor() {
    this.db = null; // Initialize lazily
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
    this.maxRetries = 3;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get Firestore instance (lazy initialization)
   */
  getDb() {
    if (!this.db) {
      try {
        this.db = getFirestore();
      } catch (error) {
        console.error('❌ [LocationService] Failed to get Firestore:', error);
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using LocationService.');
      }
    }
    return this.db;
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   * @param {Object} coord1 - First coordinate {lat, lng}
   * @param {Object} coord2 - Second coordinate {lat, lng}
   * @returns {number} Distance in meters
   */
  calculateHaversineDistance(coord1, coord2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = coord1.lat * Math.PI / 180;
    const φ2 = coord2.lat * Math.PI / 180;
    const Δφ = (coord2.lat - coord1.lat) * Math.PI / 180;
    const Δλ = (coord2.lng - coord1.lng) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Calculate distance with Google Maps API (with fallback)
   * @param {Object} origin - Origin coordinates
   * @param {Object} destination - Destination coordinates
   * @param {Object} options - Calculation options
   * @returns {Promise<Object>} Distance and duration
   */
  async calculateDistance(origin, destination, options = {}) {
    const cacheKey = `distance_${origin.lat}_${origin.lng}_${destination.lat}_${destination.lng}`;
    
    // Check cache first
    const cached = this.getCachedResult(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Try Google Maps API first
      const result = await this.calculateDistanceWithGoogleMaps(origin, destination, options);
      this.setCachedResult(cacheKey, result);
      return result;
    } catch (error) {
      console.warn('⚠️ Google Maps API failed, using Haversine fallback:', error.message);
      
      // Fallback to Haversine calculation
      const distance = this.calculateHaversineDistance(origin, destination);
      const result = {
        distance: {
          value: distance,
          text: `${Math.round(distance / 1000 * 100) / 100} km`
        },
        duration: {
          value: this.estimateDuration(distance),
          text: `${Math.round(this.estimateDuration(distance) / 60)} min`
        },
        method: 'haversine_fallback'
      };

      this.setCachedResult(cacheKey, result);
      return result;
    }
  }

  /**
   * Calculate distance using Google Maps Distance Matrix API
   * @param {Object} origin - Origin coordinates
   * @param {Object} destination - Destination coordinates
   * @param {Object} options - API options
   * @returns {Promise<Object>} Distance and duration
   */
  async calculateDistanceWithGoogleMaps(origin, destination, options = {}) {
    if (!this.googleMapsApiKey) {
      throw new Error('Google Maps API key not configured');
    }

    const params = new URLSearchParams({
      origins: `${origin.lat},${origin.lng}`,
      destinations: `${destination.lat},${destination.lng}`,
      key: this.googleMapsApiKey,
      units: 'metric',
      mode: options.mode || 'driving',
      traffic_model: options.trafficModel || 'best_guess',
      departure_time: options.departureTime || 'now'
    });

    const response = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Google Maps API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.status !== 'OK') {
      throw new Error(`Google Maps API error: ${data.status}`);
    }

    const element = data.rows[0]?.elements[0];
    if (!element || element.status !== 'OK') {
      throw new Error(`Google Maps API error: ${element?.status || 'No data'}`);
    }

    return {
      distance: element.distance,
      duration: element.duration,
      method: 'google_maps'
    };
  }

  /**
   * Estimate duration based on distance
   * @param {number} distance - Distance in meters
   * @returns {number} Duration in seconds
   */
  estimateDuration(distance) {
    const averageSpeed = 30; // km/h
    const speedMs = averageSpeed * 1000 / 3600; // m/s
    return Math.round(distance / speedMs);
  }

  /**
   * Validate coordinates
   * @param {Object} coords - Coordinates {lat, lng}
   * @returns {Object} Validation result
   */
  validateCoordinates(coords) {
    const { lat, lng } = coords;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return {
        isValid: false,
        error: 'Coordinates must be numbers'
      };
    }

    if (lat < -90 || lat > 90) {
      return {
        isValid: false,
        error: 'Latitude must be between -90 and 90'
      };
    }

    if (lng < -180 || lng > 180) {
      return {
        isValid: false,
        error: 'Longitude must be between -180 and 180'
      };
    }

    return { isValid: true };
  }

  /**
   * Check if location is within service area
   * @param {Object} coords - Coordinates {lat, lng}
   * @param {Object} serviceArea - Service area configuration
   * @returns {Object} Validation result
   */
  isWithinServiceArea(coords, serviceArea) {
    const validation = this.validateCoordinates(coords);
    if (!validation.isValid) {
      return validation;
    }

    // Simple circular service area check
    const center = serviceArea.center;
    const radius = serviceArea.radius * 1000; // Convert km to meters

    const distance = this.calculateHaversineDistance(center, coords);

    return {
      isValid: distance <= radius,
      distance: distance,
      maxDistance: radius
    };
  }

  /**
   * Find nearby drivers with optimized query
   * @param {Object} pickupLocation - Pickup coordinates
   * @param {number} maxDistance - Maximum distance in meters
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Nearby drivers
   */
  async findNearbyDrivers(pickupLocation, maxDistance = 10000, options = {}) {
    try {
      const { limit = 50, includeOffline = false } = options;

      // Build query constraints
      const constraints = [
        ['driver.isAvailable', '==', true],
        ['driver.isOnline', '==', true]
      ];

      if (!includeOffline) {
        constraints.push(['driver.lastSeen', '>=', new Date(Date.now() - 30 * 60 * 1000)]); // 30 minutes
      }

      // Get drivers with basic filters
      let query = this.db.collection('users');
      constraints.forEach(([field, operator, value]) => {
        query = query.where(field, operator, value);
      });

      const driversSnapshot = await query.limit(limit).get();
      const nearbyDrivers = [];

      for (const doc of driversSnapshot.docs) {
        const driver = { id: doc.id, ...doc.data() };
        
        if (driver.driver?.currentLocation) {
          const distance = this.calculateHaversineDistance(
            pickupLocation,
            driver.driver.currentLocation
          );

          if (distance <= maxDistance) {
            nearbyDrivers.push({
              ...driver,
              distanceFromPickup: distance
            });
          }
        }
      }

      // Sort by distance
      nearbyDrivers.sort((a, b) => a.distanceFromPickup - b.distanceFromPickup);

      // Record metric for nearby drivers found
      monitoringService.recordMetric('nearby_drivers_found', nearbyDrivers.length, {
        maxDistance,
        totalDriversChecked: driversSnapshot.size
      });

      return nearbyDrivers;
    } catch (error) {
      console.error('❌ Error in LocationService.findNearbyDrivers:', error);
      throw error;
    }
  }

  /**
   * Throttle location updates to prevent overload
   * @param {string} driverId - Driver ID
   * @param {Object} location - Location data
   * @param {number} throttleMs - Throttle interval in milliseconds
   * @returns {Promise<boolean>} Whether update should proceed
   */
  /**
   * ✅ INDUSTRY STANDARD: Adaptive throttling based on trip status and speed
   * Matches Zomato/Uber/Porter standards:
   * - Active trip + moving: 3-5 seconds
   * - Active trip + stationary: 10-15 seconds
   * - No active trip: 30-60 seconds
   */
  async shouldUpdateLocation(driverId, location, throttleMs = 30000) {
    const lastUpdateKey = `location_update_${driverId}`;
    const lastUpdate = this.cache.get(lastUpdateKey);

    // ✅ CRITICAL FIX: Check if driver has active booking for adaptive throttling
    let adaptiveThrottleMs = throttleMs;
    try {
      const activeBookingStatuses = ['driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff'];
      const activeBooking = await this.db.collection('bookings')
        .where('driverId', '==', driverId)
        .where('status', 'in', activeBookingStatuses)
        .limit(1)
        .get();

      if (!activeBooking.empty) {
        // ✅ Driver has active trip - use aggressive throttling
        const speed = location.speed || 0; // m/s
        const speedKmh = speed * 3.6; // Convert to km/h

        if (speedKmh > 20) {
          // Fast movement (>20 km/h): 3 seconds (matches Uber/Zomato)
          adaptiveThrottleMs = 3000;
        } else if (speedKmh > 5) {
          // Normal movement (5-20 km/h): 5 seconds
          adaptiveThrottleMs = 5000;
        } else {
          // Stationary (<5 km/h): 15 seconds
          adaptiveThrottleMs = 15000;
        }

        console.log(`📍 [LOCATION_SERVICE] Adaptive throttle for active trip: ${adaptiveThrottleMs}ms (speed: ${speedKmh.toFixed(1)} km/h)`);
      } else {
        // ✅ No active trip - use conservative throttling (30 seconds)
        adaptiveThrottleMs = 30000;
      }
    } catch (error) {
      console.warn('⚠️ [LOCATION_SERVICE] Error checking active booking, using default throttle:', error);
      // Use provided throttle as fallback
    }

    if (lastUpdate && (Date.now() - lastUpdate) < adaptiveThrottleMs) {
      return false;
    }

    this.cache.set(lastUpdateKey, Date.now());
    return true;
  }

  /**
   * Update driver location with throttling
   * @param {string} driverId - Driver ID
   * @param {Object} location - Location data
   * @param {Object} options - Update options
   * @returns {Promise<Object>} Update result
   */
  /**
   * ✅ INDUSTRY STANDARD: Update driver location with adaptive throttling
   * Automatically adjusts throttle based on trip status and speed
   */
  async updateDriverLocation(driverId, location, options = {}) {
    const { throttleMs = null, forceUpdate = false } = options; // null = auto-detect

    // ✅ CRITICAL FIX: Use adaptive throttling (trip status + speed aware)
    // If throttleMs not provided, shouldUpdateLocation will auto-detect optimal throttle
    if (!forceUpdate && !(await this.shouldUpdateLocation(driverId, location, throttleMs || 30000))) {
      return {
        success: true,
        skipped: true,
        reason: 'Throttled (adaptive)'
      };
    }

    try {
      const locationData = {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy || 0,
        address: location.address || 'Current Location',
        timestamp: new Date()
      };

      // ✅ CRITICAL FIX: Check if driver has active booking to include in location update
      const activeBookingStatuses = ['driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff'];
      const activeBooking = await this.db.collection('bookings')
        .where('driverId', '==', driverId)
        .where('status', 'in', activeBookingStatuses)
        .limit(1)
        .get();

      const currentBookingId = activeBooking.empty ? null : activeBooking.docs[0].id;

      // Update driver location in users collection
      await this.db.collection('users').doc(driverId).update({
        'driver.currentLocation': locationData,
        'driver.lastSeen': new Date(),
        updatedAt: new Date()
      });

      // ✅ CRITICAL FIX: Update driverLocations collection with booking context
      await this.db.collection('driverLocations').doc(driverId).set({
        driverId,
        currentLocation: locationData,
        currentTripId: currentBookingId, // ✅ Include active booking ID
        lastUpdated: new Date()
      }, { merge: true });

      // ✅ CRITICAL FIX: If driver has active booking, notify customer via WebSocket
      if (currentBookingId) {
        try {
          const bookingData = activeBooking.docs[0].data();
          const socketService = require('../services/socket');
          const io = socketService.getSocketIO();
          
          if (io && bookingData.customerId) {
            const locationUpdateEvent = {
              bookingId: currentBookingId,
              driverId: driverId,
              location: {
                latitude: locationData.latitude,
                longitude: locationData.longitude,
                accuracy: locationData.accuracy || 0,
                speed: location.speed || 0,
                heading: location.heading || 0,
                timestamp: new Date().toISOString()
              },
              timestamp: new Date().toISOString()
            };
            
            // ✅ Emit to both user room and booking room
            const userRoom = `user:${bookingData.customerId}`;
            const bookingRoom = `booking:${currentBookingId}`;
            
            io.to(userRoom).emit('driver_location_update', locationUpdateEvent);
            io.to(bookingRoom).emit('driver_location_update', locationUpdateEvent);
            
            console.log(`📍 [LOCATION_SERVICE] Real-time location update sent for active trip:`, {
              bookingId: currentBookingId,
              customerId: bookingData.customerId,
              speed: location.speed || 0
            });
          }
        } catch (wsError) {
          console.warn('⚠️ [LOCATION_SERVICE] Failed to send WebSocket location update:', wsError);
          // Continue - location is still saved
        }
      }

      await monitoringService.logEvent('driver_location_updated', {
        driverId,
        location: locationData
      });

      return {
        success: true,
        data: locationData
      };
    } catch (error) {
      console.error('❌ Error in LocationService.updateDriverLocation:', error);
      throw error;
    }
  }

  /**
   * Get cached result
   * @param {string} key - Cache key
   * @returns {Object|null} Cached result
   */
  getCachedResult(key) {
    const cached = this.cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  /**
   * Set cached result
   * @param {string} key - Cache key
   * @param {Object} data - Data to cache
   */
  setCachedResult(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Clear expired cache entries
   */
  clearExpiredCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get service area configuration
   * @returns {Promise<Object>} Service area config
   */
  async getServiceAreaConfig() {
    try {
      const configDoc = await this.db.collection('systemConfig').doc('serviceArea').get();
      
      if (configDoc.exists) {
        return configDoc.data();
      }

      // Default service area (Tirupattur)
      return {
        center: {
          lat: 12.4974,
          lng: 78.5604
        },
        radius: 27, // km
        name: 'Tirupattur Town'
      };
    } catch (error) {
      console.error('❌ Failed to get service area config:', error.message);
      return {
        center: { lat: 12.4974, lng: 78.5604 },
        radius: 27,
        name: 'Tirupattur Town'
      };
    }
  }
}

module.exports = new LocationService();
