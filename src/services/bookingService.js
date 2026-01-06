/**
 * ⚠️ IMPORTANT: Fare calculation logic must match fareCalculationService.js
 * 
 * AUTHORITATIVE SOURCE: backend/src/services/fareCalculationService.js
 * 
 * CURRENT RATES (DO NOT CHANGE WITHOUT UPDATING ALL FILES):
 * - Customer Rate: ₹10/km
 * - Rounding: Math.ceil() (round up to next km)
 * - Base Fare: ₹0
 * - Commission: ₹2/km (deducted from driver points wallet)
 * 
 * See fareCalculationService.js header for full update checklist.
 */

const { getFirestore } = require('./firebase');
const { GeoPoint, FieldValue } = require('firebase-admin/firestore');
const axios = require('axios');
const serviceAreaValidation = require('./serviceAreaValidation');
const walletService = require('./walletService');

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
   * Create a new delivery booking with atomic transaction
   * @param {Object} bookingData - Booking information
   * @returns {Object} Created booking with calculated pricing
   */
  async createBookingAtomically(bookingData) {
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

      // ✅ CRITICAL FIX: Check for existing active bookings (exclude delivered/completed)
      // ✅ Use shared constants for consistency
      const { ACTIVE_BOOKING_STATUSES } = require('../constants/bookingStatuses');
      const existingActiveBooking = await this.db.collection('bookings')
        .where('customerId', '==', customerId)
        .where('status', 'in', ACTIVE_BOOKING_STATUSES)
        .limit(1)
        .get();

      if (!existingActiveBooking.empty) {
        const existingData = existingActiveBooking.docs[0].data();
        throw new Error(`Customer already has an active booking (ID: ${existingData.id}, Status: ${existingData.status}). Please complete or cancel the current booking before creating a new one.`);
      }

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

      // Use atomic transaction for booking creation
      const result = await this.db.runTransaction(async (transaction) => {
        const bookingId = this.db.collection('bookings').doc().id;
        const bookingRef = this.db.collection('bookings').doc(bookingId);
        
        // ✅ CRITICAL FIX: Ensure specialInstructions is preserved in package object
        const packageData = {
          ...packageInfo,
          // Explicitly preserve specialInstructions if provided
          specialInstructions: packageInfo?.specialInstructions || ''
        };

        // Create booking document
        const booking = {
          id: bookingId,
          customerId,
          pickup: {
            ...pickup,
            coordinates: new GeoPoint(pickup.coordinates.latitude, pickup.coordinates.longitude)
          },
          dropoff: {
            ...dropoff,
            coordinates: new GeoPoint(dropoff.coordinates.latitude, dropoff.coordinates.longitude)
          },
          package: packageData, // ✅ CRITICAL FIX: Use packageData that explicitly includes specialInstructions
          vehicle,
          paymentMethod,
          status: 'pending', // Initial status - waiting for driver acceptance
          pricing,
          distance: {
            value: distance,
            text: `${distance} km`
          },
          estimatedPickupTime: estimatedPickupTime ? new Date(estimatedPickupTime) : null,
          estimatedDeliveryTime: estimatedDeliveryTime ? new Date(estimatedDeliveryTime) : null,
          createdAt: new Date(),
          updatedAt: new Date(),
          // ✅ FIX: Persist idempotency key for duplicate detection and debugging
          idempotencyKey: bookingData.idempotencyKey || null,
          // Driver assignment fields (initially null)
          driverId: null,
          assignedAt: null,
          acceptedAt: null,
          // Timing fields
          timing: {
            createdAt: new Date(),
            estimatedPickupTime: estimatedPickupTime ? new Date(estimatedPickupTime) : null,
            estimatedDeliveryTime: estimatedDeliveryTime ? new Date(estimatedDeliveryTime) : null,
            actualPickupTime: null,
            actualDeliveryTime: null
          }
        };

        // Set booking document in transaction
        transaction.set(bookingRef, booking);

        // Update customer's booking count in users collection
        const customerRef = this.db.collection('users').doc(customerId);
        transaction.update(customerRef, {
          totalBookings: FieldValue.increment(1),
          lastBookingAt: new Date(),
          updatedAt: new Date()
        });

        return { bookingId, booking };
      });

      console.log(`✅ Booking ${result.bookingId} created atomically`);

      return {
        success: true,
        message: 'Booking created successfully',
        data: {
          booking: result.booking
        }
      };

    } catch (error) {
      console.error('❌ Error creating booking atomically:', error);
      return {
        success: false,
        message: error.message || 'Failed to create booking',
        error: error
      };
    }
  }

  /**
   * Driver accepts booking with atomic transaction
   * @param {string} bookingId - Booking ID
   * @param {string} driverId - Driver ID
   * @param {Object} acceptanceData - Additional acceptance data
   * @returns {Object} Acceptance result
   */
  async acceptBookingAtomically(bookingId, driverId, acceptanceData = {}) {
    try {
      const { estimatedArrival } = acceptanceData;

      // Use atomic transaction for driver acceptance
      const result = await this.db.runTransaction(async (transaction) => {
        const bookingRef = this.db.collection('bookings').doc(bookingId);
        // ✅ CRITICAL FIX: Use 'users' collection, not 'drivers' collection
        const driverRef = this.db.collection('users').doc(driverId);

        // Get current booking and driver data
        const [bookingDoc, driverDoc] = await Promise.all([
          transaction.get(bookingRef),
          transaction.get(driverRef)
        ]);

        if (!bookingDoc.exists) {
          throw new Error('Booking not found');
        }

        if (!driverDoc.exists) {
          throw new Error('Driver not found');
        }

        const booking = bookingDoc.data();
        const driver = driverDoc.data();

        // Validate booking can be accepted
        if (booking.status !== 'pending') {
          throw new Error(`Booking cannot be accepted. Current status: ${booking.status}`);
        }

        // ✅ USE VALIDATION UTILITY: Comprehensive check for all driverId edge cases
        const bookingValidation = require('../utils/bookingValidation');
        if (!bookingValidation.isDriverIdEmpty(booking.driverId)) {
          const normalizedDriverId = bookingValidation.normalizeDriverId(booking.driverId);
          if (normalizedDriverId !== driverId) {
            throw new Error('Booking is already assigned to another driver');
          }
          // Same driver - allow idempotent accept
        }

        // ✅ CRITICAL FIX: Check driver availability from correct field (driver.driver.isAvailable, not driver.status)
        if (!driver.driver?.isAvailable || !driver.driver?.isOnline) {
          throw new Error('Driver is not available');
        }

        // ✅ CRITICAL FIX: Check if driver already has an active booking (exclude delivered/completed)
        // ✅ Use shared constants for consistency (excluding pending as drivers don't have pending bookings)
        const { ACTIVE_BOOKING_STATUSES } = require('../constants/bookingStatuses');
        const driverActiveStatuses = ACTIVE_BOOKING_STATUSES.filter(s => s !== 'pending');
        const driverActiveBooking = await this.db.collection('bookings')
          .where('driverId', '==', driverId)
          .where('status', 'in', driverActiveStatuses)
          .limit(1)
          .get();

        if (!driverActiveBooking.empty) {
          const existingDriverBooking = driverActiveBooking.docs[0].data();
          throw new Error(`Driver already has an active booking (ID: ${existingDriverBooking.id}, Status: ${existingDriverBooking.status}). Please complete the current booking before accepting a new one.`);
        }

        // Update booking with driver acceptance
        const driverVehicleDetails = driver.driver?.vehicleDetails || {};
        const vehicleModel =
          driver.driver?.vehicleModel ||
          driverVehicleDetails.vehicleModel ||
          booking.driverInfo?.vehicleModel ||
          '';
        const vehicleNumber =
          driver.driver?.vehicleNumber ||
          driverVehicleDetails.vehicleNumber ||
          booking.driverInfo?.vehicleNumber ||
          '';
        const vehicleColor =
          driver.driver?.vehicleColor ||
          driverVehicleDetails.vehicleColor ||
          booking.driverInfo?.vehicleColor ||
          '';
        const vehicleType =
          driver.driver?.vehicleType ||
          driverVehicleDetails.vehicleType ||
          booking.driverInfo?.vehicleType ||
          '';
        const driverInfo = {
          id: driverId,
          name: driver.name || driver.driver?.name || booking.driverInfo?.name || 'Driver',
          phone: driver.phone || driver.driver?.phone || booking.driverInfo?.phone || '',
          rating: driver.driver?.rating || driver.driver?.averageRating || booking.driverInfo?.rating || 4.5,
          vehicleType,
          vehicleNumber,
          vehicleModel,
          vehicleColor,
          vehicleDetails: {
            ...driverVehicleDetails
          },
          vehicleInfo: {
            ...driverVehicleDetails
          },
          estimatedArrival: estimatedArrival || booking.driverInfo?.estimatedArrival || null,
          profileImage: driver.driver?.profileImage || driver.photoURL || booking.driverInfo?.profileImage || null,
          currentLocation: driver.driver?.currentLocation || booking.driverInfo?.currentLocation || null
        };

        const updatedBooking = {
          ...booking,
          driverId: driverId,
          status: 'driver_assigned',
          assignedAt: new Date(),
          acceptedAt: new Date(),
          updatedAt: new Date(),
          driverInfo: {
            ...(booking.driverInfo || {}),
            ...driverInfo
          },
          driver: {
            ...(booking.driver || {}),
            ...driverInfo
          },
          timing: {
            ...booking.timing,
            assignedAt: new Date(),
            acceptedAt: new Date(),
            estimatedArrival: estimatedArrival || null
          }
        };

        // ✅ CRITICAL FIX: Update driver status using correct field structure
        transaction.update(driverRef, {
          'driver.isAvailable': false,
          'driver.currentBookingId': bookingId,
          updatedAt: new Date()
        });
        
        // ✅ CRITICAL FIX: Update driverLocations collection atomically
        const driverLocationRef = this.db.collection('driverLocations').doc(driverId);
        transaction.set(driverLocationRef, {
          driverId: driverId,
          currentTripId: bookingId,
          lastUpdated: new Date()
        }, { merge: true });

        // Apply booking updates in transaction
        transaction.update(bookingRef, updatedBooking);

        return { booking: updatedBooking, driver: driverInfo };
      });

      console.log(`✅ Driver ${driverId} accepted booking ${bookingId} atomically`);

      return {
        success: true,
        message: 'Booking accepted successfully',
        data: result
      };

    } catch (error) {
      console.error('❌ Error accepting booking atomically:', error);
      return {
        success: false,
        message: error.message || 'Failed to accept booking',
        error: error
      };
    }
  }

  /**
   * Create a new delivery booking (legacy method - kept for backward compatibility)
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
          // phone removed - sender phone not needed
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
          time: 0, // No time charges
          total: pricing.total, // Use the correct total from pricing calculation
          currency: 'INR'
        },
        
        paymentMethod,
        paymentStatus: 'pending',
        
        timing: {
          createdAt: new Date(),
          estimatedPickupTime: estimatedPickupTime || new Date(Date.now() + 15 * 60 * 1000), // Default: 15 minutes from now
          estimatedDeliveryTime: estimatedDeliveryTime || new Date(Date.now() + 45 * 60 * 1000) // Default: 45 minutes from now
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
        data: { 
          booking,
          serviceAreaWarnings: serviceAreaValidation.warnings || []
        }
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
   * @param {number} exactDistance - Exact distance in kilometers
   * @param {number} weight - Package weight in kg
   * @param {string} vehicleType - Vehicle type (2_wheeler only)
   * @returns {Object} Pricing breakdown
   */
  async calculatePricing(exactDistance, weight, vehicleType) {
    try {
      // Only support 2-wheeler vehicles
      if (vehicleType !== '2_wheeler') {
        throw new Error('Only 2-wheeler vehicles are supported');
      }

      const rates = await this.getDefaultRates();
      
      // Round up to next km for any fraction
      // e.g., 6.3km → 7km, 6.1km → 7km, 6.0km → 6km
      const roundedDistance = Math.ceil(exactDistance);
      
      // Base calculation using rounded distance - NO BASE FARE
      const baseFare = 0; // NO BASE FARE
      const perKmRate = rates.baseRate; // ₹10 per km
      const distanceCharge = roundedDistance * perKmRate;
      
      // Vehicle type multiplier - only 2-wheeler supported
      const vehicleMultiplier = 1; // 2-wheeler has no multiplier
      
      // SIMPLIFIED PRICING: No weight multiplier, no surge pricing, no base fare
      // Weight doesn't affect fare - removed weight multiplier
      const weightMultiplier = 1; // No weight-based charges
      
      // Calculate total - SIMPLE: Distance charge ONLY (no base fare)
      const subtotal = distanceCharge; // Only distance charge
      
      // NO SURGE PRICING - removed surge calculation
      const surgeMultiplier = 1.0; // No surge pricing
      const totalWithSurge = subtotal; // No surge applied
      
      // Round to nearest rupee
      const finalTotal = Math.round(totalWithSurge);
      
      return {
        exactDistance: parseFloat(exactDistance.toFixed(2)), // Show exact distance
        roundedDistance: roundedDistance, // Distance used for pricing
        baseFare,
        distanceCharge,
        vehicleMultiplier,
        weightMultiplier,
        surgeMultiplier,
        subtotal,
        total: finalTotal,
        totalAmount: finalTotal, // Alias for backward compatibility
        currency: 'INR',
        ratePerKm: perKmRate, // ₹10 per km
        timeCharge: 0, // No time-based charges
        breakdown: {
          exactDistance: parseFloat(exactDistance.toFixed(2)),
          roundedDistance: roundedDistance,
          baseFare: 0, // No base fare
          distanceCharge,
          vehicleCharge: 0, // No additional charge for 2-wheeler
          weightCharge: 0, // No weight-based charges
          surgeCharge: 0, // No surge pricing
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
  calculateSurgePricing() {
    // SIMPLIFIED: No surge pricing at any time
    // Always return 1.0 (no surge multiplier)
    return 1.0;
  }

  /**
   * Get default delivery rates
   * @returns {Object} Default rates
   */
  getDefaultRates() {
    // Default rates for 2-wheeler only - SIMPLIFIED PRICING
    const defaultRates = {
      baseFare: 0, // NO BASE FARE - removed completely
      baseRate: 10, // ₹10 per km only
      vehicleRates: {
        '2_wheeler': 1 // no multiplier for 2-wheeler
      },
      // REMOVED: No weight surcharge, distance surcharge, or time surcharge
      // Simple pricing: ₹10 per km ONLY (no base fare)
      weightSurcharge: {
        threshold: 0, // No weight surcharge
        rate: 0 // No additional charges
      },
      distanceSurcharge: {
        threshold: 0, // No distance surcharge
        rate: 0 // No additional charges
      },
      timeSurcharge: {
        peakHours: {
          start: '00:00',
          end: '00:00',
          multiplier: 1.0 // No surge pricing
        },
        nightHours: {
          start: '00:00',
          end: '00:00',
          multiplier: 1.0 // No surge pricing
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
    const maxWeight = 25; // kg
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

      // ✅ UNIFIED STATUS DEFINITION: Use shared constants for consistency
      const { VALID_BOOKING_STATUSES } = require('../constants/bookingStatuses');
      const validStatuses = VALID_BOOKING_STATUSES;

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
          updateData['timing.assignedAt'] = new Date();
          break;
        case 'driver_enroute':
          updateData['timing.driverEnrouteAt'] = new Date();
          break;
      case 'driver_arrived':
        updateData['timing.driverArrivedAt'] = new Date();
        break;
      case 'photo_captured':
        updateData['timing.photoCapturedAt'] = new Date();
        break;
      case 'picked_up':
        updateData['timing.pickedUpAt'] = new Date();
        break;
      case 'in_transit':
        updateData['timing.inTransitAt'] = new Date();
        break;
      case 'at_dropoff':
        updateData['timing.arrivedDropoffAt'] = new Date();
        break;
      case 'delivered':
        updateData['timing.deliveredAt'] = new Date();
        
        // ✅ CRITICAL FIX: Deduct commission when trip is delivered (fallback - primary is payment confirmation)
        try {
          const bookingData = bookingDoc.data();
          const driverId = bookingData.driverId;
          
          // ✅ CRITICAL FIX: Check if commission was already deducted (from payment confirmation)
          const alreadyDeducted = bookingData.commissionDeducted?.amount || bookingData.commissionDeducted || false;
          if (alreadyDeducted) {
            console.log(`⚠️ [BOOKING_SERVICE] Commission already deducted for booking ${bookingId}. Skipping duplicate deduction.`);
            // Use existing commission data
            updateData.commissionDeducted = bookingData.commissionDeducted;
          } else if (driverId) {
            // Get the actual fare amount paid by customer
            const tripFare = bookingData.fare?.totalFare || bookingData.fare?.total || bookingData.fare || 0;
            const exactDistanceKm = bookingData.distance?.total || bookingData.exactDistance || bookingData.pricing?.distance || 0;
            
            // ✅ CRITICAL FIX: Always use fareCalculationService for proper rounding (0.5km → 1km, 8.4km → 9km)
            const fareCalculationService = require('./fareCalculationService');
            let fareBreakdown;
            let roundedDistanceKm;
            let commissionAmount;
            
            if (exactDistanceKm > 0) {
              fareBreakdown = fareCalculationService.calculateFare(exactDistanceKm);
              roundedDistanceKm = fareBreakdown.roundedDistanceKm; // Rounded distance (e.g., 8.4km → 9km)
              commissionAmount = fareBreakdown.commission; // Commission based on rounded distance (e.g., 9km × ₹2 = ₹18)
            } else {
              // ✅ CRITICAL FIX: Even if distance is 0, use fareCalculationService for minimum commission
              fareBreakdown = fareCalculationService.calculateFare(0.5); // 0.5km rounds to 1km
              roundedDistanceKm = fareBreakdown.roundedDistanceKm; // Will be 1km
              commissionAmount = fareBreakdown.commission; // Will be ₹2 (1km × ₹2/km)
            }
            
            console.log(`💰 [BOOKING_SERVICE] Deducting commission for trip ${bookingId}:`, {
              exactDistanceKm: exactDistanceKm.toFixed(2),
              roundedDistanceKm: roundedDistanceKm,
              commissionAmount: commissionAmount,
              tripFare: tripFare,
              calculation: `${roundedDistanceKm}km × ₹2/km = ₹${commissionAmount}`
            });
            
            // Prepare trip details for commission transaction
            const tripDetails = {
              bookingId: bookingId,
              pickupLocation: bookingData.pickup || {},
              dropoffLocation: bookingData.dropoff || {},
              tripFare: tripFare,
              distance: roundedDistanceKm, // ✅ Use rounded distance
              exactDistance: exactDistanceKm,
              paymentMethod: 'cash'
            };
            
            // Deduct commission from driver wallet
            const commissionResult = await walletService.deductPoints(
              driverId,
              bookingId,
              roundedDistanceKm, // ✅ Pass rounded distance
              commissionAmount,
              tripDetails
            );
            
            if (commissionResult.success) {
              console.log(`✅ [BOOKING_SERVICE] Commission deducted: ₹${commissionAmount} (${roundedDistanceKm}km × ₹2/km, fare: ₹${tripFare})`);
              updateData.commissionDeducted = {
                amount: commissionAmount,
                roundedDistanceKm: roundedDistanceKm,
                exactDistanceKm: exactDistanceKm,
                tripFare: tripFare,
                transactionId: commissionResult.data?.transactionId || commissionResult.transactionId,
                deductedAt: new Date(),
                deductedBy: driverId
              };
            } else {
              console.error('❌ [BOOKING_SERVICE] Commission deduction failed:', commissionResult.error);
              // ✅ CRITICAL FIX: Still mark booking to prevent duplicate attempts
              updateData.commissionDeducted = {
                amount: commissionAmount,
                roundedDistanceKm: roundedDistanceKm,
                exactDistanceKm: exactDistanceKm,
                status: 'failed',
                failureReason: commissionResult.error,
                deductedAt: new Date(),
                deductedBy: driverId
              };
              updateData.commissionError = commissionResult.error;
            }
          }
        } catch (commissionError) {
          console.error('❌ [BOOKING_SERVICE] Error processing commission:', commissionError);
          updateData.commissionError = commissionError.message;
        }
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
      // ✅ REVIEWER BYPASS: Skip validation when reviewer flag is set
      if (bookingData?.reviewerBypass) {
        return {
          isValid: true,
          message: 'Reviewer bypass enabled - service area validation skipped',
          reviewerBypass: true
        };
      }
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
