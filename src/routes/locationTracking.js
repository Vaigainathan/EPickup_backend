/**
 * Location Tracking Routes
 * Handles real-time driver location tracking and customer updates
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const { authMiddleware, requireDriver } = require('../middleware/auth');
const locationTrackingService = require('../services/locationTrackingService');
const { getFirestore } = require('../services/firebase');

/**
 * @route   POST /api/location-tracking/start
 * @desc    Start tracking a driver for a booking
 * @access  Private (Customer, Driver, Admin)
 */
router.post('/start', [
  authMiddleware,
  body('bookingId').notEmpty().withMessage('Booking ID is required'),
  body('driverId').notEmpty().withMessage('Driver ID is required'),
  body('customerId').notEmpty().withMessage('Customer ID is required')
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

    const { bookingId, driverId, customerId } = req.body;
    const { uid, userType } = req.user;

    // Verify user has permission to start tracking
    if (userType === 'customer' && uid !== customerId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You can only start tracking for your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (userType === 'driver' && uid !== driverId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You can only start tracking for your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    const result = await locationTrackingService.startTracking(bookingId, driverId, customerId);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'Location tracking started successfully',
        data: result.trackingData,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: {
          code: 'TRACKING_START_FAILED',
          message: 'Failed to start location tracking',
          details: result.error
        },
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error starting location tracking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to start location tracking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/location-tracking/update
 * @desc    Update driver location
 * @access  Private (Driver only)
 */
router.post('/update', [
  requireDriver,
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
  body('accuracy').optional().isFloat({ min: 0 }).withMessage('Accuracy must be positive'),
  body('speed').optional().isFloat({ min: 0 }).withMessage('Speed must be positive'),
  body('heading').optional().isFloat({ min: 0, max: 360 }).withMessage('Heading must be 0-360')
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

    const { uid } = req.user;
    const { latitude, longitude, accuracy, speed, heading } = req.body;

    const locationData = {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      accuracy: accuracy ? parseFloat(accuracy) : 0,
      speed: speed ? parseFloat(speed) : 0,
      heading: heading ? parseFloat(heading) : 0,
      timestamp: new Date()
    };

    const result = await locationTrackingService.updateDriverLocation(uid, locationData);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'Location updated successfully',
        data: { location: locationData },
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: {
          code: 'LOCATION_UPDATE_FAILED',
          message: 'Failed to update location',
          details: result.error
        },
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error updating location:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to update location',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/location-tracking/:bookingId
 * @desc    Get current tracking data for a booking
 * @access  Private (Customer, Driver, Admin)
 */
router.get('/:bookingId', authMiddleware, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { uid, userType } = req.user;

    // Verify user has permission to view tracking data
    const db = getFirestore();
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

    const bookingData = bookingDoc.data();
    
    if (userType === 'customer' && bookingData.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You can only view tracking for your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (userType === 'driver' && bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You can only view tracking for your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    const result = await locationTrackingService.getTrackingData(bookingId);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'Tracking data retrieved successfully',
        data: result.data,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        error: {
          code: 'TRACKING_NOT_FOUND',
          message: 'No tracking data found for this booking',
          details: result.error
        },
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error getting tracking data:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get tracking data',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/location-tracking/:bookingId/history
 * @desc    Get location history for a booking
 * @access  Private (Customer, Driver, Admin)
 */
router.get('/:bookingId/history', authMiddleware, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { limit = 50 } = req.query;
    const { uid, userType } = req.user;

    // Verify user has permission to view tracking data
    const db = getFirestore();
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

    const bookingData = bookingDoc.data();
    
    if (userType === 'customer' && bookingData.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You can only view tracking for your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (userType === 'driver' && bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You can only view tracking for your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    const result = await locationTrackingService.getLocationHistory(bookingId, parseInt(limit));

    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'Location history retrieved successfully',
        data: result.data,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        error: {
          code: 'HISTORY_NOT_FOUND',
          message: 'No location history found for this booking',
          details: result.error
        },
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error getting location history:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get location history',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/location-tracking/:bookingId/stop
 * @desc    Stop tracking for a booking
 * @access  Private (Driver, Admin)
 */
router.post('/:bookingId/stop', [
  authMiddleware,
  body('reason').optional().isString().withMessage('Reason must be a string')
], async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason = 'completed' } = req.body;
    const { uid, userType } = req.user;

    // Only drivers and admins can stop tracking
    if (userType === 'customer') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Customers cannot stop location tracking'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Verify user has permission to stop tracking
    const db = getFirestore();
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

    const bookingData = bookingDoc.data();
    
    if (userType === 'driver' && bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'You can only stop tracking for your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    const result = await locationTrackingService.stopTracking(bookingId, reason);

    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'Location tracking stopped successfully',
        data: { bookingId, reason },
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: {
          code: 'TRACKING_STOP_FAILED',
          message: 'Failed to stop location tracking',
          details: result.error
        },
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error stopping tracking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to stop location tracking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/location-tracking/statistics
 * @desc    Get tracking statistics (Admin only)
 * @access  Private (Admin only)
 */
router.get('/statistics', authMiddleware, async (req, res) => {
  try {
    const { userType } = req.user;

    if (userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'PERMISSION_DENIED',
          message: 'Only admins can view tracking statistics'
        },
        timestamp: new Date().toISOString()
      });
    }

    const statistics = await locationTrackingService.getTrackingStatistics();

    res.status(200).json({
      success: true,
      message: 'Tracking statistics retrieved successfully',
      data: statistics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting tracking statistics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get tracking statistics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
