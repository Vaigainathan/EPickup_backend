/**
 * Admin Booking Management Routes
 * Handles manual driver assignment and booking management
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const { getFirestore } = require('../services/firebase');
const notificationService = require('../services/notificationService');
const errorHandlingService = require('../services/errorHandlingService');

/**
 * @route   GET /api/admin/bookings
 * @desc    Get all bookings with filters
 * @access  Private (Admin only)
 */
router.get('/bookings', authMiddleware, async (req, res) => {
  try {
    const { userType } = req.user;
    
    if (userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Only admins can access booking management'
        },
        timestamp: new Date().toISOString()
      });
    }

    const { 
      status, 
      driverId, 
      customerId, 
      startDate, 
      endDate, 
      limit = 50, 
      offset = 0,
      includeTracking = false 
    } = req.query;

    const db = getFirestore();
    let query = db.collection('bookings');

    // Apply filters
    if (status) {
      query = query.where('status', '==', status);
    }
    if (driverId) {
      query = query.where('driverId', '==', driverId);
    }
    if (customerId) {
      query = query.where('customerId', '==', customerId);
    }
    if (startDate) {
      query = query.where('createdAt', '>=', new Date(startDate));
    }
    if (endDate) {
      query = query.where('createdAt', '<=', new Date(endDate));
    }

    // Order by creation date
    query = query.orderBy('createdAt', 'desc');

    // Apply pagination
    query = query.limit(parseInt(limit)).offset(parseInt(offset));

    const snapshot = await query.get();
    const bookings = [];

    for (const doc of snapshot.docs) {
      const bookingData = doc.data();
      const booking = {
        id: doc.id,
        ...bookingData
      };

      // Include customer info
      if (bookingData.customerId) {
        const customerDoc = await db.collection('users').doc(bookingData.customerId).get();
        if (customerDoc.exists) {
          booking.customerInfo = {
            name: customerDoc.data().name,
            phone: customerDoc.data().phone,
            email: customerDoc.data().email
          };
        }
      }

      // Include driver info
      if (bookingData.driverId) {
        const driverDoc = await db.collection('users').doc(bookingData.driverId).get();
        if (driverDoc.exists) {
          booking.driverInfo = {
            name: driverDoc.data().name,
            phone: driverDoc.data().phone,
            vehicleNumber: driverDoc.data().driver?.vehicleNumber,
            isOnline: driverDoc.data().driver?.isOnline,
            isAvailable: driverDoc.data().driver?.isAvailable
          };
        }
      }

      // Include tracking data if requested
      if (includeTracking === 'true') {
        const trackingDoc = await db.collection('locationTracking').doc(doc.id).get();
        if (trackingDoc.exists) {
          booking.trackingData = trackingDoc.data();
        }
      }

      bookings.push(booking);
    }

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
    const errorResponse = errorHandlingService.handleApiError(error, {
      endpoint: '/api/admin/bookings',
      method: 'GET'
    });
    res.status(errorResponse.statusCode || 500).json(errorResponse);
  }
});

/**
 * @route   POST /api/admin/bookings/:bookingId/assign-driver
 * @desc    Manually assign driver to booking
 * @access  Private (Admin only)
 */
router.post('/bookings/:bookingId/assign-driver', [
  authMiddleware,
  body('driverId').notEmpty().withMessage('Driver ID is required'),
  body('reason').optional().isString().withMessage('Reason must be a string')
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

    const { userType } = req.user;
    if (userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Only admins can assign drivers'
        },
        timestamp: new Date().toISOString()
      });
    }

    const { bookingId } = req.params;
    const { driverId, reason = 'Manual assignment by admin' } = req.body;

    const db = getFirestore();
    const batch = db.batch();

    // Get booking
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();

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

    // Check if booking is assignable
    if (bookingData.status !== 'pending' && bookingData.status !== 'driver_assigned') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BOOKING_STATUS',
          message: 'Booking cannot be assigned in current status'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get driver info
    const driverDoc = await db.collection('users').doc(driverId).get();
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const driverData = driverDoc.data();
    if (driverData.userType !== 'driver') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a driver'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if driver is available
    if (!driverData.driver?.isOnline || !driverData.driver?.isAvailable) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_AVAILABLE',
          message: 'Driver is not online or available'
        },
        timestamp: new Date().toISOString()
      });
    }

    // ✅ CRITICAL FIX: Check if driver is verified
    const verificationStatus = driverData.driver?.verificationStatus || driverData.verificationStatus;
    if (verificationStatus !== 'verified' && verificationStatus !== 'approved') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_VERIFIED',
          message: 'Driver is not verified',
          details: 'Only verified drivers can be assigned to bookings',
          currentStatus: verificationStatus
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update booking
    batch.update(bookingRef, {
      driverId,
      status: 'driver_assigned',
      assignedAt: new Date(),
      assignmentReason: reason,
      assignedBy: req.user.uid,
      updatedAt: new Date()
    });

    // Create assignment record
    const assignmentRef = db.collection('driverAssignments').doc();
    batch.set(assignmentRef, {
      bookingId,
      driverId,
      assignedAt: new Date(),
      assignedBy: req.user.uid,
      reason,
      status: 'assigned'
    });

    // Update driver's active bookings count
    const driverRef = db.collection('users').doc(driverId);
    batch.update(driverRef, {
      'driver.activeBookings': (driverData.driver?.activeBookings || 0) + 1,
      updatedAt: new Date()
    });

    await batch.commit();

    // Send notifications
    await Promise.all([
      // Notify customer
      notificationService.notifyCustomerDriverAssigned(bookingData, {
        name: driverData.name,
        phone: driverData.phone,
        vehicleNumber: driverData.driver?.vehicleNumber
      }),
      
      // Notify driver
      notificationService.sendTemplateNotification(
        driverId,
        'DRIVER',
        'BOOKING_ACCEPTED',
        {
          bookingId,
          customerName: bookingData.customerInfo?.name || 'Customer',
          pickupAddress: bookingData.pickup?.address,
          dropoffAddress: bookingData.dropoff?.address,
          fare: bookingData.fare?.total
        }
      )
    ]);

    // ✅ CRITICAL FIX: Notify driver via WebSocket for real-time updates
    try {
      const wsEventHandler = require('../services/websocketEventHandler');
      await wsEventHandler.notifyDriverOfAssignment(driverId, {
        bookingId,
        customerName: bookingData.pickup?.name || 'Customer',
        pickupAddress: bookingData.pickup?.address,
        dropoffAddress: bookingData.dropoff?.address,
        estimatedFare: bookingData.pricing?.total || bookingData.fare?.total || 0,
        assignedBy: req.user.uid,
        assignedAt: new Date().toISOString()
      });
      console.log(`✅ [ADMIN_ASSIGNMENT] Driver ${driverId} notified via WebSocket for booking ${bookingId}`);
    } catch (notificationError) {
      console.error('❌ [ADMIN_ASSIGNMENT] Failed to notify driver via WebSocket:', notificationError);
      // Don't fail the assignment if WebSocket notification fails
    }

    res.status(200).json({
      success: true,
      message: 'Driver assigned successfully',
      data: {
        bookingId,
        driverId,
        driverName: driverData.name,
        assignedAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error assigning driver:', error);
    const errorResponse = errorHandlingService.handleApiError(error, {
      endpoint: '/api/admin/bookings/:bookingId/assign-driver',
      method: 'POST',
      bookingId: req.params.bookingId,
      driverId: req.body.driverId
    });
    res.status(errorResponse.statusCode || 500).json(errorResponse);
  }
});

/**
 * @route   POST /api/admin/bookings/:bookingId/reassign-driver
 * @desc    Reassign driver to booking
 * @access  Private (Admin only)
 */
router.post('/bookings/:bookingId/reassign-driver', [
  authMiddleware,
  body('newDriverId').notEmpty().withMessage('New driver ID is required'),
  body('reason').optional().isString().withMessage('Reason must be a string')
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

    const { userType } = req.user;
    if (userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Only admins can reassign drivers'
        },
        timestamp: new Date().toISOString()
      });
    }

    const { bookingId } = req.params;
    const { newDriverId, reason = 'Manual reassignment by admin' } = req.body;

    const db = getFirestore();
    const batch = db.batch();

    // Get booking
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();

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
    const oldDriverId = bookingData.driverId;

    // Get new driver info
    const newDriverDoc = await db.collection('users').doc(newDriverId).get();
    if (!newDriverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_FOUND',
          message: 'New driver not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const newDriverData = newDriverDoc.data();

    // Update booking
    batch.update(bookingRef, {
      driverId: newDriverId,
      previousDriverId: oldDriverId,
      reassignedAt: new Date(),
      reassignmentReason: reason,
      reassignedBy: req.user.uid,
      updatedAt: new Date()
    });

    // Create reassignment record
    const reassignmentRef = db.collection('driverReassignments').doc();
    batch.set(reassignmentRef, {
      bookingId,
      oldDriverId,
      newDriverId,
      reassignedAt: new Date(),
      reassignedBy: req.user.uid,
      reason,
      status: 'reassigned'
    });

    // Update driver counts
    if (oldDriverId) {
      const oldDriverRef = db.collection('users').doc(oldDriverId);
      const oldDriverDoc = await oldDriverRef.get();
      const oldDriverData = oldDriverDoc.data();
      
      batch.update(oldDriverRef, {
        'driver.activeBookings': Math.max((oldDriverData.driver?.activeBookings || 1) - 1, 0),
        updatedAt: new Date()
      });
    }

    const newDriverRef = db.collection('users').doc(newDriverId);
    batch.update(newDriverRef, {
      'driver.activeBookings': (newDriverData.driver?.activeBookings || 0) + 1,
      updatedAt: new Date()
    });

    await batch.commit();

    // Send notifications
    await Promise.all([
      // Notify customer about reassignment
      notificationService.sendTemplateNotification(
        bookingData.customerId,
        'CUSTOMER',
        'DRIVER_ASSIGNED',
        {
          bookingId,
          driverName: newDriverData.name,
          eta: '15 mins'
        }
      ),
      
      // Notify new driver
      notificationService.sendTemplateNotification(
        newDriverId,
        'DRIVER',
        'BOOKING_ACCEPTED',
        {
          bookingId,
          customerName: bookingData.customerInfo?.name || 'Customer',
          pickupAddress: bookingData.pickup?.address,
          dropoffAddress: bookingData.dropoff?.address,
          fare: bookingData.fare?.total
        }
      ),
      
      // Notify old driver if exists
      oldDriverId && notificationService.sendTemplateNotification(
        oldDriverId,
        'DRIVER',
        'BOOKING_CANCELLED',
        {
          bookingId,
          reason: 'Reassigned to another driver'
        }
      )
    ].filter(Boolean));

    res.status(200).json({
      success: true,
      message: 'Driver reassigned successfully',
      data: {
        bookingId,
        oldDriverId,
        newDriverId,
        newDriverName: newDriverData.name,
        reassignedAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error reassigning driver:', error);
    const errorResponse = errorHandlingService.handleApiError(error, {
      endpoint: '/api/admin/bookings/:bookingId/reassign-driver',
      method: 'POST',
      bookingId: req.params.bookingId,
      newDriverId: req.body.newDriverId
    });
    res.status(errorResponse.statusCode || 500).json(errorResponse);
  }
});

/**
 * @route   GET /api/admin/available-drivers
 * @desc    Get available drivers for assignment
 * @access  Private (Admin only)
 */
router.get('/available-drivers', authMiddleware, async (req, res) => {
  try {
    const { userType } = req.user;
    if (userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Only admins can access driver information'
        },
        timestamp: new Date().toISOString()
      });
    }

    const { location, radius = 10 } = req.query;
    const db = getFirestore();

    // Get online and available drivers
    const query = db.collection('users')
      .where('userType', '==', 'driver')
      .where('driver.isOnline', '==', true)
      .where('driver.isAvailable', '==', true);

    const snapshot = await query.get();
    const drivers = [];

    for (const doc of snapshot.docs) {
      const driverData = doc.data();
      
      // Calculate distance if location provided
      let distance = null;
      if (location && driverData.driver?.currentLocation) {
        const [lat, lng] = location.split(',').map(Number);
        distance = calculateDistance(
          lat,
          lng,
          driverData.driver.currentLocation.latitude,
          driverData.driver.currentLocation.longitude
        );
        
        // Filter by radius
        if (distance > radius) {
          continue;
        }
      }

      drivers.push({
        id: doc.id,
        name: driverData.name,
        phone: driverData.phone,
        vehicleNumber: driverData.driver?.vehicleNumber,
        currentLocation: driverData.driver?.currentLocation,
        activeBookings: driverData.driver?.activeBookings || 0,
        rating: driverData.driver?.rating || 0,
        distance: distance ? Math.round(distance * 100) / 100 : null,
        lastSeen: driverData.driver?.lastSeen || driverData.updatedAt
      });
    }

    // Sort by distance if location provided, otherwise by rating
    if (location) {
      drivers.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    } else {
      drivers.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }

    res.status(200).json({
      success: true,
      message: 'Available drivers retrieved successfully',
      data: {
        drivers,
        total: drivers.length,
        filters: {
          location,
          radius: parseInt(radius)
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting available drivers:', error);
    const errorResponse = errorHandlingService.handleApiError(error, {
      endpoint: '/api/admin/available-drivers',
      method: 'GET'
    });
    res.status(errorResponse.statusCode || 500).json(errorResponse);
  }
});

/**
 * @route   POST /api/admin/bookings/:bookingId/cancel
 * @desc    Cancel booking (Admin only)
 * @access  Private (Admin only)
 */
router.post('/bookings/:bookingId/cancel', [
  authMiddleware,
  body('reason').notEmpty().withMessage('Cancellation reason is required')
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

    const { userType } = req.user;
    if (userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Only admins can cancel bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    const { bookingId } = req.params;
    const { reason } = req.body;

    const db = getFirestore();
    const batch = db.batch();

    // Get booking
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();

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

    // Update booking
    batch.update(bookingRef, {
      status: 'cancelled',
      cancellationReason: reason,
      cancelledBy: req.user.uid,
      cancelledAt: new Date(),
      updatedAt: new Date()
    });

    // Update driver's active bookings count if assigned
    if (bookingData.driverId) {
      const driverRef = db.collection('users').doc(bookingData.driverId);
      const driverDoc = await driverRef.get();
      const driverData = driverDoc.data();
      
      batch.update(driverRef, {
        'driver.activeBookings': Math.max((driverData.driver?.activeBookings || 1) - 1, 0),
        updatedAt: new Date()
      });
    }

    await batch.commit();

    // Send notifications
    await Promise.all([
      // Notify customer
      notificationService.sendTemplateNotification(
        bookingData.customerId,
        'CUSTOMER',
        'BOOKING_CANCELLED',
        {
          bookingId,
          reason
        }
      ),
      
      // Notify driver if assigned
      bookingData.driverId && notificationService.sendTemplateNotification(
        bookingData.driverId,
        'DRIVER',
        'BOOKING_CANCELLED',
        {
          bookingId,
          reason: 'Booking cancelled by admin'
        }
      )
    ].filter(Boolean));

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: {
        bookingId,
        reason,
        cancelledAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error cancelling booking:', error);
    const errorResponse = errorHandlingService.handleApiError(error, {
      endpoint: '/api/admin/bookings/:bookingId/cancel',
      method: 'POST',
      bookingId: req.params.bookingId
    });
    res.status(errorResponse.statusCode || 500).json(errorResponse);
  }
});

// Helper function to calculate distance
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = router;
