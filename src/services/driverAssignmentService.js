const { getFirestore } = require('./firebase');
const socketService = require('./socketService');
const serviceAreaValidation = require('./serviceAreaValidation');

/**
 * Driver Assignment Service for EPickup
 * Handles location-based driver matching and assignment logic
 */
class DriverAssignmentService {
  constructor() {
    this.db = getFirestore();
    this.maxDistance = 10000; // 10km in meters
    this.maxResponseTime = 300000; // 5 minutes in milliseconds
  }

  /**
   * Find nearby available drivers
   * @param {Object} pickupLocation - Pickup location coordinates
   * @param {number} maxDistance - Maximum distance in meters
   * @returns {Array} Array of available drivers
   */
  async findNearbyDrivers(pickupLocation, maxDistance = this.maxDistance) {
    try {
      const { lat, lng } = pickupLocation;
      
      // Validate pickup location is within service area
      const locationValidation = serviceAreaValidation.validateLocation(lat, lng);
      if (!locationValidation.isValid) {
        return {
          success: false,
          error: {
            code: 'LOCATION_OUTSIDE_SERVICE_AREA',
            message: locationValidation.message
          }
        };
      }
      
      // Get all available drivers
      const driversSnapshot = await this.db.collection('drivers')
        .where('isAvailable', '==', true)
        .where('isOnline', '==', true)
        .get();

      const nearbyDrivers = [];

      for (const doc of driversSnapshot.docs) {
        const driver = { id: doc.id, ...doc.data() };
        
        if (driver.currentLocation) {
          // Validate driver location is within service area
          const driverLocationValidation = serviceAreaValidation.validateLocation(
            driver.currentLocation.lat,
            driver.currentLocation.lng
          );
          
          if (!driverLocationValidation.isValid) {
            console.warn(`Driver ${driver.id} is outside service area:`, driverLocationValidation.message);
            continue; // Skip drivers outside service area
          }

          const distance = this.calculateDistance(
            lat, lng,
            driver.currentLocation.lat,
            driver.currentLocation.lng
          );

          if (distance <= maxDistance) {
            nearbyDrivers.push({
              ...driver,
              distance: Math.round(distance),
              serviceAreaValidation: driverLocationValidation
            });
          }
        }
      }

      // Sort by distance (closest first)
      nearbyDrivers.sort((a, b) => a.distance - b.distance);

      return {
        success: true,
        data: nearbyDrivers,
        total: nearbyDrivers.length
      };
    } catch (error) {
      console.error('Find nearby drivers error:', error);
      return {
        success: false,
        error: {
          code: 'DRIVER_SEARCH_ERROR',
          message: 'Failed to find nearby drivers',
          details: error.message
        }
      };
    }
  }

  /**
   * Assign driver to booking automatically
   * @param {string} bookingId - Booking ID
   * @param {Object} pickupLocation - Pickup location
   * @returns {Object} Assignment result
   */
  async autoAssignDriver(bookingId, pickupLocation) {
    try {
      // Find nearby drivers
      const nearbyResult = await this.findNearbyDrivers(pickupLocation);
      
      if (!nearbyResult.success || nearbyResult.data.length === 0) {
        return {
          success: false,
          error: {
            code: 'NO_DRIVERS_AVAILABLE',
            message: 'No drivers available in your area'
          }
        };
      }

      // Get booking details
      const booking = await this.getBooking(bookingId);
      if (!booking) {
        return {
          success: false,
          error: {
            code: 'BOOKING_NOT_FOUND',
            message: 'Booking not found'
          }
        };
      }

      // Find the best driver based on criteria
      const bestDriver = this.selectBestDriver(nearbyResult.data, booking);
      
      if (!bestDriver) {
        return {
          success: false,
          error: {
            code: 'NO_SUITABLE_DRIVER',
            message: 'No suitable driver found'
          }
        };
      }

      // Assign driver to booking
      const assignmentResult = await this.assignDriverToBooking(bookingId, bestDriver.id);
      
      if (assignmentResult.success) {
        // Notify driver via WebSocket
        socketService.sendToUser(bestDriver.id, 'new-booking-assigned', {
          bookingId,
          booking: booking,
          pickupLocation,
          estimatedDistance: bestDriver.distance,
          timestamp: new Date().toISOString()
        });

        // Notify customer
        socketService.sendToUser(booking.customerId, 'driver-assigned', {
          bookingId,
          driverId: bestDriver.id,
          driverName: bestDriver.name,
          estimatedDistance: bestDriver.distance,
          timestamp: new Date().toISOString()
        });
      }

      return assignmentResult;
    } catch (error) {
      console.error('Auto assign driver error:', error);
      return {
        success: false,
        error: {
          code: 'ASSIGNMENT_ERROR',
          message: 'Failed to assign driver',
          details: error.message
        }
      };
    }
  }

  /**
   * Manually assign driver to booking
   * @param {string} bookingId - Booking ID
   * @param {string} driverId - Driver ID
   * @param {string} assignedBy - User who assigned
   * @returns {Object} Assignment result
   */
  async manualAssignDriver(bookingId, driverId, assignedBy) {
    try {
      // Validate driver availability
      const driver = await this.getDriver(driverId);
      if (!driver) {
        return {
          success: false,
          error: {
            code: 'DRIVER_NOT_FOUND',
            message: 'Driver not found'
          }
        };
      }

      if (!driver.isAvailable || !driver.isOnline) {
        return {
          success: false,
          error: {
            code: 'DRIVER_NOT_AVAILABLE',
            message: 'Driver is not available'
          }
        };
      }

      // Get booking details
      const booking = await this.getBooking(bookingId);
      if (!booking) {
        return {
          success: false,
          error: {
            code: 'BOOKING_NOT_FOUND',
            message: 'Booking not found'
          }
        };
      }

      // Check if driver is already assigned to another booking
      const activeBookings = await this.getDriverActiveBookings(driverId);
      if (activeBookings.length > 0) {
        return {
          success: false,
          error: {
            code: 'DRIVER_BUSY',
            message: 'Driver is already assigned to another booking'
          }
        };
      }

      // Assign driver to booking
      const assignmentResult = await this.assignDriverToBooking(bookingId, driverId, assignedBy);
      
      if (assignmentResult.success) {
        // Notify driver via WebSocket
        socketService.sendToUser(driverId, 'new-booking-assigned', {
          bookingId,
          booking: booking,
          assignedBy,
          timestamp: new Date().toISOString()
        });

        // Notify customer
        socketService.sendToUser(booking.customerId, 'driver-assigned', {
          bookingId,
          driverId: driverId,
          driverName: driver.name,
          assignedBy,
          timestamp: new Date().toISOString()
        });
      }

      return assignmentResult;
    } catch (error) {
      console.error('Manual assign driver error:', error);
      return {
        success: false,
        error: {
          code: 'ASSIGNMENT_ERROR',
          message: 'Failed to assign driver',
          details: error.message
        }
      };
    }
  }

  /**
   * Select the best driver based on criteria
   * @param {Array} drivers - Array of nearby drivers
   * @param {Object} booking - Booking details
   * @returns {Object|null} Best driver or null
   */
  selectBestDriver(drivers, booking) {
    if (drivers.length === 0) return null;

    // Filter drivers based on booking requirements
    const suitableDrivers = drivers.filter(driver => {
      // Check vehicle capacity
      if (booking.weight && driver.vehicleDetails?.capacity) {
        if (booking.weight > driver.vehicleDetails.capacity) {
          return false;
        }
      }

      // Check driver rating (minimum 3.5 stars)
      if (driver.rating && driver.rating < 3.5) {
        return false;
      }

      // Check if driver is within preferred areas
      if (driver.preferences?.preferredAreas && driver.preferences.preferredAreas.length > 0) {
        const isInPreferredArea = this.isLocationInPreferredAreas(
          booking.pickup.coordinates,
          driver.preferences.preferredAreas
        );
        if (!isInPreferredArea) {
          return false;
        }
      }

      return true;
    });

    if (suitableDrivers.length === 0) return null;

    // Score drivers based on multiple factors
    const scoredDrivers = suitableDrivers.map(driver => {
      let score = 0;

      // Distance score (closer is better) - 40% weight
      const maxDistance = Math.max(...suitableDrivers.map(d => d.distance));
      const distanceScore = 1 - (driver.distance / maxDistance);
      score += distanceScore * 0.4;

      // Rating score - 30% weight
      const ratingScore = (driver.rating - 1) / 4; // Normalize 1-5 to 0-1
      score += ratingScore * 0.3;

      // Experience score (more trips is better) - 20% weight
      const maxTrips = Math.max(...suitableDrivers.map(d => d.totalTrips || 0));
      const experienceScore = maxTrips > 0 ? (driver.totalTrips || 0) / maxTrips : 0;
      score += experienceScore * 0.2;

      // Availability score (longer online time is better) - 10% weight
      const onlineTime = driver.currentLocation?.updatedAt ? 
        Date.now() - driver.currentLocation.updatedAt.toMillis() : 0;
      const maxOnlineTime = Math.max(...suitableDrivers.map(d => 
        d.currentLocation?.updatedAt ? Date.now() - d.currentLocation.updatedAt.toMillis() : 0
      ));
      const availabilityScore = maxOnlineTime > 0 ? onlineTime / maxOnlineTime : 0;
      score += availabilityScore * 0.1;

      return { ...driver, score };
    });

    // Return driver with highest score
    scoredDrivers.sort((a, b) => b.score - a.score);
    return scoredDrivers[0];
  }

  /**
   * Assign driver to booking in database
   * @param {string} bookingId - Booking ID
   * @param {string} driverId - Driver ID
   * @param {string} assignedBy - User who assigned
   * @returns {Object} Assignment result
   */
  async assignDriverToBooking(bookingId, driverId, assignedBy = 'system') {
    try {
      const batch = this.db.batch();

      // Update booking
      const bookingRef = this.db.collection('bookings').doc(bookingId);
      batch.update(bookingRef, {
        driverId,
        bookingStatus: 'assigned',
        assignedAt: new Date(),
        assignedBy,
        updatedAt: new Date()
      });

      // Update driver availability
      const driverRef = this.db.collection('drivers').doc(driverId);
      batch.update(driverRef, {
        isAvailable: false,
        currentBookingId: bookingId,
        updatedAt: new Date()
      });

      // Create assignment record
      const assignmentRef = this.db.collection('driverAssignments').doc();
      batch.set(assignmentRef, {
        id: assignmentRef.id,
        bookingId,
        driverId,
        assignedBy,
        assignedAt: new Date(),
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      await batch.commit();

      return {
        success: true,
        message: 'Driver assigned successfully',
        data: {
          bookingId,
          driverId,
          assignedBy,
          assignedAt: new Date()
        }
      };
    } catch (error) {
      console.error('Assign driver to booking error:', error);
      return {
        success: false,
        error: {
          code: 'ASSIGNMENT_DB_ERROR',
          message: 'Failed to assign driver to booking',
          details: error.message
        }
      };
    }
  }

  /**
   * Unassign driver from booking
   * @param {string} bookingId - Booking ID
   * @param {string} unassignedBy - User who unassigned
   * @returns {Object} Unassignment result
   */
  async unassignDriver(bookingId, unassignedBy = 'system') {
    try {
      const booking = await this.getBooking(bookingId);
      if (!booking || !booking.driverId) {
        return {
          success: false,
          error: {
            code: 'NO_DRIVER_ASSIGNED',
            message: 'No driver assigned to this booking'
          }
        };
      }

      const batch = this.db.batch();

      // Update booking
      const bookingRef = this.db.collection('bookings').doc(bookingId);
      batch.update(bookingRef, {
        driverId: null,
        bookingStatus: 'confirmed',
        unassignedAt: new Date(),
        unassignedBy,
        updatedAt: new Date()
      });

      // Update driver availability
      const driverRef = this.db.collection('drivers').doc(booking.driverId);
      batch.update(driverRef, {
        isAvailable: true,
        currentBookingId: null,
        updatedAt: new Date()
      });

      // Update assignment record
      const assignmentQuery = await this.db.collection('driverAssignments')
        .where('bookingId', '==', bookingId)
        .where('status', '==', 'active')
        .limit(1)
        .get();

      if (!assignmentQuery.empty) {
        const assignmentRef = assignmentQuery.docs[0].ref;
        batch.update(assignmentRef, {
          status: 'cancelled',
          unassignedAt: new Date(),
          unassignedBy,
          updatedAt: new Date()
        });
      }

      await batch.commit();

      // Notify users via WebSocket
      socketService.sendToUser(booking.driverId, 'booking-unassigned', {
        bookingId,
        unassignedBy,
        timestamp: new Date().toISOString()
      });

      socketService.sendToUser(booking.customerId, 'driver-unassigned', {
        bookingId,
        driverId: booking.driverId,
        unassignedBy,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        message: 'Driver unassigned successfully',
        data: {
          bookingId,
          driverId: booking.driverId,
          unassignedBy,
          unassignedAt: new Date()
        }
      };
    } catch (error) {
      console.error('Unassign driver error:', error);
      return {
        success: false,
        error: {
          code: 'UNASSIGNMENT_ERROR',
          message: 'Failed to unassign driver',
          details: error.message
        }
      };
    }
  }

  /**
   * Get driver's active bookings
   * @param {string} driverId - Driver ID
   * @returns {Array} Array of active bookings
   */
  async getDriverActiveBookings(driverId) {
    try {
      const snapshot = await this.db.collection('bookings')
        .where('driverId', '==', driverId)
        .where('bookingStatus', 'in', ['assigned', 'picked_up', 'delivering'])
        .get();

      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Get driver active bookings error:', error);
      return [];
    }
  }

  /**
   * Calculate distance between two points using Haversine formula
   * @param {number} lat1 - Latitude of point 1
   * @param {number} lon1 - Longitude of point 1
   * @param {number} lat2 - Latitude of point 2
   * @param {number} lon2 - Longitude of point 2
   * @returns {number} Distance in meters
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Check if location is in preferred areas
   * @param {Object} location - Location coordinates
   * @param {Array} preferredAreas - Array of preferred area names
   * @returns {boolean} True if location is in preferred areas
   */
  isLocationInPreferredAreas(location, preferredAreas) { // eslint-disable-line no-unused-vars
    // This is a simplified check. In a real implementation,
    // you would use a geocoding service to check if the location
    // falls within the preferred areas
    return true; // For now, assume all locations are acceptable
  }

  /**
   * Get booking from database
   * @param {string} bookingId - Booking ID
   * @returns {Object|null} Booking data
   */
  async getBooking(bookingId) {
    try {
      const doc = await this.db.collection('bookings').doc(bookingId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Get booking error:', error);
      return null;
    }
  }

  /**
   * Get driver from database
   * @param {string} driverId - Driver ID
   * @returns {Object|null} Driver data
   */
  async getDriver(driverId) {
    try {
      const doc = await this.db.collection('drivers').doc(driverId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Get driver error:', error);
      return null;
    }
  }

  /**
   * Get assignment statistics
   * @returns {Object} Assignment statistics
   */
  async getAssignmentStatistics() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const snapshot = await this.db.collection('driverAssignments')
        .where('assignedAt', '>=', today)
        .get();

      const assignments = snapshot.docs.map(doc => doc.data());
      
      const stats = {
        totalAssignments: assignments.length,
        successfulAssignments: assignments.filter(a => a.status === 'active').length,
        cancelledAssignments: assignments.filter(a => a.status === 'cancelled').length,
        averageResponseTime: this.calculateAverageResponseTime(assignments)
      };

      return {
        success: true,
        data: stats
      };
    } catch (error) {
      console.error('Get assignment statistics error:', error);
      return {
        success: false,
        error: {
          code: 'STATISTICS_ERROR',
          message: 'Failed to get assignment statistics',
          details: error.message
        }
      };
    }
  }

  /**
   * Calculate average response time
   * @param {Array} assignments - Array of assignments
   * @returns {number} Average response time in minutes
   */
  calculateAverageResponseTime(assignments) {
    const responseTimes = assignments
      .filter(a => a.assignedAt && a.createdAt)
      .map(a => {
        const assignedTime = a.assignedAt.toMillis();
        const createdTime = a.createdAt.toMillis();
        return (assignedTime - createdTime) / (1000 * 60); // Convert to minutes
      });

    if (responseTimes.length === 0) return 0;

    const average = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    return Math.round(average);
  }

  /**
   * Validate driver location for service area
   * @param {number} latitude - Driver latitude
   * @param {number} longitude - Driver longitude
   * @returns {Object} Validation result
   */
  validateDriverLocation(latitude, longitude) {
    return serviceAreaValidation.validateDriverLocation(latitude, longitude);
  }

  /**
   * Get service area information
   * @returns {Object} Service area information
   */
  getServiceAreaInfo() {
    return serviceAreaValidation.getServiceAreaInfo();
  }
}

module.exports = new DriverAssignmentService();
