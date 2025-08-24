const express = require('express');
const router = express.Router();
const serviceAreaValidation = require('../services/serviceAreaValidation');
const { asyncHandler } = require('../middleware/errorHandler');

/**
 * @route GET /api/service-area/info
 * @desc Get service area information
 * @access Public
 */
router.get('/info', asyncHandler(async (req, res) => {
  const serviceAreaInfo = serviceAreaValidation.getServiceAreaInfo();
  
  res.json({
    success: true,
    message: 'Service area information retrieved successfully',
    data: serviceAreaInfo
  });
}));

/**
 * @route POST /api/service-area/validate-location
 * @desc Validate a single location against service area
 * @access Public
 */
router.post('/validate-location', asyncHandler(async (req, res) => {
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_COORDINATES',
        message: 'Latitude and longitude are required'
      }
    });
  }

  const validation = serviceAreaValidation.validateLocation(latitude, longitude);
  
  res.json({
    success: true,
    message: 'Location validation completed',
    data: validation
  });
}));

/**
 * @route POST /api/service-area/validate-booking
 * @desc Validate booking locations (pickup and dropoff) against service area
 * @access Public
 */
router.post('/validate-booking', asyncHandler(async (req, res) => {
  const { pickup, dropoff } = req.body;

  if (!pickup?.coordinates || !dropoff?.coordinates) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_BOOKING_DATA',
        message: 'Pickup and dropoff coordinates are required'
      }
    });
  }

  const bookingData = {
    pickup: {
      coordinates: pickup.coordinates
    },
    dropoff: {
      coordinates: dropoff.coordinates
    }
  };

  const validation = serviceAreaValidation.validateBookingLocations(bookingData);
  
  res.json({
    success: true,
    message: 'Booking location validation completed',
    data: validation
  });
}));

/**
 * @route POST /api/service-area/validate-route
 * @desc Validate a route against service area
 * @access Public
 */
router.post('/validate-route', asyncHandler(async (req, res) => {
  const { coordinates } = req.body;

  if (!coordinates || !Array.isArray(coordinates)) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_ROUTE_DATA',
        message: 'Route coordinates array is required'
      }
    });
  }

  const validation = serviceAreaValidation.validateRoute(coordinates);
  
  res.json({
    success: true,
    message: 'Route validation completed',
    data: validation
  });
}));

/**
 * @route POST /api/service-area/validate-driver
 * @desc Validate driver location for going online
 * @access Public
 */
router.post('/validate-driver', asyncHandler(async (req, res) => {
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_COORDINATES',
        message: 'Latitude and longitude are required'
      }
    });
  }

  const validation = serviceAreaValidation.validateDriverLocation(latitude, longitude);
  
  res.json({
    success: true,
    message: 'Driver location validation completed',
    data: validation
  });
}));

module.exports = router;
