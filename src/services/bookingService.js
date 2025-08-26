const { getFirestore } = require('./firebase');
const axios = require('axios');
const serviceAreaValidation = require('./serviceAreaValidation');

/**
 * Booking Service for EPickup delivery platform
 * Handles complete delivery booking lifecycle
 */
class BookingService {
  constructor() {
    this.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  }

  get db() {
    return getFirestore();
  }

  /**
   * Create a new delivery booking
   * @param {Object} bookingData - Booking information
   * @returns {Object} Created booking with calculated pricing
   */
  async createBooking(bookingData) {
    try {
      const {
        customerId,
        pickup,
        dropoff,
        package: packageInfo,
        vehicle,
        paymentMethod,
        estimatedPickupTime,
        estimatedDeliveryTime
      } = bookingData;

      // Validate booking data
      const validation = this.validateBookingData(bookingData);
      if (!validation.isValid) {
        throw new Error(validation.errors.join(', '));
      }

      // Validate service area for booking locations
      const serviceAreaValidation = await this.validateServiceArea(bookingData);
      if (!serviceAreaValidation.isValid) {
        throw new Error(serviceAreaValidation.message);
      }

      // Calculate distance and pricing
      const distance = await this.calculateDistance(pickup.coordinates, dropoff.coordinates);
      const pricing = await this.calculatePricing(distance, packageInfo.weight, vehicle.type);

      // Create booking document
      const booking = {
        id: `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        customerId,
        driverId: null,
        status: 'pending',
        
        pickup: {
          name: pickup.name,
          phone: pickup.phone,
          address: pickup.address,
          coordinates: pickup.coordinates,
          instructions: pickup.instructions || ''
        },
        
        dropoff: {
          name: dropoff.name,
          phone: dropoff.phone,
          address: dropoff.address,
          coordinates: dropoff.coordinates,
          instructions: dropoff.instructions || ''
        },
        
        package: {
          weight: packageInfo.weight,
          weightUnit: 'kg',
          description: packageInfo.description || '',
          dimensions: packageInfo.dimensions || null,
          isFragile: packageInfo.isFragile || false,
          requiresSpecialHandling: packageInfo.requiresSpecialHandling || false
        },
        
        vehicle: {
          type: vehicle.type,
          required: vehicle.required || false
        },
        
        fare: {
          base: pricing.baseFare,
          distance: pricing.distanceCharge,
          time: pricing.timeCharge || 0,
          total: pricing.totalAmount,
          currency: 'INR'
        },
        
        paymentMethod,
        paymentStatus: 'pending',
        
        timing: {
          createdAt: new Date(),
          estimatedPickupTime,
          estimatedDeliveryTime
        },
        
        distance: {
          total: distance,
          unit: 'km'
        },
        
        rating: {
          customerRating: null,
          customerFeedback: null,
          driverRating: null,
          driverFeedback: null
        },
        
        cancellation: {
          cancelledBy: null,
          reason: null,
          cancelledAt: null,
          refundAmount: null
        },
        
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Save to database
      await this.db.collection('bookings').doc(booking.id).set(booking);

      // Create trip tracking record
      await this.db.collection('tripTracking').doc(booking.id).set({
        tripId: booking.id,
        bookingId: booking.id,
        driverId: null,
        customerId,
        currentStatus: 'pending',
        locations: [],
        progress: {
          distanceToPickup: 0,
          distanceToDropoff: 0,
          etaToPickup: 0,
          etaToDropoff: 0,
          isAtPickup: false,
          isAtDropoff: false
        },
        lastUpdated: new Date()
      });

      return {
        success: true,
        message: 'Booking created successfully',
        data: { booking }
      };

    } catch (error) {
      console.error('Error creating booking:', error);
      throw error;
    }
  }

  /**
   * Create a booking from reorder data
   * @param {Object} reorderData - Reorder information
   * @returns {Object} Created booking
   */
  async createBookingFromReorder(reorderData) {
    try {
      const {
        customerId,
        originalOrderId,
        pickup,
        dropoff,
        package: packageInfo,
        vehicle,
        paymentMethod,
        estimatedPickupTime,
        estimatedDeliveryTime
      } = reorderData;

      // Validate reorder data
      if (!originalOrderId) {
        throw new Error('Original order ID is required for reorder');
      }

      // Create booking data
      const bookingData = {
        customerId,
        pickup,
        dropoff,
        package: packageInfo,
        vehicle,
        paymentMethod,
        estimatedPickupTime,
        estimatedDeliveryTime,
        reorderedFrom: originalOrderId
      };

      // Use existing createBooking method
      return await this.createBooking(bookingData);

    } catch (error) {
      console.error('Error creating booking from reorder:', error);
      throw error;
    }
  }

  /**
   * Calculate distance between two points using Google Maps API
   * @param {Object} origin - Origin coordinates
   * @param {Object} destination - Destination coordinates
   * @returns {number} Distance in kilometers
   */
  async calculateDistance(origin, destination) {
    try {
      if (!this.googleMapsApiKey) {
        // Fallback to Haversine formula if no API key
        return this.calculateHaversineDistance(origin, destination);
      }

      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.latitude},${origin.longitude}&destinations=${destination.latitude},${destination.longitude}&key=${this.googleMapsApiKey}&units=metric`;
      
      const response = await axios.get(url);
      
      if (response.data.status === 'OK' && response.data.rows[0].elements[0].status === 'OK') {
        const distanceText = response.data.rows[0].elements[0].distance.text;
        return parseFloat(distanceText.replace(' km', ''));
      }
      
      // Fallback to Haversine if API fails
      return this.calculateHaversineDistance(origin, destination);
      
    } catch (error) {
      console.warn('Google Maps API failed, using Haversine formula:', error.message);
      return this.calculateHaversineDistance(origin, destination);
    }
  }

  /**
   * Calculate distance using Haversine formula
   * @param {Object} origin - Origin coordinates
   * @param {Object} destination - Destination coordinates
   * @returns {number} Distance in kilometers
   */
  calculateHaversineDistance(origin, destination) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (destination.latitude - origin.latitude) * Math.PI / 180;
    const dLon = (destination.longitude - origin.longitude) * Math.PI / 180;
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(origin.latitude * Math.PI / 180) * Math.cos(destination.latitude * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Calculate estimated delivery time based on distance
   * @param {number} distance - Distance in kilometers
   * @returns {string} Estimated time in human-readable format
   */
  calculateEstimatedTime(distance) {
    // Average speed: 20 km/h for 2-wheeler in city traffic
    const averageSpeed = 20; // km/h
    const timeInHours = distance / averageSpeed;
    const timeInMinutes = Math.round(timeInHours * 60);
    
    if (timeInMinutes < 60) {
      return `${timeInMinutes} min`;
    } else {
      const hours = Math.floor(timeInMinutes / 60);
      const minutes = timeInMinutes % 60;
      return `${hours}h ${minutes}min`;
    }
  }

  /**
   * Calculate dynamic pricing based on distance, weight, and other factors
   * @param {number} distance - Distance in kilometers
   * @param {number} weight - Package weight in kg
   * @param {string} vehicleType - Vehicle type (2_wheeler only)
   * @returns {Object} Pricing breakdown
   */
  async calculatePricing(distance, weight, vehicleType) {
    try {
      // Only support 2-wheeler vehicles
      if (vehicleType !== '2_wheeler') {
        throw new Error('Only 2-wheeler vehicles are supported');
      }

      const rates = await this.getDefaultRates();
      
      // Base calculation
      const baseFare = rates.baseFare;
      const perKmRate = rates.baseRate;
      const distanceCharge = distance * perKmRate;
      
      // Vehicle type multiplier - only 2-wheeler supported
      const vehicleMultiplier = 1; // 2-wheeler has no multiplier
      
      // Weight multiplier
      let weightMultiplier = 1;
      if (weight > 10) {
        weightMultiplier = 1.2; // 20% extra for heavy packages
      } else if (weight > 5) {
        weightMultiplier = 1.1; // 10% extra for medium packages
      }
      
      // Calculate total
      const subtotal = (baseFare + distanceCharge) * vehicleMultiplier * weightMultiplier;
      
      // Apply surge pricing if applicable
      const surgeMultiplier = this.calculateSurgePricing(new Date());
      const totalWithSurge = subtotal * surgeMultiplier;
      
      // Round to nearest rupee
      const finalTotal = Math.round(totalWithSurge);
      
      return {
        baseFare,
        distanceCharge,
        vehicleMultiplier,
        weightMultiplier,
        surgeMultiplier,
        subtotal,
        total: finalTotal,
        currency: 'INR',
        breakdown: {
          baseFare,
          distanceCharge,
          vehicleCharge: 0, // No additional charge for 2-wheeler
          weightCharge: subtotal - (baseFare + distanceCharge),
          surgeCharge: totalWithSurge - subtotal,
          total: finalTotal
        }
      };
    } catch (error) {
      console.error('Error calculating pricing:', error);
      throw error;
    }
  }

  /**
   * Calculate surge pricing based on time of day
   * @param {Object} timeSurcharge - Time-based surge configuration
   * @returns {number} Surge multiplier
   */
  calculateSurgePricing(timeSurcharge) {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // HH:MM format

    // Check peak hours
    if (currentTime >= timeSurcharge.peakHours.start && currentTime <= timeSurcharge.peakHours.end) {
      return timeSurcharge.peakHours.rate;
    }

    // Check late night
    if (currentTime >= timeSurcharge.lateNight.start || currentTime <= timeSurcharge.lateNight.end) {
      return timeSurcharge.lateNight.rate;
    }

    return 1.0; // No surge
  }

  /**
   * Get default delivery rates
   * @returns {Object} Default rates
   */
  getDefaultRates() {
    // Default rates for 2-wheeler only
    const defaultRates = {
      baseFare: 30,
      baseRate: 12, // per km
      vehicleRates: {
        '2_wheeler': 1 // no multiplier for 2-wheeler
      },
      weightSurcharge: {
        threshold: 5, // kg
        rate: 5 // per kg above threshold
      },
      distanceSurcharge: {
        threshold: 10, // km
        rate: 15 // per km above threshold
      },
      timeSurcharge: {
        peakHours: {
          start: '08:00',
          end: '10:00',
          multiplier: 1.2
        },
        nightHours: {
          start: '22:00',
          end: '06:00',
          multiplier: 1.3
        }
      },
      currency: 'INR',
      lastUpdated: new Date().toISOString()
    };

    return defaultRates;
  }

  /**
   * Validate booking data
   * @param {Object} bookingData - Booking data to validate
   * @returns {Object} Validation result
   */
  validateBookingData(bookingData) {
    const errors = [];

    // Required fields
    if (!bookingData.customerId) errors.push('Customer ID is required');
    if (!bookingData.pickup?.coordinates) errors.push('Pickup coordinates are required');
    if (!bookingData.dropoff?.coordinates) errors.push('Dropoff coordinates are required');
    if (!bookingData.package?.weight) errors.push('Package weight is required');

    // Weight limits
    const maxWeight = 50; // kg
    if (bookingData.package.weight > maxWeight) {
      errors.push(`Package weight cannot exceed ${maxWeight} kg`);
    }

    // Distance limits
    const maxDistance = 100; // km
    if (bookingData.distance && bookingData.distance > maxDistance) {
      errors.push(`Distance cannot exceed ${maxDistance} km`);
    }

    // Minimum amount
    const minAmount = 50; // INR
    if (bookingData.pricing?.totalAmount && bookingData.pricing.totalAmount < minAmount) {
      errors.push(`Minimum booking amount is ₹${minAmount}`);
    }

    // Time validation
    if (bookingData.estimatedPickupTime) {
      const pickupTime = new Date(bookingData.estimatedPickupTime);
      const now = new Date();
      if (pickupTime < now) {
        errors.push('Estimated pickup time cannot be in the past');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Update booking status
   * @param {string} bookingId - Booking ID
   * @param {string} status - New status
   * @param {string} updatedBy - User ID who updated
   * @param {Object} additionalData - Additional data to update
   * @returns {Object} Updated booking
   */
  async updateBookingStatus(bookingId, status, updatedBy, additionalData = {}) {
    try {
      const bookingRef = this.db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();

      if (!bookingDoc.exists) {
        throw new Error('Booking not found');
      }

      const validStatuses = [
        'pending', 'confirmed', 'driver_assigned', 'driver_enroute',
        'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff', 'delivered', 'cancelled'
      ];

      if (!validStatuses.includes(status)) {
        throw new Error('Invalid status');
      }

      // Status-specific validations
      if (status === 'driver_assigned' && !additionalData.driverId) {
        throw new Error('Driver ID required for driver assignment');
      }

      if (status === 'delivered' && !additionalData.actualDeliveryTime) {
        additionalData.actualDeliveryTime = new Date();
      }

      // Update booking
      const updateData = {
        status,
        updatedAt: new Date(),
        ...additionalData
      };

      // Add timing information based on status
      switch (status) {
        case 'confirmed':
          updateData['timing.confirmedAt'] = new Date();
          break;
        case 'driver_assigned':
          updateData['timing.driverAssignedAt'] = new Date();
          break;
        case 'driver_enroute':
          updateData['timing.driverEnrouteAt'] = new Date();
          break;
        case 'driver_arrived':
          updateData['timing.driverArrivedAt'] = new Date();
          break;
        case 'picked_up':
          updateData['timing.pickedUpAt'] = new Date();
          break;
        case 'delivered':
          updateData['timing.deliveredAt'] = new Date();
          break;
      }

      await bookingRef.update(updateData);

      // Update trip tracking
      await this.db.collection('tripTracking').doc(bookingId).update({
        currentStatus: status,
        lastUpdated: new Date()
      });

      // Get updated booking
      const updatedDoc = await bookingRef.get();
      const updatedBooking = updatedDoc.data();

      return {
        success: true,
        message: 'Booking status updated successfully',
        data: { booking: updatedBooking }
      };

    } catch (error) {
      console.error('Error updating booking status:', error);
      throw error;
    }
  }

  /**
   * Cancel booking and handle refunds
   * @param {string} bookingId - Booking ID
   * @param {string} cancelledBy - User ID who cancelled
   * @param {string} reason - Cancellation reason
   * @returns {Object} Cancellation result
   */
  async cancelBooking(bookingId, cancelledBy, reason) {
    try {
      const bookingRef = this.db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();

      if (!bookingDoc.exists) {
        throw new Error('Booking not found');
      }

      const bookingData = bookingDoc.data();

      // Check if booking can be cancelled
      const cancellableStatuses = ['pending', 'confirmed', 'driver_assigned'];
      if (!cancellableStatuses.includes(bookingData.status)) {
        throw new Error('Booking cannot be cancelled in its current status');
      }

      // Calculate refund amount
      let refundAmount = 0;
      if (bookingData.pricing?.totalAmount) {
        // Full refund if cancelled before driver assignment
        if (bookingData.status === 'pending' || bookingData.status === 'confirmed') {
          refundAmount = bookingData.pricing.totalAmount;
        }
        // Partial refund if driver was assigned (deduct cancellation fee)
        else if (bookingData.status === 'driver_assigned') {
          const cancellationFee = Math.min(50, bookingData.pricing.totalAmount * 0.1); // 10% or ₹50, whichever is less
          refundAmount = bookingData.pricing.totalAmount - cancellationFee;
        }
      }

      // Update booking status
      await this.updateBookingStatus(bookingId, 'cancelled', cancelledBy, {
        'cancellation.cancelledBy': cancelledBy,
        'cancellation.reason': reason,
        'cancellation.cancelledAt': new Date(),
        'cancellation.refundAmount': refundAmount
      });

      // If driver was assigned, update driver location
      if (bookingData.driverId) {
        await this.db.collection('driverLocations').doc(bookingData.driverId).update({
          currentTripId: null,
          lastUpdated: new Date()
        });
      }

      return {
        success: true,
        message: 'Booking cancelled successfully',
        data: {
          refundAmount,
          cancellationFee: bookingData.pricing?.totalAmount - refundAmount || 0
        }
      };

    } catch (error) {
      console.error('Error cancelling booking:', error);
      throw error;
    }
  }

  /**
   * Get available drivers for a booking
   * @param {Object} pickupLocation - Pickup coordinates
   * @param {number} radius - Search radius in km
   * @param {string} vehicleType - Required vehicle type
   * @returns {Array} Available drivers
   */
  async getAvailableDrivers(pickupLocation, radius = 5, vehicleType = null) {
    try {
      const query = this.db.collection('driverLocations')
        .where('isOnline', '==', true)
        .where('isAvailable', '==', true);

      const snapshot = await query.get();
      const availableDrivers = [];

      for (const doc of snapshot.docs) {
        const driverData = doc.data();
        
        // Check if driver has current trip
        if (driverData.currentTripId) continue;

        // Check vehicle type if specified
        if (vehicleType && driverData.vehicleType !== vehicleType) continue;

        // Calculate distance to pickup
        if (driverData.currentLocation) {
          const distance = this.calculateHaversineDistance(
            driverData.currentLocation,
            pickupLocation
          );

          if (distance <= radius) {
            availableDrivers.push({
              driverId: doc.id,
              distance,
              rating: driverData.rating || 0,
              totalTrips: driverData.totalTrips || 0,
              currentLocation: driverData.currentLocation
            });
          }
        }
      }

      // Sort by distance and rating
      availableDrivers.sort((a, b) => {
        const distanceDiff = a.distance - b.distance;
        if (Math.abs(distanceDiff) < 1) { // Within 1km, prioritize rating
          return b.rating - a.rating;
        }
        return distanceDiff;
      });

      return availableDrivers;

    } catch (error) {
      console.error('Error getting available drivers:', error);
      throw error;
    }
  }

  /**
   * Assign driver to booking
   * @param {string} bookingId - Booking ID
   * @param {string} driverId - Driver ID
   * @returns {Object} Assignment result
   */
  async assignDriverToBooking(bookingId, driverId) {
    try {
      // Check if driver is still available
      const driverDoc = await this.db.collection('driverLocations').doc(driverId).get();
      if (!driverDoc.exists || !driverDoc.data().isAvailable) {
        throw new Error('Driver is no longer available');
      }

      // Update booking
      await this.updateBookingStatus(bookingId, 'driver_assigned', 'system', {
        driverId
      });

      // Update driver location
      await this.db.collection('driverLocations').doc(driverId).update({
        currentTripId: bookingId,
        lastUpdated: new Date()
      });

      return {
        success: true,
        message: 'Driver assigned successfully',
        data: { driverId, bookingId }
      };

    } catch (error) {
      console.error('Error assigning driver:', error);
      throw error;
    }
  }

  /**
   * Get booking details
   * @param {string} bookingId - Booking ID
   * @returns {Object} Booking details
   */
  async getBookingDetails(bookingId) {
    try {
      const bookingDoc = await this.db.collection('bookings').doc(bookingId).get();
      
      if (!bookingDoc.exists) {
        throw new Error('Booking not found');
      }

      const bookingData = bookingDoc.data();

      // Get driver details if assigned
      let driverDetails = null;
      if (bookingData.driverId) {
        const driverDoc = await this.db.collection('users').doc(bookingData.driverId).get();
        if (driverDoc.exists) {
          const driver = driverDoc.data();
          driverDetails = {
            id: driver.id,
            name: driver.name,
            phone: driver.phone,
            rating: driver.driver?.rating || 0,
            vehicleDetails: driver.driver?.vehicleDetails || {}
          };
        }
      }

      // Get trip tracking
      const trackingDoc = await this.db.collection('tripTracking').doc(bookingId).get();
      const tracking = trackingDoc.exists ? trackingDoc.data() : null;

      return {
        success: true,
        message: 'Booking details retrieved successfully',
        data: {
          booking: bookingData,
          driver: driverDetails,
          tracking
        }
      };

    } catch (error) {
      console.error('Error getting booking details:', error);
      throw error;
    }
  }

  /**
   * Get customer bookings with enhanced data for order history
   * @param {string} customerId - Customer ID
   * @param {Object} filters - Filter options
   * @returns {Object} Enhanced booking history
   */
  async getCustomerBookingsEnhanced(customerId, filters = {}) {
    try {
      let query = this.db.collection('bookings')
        .where('customerId', '==', customerId);

      // Apply filters
      if (filters.status) {
        if (Array.isArray(filters.status)) {
          query = query.where('status', 'in', filters.status);
        } else {
          query = query.where('status', '==', filters.status);
        }
      }

      if (filters.startDate) {
        query = query.where('createdAt', '>=', new Date(filters.startDate));
      }

      if (filters.endDate) {
        query = query.where('createdAt', '<=', new Date(filters.endDate));
      }

      // Order by creation date
      query = query.orderBy('createdAt', 'desc');

      // Apply pagination
      if (filters.limit) {
        query = query.limit(parseInt(filters.limit));
      }

      if (filters.offset) {
        query = query.offset(parseInt(filters.offset));
      }

      const snapshot = await query.get();
      const bookings = [];

      // Process each booking and enrich with additional data
      for (const doc of snapshot.docs) {
        const bookingData = doc.data();
        
        // Format booking for frontend consumption
        const formattedBooking = {
          id: doc.id,
          bookingId: bookingData.id || doc.id,
          status: bookingData.status,
          date: bookingData.timing?.createdAt?.toDate?.() || bookingData.createdAt?.toDate?.() || new Date(),
          
          // Pickup information
          pickup: {
            name: bookingData.pickup?.name || '',
            phone: bookingData.pickup?.phone || '',
            address: bookingData.pickup?.address || '',
            coordinates: bookingData.pickup?.coordinates || null,
            instructions: bookingData.pickup?.instructions || ''
          },
          
          // Dropoff information
          dropoff: {
            name: bookingData.dropoff?.name || '',
            phone: bookingData.dropoff?.phone || '',
            address: bookingData.dropoff?.address || '',
            coordinates: bookingData.dropoff?.coordinates || null,
            instructions: bookingData.dropoff?.instructions || ''
          },
          
          // Vehicle information
          vehicleType: bookingData.vehicle?.type || '2_wheeler',
          
          // Package information
          package: {
            weight: bookingData.package?.weight || 0,
            description: bookingData.package?.description || '',
            dimensions: bookingData.package?.dimensions || null,
            isFragile: bookingData.package?.isFragile || false,
            requiresSpecialHandling: bookingData.package?.requiresSpecialHandling || false
          },
          
          // Fare information
          price: `₹${bookingData.fare?.total || 0}`,
          fare: {
            base: bookingData.fare?.base || 0,
            distance: bookingData.fare?.distance || 0,
            time: bookingData.fare?.time || 0,
            total: bookingData.fare?.total || 0,
            currency: bookingData.fare?.currency || 'INR'
          },
          
          // Distance information
          distance: bookingData.distance?.total || 0,
          
          // Payment information
          paymentMethod: bookingData.paymentMethod || 'cash',
          paymentStatus: bookingData.paymentStatus || 'pending',
          
          // Timing information
          estimatedPickupTime: bookingData.timing?.estimatedPickupTime,
          estimatedDeliveryTime: bookingData.timing?.estimatedDeliveryTime,
          actualPickupTime: bookingData.timing?.actualPickupTime,
          actualDeliveryTime: bookingData.timing?.actualDeliveryTime,
          
          // Driver information
          driver: null,
          
          // Rating information
          rating: bookingData.rating || null,
          
          // Reorder information
          canReorder: bookingData.status === 'delivered',
          reorderedFrom: bookingData.reorderedFrom || null
        };

        // Fetch driver information if available and requested
        if (filters.includeDriver !== false && bookingData.driverId) {
          try {
            const driverDoc = await this.db.collection('users').doc(bookingData.driverId).get();
            if (driverDoc.exists) {
              const driverData = driverDoc.data();
              formattedBooking.driver = {
                id: bookingData.driverId,
                name: driverData.profile?.name || driverData.personalInfo?.name || 'Driver',
                phone: driverData.phoneNumber || '',
                rating: driverData.driver?.rating || 0,
                vehicleNumber: driverData.driver?.vehicleInfo?.vehicleNumber || '',
                profileImage: driverData.profile?.profilePicture || null
              };
            }
          } catch (driverError) {
            console.warn('Failed to fetch driver info for booking:', doc.id, driverError.message);
          }
        }

        bookings.push(formattedBooking);
      }

      return {
        success: true,
        message: 'Customer bookings retrieved successfully',
        data: {
          bookings,
          total: bookings.length,
          hasMore: bookings.length === (filters.limit || 20),
          filters
        }
      };

    } catch (error) {
      console.error('Error getting enhanced customer bookings:', error);
      throw error;
    }
  }

  /**
   * Get driver's trip history
   * @param {string} driverId - Driver ID
   * @param {Object} filters - Filter options
   * @returns {Object} Trip history
   */
  async getDriverTrips(driverId, filters = {}) {
    try {
      let query = this.db.collection('bookings')
        .where('driverId', '==', driverId);

      // Apply filters
      if (filters.status) {
        query = query.where('status', '==', filters.status);
      }

      if (filters.startDate) {
        query = query.where('createdAt', '>=', new Date(filters.startDate));
      }

      if (filters.endDate) {
        query = query.where('createdAt', '<=', new Date(filters.endDate));
      }

      // Order by creation date
      query = query.orderBy('createdAt', 'desc');

      // Apply pagination
      if (filters.limit) {
        query = query.limit(parseInt(filters.limit));
      }

      if (filters.offset) {
        query = query.offset(parseInt(filters.offset));
      }

      const snapshot = await query.get();
      const trips = [];

      snapshot.forEach(doc => {
        trips.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return {
        success: true,
        message: 'Driver trips retrieved successfully',
        data: {
          trips,
          total: trips.length,
          filters
        }
      };

    } catch (error) {
      console.error('Error getting driver trips:', error);
      throw error;
    }
  }

  /**
   * Validate service area for booking locations
   * @param {Object} bookingData - Booking data
   * @returns {Object} Validation result
   */
  async validateServiceArea(bookingData) {
    try {
      return serviceAreaValidation.validateBookingLocations(bookingData);
    } catch (error) {
      console.error('Error validating service area:', error);
      return {
        isValid: false,
        message: 'Failed to validate service area'
      };
    }
  }

  /**
   * Get service area information
   * @returns {Object} Service area information
   */
  getServiceAreaInfo() {
    return serviceAreaValidation.getServiceAreaInfo();
  }
}

module.exports = new BookingService();
