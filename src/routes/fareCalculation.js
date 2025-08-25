const express = require('express');
const router = express.Router();
const fareCalculationService = require('../services/fareCalculationService');
const { authenticateToken } = require('../middleware/auth');

/**
 * @route POST /api/fare/estimate
 * @desc Get fare estimate for a route
 * @access Public
 */
router.post('/estimate', async (req, res) => {
    try {
        const { pickup, dropoff } = req.body;

        // Validate input
        if (!pickup || !dropoff || !pickup.lat || !pickup.lng || !dropoff.lat || !dropoff.lng) {
            return res.status(400).json({
                success: false,
                message: 'Invalid pickup or dropoff coordinates'
            });
        }

        const fareEstimate = await fareCalculationService.getFareEstimate(pickup, dropoff);

        res.json({
            success: true,
            data: fareEstimate
        });
    } catch (error) {
        console.error('Fare estimate error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to calculate fare estimate'
        });
    }
});

/**
 * @route POST /api/fare/calculate
 * @desc Calculate exact fare for a trip
 * @access Private (Customer/Driver)
 */
router.post('/calculate', authenticateToken, async (req, res) => {
    try {
        const { pickup, dropoff, tripId } = req.body;

        // Validate input
        if (!pickup || !dropoff || !pickup.lat || !pickup.lng || !dropoff.lat || !dropoff.lng) {
            return res.status(400).json({
                success: false,
                message: 'Invalid pickup or dropoff coordinates'
            });
        }

        const distanceAndFare = await fareCalculationService.calculateDistanceAndFare(pickup, dropoff);

        res.json({
            success: true,
            data: {
                tripId: tripId,
                ...distanceAndFare
            }
        });
    } catch (error) {
        console.error('Fare calculation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to calculate fare'
        });
    }
});

/**
 * @route POST /api/fare/complete-trip
 * @desc Complete trip and process commission deduction
 * @access Private (Driver)
 */
router.post('/complete-trip', authenticateToken, async (req, res) => {
    try {
        const { tripId, fareDetails, driverId } = req.body;

        // Validate input
        if (!tripId || !fareDetails || !driverId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }

        // Validate fare calculation
        if (!fareCalculationService.validateFareCalculation(fareDetails.fare)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid fare calculation'
            });
        }

        const tripCompletion = await fareCalculationService.processTripCompletion(
            tripId, 
            fareDetails, 
            driverId
        );

        res.json({
            success: true,
            data: tripCompletion
        });
    } catch (error) {
        console.error('Trip completion error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to complete trip'
        });
    }
});

/**
 * @route GET /api/fare/rates
 * @desc Get current fare rates and commission structure
 * @access Public
 */
router.get('/rates', (req, res) => {
    res.json({
        success: true,
        data: {
            baseFarePerKm: fareCalculationService.BASE_FARE_PER_KM,
            commissionPerKm: fareCalculationService.COMMISSION_PER_KM,
            minimumFare: fareCalculationService.MINIMUM_FARE,
            currency: 'INR',
            updatedAt: new Date().toISOString()
        }
    });
});

/**
 * @route POST /api/fare/validate
 * @desc Validate fare calculation
 * @access Private
 */
router.post('/validate', authenticateToken, (req, res) => {
    try {
        const { fareDetails } = req.body;

        if (!fareDetails) {
            return res.status(400).json({
                success: false,
                message: 'Fare details required'
            });
        }

        const isValid = fareCalculationService.validateFareCalculation(fareDetails);

        res.json({
            success: true,
            data: {
                isValid: isValid,
                fareDetails: fareDetails
            }
        });
    } catch (error) {
        console.error('Fare validation error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to validate fare'
        });
    }
});

module.exports = router;
