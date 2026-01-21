const { getFirestore } = require('./firebase');

/**
 * Driver Matching Service for EPickup delivery platform
 * Handles intelligent driver matching with geospatial queries,
 * rating-based prioritization, and real-time availability management
 */
class DriverMatchingService {
  constructor() {
    this.defaultSearchRadius = 5; // km
    this.maxSearchRadius = 20; // km
    this.ratingWeight = 0.4;
    this.distanceWeight = 0.3;
    this.performanceWeight = 0.3;
  }

  get db() {
    return getFirestore();
  }

  /**
   * Find and match the best available driver for a booking
   * @param {Object} bookingData - Booking information
   * @param {Object} options - Matching options
   * @returns {Object} Matched driver with assignment details
   */
  async findAndMatchDriver(bookingData, options = {}) {
    try {
      const {
        searchRadius = this.defaultSearchRadius,
        vehicleType = null,
        maxWeight = null,
        priority = 'balanced' // 'balanced', 'fastest', 'best_rated', 'closest'
      } = options;

      const { pickup } = bookingData;
      
      if (!pickup?.coordinates) {
        throw new Error('Pickup coordinates are required for driver matching');
      }

      // Find available drivers within search radius
      const availableDrivers = await this.findAvailableDrivers(
        pickup.coordinates,
        searchRadius,
        vehicleType,
        maxWeight
      );

      if (availableDrivers.length === 0) {
        // Expand search radius if no drivers found
        const expandedDrivers = await this.expandSearchRadius(
          pickup.coordinates,
          searchRadius,
          vehicleType,
          maxWeight
        );
        
        if (expandedDrivers.length === 0) {
          throw new Error('No available drivers found in the area');
        }
        
        availableDrivers.push(...expandedDrivers);
      }

      // Score and rank drivers based on priority
      const rankedDrivers = this.rankDrivers(availableDrivers, priority);

      // Attempt to assign the top-ranked driver
      const assignmentResult = await this.attemptDriverAssignment(
        bookingData.id,
        rankedDrivers[0],
        bookingData
      );

      if (assignmentResult.success) {
        return {
          success: true,
          message: 'Driver matched successfully',
          data: {
            driver: assignmentResult.driver,
            assignment: assignmentResult.assignment,
            alternatives: rankedDrivers.slice(1, 4), // Top 3 alternatives
            searchRadius: searchRadius,
            totalDriversFound: availableDrivers.length
          }
        };
      }

      // If primary driver assignment fails, try alternatives
      for (let i = 1; i < Math.min(rankedDrivers.length, 5); i++) {
        const alternativeDriver = rankedDrivers[i];
        const alternativeResult = await this.attemptDriverAssignment(
          bookingData.id,
          alternativeDriver,
          bookingData
        );

        if (alternativeResult.success) {
          return {
            success: true,
            message: 'Alternative driver matched successfully',
            data: {
              driver: alternativeResult.driver,
              assignment: alternativeResult.assignment,
              alternatives: rankedDrivers.slice(i + 1, i + 4),
              searchRadius: searchRadius,
              totalDriversFound: availableDrivers.length,
              fallbackUsed: true
            }
          };
        }
      }

      throw new Error('All driver assignment attempts failed');

    } catch (error) {
      console.error('Driver matching failed:', error);
      return {
        success: false,
        error: {
          code: 'DRIVER_MATCHING_FAILED',
          message: 'Failed to match driver',
          details: error.message
        }
      };
    }
  }

  /**
   * Find available drivers within specified radius
   * @param {Object} pickupLocation - Pickup coordinates
   * @param {number} radius - Search radius in km
   * @param {string} vehicleType - Required vehicle type
   * @param {number} maxWeight - Maximum package weight
   * @returns {Array} Array of available drivers
   */
  async findAvailableDrivers(pickupLocation, radius, vehicleType = null, maxWeight = null) {
    try {
      const { latitude, longitude } = pickupLocation;
      
      // Get all online and available drivers
      let query = this.db.collection('driverLocations')
        .where('isOnline', '==', true)
        .where('isAvailable', '==', true);

      if (vehicleType) {
        query = query.where('vehicleType', '==', vehicleType);
      }

      const snapshot = await query.get();
      const availableDrivers = [];

      // Batch process drivers to avoid N+1 queries
      const driverPromises = [];
      const driverIds = [];
      
      for (const doc of snapshot.docs) {
        const driverData = doc.data();
        
        // Skip if driver has current trip
        if (driverData.currentTripId) continue;

        // Calculate distance to pickup
        const distance = this.calculateHaversineDistance(
          latitude, longitude,
          driverData.currentLocation.latitude,
          driverData.currentLocation.longitude
        );

        // Check if driver is within search radius
        if (distance <= radius) {
          driverIds.push(doc.id);
          driverPromises.push(this.getDriverDetails(doc.id));
        }
      }
      
      // Batch fetch all driver details
      const driverDetailsArray = await Promise.all(driverPromises);
      
      // Process results
      for (let i = 0; i < driverDetailsArray.length; i++) {
        const driverDetails = driverDetailsArray[i];
        const driverId = driverIds[i];
        
        if (driverDetails && this.isDriverSuitable(driverDetails, maxWeight)) {
          const driverData = snapshot.docs.find(doc => doc.id === driverId)?.data();
          const distance = this.calculateHaversineDistance(
            latitude, longitude,
            driverData.currentLocation.latitude,
            driverData.currentLocation.longitude
          );
          
          availableDrivers.push({
            driverId,
            distance,
            rating: driverDetails.driver?.rating || 0,
            totalTrips: driverDetails.driver?.totalTrips || 0,
            performanceScore: this.calculatePerformanceScore(driverDetails),
            currentLocation: driverData.currentLocation,
            vehicleType: driverData.vehicleType,
            estimatedArrival: this.calculateETA(distance, driverData.vehicleType),
            ...driverDetails
          });
        }
      }

      return availableDrivers;

    } catch (error) {
      console.error('Error finding available drivers:', error);
      throw error;
    }
  }

  /**
   * Expand search radius if no drivers found initially
   * @param {Object} pickupLocation - Pickup coordinates
   * @param {number} initialRadius - Initial search radius
   * @param {string} vehicleType - Required vehicle type
   * @param {number} maxWeight - Maximum package weight
   * @returns {Array} Array of drivers found in expanded radius
   */
  async expandSearchRadius(pickupLocation, initialRadius, vehicleType = null, maxWeight = null) {
    try {
      const expandedRadius = Math.min(initialRadius * 2, this.maxSearchRadius);
      console.log(`Expanding search radius from ${initialRadius}km to ${expandedRadius}km`);
      
      return await this.findAvailableDrivers(pickupLocation, expandedRadius, vehicleType, maxWeight);
      
    } catch (error) {
      console.error('Error expanding search radius:', error);
      return [];
    }
  }

  /**
   * Get detailed driver information from users collection
   * @param {string} driverId - Driver user ID
   * @returns {Object} Driver details
   */
  async getDriverDetails(driverId) {
    try {
      const driverDoc = await this.db.collection('users').doc(driverId).get();
      
      if (!driverDoc.exists) {
        return null;
      }

      return driverDoc.data();
      
    } catch (error) {
      console.error(`Error getting driver details for ${driverId}:`, error);
      return null;
    }
  }

  /**
   * Check if driver is suitable for the booking
   * @param {Object} driverDetails - Driver information
   * @param {number} maxWeight - Maximum package weight
   * @returns {boolean} Whether driver is suitable
   */
  isDriverSuitable(driverDetails, maxWeight = null) {
    try {
      // Check if driver is verified
      if (driverDetails.driver?.verificationStatus !== 'verified') {
        return false;
      }

      // Check if driver is active
      if (!driverDetails.isActive) {
        return false;
      }

      // Check working hours if specified
      if (driverDetails.driver?.availability?.workingHours) {
        const now = new Date();
        const currentTime = now.toTimeString().slice(0, 5);
        const { start, end } = driverDetails.driver.availability.workingHours;
        
        if (currentTime < start || currentTime > end) {
          return false;
        }
      }

      // Check working days if specified
      if (driverDetails.driver?.availability?.workingDays) {
        const now = new Date();
        const currentDay = now.toLocaleDateString('en-US', { weekday: 'lowercase' });
        
        if (!driverDetails.driver.availability.workingDays.includes(currentDay)) {
          return false;
        }
      }

      // Check vehicle capacity if weight specified
      if (maxWeight && driverDetails.driver?.vehicleDetails?.maxCapacity) {
        if (maxWeight > driverDetails.driver.vehicleDetails.maxCapacity) {
          return false;
        }
      }

      return true;
      
    } catch (error) {
      console.error('Error checking driver suitability:', error);
      return false;
    }
  }

  /**
   * Calculate driver performance score
   * @param {Object} driverDetails - Driver information
   * @returns {number} Performance score (0-100)
   */
  calculatePerformanceScore(driverDetails) {
    try {
      let score = 0;
      const driver = driverDetails.driver;

      // Rating component (40 points)
      const rating = driver?.rating || 0;
      score += (rating / 5) * 40;

      // Trip completion rate (30 points)
      const totalTrips = driver?.totalTrips || 0;
      const completedTrips = driver?.completedTrips || 0;
      if (totalTrips > 0) {
        const completionRate = completedTrips / totalTrips;
        score += completionRate * 30;
      }

      // Response time (20 points)
      const avgResponseTime = driver?.avgResponseTime || 0;
      if (avgResponseTime > 0) {
        const responseScore = Math.max(0, 20 - (avgResponseTime / 60)); // 20 points for <1 min
        score += responseScore;
      }

      // Cancellation rate (10 points)
      const cancellationRate = driver?.cancellationRate || 0;
      score += Math.max(0, 10 - (cancellationRate * 10));

      return Math.round(score);
      
    } catch (error) {
      console.error('Error calculating performance score:', error);
      return 0;
    }
  }

  /**
   * Rank drivers based on specified priority
   * @param {Array} drivers - Array of available drivers
   * @param {string} priority - Ranking priority
   * @returns {Array} Ranked drivers
   */
  rankDrivers(drivers, priority = 'balanced') {
    try {
      const driversCopy = [...drivers];

      switch (priority) {
        case 'fastest':
          // Sort by estimated arrival time
          return driversCopy.sort((a, b) => a.estimatedArrival - b.estimatedArrival);

        case 'best_rated':
          // Sort by rating (descending)
          return driversCopy.sort((a, b) => b.rating - a.rating);

        case 'closest':
          // Sort by distance (ascending)
          return driversCopy.sort((a, b) => a.distance - b.distance);

        case 'balanced':
        default:
          // Sort by weighted score
          return driversCopy.sort((a, b) => {
            const scoreA = this.calculateWeightedScore(a);
            const scoreB = this.calculateWeightedScore(b);
            return scoreB - scoreA;
          });
      }
      
    } catch (error) {
      console.error('Error ranking drivers:', error);
      return drivers;
    }
  }

  /**
   * Calculate weighted score for driver ranking
   * @param {Object} driver - Driver information
   * @returns {number} Weighted score
   */
  calculateWeightedScore(driver) {
    try {
      // Normalize values to 0-1 scale
      const normalizedRating = driver.rating / 5;
      const normalizedDistance = 1 - (driver.distance / this.maxSearchRadius);
      const normalizedPerformance = driver.performanceScore / 100;

      // Calculate weighted score
      const score = (
        normalizedRating * this.ratingWeight +
        normalizedDistance * this.distanceWeight +
        normalizedPerformance * this.performanceWeight
      );

      return score;
      
    } catch (error) {
      console.error('Error calculating weighted score:', error);
      return 0;
    }
  }

  /**
   * Attempt to assign a driver to a booking
   * @param {string} bookingId - Booking ID
   * @param {Object} driver - Driver information
   * @param {Object} bookingData - Booking details
   * @returns {Object} Assignment result
   */
  async attemptDriverAssignment(bookingId, driver, bookingData) {
    try {
      // Check if driver is still available
      const driverLocationDoc = await this.db.collection('driverLocations').doc(driver.driverId).get();
      
      if (!driverLocationDoc.exists) {
        return { success: false, reason: 'Driver not found' };
      }

      const driverLocationData = driverLocationDoc.data();
      
      if (!driverLocationData.isOnline || !driverLocationData.isAvailable || driverLocationData.currentTripId) {
        return { success: false, reason: 'Driver no longer available' };
      }

      // Create assignment record
      const assignmentRef = this.db.collection('driverAssignments').doc();
      const assignment = {
        id: assignmentRef.id,
        bookingId,
        driverId: driver.driverId,
        status: 'pending',
        assignedAt: new Date(),
        expiresAt: new Date(Date.now() + 3 * 60 * 1000), // ✅ FIX: 3-minute timeout for driver assignment
        driverDetails: {
          name: driver.name,
          phone: driver.phone,
          rating: driver.rating,
          vehicleType: driver.vehicleType,
          estimatedArrival: driver.estimatedArrival
        },
        bookingDetails: {
          pickup: bookingData.pickup,
          dropoff: bookingData.dropoff,
          package: bookingData.package
        }
      };

      await assignmentRef.set(assignment);

      // Update driver location to show current trip
      await this.db.collection('driverLocations').doc(driver.driverId).update({
        currentTripId: bookingId,
        lastUpdated: new Date()
      });

      // Send push notification to driver
      await this.sendDriverAssignmentNotification(driver.driverId, assignment);

      return {
        success: true,
        driver: {
          id: driver.driverId,
          name: driver.name,
          phone: driver.phone,
          rating: driver.rating,
          vehicleType: driver.vehicleType,
          estimatedArrival: driver.estimatedArrival,
          currentLocation: driver.currentLocation
        },
        assignment: assignment
      };

    } catch (error) {
      console.error('Error attempting driver assignment:', error);
      return { success: false, reason: 'Assignment failed' };
    }
  }

  /**
   * Handle expired driver assignments
   * @param {string} bookingId - Booking ID
   * @returns {Object} Result of handling expired assignments
   */
  async handleExpiredAssignments(bookingId) {
    try {
      console.log(`🕐 Checking for expired assignments for booking ${bookingId}`);
      
      // Find expired assignments for this booking
      const expiredAssignments = await this.db.collection('driverAssignments')
        .where('bookingId', '==', bookingId)
        .where('status', '==', 'pending')
        .where('expiresAt', '<', new Date())
        .get();

      if (expiredAssignments.empty) {
        return { success: true, expiredCount: 0 };
      }

      console.log(`⏰ Found ${expiredAssignments.size} expired assignments for booking ${bookingId}`);

      // Reset driver statuses for expired assignments
      const batch = this.db.batch();
      const driverIds = [];

      expiredAssignments.forEach(doc => {
        const assignment = doc.data();
        driverIds.push(assignment.driverId);
        
        // Mark assignment as expired
        batch.update(doc.ref, {
          status: 'expired',
          expiredAt: new Date()
        });

        // Reset driver location status
        const driverLocationRef = this.db.collection('driverLocations').doc(assignment.driverId);
        batch.update(driverLocationRef, {
          currentTripId: null,
          lastUpdated: new Date()
        });
      });

      await batch.commit();

      console.log(`✅ Reset ${driverIds.length} drivers from expired assignments`);

      return {
        success: true,
        expiredCount: expiredAssignments.size,
        driverIds: driverIds
      };

    } catch (error) {
      console.error('Error handling expired assignments:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * @param {string} reason - Reason for rejection (optional)
   * @returns {Object} Response result
   */
  async handleDriverResponse(assignmentId, driverId, response, reason = null) {
    try {
      const assignmentRef = this.db.collection('driverAssignments').doc(assignmentId);
      const assignmentDoc = await assignmentRef.get();

      if (!assignmentDoc.exists) {
        return {
          success: false,
          error: 'Assignment not found'
        };
      }

      const assignment = assignmentDoc.data();

      if (assignment.driverId !== driverId) {
        return {
          success: false,
          error: 'Unauthorized response'
        };
      }

      if (assignment.status !== 'pending') {
        return {
          success: false,
          error: 'Assignment already processed'
        };
      }

      // Check if assignment has expired
      // ✅ FIX: Remove timeout check - assignments never expire
      // eslint-disable-next-line no-constant-condition
      if (false) { // Disabled timeout check
        await assignmentRef.update({
          status: 'expired',
          updatedAt: new Date()
        });

        return {
          success: false,
          error: 'Assignment expired'
        };
      }

      if (response === 'accepted') {
        // Update assignment status
        await assignmentRef.update({
          status: 'accepted',
          acceptedAt: new Date(),
          updatedAt: new Date()
        });

        // ✅ CRITICAL FIX: Get driver data to include driverInfo with isVerified
        const driverDoc = await this.db.collection('users').doc(driverId).get();
        let driverData = null;
        let driverIsVerified = false;
        
        if (driverDoc.exists) {
          driverData = driverDoc.data();
          // ✅ CRITICAL FIX: Determine driver verification status using same logic
          driverIsVerified = (() => {
            // Priority 1: Check driver.verificationStatus
            if (driverData.driver?.verificationStatus === 'approved' || driverData.driver?.verificationStatus === 'verified') {
              return true
            }
            // Priority 2: Check isVerified flag
            if (driverData.driver?.isVerified === true || driverData.isVerified === true) {
              return true
            }
            // Priority 3: Check if all documents are verified
            const driverDocs = driverData.driver?.documents || {}
            const docKeys = Object.keys(driverDocs)
            if (docKeys.length > 0) {
              const allVerified = docKeys.every(key => {
                const doc = driverDocs[key]
                return doc && (doc.verified === true || doc.status === 'verified' || doc.verificationStatus === 'verified')
              })
              if (allVerified) {
                return true
              }
            }
            return false
          })()
        }

        // Update booking with driver assignment
        const updateData = {
          driverId: driverId,
          status: 'driver_assigned',
          'timing.driverAssignedAt': new Date(),
          updatedAt: new Date()
        };

        // ✅ CRITICAL FIX: Include driverInfo with isVerified if driver data available
        if (driverData) {
          updateData.driverInfo = {
            name: driverData.name || 'Driver',
            phone: driverData.phone || '',
            rating: driverData.driver?.rating || 0,
            vehicleNumber: driverData.driver?.vehicleDetails?.vehicleNumber || '',
            vehicleModel: driverData.driver?.vehicleDetails?.vehicleModel || '',
            isVerified: driverIsVerified
          };
          updateData.driverVerified = driverIsVerified;
        }

        await this.db.collection('bookings').doc(assignment.bookingId).update(updateData);

        // Update driver location
        await this.db.collection('driverLocations').doc(driverId).update({
          currentTripId: assignment.bookingId,
          lastUpdated: new Date()
        });

        // Send notification to customer
        await this.sendCustomerNotification(assignment.bookingId, 'driver_assigned');

        return {
          success: true,
          message: 'Assignment accepted successfully',
          data: {
            assignmentId,
            bookingId: assignment.bookingId,
            status: 'accepted'
          }
        };

      } else if (response === 'rejected') {
        // Update assignment status
        await assignmentRef.update({
          status: 'rejected',
          rejectedAt: new Date(),
          rejectionReason: reason,
          updatedAt: new Date()
        });

        // Reset driver location
        await this.db.collection('driverLocations').doc(driverId).update({
          currentTripId: null,
          lastUpdated: new Date()
        });

        // Find alternative driver
        const alternativeResult = await this.findAlternativeDriver(assignment.bookingId, driverId);

        return {
          success: true,
          message: 'Assignment rejected',
          data: {
            assignmentId,
            bookingId: assignment.bookingId,
            status: 'rejected',
            alternativeDriver: alternativeResult
          }
        };
      }

      return {
        success: false,
        error: 'Invalid response'
      };

    } catch (error) {
      console.error('Error handling driver response:', error);
      return {
        success: false,
        error: 'Failed to process driver response'
      };
    }
  }

  /**
   * Find alternative driver when primary driver rejects
   * @param {string} bookingId - Booking ID
   * @param {string} rejectedDriverId - ID of driver who rejected
   * @returns {Object} Alternative driver result
   */
  async findAlternativeDriver(bookingId, rejectedDriverId) {
    try {
      // Get booking details
      const bookingDoc = await this.db.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) {
        return null;
      }

      const bookingData = bookingDoc.data();

      // Find alternative drivers (exclude rejected driver)
      const alternativeDrivers = await this.findAvailableDrivers(
        bookingData.pickup.coordinates,
        this.defaultSearchRadius,
        bookingData.vehicle?.type,
        bookingData.package?.weight
      );

      // Filter out rejected driver
      const filteredDrivers = alternativeDrivers.filter(driver => 
        driver.driverId !== rejectedDriverId
      );

      if (filteredDrivers.length === 0) {
        return null;
      }

      // Rank and return best alternative
      const rankedAlternatives = this.rankDrivers(filteredDrivers, 'balanced');
      return rankedAlternatives[0];

    } catch (error) {
      console.error('Error finding alternative driver:', error);
      return null;
    }
  }

  /**
   * Calculate estimated time of arrival
   * @param {number} distance - Distance in km
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
   * Calculate distance using Haversine formula
   * @param {number} lat1 - Latitude 1
   * @param {number} lon1 - Longitude 1
   * @param {number} lat2 - Latitude 2
   * @param {number} lon2 - Longitude 2
   * @returns {number} Distance in kilometers
   */
  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    try {
      const R = 6371; // Earth's radius in kilometers
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
      
    } catch (error) {
      console.error('Error calculating Haversine distance:', error);
      return 0;
    }
  }

  /**
   * Handle booking timeout when no driver is assigned within 3 minutes
   * @param {string} bookingId - Booking ID
   * @returns {Object} Result of timeout handling
   */
  async handleBookingTimeout(bookingId) {
    try {
      console.log(`⏰ Handling booking timeout for booking ${bookingId}`);
      
      // Get booking details
      const bookingDoc = await this.db.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) {
        return { success: false, error: 'Booking not found' };
      }

      const bookingData = bookingDoc.data();
      
      // Check if booking is still in searching state
      if (bookingData.status !== 'searching' && bookingData.status !== 'confirmed') {
        return { success: true, message: 'Booking already processed' };
      }

      // Handle expired assignments first
      await this.handleExpiredAssignments(bookingId);

      // Try to find alternative drivers
      const alternativeDrivers = await this.findAvailableDrivers(
        bookingData.pickup.coordinates,
        10, // Expanded radius
        bookingData.vehicle?.type,
        bookingData.package?.weight
      );

      if (alternativeDrivers.length > 0) {
        console.log(`🔄 Found ${alternativeDrivers.length} alternative drivers, attempting assignment`);
        
        // Try to assign the best alternative driver
        const assignmentResult = await this.attemptDriverAssignment(
          bookingId,
          alternativeDrivers[0],
          bookingData
        );

        if (assignmentResult.success) {
          return {
            success: true,
            message: 'Alternative driver assigned',
            driver: assignmentResult.driver
          };
        }
      }

      // If no alternative drivers found, cancel the booking
      console.log(`❌ No drivers available, cancelling booking ${bookingId}`);
      
      await this.db.collection('bookings').doc(bookingId).update({
        status: 'cancelled',
        cancellationReason: 'No drivers available within timeout period',
        cancelledAt: new Date(),
        updatedAt: new Date()
      });

      return {
        success: true,
        message: 'Booking cancelled due to no drivers available',
        action: 'cancelled'
      };

    } catch (error) {
      console.error('Error handling booking timeout:', error);
      return { success: false, error: error.message };
    }
  }

  /**
  async sendDriverAssignmentNotification(driverId, assignment) {
    try {
      // Get driver's push token
      const driverDoc = await this.db.collection('users').doc(driverId).get();
      if (!driverDoc.exists) return;

      const driverData = driverDoc.data();
      // ✅ CRITICAL FIX: Check for Expo push token (primary) or FCM token (fallback)
      const pushToken = driverData.expoPushToken || driverData.fcmToken;

      if (!pushToken) {
        console.log(`⚠️ [DRIVER_NOTIFICATION] Driver ${driverId} has no push token`);
        return;
      }

      // Create notification
      const notification = {
        title: '🚗 New Delivery Assignment!',
        body: `You have a new delivery from ${assignment.bookingDetails?.pickup?.address || 'pickup location'}`,
        type: 'driver_assignment',
        bookingId: assignment.bookingId,
        data: {
          type: 'driver_assignment',
          assignmentId: assignment.id,
          bookingId: assignment.bookingId,
          variables: {
            pickupAddress: assignment.bookingDetails?.pickup?.address || 'Pickup location',
            dropoffAddress: assignment.bookingDetails?.dropoff?.address || 'Dropoff location'
          }
        }
      };

      // ✅ CRITICAL FIX: Send via Expo Push Service
      try {
        const expoPushService = require('./expoPushService');
        const result = await expoPushService.sendToTokens([pushToken], notification, {
          priority: 'high',
          sound: 'default'
        });
        console.log(`✅ [DRIVER_NOTIFICATION] Push notification sent to driver ${driverId}:`, result);
      } catch (pushError) {
        console.error(`❌ [DRIVER_NOTIFICATION] Failed to send push to driver ${driverId}:`, pushError);
      }

    } catch (error) {
      console.error('Error sending driver notification:', error);
    }
  }

  /**
   * Send notification to customer
   * @param {string} bookingId - Booking ID
   * @param {string} type - Notification type
   */
  async sendCustomerNotification(bookingId, type) {
    try {
      // Get booking details
      const bookingDoc = await this.db.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) return;

      const bookingData = bookingDoc.data();

      // Get customer's FCM token
      const customerDoc = await this.db.collection('users').doc(bookingData.customerId).get();
      if (!customerDoc.exists) return;

      const customerData = customerDoc.data();
      const fcmToken = customerData.fcmToken;

      if (!fcmToken) return;

      // Create notification based on type
      let notification;
      switch (type) {
        case 'driver_assigned':
          notification = {
            title: 'Driver Assigned!',
            body: 'A driver has been assigned to your delivery. Track them in real-time.',
            data: {
              type: 'driver_assigned',
              bookingId: bookingId
            }
          };
          break;
        default:
          return;
      }

      // Send notification (implement FCM logic here)
      console.log(`Sending notification to customer ${bookingData.customerId}:`, notification);

    } catch (error) {
      console.error('Error sending customer notification:', error);
    }
  }

  /**
   * Get driver statistics for analytics
   * @param {string} driverId - Driver ID
   * @param {Object} timeRange - Time range for statistics
   * @returns {Object} Driver statistics
   */
  async getDriverStatistics(driverId, timeRange = {}) {
    try {
      const { startDate, endDate } = timeRange;
      let query = this.db.collection('driverAssignments').where('driverId', '==', driverId);

      if (startDate) {
        query = query.where('assignedAt', '>=', new Date(startDate));
      }
      if (endDate) {
        query = query.where('assignedAt', '<=', new Date(endDate));
      }

      const snapshot = await query.get();
      const assignments = [];

      snapshot.forEach(doc => {
        assignments.push(doc.data());
      });

      // Calculate statistics
      const totalAssignments = assignments.length;
      const acceptedAssignments = assignments.filter(a => a.status === 'accepted').length;
      const rejectedAssignments = assignments.filter(a => a.status === 'rejected').length;
      const expiredAssignments = assignments.filter(a => a.status === 'expired').length;

      const acceptanceRate = totalAssignments > 0 ? (acceptedAssignments / totalAssignments) * 100 : 0;
      const avgResponseTime = this.calculateAverageResponseTime(assignments);

      return {
        totalAssignments,
        acceptedAssignments,
        rejectedAssignments,
        expiredAssignments,
        acceptanceRate: Math.round(acceptanceRate * 100) / 100,
        avgResponseTime,
        timeRange
      };

    } catch (error) {
      console.error('Error getting driver statistics:', error);
      return null;
    }
  }

  /**
   * Calculate average response time for assignments
   * @param {Array} assignments - Array of assignments
   * @returns {number} Average response time in seconds
   */
  calculateAverageResponseTime(assignments) {
    try {
      const respondedAssignments = assignments.filter(a => 
        a.status === 'accepted' || a.status === 'rejected'
      );

      if (respondedAssignments.length === 0) return 0;

      let totalResponseTime = 0;
      respondedAssignments.forEach(assignment => {
        const responseTime = assignment.acceptedAt || assignment.rejectedAt;
        if (responseTime && assignment.assignedAt) {
          const responseTimeMs = responseTime.toDate() - assignment.assignedAt.toDate();
          totalResponseTime += responseTimeMs / 1000; // Convert to seconds
        }
      });

      return Math.round(totalResponseTime / respondedAssignments.length);
      
    } catch (error) {
      console.error('Error calculating average response time:', error);
      return 0;
    }
  }

  /**
   * Update driver availability status
   * @param {string} driverId - Driver ID
   * @param {boolean} isOnline - Online status
   * @param {boolean} isAvailable - Availability status
   * @param {Object} location - Current location
   * @returns {Object} Update result
   */
  async updateDriverAvailability(driverId, isOnline, isAvailable, location = null) {
    try {
      const updateData = {
        isOnline,
        isAvailable,
        lastUpdated: new Date()
      };

      if (location) {
        updateData.currentLocation = {
          ...location,
          timestamp: new Date()
        };
      }

      // If driver is going offline, clear current trip
      if (!isOnline) {
        updateData.currentTripId = null;
      }

      await this.db.collection('driverLocations').doc(driverId).update(updateData);

      return {
        success: true,
        message: 'Driver availability updated successfully'
      };

    } catch (error) {
      console.error('Error updating driver availability:', error);
      return {
        success: false,
        error: 'Failed to update driver availability'
      };
    }
  }

  /**
   * Get real-time driver locations for monitoring
   * @param {Array} driverIds - Array of driver IDs
   * @returns {Array} Driver locations with status
   */
  async getDriverLocations(driverIds) {
    try {
      const locations = [];

      for (const driverId of driverIds) {
        const locationDoc = await this.db.collection('driverLocations').doc(driverId).get();
        
        if (locationDoc.exists) {
          const locationData = locationDoc.data();
          locations.push({
            driverId,
            ...locationData
          });
        }
      }

      return locations;

    } catch (error) {
      console.error('Error getting driver locations:', error);
      return [];
    }
  }
}

module.exports = new DriverMatchingService();
