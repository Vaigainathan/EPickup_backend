const express = require('express');
const { body, validationResult, query } = require('express-validator');
const bookingService = require('../services/bookingService');
const { requireRole, requireCustomer, requireDriver } = require('../middleware/auth');
const { userRateLimit } = require('../middleware/auth');
const { getFirestore } = require('../services/firebase');
const { requireOwnership } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   POST /api/bookings
 * @desc    Create a new delivery booking
 * @access  Private (Customer only)
 */
router.post('/', [
  requireCustomer,
  userRateLimit(3, 5 * 60 * 1000), // 3 attempts per 5 minutes
  body('pickup.name')
    .isLength({ min: 2, max: 50 })
    .withMessage('Pickup name must be between 2 and 50 characters'),
  body('pickup.phone')
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number for pickup'),
  body('pickup.address')
    .isLength({ min: 10, max: 200 })
    .withMessage('Pickup address must be between 10 and 200 characters'),
  body('pickup.coordinates.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Pickup latitude must be between -90 and 90'),
  body('pickup.coordinates.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Pickup longitude must be between -180 and 180'),
  body('dropoff.name')
    .isLength({ min: 2, max: 50 })
    .withMessage('Dropoff name must be between 2 and 50 characters'),
  body('dropoff.phone')
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number for dropoff'),
  body('dropoff.address')
    .isLength({ min: 10, max: 200 })
    .withMessage('Dropoff address must be between 10 and 200 characters'),
  body('dropoff.coordinates.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Dropoff latitude must be between -90 and 90'),
  body('dropoff.coordinates.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Dropoff longitude must be between -180 and 180'),
  body('package.weight')
    .isFloat({ min: 0.1, max: 50 })
    .withMessage('Package weight must be between 0.1 and 50 kg'),
  body('vehicle.type')
    .isIn(['2_wheeler'])
    .withMessage('Vehicle type must be 2_wheeler'),
  body('paymentMethod')
    .isIn(['cash', 'online', 'wallet'])
    .withMessage('Payment method must be cash, online, or wallet'),
  body('estimatedPickupTime')
    .optional()
    .isISO8601()
    .withMessage('Estimated pickup time must be a valid ISO 8601 date'),
  body('estimatedDeliveryTime')
    .optional()
    .isISO8601()
    .withMessage('Estimated delivery time must be a valid ISO 8601 date')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const bookingData = {
      ...req.body,
      customerId: req.user.uid
    };

    // Create booking
    const result = await bookingService.createBooking(bookingData);

    res.status(201).json({
      success: true,
      message: 'Booking created successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_CREATION_ERROR',
        message: 'Failed to create booking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/bookings/confirm
 * @desc    Confirm booking with final details (review booking screen)
 * @access  Private (Customer only)
 */
router.post('/confirm', [
  requireCustomer,
  userRateLimit(3, 5 * 60 * 1000), // 3 attempts per 5 minutes
  body('bookingId')
    .isString()
    .withMessage('Booking ID is required'),
  body('pickup.name')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Pickup name must be between 2 and 50 characters'),
  body('pickup.phone')
    .optional()
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number for pickup'),
  body('pickup.address')
    .optional()
    .isLength({ min: 10, max: 200 })
    .withMessage('Pickup address must be between 10 and 200 characters'),
  body('pickup.coordinates.latitude')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Pickup latitude must be between -90 and 90'),
  body('pickup.coordinates.longitude')
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Pickup longitude must be between -180 and 180'),
  body('dropoff.name')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Dropoff name must be between 2 and 50 characters'),
  body('dropoff.phone')
    .optional()
    .isMobilePhone('en-IN')
    .withMessage('Please provide a valid Indian phone number for dropoff'),
  body('dropoff.address')
    .optional()
    .isLength({ min: 10, max: 200 })
    .withMessage('Dropoff address must be between 10 and 200 characters'),
  body('dropoff.coordinates.latitude')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Dropoff latitude must be between -90 and 90'),
  body('dropoff.coordinates.longitude')
    .optional()
    .isFloat({ min: -180, max: 180 })
    .withMessage('Dropoff longitude must be between -180 and 180'),
  body('package.weight')
    .optional()
    .isFloat({ min: 0.1, max: 50 })
    .withMessage('Package weight must be between 0.1 and 50 kg'),
  body('paymentMethod')
    .isIn(['cash', 'online', 'wallet'])
    .withMessage('Payment method must be cash, online, or wallet'),
  body('estimatedPickupTime')
    .optional()
    .isISO8601()
    .withMessage('Estimated pickup time must be a valid ISO 8601 date'),
  body('estimatedDeliveryTime')
    .optional()
    .isISO8601()
    .withMessage('Estimated delivery time must be a valid ISO 8601 date')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { bookingId, ...updateData } = req.body;
    const { uid } = req.user;

    // Get existing booking
    const existingBooking = await bookingService.getBookingDetails(bookingId);
    if (!existingBooking.success) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found',
          details: 'The specified booking does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const { booking } = existingBooking.data;

    // Check if user owns this booking
    if (booking.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only confirm your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if booking can be confirmed
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Invalid booking status',
          details: 'Booking cannot be confirmed in its current status'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update booking with final details
    const updatedBookingData = {
      ...booking,
      ...updateData,
      status: 'confirmed',
      confirmedAt: new Date(),
      updatedAt: new Date()
    };

    // Recalculate fare if weight or locations changed
    if (updateData.package?.weight || updateData.pickup?.coordinates || updateData.dropoff?.coordinates) {
      const pickupCoords = updateData.pickup?.coordinates || booking.pickup.coordinates;
      const dropoffCoords = updateData.dropoff?.coordinates || booking.dropoff.coordinates;
      const weight = updateData.package?.weight || booking.package.weight;

      const distance = await bookingService.calculateDistance(pickupCoords, dropoffCoords);
      const pricing = await bookingService.calculatePricing(distance, weight, booking.vehicle.type);

      updatedBookingData.fare = {
        base: pricing.baseFare,
        distance: pricing.distanceCharge,
        time: pricing.timeCharge || 0,
        total: pricing.totalAmount,
        currency: 'INR'
      };
    }

    // Update booking in database
    const db = getFirestore();
    await db.collection('bookings').doc(bookingId).update(updatedBookingData);

    // Get updated booking details
    const result = await bookingService.getBookingDetails(bookingId);

    // Send confirmation notification
    try {
      const notificationService = require('../services/notificationService');
      await notificationService.sendNotificationToUser(uid, 'booking_confirmed', {
        bookingId,
        booking: result.data.booking
      });
    } catch (notificationError) {
      console.error('Failed to send confirmation notification:', notificationError);
    }

    res.status(200).json({
      success: true,
      message: 'Booking confirmed successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error confirming booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_CONFIRMATION_ERROR',
        message: 'Failed to confirm booking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/bookings/preview
 * @desc    Preview booking with calculated fare (before confirmation)
 * @access  Private (Customer only)
 */
router.post('/preview', [
  requireCustomer,
  body('pickup.coordinates.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Pickup latitude must be between -90 and 90'),
  body('pickup.coordinates.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Pickup longitude must be between -180 and 180'),
  body('dropoff.coordinates.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Dropoff latitude must be between -90 and 90'),
  body('dropoff.coordinates.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Dropoff longitude must be between -180 and 180'),
  body('package.weight')
    .isFloat({ min: 0.1, max: 50 })
    .withMessage('Package weight must be between 0.1 and 50 kg'),
  body('vehicle.type')
    .isIn(['2_wheeler'])
    .withMessage('Vehicle type must be 2_wheeler')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { pickup, dropoff, package: packageInfo, vehicle } = req.body;

    // Calculate distance and pricing
    const distance = await bookingService.calculateDistance(pickup.coordinates, dropoff.coordinates);
    const pricing = await bookingService.calculatePricing(distance, packageInfo.weight, vehicle.type);
    const estimatedTime = bookingService.calculateEstimatedTime(distance);

    // Format response to match frontend expectations
    const chargeCalculation = {
      distance: distance,
      baseRate: pricing.ratePerKm,
      totalCharge: pricing.totalAmount,
      currency: 'INR',
      estimatedTime: estimatedTime,
      breakdown: {
        distanceCharge: pricing.distanceCharge,
        baseFare: pricing.baseFare,
        timeCharge: pricing.timeCharge || 0,
        total: pricing.totalAmount
      }
    };

    // Create preview booking data
    const previewBooking = {
      id: `PREVIEW_${Date.now()}`,
      pickup,
      dropoff,
      package: packageInfo,
      vehicle,
      fare: chargeCalculation,
      estimatedPickupTime: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      estimatedDeliveryTime: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    };

    res.status(200).json({
      success: true,
      message: 'Booking preview generated successfully',
      data: {
        booking: previewBooking,
        chargeCalculation
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error generating booking preview:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_PREVIEW_ERROR',
        message: 'Failed to generate booking preview',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/bookings
 * @desc    Get all bookings (with filters)
 * @access  Private (Admin only)
 */
router.get('/', [
  requireRole(['admin']),
  query('status')
    .optional()
    .isIn(['pending', 'confirmed', 'driver_assigned', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff', 'delivered', 'cancelled'])
    .withMessage('Invalid status filter'),
  query('customerId')
    .optional()
    .isString()
    .withMessage('Customer ID must be a string'),
  query('driverId')
    .optional()
    .isString()
    .withMessage('Driver ID must be a string'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a non-negative integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { status, customerId, driverId, startDate, endDate, limit = 20, offset = 0 } = req.query;
    const db = getFirestore();
    
    let query = db.collection('bookings');
    
    // Apply filters
    if (status) query = query.where('status', '==', status);
    if (customerId) query = query.where('customerId', '==', customerId);
    if (driverId) query = query.where('driverId', '==', driverId);
    if (startDate) query = query.where('createdAt', '>=', new Date(startDate));
    if (endDate) query = query.where('createdAt', '<=', new Date(endDate));
    
    // Order by creation date
    query = query.orderBy('createdAt', 'desc');
    
    // Apply pagination
    query = query.limit(parseInt(limit)).offset(parseInt(offset));
    
    const snapshot = await query.get();
    const bookings = [];
    
    snapshot.forEach(doc => {
      bookings.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.status(200).json({
      success: true,
      message: 'Bookings retrieved successfully',
      data: {
        bookings,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: bookings.length
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting bookings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKINGS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve bookings',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/bookings/:id
 * @desc    Get specific booking details
 * @access  Private (Customer, Driver, Admin)
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { uid, userType } = req.user;

    // Get booking details
    const result = await bookingService.getBookingDetails(id);
    const { booking, driver, tracking } = result.data;

    // Check access permissions
    if (userType !== 'admin' && 
        booking.customerId !== uid && 
        booking.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only access your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      success: true,
      message: 'Booking details retrieved successfully',
      data: {
        booking,
        driver,
        tracking
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting booking details:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_DETAILS_ERROR',
        message: 'Failed to retrieve booking details',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/bookings/:id
 * @desc    Update booking details
 * @access  Private (Customer, Driver, Admin)
 */
router.put('/:id', [
  body('pickup.instructions')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Pickup instructions cannot exceed 200 characters'),
  body('dropoff.instructions')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Dropoff instructions cannot exceed 200 characters'),
  body('estimatedPickupTime')
    .optional()
    .isISO8601()
    .withMessage('Estimated pickup time must be a valid ISO 8601 date'),
  body('estimatedDeliveryTime')
    .optional()
    .isISO8601()
    .withMessage('Estimated delivery time must be a valid ISO 8601 date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { id } = req.params;
    const { uid, userType } = req.user;
    const updateData = req.body;

    // Get current booking to check permissions
    const currentBooking = await bookingService.getBookingDetails(id);
    const { booking } = currentBooking.data;

    // Check access permissions
    if (userType !== 'admin' && 
        booking.customerId !== uid && 
        booking.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only update your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Only allow updates for certain statuses
    const updatableStatuses = ['pending', 'confirmed'];
    if (!updatableStatuses.includes(booking.status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'UPDATE_NOT_ALLOWED',
          message: 'Update not allowed',
          details: 'Booking cannot be updated in its current status'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update booking
    const db = getFirestore();
    await db.collection('bookings').doc(id).update({
      ...updateData,
      updatedAt: new Date()
    });

    // Get updated booking
    const updatedResult = await bookingService.getBookingDetails(id);

    res.status(200).json({
      success: true,
      message: 'Booking updated successfully',
      data: updatedResult.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_UPDATE_ERROR',
        message: 'Failed to update booking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   DELETE /api/bookings/:id
 * @desc    Delete booking (Admin only)
 * @access  Private (Admin only)
 */
router.delete('/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if booking exists
    const bookingDoc = await getFirestore().collection('bookings').doc(id).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found',
          details: 'Booking with this ID does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Delete booking and related documents
    const batch = getFirestore().batch();
    batch.delete(bookingDoc.ref);
    batch.delete(getFirestore().collection('tripTracking').doc(id));

    await batch.commit();

    res.status(200).json({
      success: true,
      message: 'Booking deleted successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_DELETION_ERROR',
        message: 'Failed to delete booking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/bookings/:id/assign-driver
 * @desc    Assign driver to booking
 * @access  Private (Admin only)
 */
router.post('/:id/assign-driver', [
  requireRole(['admin']),
  body('driverId')
    .isString()
    .withMessage('Driver ID is required'),
  body('forceAssign')
    .optional()
    .isBoolean()
    .withMessage('Force assign must be a boolean')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { id } = req.params;
    const { driverId } = req.body;

    // Assign driver
    const result = await bookingService.assignDriverToBooking(id, driverId);

    res.status(200).json({
      success: true,
      message: 'Driver assigned successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error assigning driver:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DRIVER_ASSIGNMENT_ERROR',
        message: 'Failed to assign driver',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/bookings/:id/start-trip
 * @desc    Start trip (Driver only)
 * @access  Private (Driver only)
 */
router.post('/:id/start-trip', [
  requireDriver,
  body('location')
    .isObject()
    .withMessage('Current location is required'),
  body('location.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('location.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { id } = req.params;
    const { uid } = req.user;
    const { location } = req.body;

    // Update booking status to driver enroute
    const result = await bookingService.updateBookingStatus(id, 'driver_enroute', uid, {
      'driver.currentLocation': {
        ...location,
        timestamp: new Date()
      }
    });

    res.status(200).json({
      success: true,
      message: 'Trip started successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error starting trip:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TRIP_START_ERROR',
        message: 'Failed to start trip',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/bookings/:id/complete-trip
 * @desc    Complete trip (Driver only)
 * @access  Private (Driver only)
 */
router.post('/:id/complete-trip', [
  requireDriver,
  body('location')
    .isObject()
    .withMessage('Final location is required'),
  body('location.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('location.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  body('notes')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Notes cannot exceed 200 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { id } = req.params;
    const { uid } = req.user;
    const { location, notes } = req.body;

    // Update booking status to delivered
    const result = await bookingService.updateBookingStatus(id, 'delivered', uid, {
      'driver.currentLocation': {
        ...location,
        timestamp: new Date()
      },
      'driver.notes': notes || null,
      'timing.actualDeliveryTime': new Date()
    });

    // Update driver location
    await getFirestore().collection('driverLocations').doc(uid).update({
      currentTripId: null,
      lastUpdated: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Trip completed successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error completing trip:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TRIP_COMPLETION_ERROR',
        message: 'Failed to complete trip',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/bookings/:id/available-drivers
 * @desc    Get available drivers for a booking
 * @access  Private (Admin only)
 */
router.get('/:id/available-drivers', [
  requireRole(['admin']),
  query('radius')
    .optional()
    .isFloat({ min: 1, max: 50 })
    .withMessage('Radius must be between 1 and 50 km'),
  query('vehicleType')
    .optional()
    .isIn(['2_wheeler'])
    .withMessage('Vehicle type must be 2_wheeler')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { id } = req.params;
    const { radius = 5, vehicleType } = req.query;

    // Get booking details to get pickup location
    const bookingResult = await bookingService.getBookingDetails(id);
    const { booking } = bookingResult.data;

    if (!booking.pickup?.coordinates) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PICKUP_LOCATION',
          message: 'Invalid pickup location',
          details: 'Booking does not have valid pickup coordinates'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get available drivers
    const availableDrivers = await bookingService.getAvailableDrivers(
      booking.pickup.coordinates,
      parseFloat(radius),
      vehicleType
    );

    res.status(200).json({
      success: true,
      message: 'Available drivers retrieved successfully',
      data: {
        availableDrivers,
        searchRadius: parseFloat(radius),
        vehicleType,
        pickupLocation: booking.pickup.coordinates
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting available drivers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DRIVERS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve available drivers',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/bookings/:id/cancel
 * @desc    Cancel booking
 * @access  Private (Customer, Driver, Admin)
 */
router.post('/:id/cancel', [
  body('reason')
    .optional()
    .isLength({ min: 5, max: 200 })
    .withMessage('Reason must be between 5 and 200 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { id } = req.params;
    const { uid, userType } = req.body;
    const { reason } = req.body;

    // Get current booking to check permissions
    const currentBooking = await bookingService.getBookingDetails(id);
    const { booking } = currentBooking.data;

    // Check access permissions
    if (userType !== 'admin' && 
        booking.customerId !== uid && 
        booking.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only cancel your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Cancel booking
    const result = await bookingService.cancelBooking(id, uid, reason);

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_CANCELLATION_ERROR',
        message: 'Failed to cancel booking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/bookings/customer/:customerId
 * @desc    Get customer's booking history
 * @access  Private (Customer, Admin)
 */
router.get('/customer/:customerId', [
  requireRole(['customer', 'admin']),
  query('status')
    .optional()
    .isIn(['pending', 'confirmed', 'driver_assigned', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff', 'delivered', 'cancelled'])
    .withMessage('Invalid status filter'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a non-negative integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { customerId } = req.params;
    const { uid, userType } = req.user;
    const { status, startDate, endDate, limit = 20, offset = 0 } = req.query;

    // Check access permissions
    if (userType !== 'admin' && customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only access your own booking history'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get customer bookings
    const result = await bookingService.getCustomerBookings(customerId, {
      status,
      startDate,
      endDate,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.status(200).json({
      success: true,
      message: 'Customer bookings retrieved successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting customer bookings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CUSTOMER_BOOKINGS_ERROR',
        message: 'Failed to retrieve customer bookings',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/bookings/driver/:driverId
 * @desc    Get driver's trip history
 * @access  Private (Driver, Admin)
 */
router.get('/driver/:driverId', [
  requireRole(['driver', 'admin']),
  query('status')
    .optional()
    .isIn(['pending', 'confirmed', 'driver_assigned', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff', 'delivered', 'cancelled'])
    .withMessage('Invalid status filter'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('offset')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Offset must be a non-negative integer')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { driverId } = req.params;
    const { uid, userType } = req.user;
    const { status, startDate, endDate, limit = 20, offset = 0 } = req.query;

    // Check access permissions
    if (userType !== 'admin' && driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only access your own trip history'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get driver trips
    const result = await bookingService.getDriverTrips(driverId, {
      status,
      startDate,
      endDate,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    res.status(200).json({
      success: true,
      message: 'Driver trips retrieved successfully',
      data: result.data,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting driver trips:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DRIVER_TRIPS_ERROR',
        message: 'Failed to retrieve driver trips',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/bookings/calculate-fare
 * @desc    Calculate fare for a booking without creating it
 * @access  Private (Customer only)
 */
router.post('/calculate-fare', [
  requireCustomer,
  body('pickup.coordinates.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Pickup latitude must be between -90 and 90'),
  body('pickup.coordinates.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Pickup longitude must be between -180 and 180'),
  body('dropoff.coordinates.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Dropoff latitude must be between -90 and 90'),
  body('dropoff.coordinates.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Dropoff longitude must be between -180 and 180'),
  body('package.weight')
    .isFloat({ min: 0.1, max: 50 })
    .withMessage('Package weight must be between 0.1 and 50 kg'),
  body('vehicle.type')
    .isIn(['2_wheeler'])
    .withMessage('Vehicle type must be 2_wheeler')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: errors.array()
        },
        timestamp: new Date().toISOString()
      });
    }

    const { pickup, dropoff, package: packageInfo, vehicle } = req.body;

    // Calculate distance and pricing
    const distance = await bookingService.calculateDistance(pickup.coordinates, dropoff.coordinates);
    const pricing = await bookingService.calculatePricing(distance, packageInfo.weight, vehicle.type);

    // Format response to match frontend expectations
    const chargeCalculation = {
      distance: distance,
      baseRate: pricing.ratePerKm,
      totalCharge: pricing.totalAmount,
      currency: 'INR',
      estimatedTime: bookingService.calculateEstimatedTime(distance),
      breakdown: {
        distanceCharge: pricing.distanceCharge,
        baseFare: pricing.baseFare,
        total: pricing.totalAmount
      }
    };

    res.status(200).json({
      success: true,
      message: 'Fare calculated successfully',
      data: chargeCalculation,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error calculating fare:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FARE_CALCULATION_ERROR',
        message: 'Failed to calculate fare',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/bookings/:id/search-drivers
 * @desc    Search for available drivers for a booking
 * @access  Private (Customer only)
 */
router.post('/:id/search-drivers', [
  requireCustomer,
  requireOwnership('id', 'bookings'),
  userRateLimit(5, 2 * 60 * 1000), // 5 attempts per 2 minutes
], async (req, res) => {
  try {
    const { id: bookingId } = req.params;
    const { uid } = req.user;
    const { searchRadius = 5, vehicleType = '2_wheeler' } = req.body;

    // Get booking details
    const bookingResult = await bookingService.getBookingDetails(bookingId);
    if (!bookingResult.success) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found',
          details: 'The specified booking does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const { booking } = bookingResult.data;

    // Check if booking is in correct status for driver search
    if (booking.status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BOOKING_STATUS',
          message: 'Invalid booking status for driver search',
          details: 'Booking must be confirmed before searching for drivers'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Import driver matching service
    const DriverMatchingService = require('../services/driverMatchingService');
    const driverMatchingService = new DriverMatchingService();

    // Search for available drivers
    const searchResult = await driverMatchingService.findAndMatchDriver(booking, {
      searchRadius,
      vehicleType,
      maxWeight: booking.package?.weight || 10,
      priority: 'balanced'
    });

    if (!searchResult.success) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NO_DRIVERS_AVAILABLE',
          message: 'No drivers available',
          details: searchResult.error?.details || 'No drivers found in the area'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Format driver data for frontend
    const formattedDrivers = searchResult.data.driver ? [{
      id: searchResult.data.driver.driverId,
      name: searchResult.data.driver.name,
      phone: searchResult.data.driver.phone,
      vehicleNumber: searchResult.data.driver.vehicleInfo?.vehicleNumber || 'N/A',
      rating: searchResult.data.driver.driver?.rating || 0,
      totalTrips: searchResult.data.driver.driver?.totalTrips || 0,
      currentLocation: searchResult.data.driver.currentLocation,
      estimatedArrival: searchResult.data.driver.estimatedArrival,
      distance: searchResult.data.driver.distance,
      vehicleType: searchResult.data.driver.vehicleType,
      isAssigned: true
    }] : [];

    // Add alternative drivers
    if (searchResult.data.alternatives) {
      searchResult.data.alternatives.forEach(driver => {
        formattedDrivers.push({
          id: driver.driverId,
          name: driver.name,
          phone: driver.phone,
          vehicleNumber: driver.vehicleInfo?.vehicleNumber || 'N/A',
          rating: driver.driver?.rating || 0,
          totalTrips: driver.driver?.totalTrips || 0,
          currentLocation: driver.currentLocation,
          estimatedArrival: driver.estimatedArrival,
          distance: driver.distance,
          vehicleType: driver.vehicleType,
          isAssigned: false
        });
      });
    }

    // Update booking status to searching
    const db = getFirestore();
    await db.collection('bookings').doc(bookingId).update({
      status: 'searching',
      'timing.searchStartedAt': new Date(),
      updatedAt: new Date()
    });

    // Send real-time notification to customer
    try {
      const { getSocketIO } = require('../services/socket');
      const io = getSocketIO();
      io.to(`user:${uid}`).emit('driver_search_started', {
        bookingId,
        drivers: formattedDrivers,
        searchRadius,
        totalDriversFound: searchResult.data.totalDriversFound,
        timestamp: new Date().toISOString()
      });
    } catch (socketError) {
      console.error('Failed to send driver search notification:', socketError);
    }

    res.status(200).json({
      success: true,
      message: 'Driver search initiated successfully',
      data: {
        bookingId,
        drivers: formattedDrivers,
        searchRadius,
        totalDriversFound: searchResult.data.totalDriversFound,
        estimatedSearchTime: '30-60 seconds',
        status: 'searching'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error searching for drivers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DRIVER_SEARCH_ERROR',
        message: 'Failed to search for drivers',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/bookings/:id/cancel-search
 * @desc    Cancel driver search for a booking
 * @access  Private (Customer only)
 */
router.post('/:id/cancel-search', [
  requireCustomer,
  requireOwnership('id', 'bookings'),
  userRateLimit(3, 60 * 1000), // 3 attempts per minute
], async (req, res) => {
  try {
    const { id: bookingId } = req.params;
    const { uid } = req.user;

    // Get booking details
    const bookingResult = await bookingService.getBookingDetails(bookingId);
    if (!bookingResult.success) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found',
          details: 'The specified booking does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const { booking } = bookingResult.data;

    // Check if booking is in searching status
    if (booking.status !== 'searching') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BOOKING_STATUS',
          message: 'Invalid booking status for canceling search',
          details: 'Booking must be in searching status to cancel driver search'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update booking status back to confirmed
    const db = getFirestore();
    await db.collection('bookings').doc(bookingId).update({
      status: 'confirmed',
      'timing.searchCancelledAt': new Date(),
      updatedAt: new Date()
    });

    // Send real-time notification to customer
    try {
      const { getSocketIO } = require('../services/socket');
      const io = getSocketIO();
      io.to(`user:${uid}`).emit('driver_search_cancelled', {
        bookingId,
        timestamp: new Date().toISOString()
      });
    } catch (socketError) {
      console.error('Failed to send search cancellation notification:', socketError);
    }

    res.status(200).json({
      success: true,
      message: 'Driver search cancelled successfully',
      data: {
        bookingId,
        status: 'confirmed'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error cancelling driver search:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SEARCH_CANCELLATION_ERROR',
        message: 'Failed to cancel driver search',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
