const express = require('express');
const { body } = require('express-validator');
const { getFirestore } = require('../services/firebase');
const { requireDriver } = require('../middleware/auth');
const { sanitizeInput, checkValidation } = require('../middleware/validation');

const router = express.Router();

// Apply input sanitization to all driver data routes
router.use(sanitizeInput);

/**
 * @route   POST /api/driver-data/vehicle-details
 * @desc    Save or update driver vehicle details
 * @access  Private (Driver only)
 */
router.post('/vehicle-details', [
  requireDriver,
  body('vehicleType').isIn(['motorcycle', 'electric']).withMessage('Vehicle type must be motorcycle or electric'),
  body('vehicleNumber').isLength({ min: 1 }).withMessage('Vehicle number is required'),
  body('vehicleMake').isLength({ min: 1 }).withMessage('Vehicle make is required'),
  body('vehicleModel').isLength({ min: 1 }).withMessage('Vehicle model is required'),
  body('vehicleYear').isInt({ min: 1990, max: new Date().getFullYear() + 1 }).withMessage('Invalid vehicle year'),
  body('vehicleColor').isLength({ min: 1 }).withMessage('Vehicle color is required'),
  body('licenseNumber').isLength({ min: 1 }).withMessage('License number is required'),
  body('licenseExpiry').isLength({ min: 1 }).withMessage('License expiry date is required'),
  body('rcNumber').isLength({ min: 1 }).withMessage('RC number is required'),
  body('insuranceNumber').isLength({ min: 1 }).withMessage('Insurance number is required'),
  body('insuranceExpiry').isLength({ min: 1 }).withMessage('Insurance expiry date is required'),
  checkValidation
], async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const {
      vehicleType,
      vehicleNumber,
      vehicleMake,
      vehicleModel,
      vehicleYear,
      vehicleColor,
      licenseNumber,
      licenseExpiry,
      rcNumber,
      insuranceNumber,
      insuranceExpiry
    } = req.body;

    console.log(`🔄 Saving vehicle details for driver: ${uid}`);

    // Validate dates
    const licenseExpiryDate = new Date(licenseExpiry);
    const insuranceExpiryDate = new Date(insuranceExpiry);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to start of day
    
    if (licenseExpiryDate < today) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_LICENSE_EXPIRY',
          message: 'License must not be expired',
          details: 'Please provide a valid license expiry date'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (insuranceExpiryDate < today) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INSURANCE_EXPIRY',
          message: 'Insurance must not be expired',
          details: 'Please provide a valid insurance expiry date'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Validate vehicle number format (Indian format: XX XX XX XXXX)
    const vehicleNumberRegex = /^[A-Z]{2}[0-9]{2}[A-Z]{2}[0-9]{4}$/;
    if (!vehicleNumberRegex.test(vehicleNumber.replace(/\s/g, ''))) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_VEHICLE_NUMBER',
          message: 'Invalid vehicle number format',
          details: 'Vehicle number should be in format: XX XX XX XXXX (e.g., KA 01 AB 1234)'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Prepare vehicle details object
    const vehicleDetails = {
      vehicleType,
      vehicleNumber: vehicleNumber.toUpperCase(),
      vehicleMake: vehicleMake.trim(),
      vehicleModel: vehicleModel.trim(),
      vehicleYear: parseInt(vehicleYear),
      vehicleColor: vehicleColor.trim(),
      licenseNumber: licenseNumber.trim(),
      licenseExpiry: licenseExpiryDate,
      rcNumber: rcNumber.trim(),
      insuranceNumber: insuranceNumber.trim(),
      insuranceExpiry: insuranceExpiryDate,
      updatedAt: new Date()
    };

    // Update driver profile in users collection
    const userRef = db.collection('users').doc(uid);
    await userRef.update({
      'driver.vehicleDetails': vehicleDetails,
      updatedAt: new Date()
    });

    // Also update the main vehicleDetails field for backward compatibility
    await userRef.update({
      vehicleDetails: vehicleDetails,
      updatedAt: new Date()
    });

    // Create a driver data entry record for admin review
    const driverDataEntryRef = db.collection('driverDataEntries').doc();
    await driverDataEntryRef.set({
      id: driverDataEntryRef.id,
      driverId: uid,
      vehicleDetails: vehicleDetails,
      status: 'pending_verification',
      submittedAt: new Date(),
      updatedAt: new Date(),
      reviewHistory: []
    });

    console.log(`✅ Vehicle details saved for driver: ${uid}`);

    res.status(200).json({
      success: true,
      message: 'Vehicle details saved successfully',
      data: {
        vehicleDetails: vehicleDetails,
        status: 'pending_verification'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error saving vehicle details:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'VEHICLE_DETAILS_SAVE_ERROR',
        message: 'Failed to save vehicle details',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver-data/vehicle-details
 * @desc    Get driver vehicle details
 * @access  Private (Driver only)
 */
router.get('/vehicle-details', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    console.log(`🔍 Getting vehicle details for driver: ${uid}`);

    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found',
          details: 'Driver profile does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const vehicleDetails = userData.driver?.vehicleDetails || userData.vehicleDetails || null;

    res.status(200).json({
      success: true,
      message: 'Vehicle details retrieved successfully',
      data: {
        vehicleDetails: vehicleDetails,
        hasVehicleDetails: !!vehicleDetails
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting vehicle details:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'VEHICLE_DETAILS_GET_ERROR',
        message: 'Failed to get vehicle details',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver-data/verification-status
 * @desc    Get driver verification status including manual data entry status
 * @access  Private (Driver only)
 */
router.get('/verification-status', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    console.log(`🔍 Getting verification status for driver: ${uid}`);

    // Get driver data entry status
    const driverDataEntryQuery = await db.collection('driverDataEntries')
      .where('driverId', '==', uid)
      .orderBy('submittedAt', 'desc')
      .limit(1)
      .get();

    let dataEntryStatus = null;
    if (!driverDataEntryQuery.empty) {
      const dataEntryDoc = driverDataEntryQuery.docs[0];
      dataEntryStatus = {
        id: dataEntryDoc.id,
        status: dataEntryDoc.data().status,
        submittedAt: dataEntryDoc.data().submittedAt,
        reviewedAt: dataEntryDoc.data().reviewedAt,
        reviewComments: dataEntryDoc.data().reviewComments,
        rejectionReason: dataEntryDoc.data().rejectionReason
      };
    }

    // Get document verification status
    const verificationService = require('../services/verificationService');
    const verificationData = await verificationService.getDriverVerificationData(uid);

    res.status(200).json({
      success: true,
      message: 'Verification status retrieved successfully',
      data: {
        dataEntryStatus: dataEntryStatus,
        documentVerification: verificationData,
        overallStatus: verificationData.verificationStatus,
        isVerified: verificationData.isVerified
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting verification status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_STATUS_ERROR',
        message: 'Failed to get verification status',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver-data/resubmit
 * @desc    Resubmit driver data after rejection
 * @access  Private (Driver only)
 */
router.post('/resubmit', [
  requireDriver,
  body('vehicleDetails').isObject().withMessage('Vehicle details are required'),
  checkValidation
], async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    const { vehicleDetails } = req.body;

    console.log(`🔄 Resubmitting vehicle details for driver: ${uid}`);

    // Update existing driver data entry
    const driverDataEntryQuery = await db.collection('driverDataEntries')
      .where('driverId', '==', uid)
      .orderBy('submittedAt', 'desc')
      .limit(1)
      .get();

    if (driverDataEntryQuery.empty) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NO_DATA_ENTRY_FOUND',
          message: 'No previous data entry found',
          details: 'Please submit vehicle details first'
        },
        timestamp: new Date().toISOString()
      });
    }

    const dataEntryDoc = driverDataEntryQuery.docs[0];
    const currentData = dataEntryDoc.data();

    // Update the data entry with new submission
    await dataEntryDoc.ref.update({
      vehicleDetails: vehicleDetails,
      status: 'pending_verification',
      submittedAt: new Date(),
      updatedAt: new Date(),
      reviewHistory: [
        ...(currentData.reviewHistory || []),
        {
          action: 'resubmitted',
          timestamp: new Date(),
          previousStatus: currentData.status
        }
      ]
    });

    // Update driver profile
    const userRef = db.collection('users').doc(uid);
    await userRef.update({
      'driver.vehicleDetails': vehicleDetails,
      vehicleDetails: vehicleDetails,
      updatedAt: new Date()
    });

    console.log(`✅ Vehicle details resubmitted for driver: ${uid}`);

    res.status(200).json({
      success: true,
      message: 'Vehicle details resubmitted successfully',
      data: {
        status: 'pending_verification',
        submittedAt: new Date()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error resubmitting vehicle details:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'RESUBMIT_ERROR',
        message: 'Failed to resubmit vehicle details',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
