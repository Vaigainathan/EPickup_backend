const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { requireRole, requireOwnership } = require('../middleware/auth');
const TrackingService = require('../services/trackingService');

const router = express.Router();
const trackingService = new TrackingService();

/**
 * @route   POST /api/tracking/start
 * @desc    Start tracking a trip
 * @access  Private (Driver, Customer)
 */
router.post('/start', [
  requireRole(['driver', 'customer']),
  body('tripId').isString().notEmpty().withMessage('Trip ID is required'),
  body('bookingId').isString().notEmpty().withMessage('Booking ID is required'),
  body('driverId').isString().notEmpty().withMessage('Driver ID is required'),
  body('customerId').isString().notEmpty().withMessage('Customer ID is required'),
  body('pickup.coordinates.latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid pickup latitude required'),
  body('pickup.coordinates.longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid pickup longitude required'),
  body('dropoff.coordinates.latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid dropoff latitude required'),
  body('dropoff.coordinates.longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid dropoff longitude required'),
  body('driverLocation.latitude').optional().isFloat({ min: -90, max: 90 }),
  body('driverLocation.longitude').optional().isFloat({ min: -180, max: 180 })
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

    const { tripId, ...tripData } = req.body;

    // Check if trip is already being tracked
    const existingTrip = trackingService.activeTrips.get(tripId);
    if (existingTrip) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'TRIP_ALREADY_TRACKING',
          message: 'Trip is already being tracked',
          details: `Trip ${tripId} is already active`
        },
        timestamp: new Date().toISOString()
      });
    }

    // Start trip tracking
    const result = await trackingService.startTripTracking(tripId, tripData);

    res.status(201).json(result);

  } catch (error) {
    console.error('Error starting trip tracking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TRACKING_START_ERROR',
        message: 'Failed to start trip tracking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/tracking/:tripId/location
 * @desc    Update driver location for a trip
 * @access  Private (Driver)
 */
router.post('/:tripId/location', [
  requireRole(['driver']),
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
  body('accuracy').optional().isFloat({ min: 0 }).withMessage('Accuracy must be positive'),
  body('speed').optional().isFloat({ min: 0 }).withMessage('Speed must be positive'),
  body('heading').optional().isFloat({ min: 0, max: 360 }).withMessage('Heading must be between 0 and 360')
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

    const { tripId } = req.params;
    const locationData = req.body;

    // Verify driver owns this trip
    const trip = trackingService.activeTrips.get(tripId);
    if (!trip) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRIP_NOT_FOUND',
          message: 'Trip not found',
          details: `Trip ${tripId} is not being tracked`
        },
        timestamp: new Date().toISOString()
      });
    }

    if (trip.driverId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only update location for your own trips'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update driver location
    const result = await trackingService.updateDriverLocation(tripId, locationData);

    res.status(200).json(result);

  } catch (error) {
    console.error('Error updating driver location:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOCATION_UPDATE_ERROR',
        message: 'Failed to update driver location',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/tracking/:tripId/status
 * @desc    Get current trip status and progress
 * @access  Private (Driver, Customer)
 */
router.get('/:tripId/status', [
  requireRole(['driver', 'customer'])
], async (req, res) => {
  try {
    const { tripId } = req.params;

    // Get trip status
    const result = await trackingService.getTripStatus(tripId);

    // Verify user has access to this trip
    const trip = trackingService.activeTrips.get(tripId);
    if (!trip) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRIP_NOT_FOUND',
          message: 'Trip not found',
          details: `Trip ${tripId} is not being tracked`
        },
        timestamp: new Date().toISOString()
      });
    }

    if (trip.driverId !== req.user.uid && trip.customerId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only view status for your own trips'
        },
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json(result);

  } catch (error) {
    console.error('Error getting trip status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TRIP_STATUS_ERROR',
        message: 'Failed to get trip status',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/tracking/:tripId/history
 * @desc    Get trip location history
 * @access  Private (Driver, Customer)
 */
router.get('/:tripId/history', [
  requireRole(['driver', 'customer']),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('startTime').optional().isISO8601().withMessage('Start time must be valid ISO 8601 date'),
  query('endTime').optional().isISO8601().withMessage('End time must be valid ISO 8601 date')
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

    const { tripId } = req.params;
    const { limit, startTime, endTime } = req.query;

    // Verify user has access to this trip
    const trip = trackingService.activeTrips.get(tripId);
    if (!trip) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRIP_NOT_FOUND',
          message: 'Trip not found',
          details: `Trip ${tripId} is not being tracked`
        },
        timestamp: new Date().toISOString()
      });
    }

    if (trip.driverId !== req.user.uid && trip.customerId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only view history for your own trips'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Parse query parameters
    const options = {
      limit: limit ? parseInt(limit) : 50,
      startTime: startTime ? new Date(startTime) : null,
      endTime: endTime ? new Date(endTime) : null
    };

    // Get location history
    const result = await trackingService.getTripLocationHistory(tripId, options);

    res.status(200).json(result);

  } catch (error) {
    console.error('Error getting trip location history:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOCATION_HISTORY_ERROR',
        message: 'Failed to get location history',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/tracking/:tripId/stop
 * @desc    Stop tracking a trip
 * @access  Private (Driver, Customer)
 */
router.post('/:tripId/stop', [
  requireRole(['driver', 'customer']),
  body('reason').optional().isString().withMessage('Reason must be a string')
], async (req, res) => {
  try {
    const { tripId } = req.params;
    const { reason = 'completed' } = req.body;

    // Verify user has access to this trip
    const trip = trackingService.activeTrips.get(tripId);
    if (!trip) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRIP_NOT_FOUND',
          message: 'Trip not found',
          details: `Trip ${tripId} is not being tracked`
        },
        timestamp: new Date().toISOString()
      });
    }

    if (trip.driverId !== req.user.uid && trip.customerId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only stop tracking for your own trips'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Stop trip tracking
    const result = await trackingService.stopTripTracking(tripId, reason);

    res.status(200).json(result);

  } catch (error) {
    console.error('Error stopping trip tracking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TRACKING_STOP_ERROR',
        message: 'Failed to stop trip tracking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/tracking/:tripId/eta
 * @desc    Get ETA for pickup and delivery
 * @access  Private (Driver, Customer)
 */
router.get('/:tripId/eta', [
  requireRole(['driver', 'customer'])
], async (req, res) => {
  try {
    const { tripId } = req.params;

    // Get trip status
    const tripStatus = await trackingService.getTripStatus(tripId);
    
    if (!tripStatus.success) {
      return res.status(404).json(tripStatus);
    }

    // Verify user has access to this trip
    const trip = trackingService.activeTrips.get(tripId);
    if (!trip) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRIP_NOT_FOUND',
          message: 'Trip not found',
          details: `Trip ${tripId} is not being tracked`
        },
        timestamp: new Date().toISOString()
      });
    }

    if (trip.driverId !== req.user.uid && trip.customerId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only view ETA for your own trips'
        },
        timestamp: new Date().toISOString()
      });
    }

    const { progress, route, currentLocation } = tripStatus.data;

    // Calculate additional ETA information
    const etaInfo = {
      tripId,
      currentLocation,
      pickup: {
        distance: progress.distanceToPickup,
        eta: progress.etaToPickup,
        isAtLocation: progress.isAtPickup
      },
      dropoff: {
        distance: progress.distanceToDropoff,
        eta: progress.etaToDropoff,
        isAtLocation: progress.isAtDropoff
      },
      route: {
        totalDistance: route.distance,
        totalDuration: route.duration,
        currentStage: progress.currentStage
      },
      lastUpdated: new Date()
    };

    res.status(200).json({
      success: true,
      message: 'ETA information retrieved successfully',
      data: etaInfo,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting ETA information:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ETA_CALCULATION_ERROR',
        message: 'Failed to calculate ETA',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/tracking/:tripId/analytics
 * @desc    Get trip analytics and performance metrics
 * @access  Private (Driver, Customer)
 */
router.get('/:tripId/analytics', [
  requireRole(['driver', 'customer'])
], async (req, res) => {
  try {
    const { tripId } = req.params;

    // Verify user has access to this trip
    const trip = trackingService.activeTrips.get(tripId);
    if (!trip) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRIP_NOT_FOUND',
          message: 'Trip not found',
          details: `Trip ${tripId} is not being tracked`
        },
        timestamp: new Date().toISOString()
      });
    }

    if (trip.driverId !== req.user.uid && trip.customerId !== req.user.uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only view analytics for your own trips'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get trip analytics
    const result = await trackingService.getTripAnalytics(tripId);

    res.status(200).json(result);

  } catch (error) {
    console.error('Error getting trip analytics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get trip analytics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/tracking/active
 * @desc    Get all active trips for the authenticated user
 * @access  Private (Driver, Customer)
 */
router.get('/active', [
  requireRole(['driver', 'customer'])
], async (req, res) => {
  try {
    const activeTrips = trackingService.getActiveTrips();
    
    // Filter trips based on user role and ownership
    let userTrips;
    if (req.user.userType === 'driver') {
      userTrips = activeTrips.filter(trip => trip.driverId === req.user.uid);
    } else {
      userTrips = activeTrips.filter(trip => trip.customerId === req.user.uid);
    }

    // Format response data
    const formattedTrips = userTrips.map(trip => ({
      tripId: trip.tripId,
      bookingId: trip.bookingId,
      status: trip.status,
      currentLocation: trip.currentLocation,
      progress: trip.progress,
      route: trip.route,
      startTime: trip.startTime,
      lastUpdate: trip.lastUpdate
    }));

    res.status(200).json({
      success: true,
      message: 'Active trips retrieved successfully',
      data: {
        trips: formattedTrips,
        total: formattedTrips.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting active trips:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ACTIVE_TRIPS_ERROR',
        message: 'Failed to get active trips',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/tracking/statistics
 * @desc    Get tracking service statistics (Admin only)
 * @access  Private (Admin)
 */
router.get('/statistics', [
  requireRole(['admin'])
], async (req, res) => {
  try {
    const stats = trackingService.getTrackingStatistics();

    res.status(200).json({
      success: true,
      message: 'Tracking statistics retrieved successfully',
      data: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting tracking statistics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'STATISTICS_ERROR',
        message: 'Failed to get tracking statistics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/tracking/cleanup
 * @desc    Clean up expired trips (Admin only)
 * @access  Private (Admin)
 */
router.post('/cleanup', [
  requireRole(['admin']),
  body('maxAge').optional().isInt({ min: 3600000 }).withMessage('Max age must be at least 1 hour in milliseconds')
], async (req, res) => {
  try {
    const { maxAge = 24 * 60 * 60 * 1000 } = req.body; // Default: 24 hours

    // Clean up expired trips
    await trackingService.cleanupExpiredTrips(maxAge);

    res.status(200).json({
      success: true,
      message: 'Cleanup completed successfully',
      data: {
        maxAge,
        timestamp: new Date()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error during cleanup:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CLEANUP_ERROR',
        message: 'Failed to cleanup expired trips',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/tracking/health
 * @desc    Health check for tracking service
 * @access  Public
 */
router.get('/health', async (req, res) => {
  try {
    const stats = trackingService.getTrackingStatistics();
    
    res.status(200).json({
      success: true,
      message: 'Tracking service is healthy',
      data: {
        status: 'healthy',
        uptime: stats.uptime,
        activeTrips: stats.activeTrips,
        timestamp: new Date()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Tracking service health check failed:', error);
    res.status(503).json({
      success: false,
      error: {
        code: 'SERVICE_UNHEALTHY',
        message: 'Tracking service is unhealthy',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
