const express = require('express');
const router = express.Router();
const socketService = require('../services/socket');
const driverAssignmentService = require('../services/driverAssignmentService');
const notificationService = require('../services/notificationService');
const { requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

/**
 * @route   GET /api/realtime/status
 * @desc    Get real-time service status
 * @access  Public
 */
router.get('/status', async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        websocket: {
          connectedUsers: socketService.getConnectedUsersCount(),
          activeBookingRooms: socketService.getActiveBookingRoomsCount(),
          driverLocations: Array.from(socketService.getDriverLocations().keys()).length
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Get real-time status error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REALTIME_STATUS_ERROR',
        message: 'Failed to get real-time status'
      }
    });
  }
});

/**
 * @route   GET /api/realtime/booking/:bookingId/driver-location
 * @desc    Get driver's current live location for a booking
 * @access  Private (Customer)
 */
router.get('/booking/:bookingId/driver-location', [
  requireRole(['customer']),
], async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { getFirestore } = require('../services/firebase');
    const db = getFirestore();

    // Get booking to verify customer owns it and get driverId
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
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

    const booking = bookingDoc.data();
    
    // Verify customer owns this booking
    if (booking.customerId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get driver's current location from tripTracking or driverLocations
    let driverLocation = null;
    let lastUpdate = null;

    // First try: Get from tripTracking (most up-to-date during active trip)
    if (booking.driverId) {
      const tripTrackingDoc = await db.collection('tripTracking').doc(bookingId).get();
      if (tripTrackingDoc.exists) {
        const tripTracking = tripTrackingDoc.data();
        if (tripTracking.currentLocation) {
          driverLocation = tripTracking.currentLocation;
          lastUpdate = tripTracking.lastUpdated || tripTracking.updatedAt;
        }
      }

      // Fallback: Get from driverLocations if not in tripTracking
      if (!driverLocation) {
        const driverLocDoc = await db.collection('driverLocations').doc(booking.driverId).get();
        if (driverLocDoc.exists) {
          const driverLoc = driverLocDoc.data();
          if (driverLoc.currentLocation) {
            driverLocation = driverLoc.currentLocation;
            lastUpdate = driverLoc.lastUpdated;
          }
        }
      }
    }

    if (!driverLocation) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_LOCATION_NOT_AVAILABLE',
          message: 'Driver location not available'
        },
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      success: true,
      data: {
        bookingId,
        driverId: booking.driverId,
        location: {
          latitude: driverLocation.latitude,
          longitude: driverLocation.longitude,
          accuracy: driverLocation.accuracy || null,
          speed: driverLocation.speed || null,
          heading: driverLocation.heading || null,
          timestamp: driverLocation.timestamp ? new Date(driverLocation.timestamp).toISOString() : null
        },
        lastUpdated: lastUpdate ? new Date(lastUpdate).toISOString() : null
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get driver location error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DRIVER_LOCATION_ERROR',
        message: 'Failed to get driver location'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/realtime/drivers/nearby
 * @desc    Find nearby available drivers
 * @access  Private (Customer)
 */
router.post('/drivers/nearby', [
  requireRole(['customer']),
  body('pickupLocation.lat').isFloat().withMessage('Valid latitude is required'),
  body('pickupLocation.lng').isFloat().withMessage('Valid longitude is required'),
  body('maxDistance').optional().isFloat({ min: 1000, max: 50000 }).withMessage('Max distance must be between 1-50km')
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
        }
      });
    }

    const { pickupLocation, maxDistance } = req.body;
    const result = await driverAssignmentService.findNearbyDrivers(pickupLocation, maxDistance);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Find nearby drivers error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DRIVER_SEARCH_ERROR',
        message: 'Failed to find nearby drivers'
      }
    });
  }
});

/**
 * @route   POST /api/realtime/drivers/assign
 * @desc    Assign driver to booking
 * @access  Private (Customer, Admin)
 */
router.post('/drivers/assign', [
  requireRole(['customer', 'admin']),
  body('bookingId').notEmpty().withMessage('Booking ID is required'),
  body('driverId').optional().notEmpty().withMessage('Driver ID is required if manual assignment'),
  body('pickupLocation.lat').optional().isFloat().withMessage('Valid latitude is required'),
  body('pickupLocation.lng').optional().isFloat().withMessage('Valid longitude is required')
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
        }
      });
    }

    const { bookingId, driverId, pickupLocation } = req.body;
    const assignedBy = req.user.uid;

    let result;
    if (driverId) {
      // Manual assignment
      result = await driverAssignmentService.manualAssignDriver(bookingId, driverId, assignedBy);
    } else {
      // Auto assignment
      if (!pickupLocation) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_LOCATION',
            message: 'Pickup location is required for auto assignment'
          }
        });
      }
      result = await driverAssignmentService.autoAssignDriver(bookingId, pickupLocation);
    }

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Assign driver error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DRIVER_ASSIGNMENT_ERROR',
        message: 'Failed to assign driver'
      }
    });
  }
});

/**
 * @route   POST /api/realtime/drivers/unassign
 * @desc    Unassign driver from booking
 * @access  Private (Customer, Admin)
 */
router.post('/drivers/unassign', [
  requireRole(['customer', 'admin']),
  body('bookingId').notEmpty().withMessage('Booking ID is required')
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
        }
      });
    }

    const { bookingId } = req.body;
    const unassignedBy = req.user.uid;

    const result = await driverAssignmentService.unassignDriver(bookingId, unassignedBy);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Unassign driver error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DRIVER_UNASSIGNMENT_ERROR',
        message: 'Failed to unassign driver'
      }
    });
  }
});

/**
 * @route   POST /api/realtime/location/update
 * @desc    Update driver location
 * @access  Private (Driver)
 */
router.post('/location/update', [
  requireRole(['driver']),
  body('bookingId').notEmpty().withMessage('Booking ID is required'),
  body('location.lat').isFloat().withMessage('Valid latitude is required'),
  body('location.lng').isFloat().withMessage('Valid longitude is required'),
  body('estimatedArrival').optional().isInt({ min: 1 }).withMessage('Estimated arrival must be positive')
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
        }
      });
    }

    const { bookingId, location, estimatedArrival } = req.body;
    const driverId = req.user.uid;

    // Update location in database
    await socketService.updateDriverLocationInDB(driverId, location, bookingId);

    // ✅ CRITICAL FIX: Get booking details to find customer ID
    const db = require('../services/firebase').getFirestore();
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    
    if (bookingDoc.exists) {
      const bookingData = bookingDoc.data();
      const customerId = bookingData.customerId;
      
      // ✅ CRITICAL FIX: Send to multiple rooms to ensure customer receives the event
      const userRoom = `user:${customerId}`;
      const bookingRoom = `booking:${bookingId}`;
      
      const locationUpdateData = {
        bookingId,
        driverId,
        location: {
          latitude: Number(location.lat),
          longitude: Number(location.lng),
          timestamp: new Date().toISOString()
        },
        estimatedArrival,
        timestamp: new Date().toISOString()
      };
      
      // ✅ CRITICAL FIX: Emit to both user room and booking room
      const getSocketIO = require('../services/socket').getSocketIO;
      try {
        const io = getSocketIO();
        if (io) {
          io.to(userRoom).emit('driver_location_update', locationUpdateData);
          io.to(bookingRoom).emit('driver_location_update', locationUpdateData);
          console.log(`📍 [REALTIME] Broadcasted location update to rooms:`, { userRoom, bookingRoom });
        }
      } catch (ioError) {
        console.error('❌ [REALTIME] Error getting Socket.IO instance:', ioError);
        // Fallback to sendToBooking
        socketService.sendToBooking(bookingId, 'driver_location_update', locationUpdateData);
      }
    } else {
      // Fallback: use sendToBooking if booking not found
      // ✅ CRITICAL FIX: Use consistent event name (driver_location_update with underscore)
      socketService.sendToBooking(bookingId, 'driver_location_update', {
        driverId,
        location: {
          latitude: Number(location.lat),
          longitude: Number(location.lng),
          timestamp: new Date().toISOString()
        },
        estimatedArrival,
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: {
        bookingId,
        location,
        estimatedArrival,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOCATION_UPDATE_ERROR',
        message: 'Failed to update location'
      }
    });
  }
});

/**
 * @route   POST /api/realtime/booking/status
 * @desc    Update booking status
 * @access  Private (Customer, Driver)
 */
router.post('/booking/status', [
  requireRole(['customer', 'driver']),
  body('bookingId').notEmpty().withMessage('Booking ID is required'),
  body('status').isIn(['confirmed', 'assigned', 'picked_up', 'delivering', 'delivered', 'cancelled']).withMessage('Valid status is required'),
  body('message').optional().isString().withMessage('Message must be a string')
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
        }
      });
    }

    const { bookingId, status, message } = req.body;
    const updatedBy = req.user.uid;

    // Update booking status in database
    await socketService.updateBookingStatus(bookingId, status, updatedBy);

    // Broadcast to booking room
    socketService.sendToBooking(bookingId, 'booking-status-update', {
      bookingId,
      status,
      message,
      updatedBy,
      timestamp: new Date().toISOString()
    });

    // Send notification
    await notificationService.sendBookingStatusNotification(
      req.user.uid,
      bookingId,
      status
    );

    res.status(200).json({
      success: true,
      message: 'Booking status updated successfully',
      data: {
        bookingId,
        status,
        message,
        updatedBy,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Update booking status error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_STATUS_ERROR',
        message: 'Failed to update booking status'
      }
    });
  }
});

/**
 * @route   POST /api/realtime/test/simulate
 * @desc    Admin-only: simulate websocket events for a booking
 * @access  Private (Admin)
 */
router.post('/test/simulate', [
  requireRole(['admin']),
  body('bookingId').notEmpty().withMessage('Booking ID is required'),
  body('driverId').optional().isString(),
  // ✅ CRITICAL FIX: Use consistent event name (driver_location_update with underscore)
  body('event').isIn(['booking_status_update', 'driver_location_update']).withMessage('Valid event is required'),
  body('payload').optional().isObject()
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
        }
      });
    }

    const { bookingId, driverId, event, payload = {} } = req.body;

    // Broadcast to booking room and relevant users
    if (event === 'booking_status_update') {
      socketService.sendToBooking(bookingId, 'booking_status_update', {
        bookingId,
        status: payload.status || 'driver_enroute',
        message: payload.message || 'Test status update',
        updatedBy: req.user.uid,
        timestamp: new Date().toISOString(),
        testingMode: true
      });
    }

    // ✅ CRITICAL FIX: Use consistent event name (driver_location_update with underscore)
    if (event === 'driver_location_update') {
      const loc = payload.location || { lat: 12.973, lng: 77.595 };
      socketService.sendToBooking(bookingId, 'driver_location_update', {
        driverId: driverId || 'test-driver',
        location: { lat: loc.lat, lng: loc.lng },
        estimatedArrival: payload.estimatedArrival || 8,
        timestamp: new Date().toISOString(),
        testingMode: true
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Test event emitted',
      data: { bookingId, event, payload }
    });
  } catch (error) {
    console.error('Realtime test simulate error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SIMULATION_ERROR',
        message: 'Failed to emit test event'
      }
    });
  }
});

/**
 * @route   POST /api/realtime/payment/status
 * @desc    Update payment status
 * @access  Private (Customer, Driver)
 */
router.post('/payment/status', [
  requireRole(['customer', 'driver']),
  body('paymentId').notEmpty().withMessage('Payment ID is required'),
  body('status').isIn(['pending', 'completed', 'failed', 'refunded']).withMessage('Valid status is required'),
  body('message').optional().isString().withMessage('Message must be a string')
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
        }
      });
    }

    const { paymentId, status, message } = req.body;
    const updatedBy = req.user.uid;

    // Update payment status in database
    await socketService.updatePaymentStatus(paymentId, status, updatedBy);

    // Get payment record to find booking
    const payment = await socketService.getPayment(paymentId);
    if (payment) {
      // Broadcast to booking room
      socketService.sendToBooking(payment.bookingId, 'payment-status-update', {
        paymentId,
        bookingId: payment.bookingId,
        status,
        message,
        updatedBy,
        timestamp: new Date().toISOString()
      });

      // Send notification
      await notificationService.sendPaymentStatusNotification(
        payment.customerId,
        paymentId,
        status
      );
    }

    res.status(200).json({
      success: true,
      message: 'Payment status updated successfully',
      data: {
        paymentId,
        status,
        message,
        updatedBy,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Update payment status error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PAYMENT_STATUS_ERROR',
        message: 'Failed to update payment status'
      }
    });
  }
});

/**
 * @route   GET /api/realtime/notifications
 * @desc    Get user's notification history
 * @access  Private
 */
router.get('/notifications', [
  requireRole(['customer', 'driver', 'admin'])
], async (req, res) => {
  try {
    const { limit = 20, offset = 0, type, status } = req.query;
    const userId = req.user.uid;

    const filters = {
      limit: parseInt(limit),
      offset: parseInt(offset)
    };

    if (type) filters.type = type;
    if (status) filters.status = status;

    const result = await notificationService.getNotificationHistory(userId, filters);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATIONS_ERROR',
        message: 'Failed to get notifications'
      }
    });
  }
});

/**
 * @route   PUT /api/realtime/notifications/:notificationId/read
 * @desc    Mark notification as read
 * @access  Private
 */
router.put('/notifications/:notificationId/read', [
  requireRole(['customer', 'driver', 'admin'])
], async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.uid;

    const result = await notificationService.markNotificationAsRead(userId, notificationId);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'MARK_READ_ERROR',
        message: 'Failed to mark notification as read'
      }
    });
  }
});

/**
 * @route   DELETE /api/realtime/notifications/:notificationId
 * @desc    Delete notification
 * @access  Private
 */
router.delete('/notifications/:notificationId', [
  requireRole(['customer', 'driver', 'admin'])
], async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.uid;

    const result = await notificationService.deleteNotification(userId, notificationId);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_NOTIFICATION_ERROR',
        message: 'Failed to delete notification'
      }
    });
  }
});

/**
 * @route   GET /api/realtime/statistics
 * @desc    Get real-time statistics
 * @access  Private (Admin)
 */
router.get('/statistics', [
  requireRole(['admin'])
], async (req, res) => {
  try {
    const [assignmentStats, notificationStats] = await Promise.all([
      driverAssignmentService.getAssignmentStatistics(),
      notificationService.getNotificationStatistics()
    ]);

    res.status(200).json({
      success: true,
      data: {
        assignment: assignmentStats.success ? assignmentStats.data : null,
        notifications: notificationStats.success ? notificationStats.data : null,
        websocket: {
          connectedUsers: socketService.getConnectedUsersCount(),
          activeBookingRooms: socketService.getActiveBookingRoomsCount(),
          driverLocations: Array.from(socketService.getDriverLocations().keys()).length
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Get real-time statistics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'STATISTICS_ERROR',
        message: 'Failed to get real-time statistics'
      }
    });
  }
});

module.exports = router;
