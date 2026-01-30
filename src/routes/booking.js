const express = require('express');
const { body, validationResult, query } = require('express-validator');
const bookingService = require('../services/bookingService');
// const driverAssignmentService = require('../services/driverAssignmentService'); // Commented out - only used in commented code
const { getSocketIO, getEventHandler } = require('../services/socket');
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
  // pickup.phone validation removed - sender phone not needed
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
    .matches(/^(\+91|91)?[\s]?[6-9]\d{4}[\s]?\d{5}$/)
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
    .isIn(['cash', 'upi', 'wallet'])
    .withMessage('Payment method must be cash, upi, or wallet'),
  body('estimatedPickupTime')
    .optional()
    .isISO8601()
    .withMessage('Estimated pickup time must be a valid ISO 8601 date'),
  body('estimatedDeliveryTime')
    .optional()
    .isISO8601()
    .withMessage('Estimated delivery time must be a valid ISO 8601 date'),
  body('idempotencyKey')
    .isString()
    .withMessage('Idempotency key is required for duplicate prevention')
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

    const { idempotencyKey } = req.body;
    const db = getFirestore();

    // ✅ IDEMPOTENCY CHECK - Prevent duplicate bookings
    console.log('🔍 [IDEMPOTENCY] Checking for existing booking with key:', idempotencyKey);
    const existingBooking = await db.collection('bookings')
      .where('customerId', '==', req.user.uid)
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();

    if (!existingBooking.empty) {
      const existingData = existingBooking.docs[0].data();
      console.log('⚠️ [IDEMPOTENCY] Duplicate request detected, returning existing booking');
      return res.status(200).json({
        success: true,
        message: 'Booking already created (duplicate request prevented)',
        data: {
          booking: existingData,
          isDuplicate: true
        },
        timestamp: new Date().toISOString()
      });
    }
    console.log('✅ [IDEMPOTENCY] No duplicate found, proceeding with new booking');

    const bookingData = {
      ...req.body,
      customerId: req.user.uid,
      idempotencyKey: idempotencyKey // Store for future duplicate checks
    };

    // ✅ REVIEWER BYPASS: Allow reviewer customer to skip location restriction
    const reviewerBypassEnabled = process.env.REVIEWER_BYPASS_ENABLED === 'true';
    const reviewerCustomerPhone = process.env.REVIEWER_CUSTOMER_PHONE;
    let isReviewerCustomer = false;

    if (reviewerBypassEnabled && reviewerCustomerPhone) {
      try {
        const userDoc = await db.collection('users').doc(req.user.uid).get();
        const userPhone = userDoc?.data()?.phone;
        // ✅ FIX: Normalize phone numbers before comparison
        const { comparePhoneNumbers } = require('../utils/phoneUtils');
        isReviewerCustomer = comparePhoneNumbers(userPhone, reviewerCustomerPhone);
      } catch (reviewerCheckError) {
        console.warn('⚠️ [REVIEWER] Failed to check reviewer customer status:', reviewerCheckError);
      }
    }

    if (isReviewerCustomer) {
      bookingData.reviewerBypass = true;
      console.log('🔓 [REVIEWER] Service area validation bypass enabled for reviewer customer');
    }

    // Create booking with atomic transaction
    const result = await bookingService.createBookingAtomically(bookingData);

    // If booking creation succeeded, notify drivers and admin (manual acceptance workflow)
    if (result.success && result.data.booking) {
      // Notify drivers in background (non-blocking)
      setImmediate(async () => {
        try {
          console.log(`📢 Broadcasting new booking ${result.data.booking.id} to available drivers`);
          
          // ✅ Send push notification to customer (booking created)
          try {
            const notificationService = require('../services/notificationService');
            await notificationService.notifyCustomerBookingCreated({
              customerId: req.user.uid,
              bookingId: result.data.booking.id,
              pickup: result.data.booking.pickup,
              dropoff: result.data.booking.dropoff,
              fare: result.data.booking.pricing?.total || result.data.booking.fare?.total || 0
            });
            console.log(`✅ [BOOKING_CREATE] Push notification sent to customer for booking ${result.data.booking.id}`);
          } catch (pushError) {
            console.warn('⚠️ [BOOKING_CREATE] Failed to send push notification to customer:', pushError);
            // Don't fail if push notification fails
          }
          
          // Notify available drivers (WebSocket + push) - single source to avoid duplicate pushes
          const wsEventHandler = getEventHandler();
          await wsEventHandler.notifyDriversOfNewBooking(result.data.booking);

          console.log(`✅ Booking ${result.data.booking.id} broadcasted to nearby drivers for manual acceptance`);
          
          // ✅ CRITICAL FIX: Notify admin dashboard of new booking for real-time customer count updates
          try {
            const io = getSocketIO();
            if (io) {
              io.to('type:admin').emit('booking_created', {
                bookingId: result.data.booking.id,
                customerId: result.data.booking.customerId,
                status: result.data.booking.status || 'pending',
                pickupLocation: result.data.booking.pickup,
                dropoffLocation: result.data.booking.dropoff,
                fare: result.data.booking.pricing?.total || result.data.booking.fare?.total || 0,
                createdAt: result.data.booking.createdAt?.toISOString?.() || new Date().toISOString(),
                timestamp: new Date().toISOString()
              });
              console.log(`📤 [BOOKING_CREATE] Emitted booking_created event to admin dashboard for booking ${result.data.booking.id}`);
            }
          } catch (adminNotificationError) {
            console.warn('⚠️ [BOOKING_CREATE] Failed to notify admin of booking creation:', adminNotificationError);
            // Don't fail if admin notification fails
          }
          
          // Note: Auto-assignment disabled - drivers manually accept bookings
          // If you want to enable auto-assignment in the future, uncomment below:
          /*
          const assignmentResult = await driverAssignmentService.autoAssignDriver(
            result.data.booking.id, 
            result.data.booking.pickup.coordinates
          );
          
          if (assignmentResult.success) {
            console.log(`✅ Driver ${assignmentResult.data.driverId} auto-assigned to booking ${result.data.booking.id}`);
            await wsEventHandler.notifyCustomerOfDriverAssignment(
              result.data.booking.customerId,
              {
                bookingId: result.data.booking.id,
                driverId: assignmentResult.data.driverId,
                driverName: assignmentResult.data.driverName,
                driverPhone: assignmentResult.data.driverPhone,
                vehicleInfo: assignmentResult.data.vehicleInfo,
                estimatedArrival: assignmentResult.data.estimatedArrival
              }
            );
          }
          */
        } catch (notificationError) {
          console.error('❌ Error notifying drivers:', notificationError);
          // Log error but don't fail the booking
        }
      });
    }

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
  // pickup.phone validation removed - sender phone not needed
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
    .isIn(['cash', 'upi', 'wallet'])
    .withMessage('Payment method must be cash, upi, or wallet'),
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
 * @route   POST /api/bookings/:id/accept
 * @desc    Driver accepts booking (Driver only)
 * @access  Private (Driver only)
 */
router.post('/:id/accept', [
  requireDriver,
  body('estimatedArrival')
    .optional()
    .isISO8601()
    .withMessage('Estimated arrival time must be a valid ISO 8601 date')
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
    const { estimatedArrival } = req.body;

    // ✅ CRITICAL FIX: Use BookingLockService for distributed locking (consistent with main endpoint)
    // Note: This endpoint may be deprecated in favor of /api/driver/bookings/:id/accept
    // But keeping it updated for backward compatibility
    const BookingLockService = require('../services/bookingLockService');
    const bookingLockService = new BookingLockService();
    
    // Acquire exclusive lock for booking acceptance
    try {
      await bookingLockService.acquireBookingLock(id, uid);
    } catch (error) {
      if (error.message === 'BOOKING_LOCKED') {
        // Verify booking state before returning error
        const db = getFirestore();
        const bookingRef = db.collection('bookings').doc(id);
        const freshBookingCheck = await bookingRef.get();
        
        if (freshBookingCheck.exists) {
          const freshBooking = freshBookingCheck.data();
          // ✅ USE VALIDATION UTILITY: Comprehensive check for all driverId edge cases
          const bookingValidation = require('../utils/bookingValidation');
          if (freshBooking.status === 'pending' && bookingValidation.isDriverIdEmpty(freshBooking.driverId)) {
            console.warn(`⚠️ [BOOKING_ACCEPT] Lock exists but booking ${id} is still pending. Possible stale lock. Attempting to continue...`);
            // Continue - let transaction handle race condition
          } else {
            return res.status(409).json({
              success: false,
              error: {
                code: 'BOOKING_ALREADY_ASSIGNED',
                message: 'Booking already assigned',
                details: 'This booking has already been assigned to another driver'
              },
              timestamp: new Date().toISOString()
            });
          }
        }
      } else if (error.message === 'BOOKING_ALREADY_ASSIGNED' || error.message === 'BOOKING_NOT_FOUND') {
        return res.status(error.message === 'BOOKING_NOT_FOUND' ? 404 : 409).json({
          success: false,
          error: {
            code: error.message,
            message: error.message === 'BOOKING_NOT_FOUND' ? 'Booking not found' : 'Booking already assigned',
            details: error.message
          },
          timestamp: new Date().toISOString()
        });
      }
      throw error;
    }

    try {
      // Use atomic transaction for driver acceptance
      const result = await bookingService.acceptBookingAtomically(id, uid, {
        estimatedArrival: estimatedArrival ? new Date(estimatedArrival) : null
      });
      
      // Release lock on success
      await bookingLockService.releaseBookingLock(id, uid);

      if (result.success) {
        let io = null;
        try {
          io = getSocketIO();
        } catch (socketError) {
          console.warn('⚠️ [BOOKING_ACCEPT] Unable to retrieve Socket.IO instance:', socketError.message);
        }
        const customerId = result.data.booking.customerId;
        const vehicleDetails = result.data.driver?.vehicleDetails || result.data.driver?.vehicleInfo || {};
        const driverInfo = {
          id: uid,
          name: result.data.driver?.name || 'Driver',
          phone: result.data.driver?.phone || '',
          rating: result.data.driver?.rating || 4.5,
          vehicleNumber: result.data.driver?.vehicleNumber || vehicleDetails.vehicleNumber || '',
          vehicleModel: result.data.driver?.vehicleModel || vehicleDetails.vehicleModel || '',
          vehicleColor: result.data.driver?.vehicleColor || vehicleDetails.vehicleColor || '',
          vehicleType: result.data.driver?.vehicleType || vehicleDetails.vehicleType || '',
          vehicleDetails: vehicleDetails,
          profileImage: result.data.driver?.profileImage || null
        };

        const bookingPayload = {
          ...result.data.booking,
          id,
          driverId: uid,
          driverInfo: {
            ...(result.data.booking.driverInfo || {}),
            ...driverInfo
          },
          driver: {
            ...(result.data.booking.driver || {}),
            ...driverInfo
          }
        };

        if (io) {
          const userRoom = `user:${customerId}`;
          const bookingRoom = `booking:${id}`;
          const customerRoom = 'type:customer';
          const timestamp = new Date().toISOString();

          const driverAssignedEvent = {
            bookingId: id,
            driverId: uid,
            driver: driverInfo,
            driverInfo,
            booking: bookingPayload,
            timestamp
          };

          const statusUpdateEvent = {
            bookingId: id,
            status: 'driver_assigned',
            driverInfo,
            booking: bookingPayload,
            timestamp,
            updatedBy: uid
          };

          io.to(userRoom).emit('driver_assigned', driverAssignedEvent);
          io.to(bookingRoom).emit('driver_assigned', driverAssignedEvent);
          io.to(customerRoom).emit('driver_assigned', driverAssignedEvent);

          io.to(userRoom).emit('booking_status_update', statusUpdateEvent);
          io.to(bookingRoom).emit('booking_status_update', statusUpdateEvent);
          io.to(customerRoom).emit('booking_status_update', statusUpdateEvent);

          io.to('type:admin').emit('booking_status_update', statusUpdateEvent);
        } else {
          console.warn('⚠️ [BOOKING_ACCEPT] Socket.IO instance not available while emitting driver assignment');
        }

        res.status(200).json({
          success: true,
          message: 'Booking accepted successfully',
          data: {
            ...result.data,
            booking: bookingPayload,
            driver: driverInfo
          },
          timestamp: new Date().toISOString()
        });
      } else {
        // Release lock on failure
        await bookingLockService.releaseBookingLock(id, uid);
        
        res.status(400).json({
          success: false,
          error: {
            code: 'BOOKING_ACCEPTANCE_ERROR',
            message: result.message,
            details: result.error
          },
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      console.error('Error accepting booking:', error);
      
      // Release lock on error
      try {
        await bookingLockService.releaseBookingLock(id, uid);
      } catch (lockError) {
        console.error('Error releasing booking lock:', lockError);
      }
      
      res.status(500).json({
        success: false,
        error: {
          code: 'BOOKING_ACCEPTANCE_ERROR',
          message: 'Failed to accept booking',
          details: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error in booking acceptance route:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_ACCEPTANCE_ERROR',
        message: 'Failed to accept booking',
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
 * @route   POST /api/bookings/:id/handle-timeout
 * @desc    Handle booking timeout when no driver assigned (Customer only)
 * @access  Private (Customer only)
 */
router.post('/:id/handle-timeout', [
  requireCustomer,
], async (req, res) => {
  try {
    const { id } = req.params;
    const { uid } = req.user;

    console.log(`⏰ Handling timeout for booking ${id} by customer ${uid}`);

    // Verify customer owns this booking
    const db = getFirestore();
    const bookingDoc = await db.collection('bookings').doc(id).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const bookingData = bookingDoc.data();
    if (bookingData.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You can only handle timeout for your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Handle timeout using driver matching service
    const driverMatchingService = require('../services/driverMatchingService');
    const timeoutResult = await driverMatchingService.handleBookingTimeout(id);

    if (timeoutResult.success) {
      res.status(200).json({
        success: true,
        data: {
          message: timeoutResult.message,
          action: timeoutResult.action || 'timeout_handled',
          driver: timeoutResult.driver || null
        },
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: {
          code: 'TIMEOUT_HANDLING_ERROR',
          message: 'Failed to handle booking timeout',
          details: timeoutResult.error
        },
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error handling booking timeout:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TIMEOUT_HANDLING_ERROR',
        message: 'Failed to handle booking timeout',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
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
 * @route   GET /api/bookings/:id/driver
 * @desc    Get driver assignment for a booking
 * @access  Private (Customer, Driver, Admin)
 */
router.get('/:id/driver', [
  requireRole(['customer', 'driver', 'admin']),
], async (req, res) => {
  try {
    const { id } = req.params;
    const { uid, userType } = req.user;
    const db = getFirestore();
    
    // Get booking details
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
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

    const bookingData = bookingDoc.data();
    
    // Check access permissions
    if (userType === 'customer' && bookingData.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only view driver assignments for your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    if (userType === 'driver' && bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only view driver assignments for bookings assigned to you'
        },
        timestamp: new Date().toISOString()
      });
    }

    // If no driver assigned, return appropriate response
    if (!bookingData.driverId) {
      return res.status(200).json({
        success: true,
        message: 'No driver assigned yet',
        data: {
          assignment: null,
          status: bookingData.status,
          searchingForDriver: bookingData.status === 'pending'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get driver details
    const driverRef = db.collection('users').doc(bookingData.driverId);
    const driverDoc = await driverRef.get();
    
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found',
          details: 'Assigned driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const driverData = driverDoc.data();
    
    // Prepare driver assignment response
    const assignment = {
      bookingId: id,
      driverId: bookingData.driverId,
      driver: {
        id: bookingData.driverId,
        name: driverData.name || driverData.driver?.name || 'Driver',
        phone: driverData.phone || driverData.driver?.phone || '',
        rating: driverData.driver?.rating || 4.5,
        vehicleType: driverData.driver?.vehicleType || '2 Wheeler',
        vehicleNumber: driverData.driver?.vehicleNumber || 'KA-XX-XX-XXXX',
        profileImage: driverData.driver?.profileImage,
        isOnline: driverData.driver?.isOnline || false,
        isAvailable: driverData.driver?.isAvailable || false
      },
      status: bookingData.status,
      assignedAt: bookingData.timing?.assignedAt || bookingData.createdAt,
      estimatedArrival: bookingData.timing?.estimatedPickupTime ? 
        Math.ceil((new Date(bookingData.timing.estimatedPickupTime) - new Date()) / (1000 * 60)) : 5
    };

    res.status(200).json({
      success: true,
      message: 'Driver assignment retrieved successfully',
      data: {
        assignment,
        status: bookingData.status
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting driver assignment:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DRIVER_ASSIGNMENT_ERROR',
        message: 'Failed to get driver assignment',
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
    const exactDistance = await bookingService.calculateDistance(pickup.coordinates, dropoff.coordinates);
    const pricing = await bookingService.calculatePricing(exactDistance, packageInfo.weight, vehicle.type);

    // Format response to match frontend expectations
    const chargeCalculation = {
      distance: exactDistance, // Show exact distance
      baseRate: pricing.ratePerKm,
      totalCharge: pricing.total,
      currency: 'INR',
      estimatedTime: bookingService.calculateEstimatedTime(exactDistance),
      breakdown: {
        distanceCharge: pricing.distanceCharge,
        baseFare: pricing.baseFare,
        total: pricing.total
      },
      // Add pricing transparency info
      pricingInfo: {
        exactDistance: pricing.exactDistance,
        roundedDistance: pricing.roundedDistance,
        ratePerKm: pricing.ratePerKm
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
      const socketService = require('../services/socket');
      const io = socketService.getSocketIO();
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
      const socketService = require('../services/socket');
      const io = socketService.getSocketIO();
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
