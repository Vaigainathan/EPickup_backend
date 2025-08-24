const express = require('express');
const { body, validationResult } = require('express-validator');
const { getFirestore } = require('../services/firebase');
const { requireDriver } = require('../middleware/auth');
const { userRateLimit } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /api/driver/profile
 * @desc    Get driver profile
 * @access  Private (Driver only)
 */
router.get('/profile', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'PROFILE_NOT_FOUND',
          message: 'Profile not found',
          details: 'Driver profile does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    
    res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        profile: {
          id: userData.id,
          name: userData.name,
          email: userData.email,
          phone: userData.phone,
          profilePicture: userData.profilePicture,
          driver: userData.driver
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting driver profile:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_RETRIEVAL_ERROR',
        message: 'Failed to retrieve profile',
        details: 'An error occurred while retrieving profile'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/driver/profile
 * @desc    Update driver profile
 * @access  Private (Driver only)
 */
router.put('/profile', [
  requireDriver,
  body('name')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email address'),
  body('profilePicture')
    .optional()
    .isURL()
    .withMessage('Profile picture must be a valid URL')
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
    const { name, email, profilePicture } = req.body;
    const db = getFirestore();
    
    const updateData = {
      updatedAt: new Date()
    };

    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (profilePicture) updateData.profilePicture = profilePicture;

    await db.collection('users').doc(uid).update(updateData);

    // Get updated profile
    const updatedDoc = await db.collection('users').doc(uid).get();
    const userData = updatedDoc.data();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        profile: {
          id: userData.id,
          name: userData.name,
          email: userData.email,
          phone: userData.phone,
          profilePicture: userData.profilePicture,
          driver: userData.driver
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating driver profile:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_UPDATE_ERROR',
        message: 'Failed to update profile',
        details: 'An error occurred while updating profile'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/documents
 * @desc    Upload driver documents
 * @access  Private (Driver only)
 */
router.post('/documents', [
  requireDriver,
  body('documentType')
    .isIn(['drivingLicense', 'profilePhoto', 'aadhaarCard', 'bikeInsurance', 'rcBook'])
    .withMessage('Document type must be one of: drivingLicense, profilePhoto, aadhaarCard, bikeInsurance, rcBook'),
  body('documentUrl')
    .isURL()
    .withMessage('Document URL must be a valid URL'),
  body('documentNumber')
    .optional()
    .isLength({ min: 5, max: 50 })
    .withMessage('Document number must be between 5 and 50 characters')
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
    const { documentType, documentUrl, documentNumber } = req.body;
    const db = getFirestore();
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const documents = userData.driver?.documents || {};
    
    // Update document
    documents[documentType] = {
      url: documentUrl,
      number: documentNumber,
      uploadedAt: new Date(),
      status: 'pending' // Will be verified by admin
    };

    // Update verification status if all documents are uploaded
    const allDocuments = Object.keys(documents);
    const uploadedDocuments = allDocuments.filter(doc => documents[doc]?.url);
    
    let verificationStatus = 'pending';
    if (uploadedDocuments.length === allDocuments.length) {
      verificationStatus = 'pending_verification';
    }

    await userRef.update({
      'driver.documents': documents,
      'driver.verificationStatus': verificationStatus,
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        documentType,
        document: documents[documentType],
        verificationStatus
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error uploading driver document:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENT_UPLOAD_ERROR',
        message: 'Failed to upload document',
        details: 'An error occurred while uploading document'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/driver/documents/:type
 * @desc    Update specific driver document
 * @access  Private (Driver only)
 */
router.put('/documents/:type', [
  requireDriver,
  body('documentUrl')
    .isURL()
    .withMessage('Document URL must be a valid URL'),
  body('documentNumber')
    .optional()
    .isLength({ min: 5, max: 50 })
    .withMessage('Document number must be between 5 and 50 characters')
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
    const { type } = req.params;
    const { documentUrl, documentNumber } = req.body;
    const db = getFirestore();
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const documents = userData.driver?.documents || {};
    
    if (!documents[type]) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DOCUMENT_NOT_FOUND',
          message: 'Document not found',
          details: 'Document of this type does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update document
    documents[type] = {
      ...documents[type],
      url: documentUrl,
      number: documentNumber,
      updatedAt: new Date(),
      status: 'pending' // Reset to pending for re-verification
    };

    // Update verification status
    await userRef.update({
      'driver.documents': documents,
      'driver.verificationStatus': 'pending_verification',
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Document updated successfully',
      data: {
        documentType: type,
        document: documents[type]
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating driver document:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENT_UPDATE_ERROR',
        message: 'Failed to update document',
        details: 'An error occurred while updating document'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/earnings
 * @desc    Get driver earnings
 * @access  Private (Driver only)
 */
router.get('/earnings', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { period = 'all', startDate, endDate } = req.query;
    const db = getFirestore();
    
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const earnings = userData.driver?.earnings || { total: 0, thisMonth: 0, thisWeek: 0 };

    // Get detailed earnings from payments collection
    let query = db.collection('payments')
      .where('driverId', '==', uid)
      .where('status', '==', 'completed');

    if (period === 'week' || period === 'month') {
      const now = new Date();
      let start;
      
      if (period === 'week') {
        start = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
      } else if (period === 'month') {
        start = new Date(now.getFullYear(), now.getMonth(), 1);
      }
      
      query = query.where('completedAt', '>=', start);
    } else if (startDate && endDate) {
      query = query
        .where('completedAt', '>=', new Date(startDate))
        .where('completedAt', '<=', new Date(endDate));
    }

    const snapshot = await query.get();
    const payments = [];
    let totalEarnings = 0;

    snapshot.forEach(doc => {
      const paymentData = doc.data();
      payments.push({
        id: doc.id,
        ...paymentData
      });
      totalEarnings += paymentData.amount;
    });

    res.status(200).json({
      success: true,
      message: 'Earnings retrieved successfully',
      data: {
        summary: earnings,
        period,
        totalEarnings,
        payments,
        paymentCount: payments.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting driver earnings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EARNINGS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve earnings',
        details: 'An error occurred while retrieving earnings'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/trips
 * @desc    Get driver trip history
 * @access  Private (Driver only)
 */
router.get('/trips', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { status, limit = 20, offset = 0 } = req.query;
    const db = getFirestore();
    
    let query = db.collection('bookings').where('driverId', '==', uid);
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
    query = query.orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(parseInt(offset));
    
    const snapshot = await query.get();
    const trips = [];
    
    snapshot.forEach(doc => {
      trips.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.status(200).json({
      success: true,
      message: 'Trips retrieved successfully',
      data: {
        trips,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: trips.length
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting driver trips:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TRIPS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve trips',
        details: 'An error occurred while retrieving trips'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/driver/status
 * @desc    Update driver status (online/offline, available/unavailable)
 * @access  Private (Driver only)
 */
router.put('/status', [
  requireDriver,
  body('isOnline')
    .isBoolean()
    .withMessage('isOnline must be a boolean'),
  body('isAvailable')
    .optional()
    .isBoolean()
    .withMessage('isAvailable must be a boolean'),
  body('workingHours')
    .optional()
    .isObject()
    .withMessage('workingHours must be an object'),
  body('workingDays')
    .optional()
    .isArray()
    .withMessage('workingDays must be an array')
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
    const { isOnline, isAvailable, workingHours, workingDays } = req.body;
    const db = getFirestore();
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const updateData = {
      'driver.isOnline': isOnline,
      updatedAt: new Date()
    };

    if (isAvailable !== undefined) {
      updateData['driver.isAvailable'] = isAvailable;
    }

    if (workingHours) {
      updateData['driver.availability.workingHours'] = workingHours;
    }

    if (workingDays) {
      updateData['driver.availability.workingDays'] = workingDays;
    }

    await userRef.update(updateData);

    // Update driver location status
    const locationRef = db.collection('driverLocations').doc(uid);
    await locationRef.set({
      driverId: uid,
      isOnline,
      isAvailable: isAvailable !== undefined ? isAvailable : userDoc.data().driver?.isAvailable || false,
      lastUpdated: new Date()
    }, { merge: true });

    res.status(200).json({
      success: true,
      message: 'Driver status updated successfully',
      data: {
        isOnline,
        isAvailable: isAvailable !== undefined ? isAvailable : userDoc.data().driver?.isAvailable || false,
        workingHours,
        workingDays
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating driver status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'STATUS_UPDATE_ERROR',
        message: 'Failed to update status',
        details: 'An error occurred while updating status'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/location
 * @desc    Update driver current location
 * @access  Private (Driver only)
 */
router.post('/location', [
  requireDriver,
  body('latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  body('accuracy')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Accuracy must be a positive number')
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
    const { latitude, longitude, accuracy = 10 } = req.body;
    const db = getFirestore();
    
    // Update driver location in users collection
    await db.collection('users').doc(uid).update({
      'driver.currentLocation': {
        latitude,
        longitude,
        timestamp: new Date(),
        accuracy
      },
      updatedAt: new Date()
    });

    // Update driver location in driverLocations collection
    const locationRef = db.collection('driverLocations').doc(uid);
    await locationRef.set({
      driverId: uid,
      currentLocation: {
        latitude,
        longitude,
        timestamp: new Date(),
        accuracy
      },
      lastUpdated: new Date()
    }, { merge: true });

    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: {
        location: {
          latitude,
          longitude,
          accuracy,
          timestamp: new Date()
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating driver location:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOCATION_UPDATE_ERROR',
        message: 'Failed to update location',
        details: 'An error occurred while updating location'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/bookings
 * @desc    Get available bookings for driver
 * @access  Private (Driver only)
 */
router.get('/bookings', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 20, offset = 0, radius = 5 } = req.query;
    const db = getFirestore();
    
    // Get driver's current location
    const driverDoc = await db.collection('users').doc(uid).get();
    if (!driverDoc.exists) {
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

    const driverData = driverDoc.data();
    const driverLocation = driverData.driver?.currentLocation;
    
    if (!driverLocation) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'LOCATION_NOT_FOUND',
          message: 'Location not found',
          details: 'Driver location is not available'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get available bookings (pending status)
    const query = db.collection('bookings')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));
    
    const snapshot = await query.get();
    const bookings = [];
    
    snapshot.forEach(doc => {
      const bookingData = doc.data();
      
      // Calculate distance from driver to pickup location
      if (bookingData.pickup?.coordinates) {
        const distance = calculateDistance(
          driverLocation.latitude,
          driverLocation.longitude,
          bookingData.pickup.coordinates.latitude,
          bookingData.pickup.coordinates.longitude
        );
        
        // Only include bookings within radius
        if (distance <= parseFloat(radius)) {
          bookings.push({
            id: doc.id,
            ...bookingData,
            distanceFromDriver: distance
          });
        }
      }
    });

    // Sort by distance (closest first)
    bookings.sort((a, b) => a.distanceFromDriver - b.distanceFromDriver);

    res.status(200).json({
      success: true,
      message: 'Available bookings retrieved successfully',
      data: {
        bookings,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: bookings.length
        },
        driverLocation,
        searchRadius: parseFloat(radius)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting available bookings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKINGS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve available bookings',
        details: 'An error occurred while retrieving available bookings'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/bookings/:id/accept
 * @desc    Accept a booking
 * @access  Private (Driver only)
 */
router.post('/bookings/:id/accept', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const db = getFirestore();
    
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
    
    // Check if booking is still available
    if (bookingData.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_AVAILABLE',
          message: 'Booking not available',
          details: 'This booking is no longer available for acceptance'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if driver is available
    const driverDoc = await db.collection('users').doc(uid).get();
    if (!driverDoc.exists) {
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

    const driverData = driverDoc.data();
    if (!driverData.driver?.isAvailable || !driverData.driver?.isOnline) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_AVAILABLE',
          message: 'Driver not available',
          details: 'Driver must be online and available to accept bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Accept booking
    await bookingRef.update({
      driverId: uid,
      status: 'driver_assigned',
      'timing.driverAssignedAt': new Date(),
      updatedAt: new Date()
    });

    // Update driver location to show current trip
    await db.collection('driverLocations').doc(uid).update({
      currentTripId: id,
      lastUpdated: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Booking accepted successfully',
      data: {
        bookingId: id,
        status: 'driver_assigned'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error accepting booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_ACCEPTANCE_ERROR',
        message: 'Failed to accept booking',
        details: 'An error occurred while accepting booking'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/bookings/:id/reject
 * @desc    Reject a booking
 * @access  Private (Driver only)
 */
router.post('/bookings/:id/reject', [
  requireDriver,
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

    const { uid } = req.user;
    const { id } = req.params;
    const { reason } = req.body;
    const db = getFirestore();
    
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
    
    // Check if driver was assigned to this booking
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only reject bookings assigned to you'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Reject booking
    await bookingRef.update({
      status: 'pending',
      driverId: null,
      'timing.driverAssignedAt': null,
      'cancellation.cancelledBy': 'driver',
      'cancellation.reason': reason || 'Rejected by driver',
      'cancellation.cancelledAt': new Date(),
      updatedAt: new Date()
    });

    // Remove current trip from driver location
    await db.collection('driverLocations').doc(uid).update({
      currentTripId: null,
      lastUpdated: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Booking rejected successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error rejecting booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_REJECTION_ERROR',
        message: 'Failed to reject booking',
        details: 'An error occurred while rejecting booking'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/driver/bookings/:id/status
 * @desc    Update booking status (start trip, pickup, delivery, etc.)
 * @access  Private (Driver only)
 */
router.put('/bookings/:id/status', [
  requireDriver,
  body('status')
    .isIn(['driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff', 'delivered'])
    .withMessage('Invalid status value'),
  body('location')
    .optional()
    .isObject()
    .withMessage('Location must be an object'),
  body('notes')
    .optional()
    .isLength({ min: 5, max: 200 })
    .withMessage('Notes must be between 5 and 200 characters')
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
    const { id } = req.params;
    const { status, location, notes } = req.body;
    const db = getFirestore();
    
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
    
    // Check if driver is assigned to this booking
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only update bookings assigned to you'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update booking status
    const updateData = {
      status,
      updatedAt: new Date()
    };

    // Add timing information based on status
    switch (status) {
      case 'driver_enroute':
        updateData['timing.driverEnrouteAt'] = new Date();
        break;
      case 'driver_arrived':
        updateData['timing.driverArrivedAt'] = new Date();
        break;
      case 'picked_up':
        updateData['timing.pickedUpAt'] = new Date();
        break;
      case 'delivered':
        updateData['timing.deliveredAt'] = new Date();
        updateData['timing.actualDeliveryTime'] = new Date().toISOString();
        break;
    }

    // Add location if provided
    if (location) {
      updateData['driver.currentLocation'] = {
        ...location,
        timestamp: new Date()
      };
    }

    // Add notes if provided
    if (notes) {
      updateData['driver.notes'] = notes;
    }

    await bookingRef.update(updateData);

    // Update trip tracking
    const tripTrackingRef = db.collection('tripTracking').doc(id);
    await tripTrackingRef.set({
      tripId: id,
      bookingId: id,
      driverId: uid,
      customerId: bookingData.customerId,
      currentStatus: status,
      lastUpdated: new Date()
    }, { merge: true });

    res.status(200).json({
      success: true,
      message: 'Booking status updated successfully',
      data: {
        bookingId: id,
        status,
        location,
        notes
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating booking status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'STATUS_UPDATE_ERROR',
        message: 'Failed to update booking status',
        details: 'An error occurred while updating booking status'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/wallet
 * @desc    Get driver wallet balance and transactions
 * @access  Private (Driver only)
 */
router.get('/wallet', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 20, offset = 0 } = req.query;
    const db = getFirestore();
    
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const walletBalance = userData.driver?.wallet?.balance || 0;
    const walletCurrency = userData.driver?.wallet?.currency || 'INR';

    // Get wallet transactions
    const transactionsQuery = db.collection('driverWalletTransactions')
      .where('driverId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    const transactionsSnapshot = await transactionsQuery.get();
    const transactions = [];

    transactionsSnapshot.forEach(doc => {
      transactions.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Get total transaction count
    const totalQuery = db.collection('driverWalletTransactions')
      .where('driverId', '==', uid);
    const totalSnapshot = await totalQuery.get();

    res.status(200).json({
      success: true,
      message: 'Wallet information retrieved successfully',
      data: {
        wallet: {
          balance: walletBalance,
          currency: walletCurrency
        },
        transactions,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: totalSnapshot.size
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting driver wallet:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'WALLET_RETRIEVAL_ERROR',
        message: 'Failed to retrieve wallet information',
        details: 'An error occurred while retrieving wallet information'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/wallet/add-money
 * @desc    Add money to driver wallet
 * @access  Private (Driver only)
 */
router.post('/wallet/add-money', [
  requireDriver,
  body('amount')
    .isFloat({ min: 10, max: 10000 })
    .withMessage('Amount must be between 10 and 10,000'),
  body('paymentMethod')
    .isIn(['upi', 'card', 'netbanking'])
    .withMessage('Payment method must be one of: upi, card, netbanking'),
  body('upiId')
    .optional()
    .isString()
    .withMessage('UPI ID must be a string'),
  body('cardDetails')
    .optional()
    .isObject()
    .withMessage('Card details must be an object')
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
    const { amount, paymentMethod, upiId, cardDetails } = req.body;
    const db = getFirestore();
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const currentBalance = userData.driver?.wallet?.balance || 0;
    const newBalance = currentBalance + amount;

    // Create wallet transaction
    const transactionRef = db.collection('driverWalletTransactions').doc();
    const transactionData = {
      id: transactionRef.id,
      driverId: uid,
      type: 'credit',
      amount: amount,
      previousBalance: currentBalance,
      newBalance: newBalance,
      paymentMethod: paymentMethod,
      status: 'pending',
      metadata: {
        upiId,
        cardDetails: cardDetails ? {
          last4: cardDetails.last4,
          brand: cardDetails.brand
        } : null
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await transactionRef.set(transactionData);

    // Update wallet balance
    await userRef.update({
      'driver.wallet.balance': newBalance,
      'driver.wallet.currency': 'INR',
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Money added to wallet successfully',
      data: {
        transaction: transactionData,
        newBalance: newBalance
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error adding money to wallet:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'WALLET_ADD_MONEY_ERROR',
        message: 'Failed to add money to wallet',
        details: 'An error occurred while adding money to wallet'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/wallet/withdraw
 * @desc    Withdraw money from driver wallet
 * @access  Private (Driver only)
 */
router.post('/wallet/withdraw', [
  requireDriver,
  body('amount')
    .isFloat({ min: 100, max: 50000 })
    .withMessage('Amount must be between 100 and 50,000'),
  body('bankDetails')
    .isObject()
    .withMessage('Bank details are required'),
  body('bankDetails.accountNumber')
    .isString()
    .isLength({ min: 9, max: 18 })
    .withMessage('Valid account number is required'),
  body('bankDetails.ifscCode')
    .isString()
    .isLength({ min: 11, max: 11 })
    .withMessage('Valid IFSC code is required'),
  body('bankDetails.accountHolderName')
    .isString()
    .isLength({ min: 2, max: 50 })
    .withMessage('Valid account holder name is required')
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
    const { amount, bankDetails } = req.body;
    const db = getFirestore();
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const currentBalance = userData.driver?.wallet?.balance || 0;

    if (currentBalance < amount) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient balance',
          details: 'Wallet balance is insufficient for this withdrawal'
        },
        timestamp: new Date().toISOString()
      });
    }

    const newBalance = currentBalance - amount;

    // Create withdrawal transaction
    const transactionRef = db.collection('driverWalletTransactions').doc();
    const transactionData = {
      id: transactionRef.id,
      driverId: uid,
      type: 'debit',
      amount: amount,
      previousBalance: currentBalance,
      newBalance: newBalance,
      paymentMethod: 'bank_transfer',
      status: 'pending',
      metadata: {
        bankDetails: {
          accountNumber: bankDetails.accountNumber,
          ifscCode: bankDetails.ifscCode,
          accountHolderName: bankDetails.accountHolderName
        }
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await transactionRef.set(transactionData);

    // Update wallet balance
    await userRef.update({
      'driver.wallet.balance': newBalance,
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Withdrawal request submitted successfully',
      data: {
        transaction: transactionData,
        newBalance: newBalance
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error withdrawing from wallet:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'WALLET_WITHDRAWAL_ERROR',
        message: 'Failed to process withdrawal',
        details: 'An error occurred while processing withdrawal'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/bookings/:id/photo-verification
 * @desc    Upload photo verification for pickup or delivery
 * @access  Private (Driver only)
 */
router.post('/bookings/:id/photo-verification', [
  requireDriver,
  body('photoType')
    .isIn(['pickup', 'delivery'])
    .withMessage('Photo type must be either pickup or delivery'),
  body('photoUrl')
    .isURL()
    .withMessage('Photo URL must be a valid URL'),
  body('photoMetadata')
    .optional()
    .isObject()
    .withMessage('Photo metadata must be an object'),
  body('location')
    .optional()
    .isObject()
    .withMessage('Location must be an object'),
  body('notes')
    .optional()
    .isLength({ min: 5, max: 200 })
    .withMessage('Notes must be between 5 and 200 characters')
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
    const { id } = req.params;
    const { photoType, photoUrl, photoMetadata, location, notes } = req.body;
    const db = getFirestore();
    
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
    
    // Check if driver is assigned to this booking
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only upload photos for bookings assigned to you'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Validate booking status for photo upload
    const validStatuses = {
      pickup: ['driver_arrived', 'picked_up'],
      delivery: ['in_transit', 'at_dropoff', 'delivered']
    };

    if (!validStatuses[photoType].includes(bookingData.status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_FOR_PHOTO',
          message: 'Invalid booking status for photo upload',
          details: `Cannot upload ${photoType} photo in current booking status: ${bookingData.status}`
        },
        timestamp: new Date().toISOString()
      });
    }

    // Create photo verification record
    const photoVerificationRef = db.collection('photoVerifications').doc();
    const photoData = {
      id: photoVerificationRef.id,
      bookingId: id,
      driverId: uid,
      customerId: bookingData.customerId,
      photoType: photoType,
      photoUrl: photoUrl,
      photoMetadata: photoMetadata || {},
      location: location || null,
      notes: notes || null,
      status: 'pending_verification',
      uploadedAt: new Date(),
      verifiedAt: null,
      verifiedBy: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await photoVerificationRef.set(photoData);

    // Update booking with photo information
    const updateData = {
      updatedAt: new Date()
    };

    if (photoType === 'pickup') {
      updateData['photos.pickup'] = {
        url: photoUrl,
        uploadedAt: new Date(),
        verificationId: photoVerificationRef.id
      };
    } else if (photoType === 'delivery') {
      updateData['photos.delivery'] = {
        url: photoUrl,
        uploadedAt: new Date(),
        verificationId: photoVerificationRef.id
      };
    }

    await bookingRef.update(updateData);

    res.status(200).json({
      success: true,
      message: 'Photo verification uploaded successfully',
      data: {
        photoVerification: photoData,
        bookingId: id,
        photoType: photoType
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error uploading photo verification:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PHOTO_VERIFICATION_UPLOAD_ERROR',
        message: 'Failed to upload photo verification',
        details: 'An error occurred while uploading photo verification'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/bookings/:id/photo-verifications
 * @desc    Get photo verifications for a booking
 * @access  Private (Driver only)
 */
router.get('/bookings/:id/photo-verifications', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const db = getFirestore();
    
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
    
    // Check if driver is assigned to this booking
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only view photos for bookings assigned to you'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get photo verifications for this booking
    const photoVerificationsQuery = db.collection('photoVerifications')
      .where('bookingId', '==', id)
      .orderBy('uploadedAt', 'desc');

    const photoVerificationsSnapshot = await photoVerificationsQuery.get();
    const photoVerifications = [];

    photoVerificationsSnapshot.forEach(doc => {
      photoVerifications.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.status(200).json({
      success: true,
      message: 'Photo verifications retrieved successfully',
      data: {
        photoVerifications,
        bookingId: id
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting photo verifications:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PHOTO_VERIFICATIONS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve photo verifications',
        details: 'An error occurred while retrieving photo verifications'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/driver/bookings/:id/photo-verifications/:photoId
 * @desc    Update photo verification (re-upload if rejected)
 * @access  Private (Driver only)
 */
router.put('/bookings/:id/photo-verifications/:photoId', [
  requireDriver,
  body('photoUrl')
    .isURL()
    .withMessage('Photo URL must be a valid URL'),
  body('photoMetadata')
    .optional()
    .isObject()
    .withMessage('Photo metadata must be an object'),
  body('location')
    .optional()
    .isObject()
    .withMessage('Location must be an object'),
  body('notes')
    .optional()
    .isLength({ min: 5, max: 200 })
    .withMessage('Notes must be between 5 and 200 characters')
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
    const { id, photoId } = req.params;
    const { photoUrl, photoMetadata, location, notes } = req.body;
    const db = getFirestore();
    
    const photoVerificationRef = db.collection('photoVerifications').doc(photoId);
    const photoDoc = await photoVerificationRef.get();
    
    if (!photoDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'PHOTO_VERIFICATION_NOT_FOUND',
          message: 'Photo verification not found',
          details: 'Photo verification with this ID does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const photoData = photoDoc.data();
    
    // Check if driver owns this photo verification
    if (photoData.driverId !== uid || photoData.bookingId !== id) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only update your own photo verifications'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Only allow updates if photo is rejected
    if (photoData.status !== 'rejected') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'PHOTO_NOT_REJECTED',
          message: 'Photo not rejected',
          details: 'Can only update photos that have been rejected'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update photo verification
    const updateData = {
      photoUrl: photoUrl,
      photoMetadata: photoMetadata || photoData.photoMetadata,
      location: location || photoData.location,
      notes: notes || photoData.notes,
      status: 'pending_verification',
      uploadedAt: new Date(),
      verifiedAt: null,
      verifiedBy: null,
      updatedAt: new Date()
    };

    await photoVerificationRef.update(updateData);

    // Update booking photo information
    const bookingRef = db.collection('bookings').doc(id);
    const bookingUpdateData = {
      updatedAt: new Date()
    };

    if (photoData.photoType === 'pickup') {
      bookingUpdateData['photos.pickup'] = {
        url: photoUrl,
        uploadedAt: new Date(),
        verificationId: photoId
      };
    } else if (photoData.photoType === 'delivery') {
      bookingUpdateData['photos.delivery'] = {
        url: photoUrl,
        uploadedAt: new Date(),
        verificationId: photoId
      };
    }

    await bookingRef.update(bookingUpdateData);

    res.status(200).json({
      success: true,
      message: 'Photo verification updated successfully',
      data: {
        photoVerification: {
          ...photoData,
          ...updateData
        },
        bookingId: id,
        photoId: photoId
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating photo verification:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PHOTO_VERIFICATION_UPDATE_ERROR',
        message: 'Failed to update photo verification',
        details: 'An error occurred while updating photo verification'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/driver/availability/slots
 * @desc    Set driver availability slots and working hours
 * @access  Private (Driver only)
 */
router.put('/availability/slots', [
  requireDriver,
  body('workingHours')
    .isObject()
    .withMessage('Working hours must be an object'),
  body('workingHours.startTime')
    .isString()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Start time must be in HH:MM format'),
  body('workingHours.endTime')
    .isString()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('End time must be in HH:MM format'),
  body('workingDays')
    .isArray({ min: 1, max: 7 })
    .withMessage('Working days must be an array with 1-7 days'),
  body('workingDays.*')
    .isIn(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
    .withMessage('Invalid working day'),
  body('availabilitySlots')
    .optional()
    .isArray()
    .withMessage('Availability slots must be an array'),
  body('availabilitySlots.*.day')
    .optional()
    .isIn(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
    .withMessage('Invalid day in availability slot'),
  body('availabilitySlots.*.slots')
    .optional()
    .isArray()
    .withMessage('Slots must be an array'),
  body('availabilitySlots.*.slots.*.startTime')
    .optional()
    .isString()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Slot start time must be in HH:MM format'),
  body('availabilitySlots.*.slots.*.endTime')
    .optional()
    .isString()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Slot end time must be in HH:MM format'),
  body('availabilitySlots.*.slots.*.isAvailable')
    .optional()
    .isBoolean()
    .withMessage('Slot availability must be a boolean'),
  body('maxBookingsPerDay')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Max bookings per day must be between 1 and 20'),
  body('preferredAreas')
    .optional()
    .isArray()
    .withMessage('Preferred areas must be an array'),
  body('preferredAreas.*.name')
    .optional()
    .isString()
    .withMessage('Area name must be a string'),
  body('preferredAreas.*.coordinates')
    .optional()
    .isObject()
    .withMessage('Area coordinates must be an object'),
  body('preferredAreas.*.radius')
    .optional()
    .isFloat({ min: 1, max: 50 })
    .withMessage('Area radius must be between 1 and 50 km')
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
    const { 
      workingHours, 
      workingDays, 
      availabilitySlots, 
      maxBookingsPerDay,
      preferredAreas 
    } = req.body;
    const db = getFirestore();
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Validate working hours
    const startTime = workingHours.startTime;
    const endTime = workingHours.endTime;
    
    if (startTime >= endTime) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_WORKING_HOURS',
          message: 'Invalid working hours',
          details: 'End time must be after start time'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update driver availability
    const updateData = {
      'driver.availability.workingHours': workingHours,
      'driver.availability.workingDays': workingDays,
      'driver.availability.maxBookingsPerDay': maxBookingsPerDay || 10,
      'driver.availability.preferredAreas': preferredAreas || [],
      updatedAt: new Date()
    };

    if (availabilitySlots) {
      updateData['driver.availability.availabilitySlots'] = availabilitySlots;
    }

    await userRef.update(updateData);

    // Update driver location status
    const locationRef = db.collection('driverLocations').doc(uid);
    await locationRef.set({
      driverId: uid,
      availability: {
        workingHours,
        workingDays,
        maxBookingsPerDay: maxBookingsPerDay || 10,
        preferredAreas: preferredAreas || [],
        availabilitySlots: availabilitySlots || []
      },
      lastUpdated: new Date()
    }, { merge: true });

    res.status(200).json({
      success: true,
      message: 'Availability slots updated successfully',
      data: {
        workingHours,
        workingDays,
        availabilitySlots,
        maxBookingsPerDay: maxBookingsPerDay || 10,
        preferredAreas: preferredAreas || []
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating availability slots:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'AVAILABILITY_SLOTS_UPDATE_ERROR',
        message: 'Failed to update availability slots',
        details: 'An error occurred while updating availability slots'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/availability/slots
 * @desc    Get driver availability slots and working hours
 * @access  Private (Driver only)
 */
router.get('/availability/slots', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const availability = userData.driver?.availability || {};

    res.status(200).json({
      success: true,
      message: 'Availability slots retrieved successfully',
      data: {
        workingHours: availability.workingHours || {},
        workingDays: availability.workingDays || [],
        availabilitySlots: availability.availabilitySlots || [],
        maxBookingsPerDay: availability.maxBookingsPerDay || 10,
        preferredAreas: availability.preferredAreas || [],
        isAvailable: userData.driver?.isAvailable || false,
        isOnline: userData.driver?.isOnline || false
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting availability slots:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'AVAILABILITY_SLOTS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve availability slots',
        details: 'An error occurred while retrieving availability slots'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/availability/toggle-slot
 * @desc    Toggle availability for a specific time slot
 * @access  Private (Driver only)
 */
router.post('/availability/toggle-slot', [
  requireDriver,
  body('day')
    .isIn(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'])
    .withMessage('Invalid day'),
  body('startTime')
    .isString()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('Start time must be in HH:MM format'),
  body('endTime')
    .isString()
    .matches(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .withMessage('End time must be in HH:MM format'),
  body('isAvailable')
    .isBoolean()
    .withMessage('Availability must be a boolean')
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
    const { day, startTime, endTime, isAvailable } = req.body;
    const db = getFirestore();
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const availabilitySlots = userData.driver?.availability?.availabilitySlots || [];

    // Find existing slot for this day and time
    let slotIndex = -1;
    let dayIndex = -1;

    for (let i = 0; i < availabilitySlots.length; i++) {
      if (availabilitySlots[i].day === day) {
        dayIndex = i;
        for (let j = 0; j < availabilitySlots[i].slots.length; j++) {
          if (availabilitySlots[i].slots[j].startTime === startTime && 
              availabilitySlots[i].slots[j].endTime === endTime) {
            slotIndex = j;
            break;
          }
        }
        break;
      }
    }

    if (dayIndex === -1) {
      // Create new day entry
      availabilitySlots.push({
        day,
        slots: [{
          startTime,
          endTime,
          isAvailable
        }]
      });
    } else if (slotIndex === -1) {
      // Add new slot to existing day
      availabilitySlots[dayIndex].slots.push({
        startTime,
        endTime,
        isAvailable
      });
    } else {
      // Update existing slot
      availabilitySlots[dayIndex].slots[slotIndex].isAvailable = isAvailable;
    }

    // Update driver availability
    await userRef.update({
      'driver.availability.availabilitySlots': availabilitySlots,
      updatedAt: new Date()
    });

    // Update driver location status
    const locationRef = db.collection('driverLocations').doc(uid);
    await locationRef.set({
      driverId: uid,
      availability: {
        ...userData.driver?.availability,
        availabilitySlots
      },
      lastUpdated: new Date()
    }, { merge: true });

    res.status(200).json({
      success: true,
      message: 'Slot availability updated successfully',
      data: {
        day,
        startTime,
        endTime,
        isAvailable,
        availabilitySlots
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error toggling slot availability:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SLOT_TOGGLE_ERROR',
        message: 'Failed to toggle slot availability',
        details: 'An error occurred while toggling slot availability'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/documents/status
 * @desc    Get driver document verification status
 * @access  Private (Driver only)
 */
router.get('/documents/status', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const documents = userData.driver?.documents || {};
    const verificationStatus = userData.driver?.verificationStatus || 'pending';

    // Calculate document completion status
    const requiredDocuments = ['drivingLicense', 'profilePhoto', 'aadhaarCard', 'bikeInsurance', 'rcBook'];
    const uploadedDocuments = requiredDocuments.filter(doc => documents[doc]?.url);
    const verifiedDocuments = requiredDocuments.filter(doc => documents[doc]?.status === 'verified');
    const rejectedDocuments = requiredDocuments.filter(doc => documents[doc]?.status === 'rejected');

    const documentStatus = {
      total: requiredDocuments.length,
      uploaded: uploadedDocuments.length,
      verified: verifiedDocuments.length,
      rejected: rejectedDocuments.length,
      pending: uploadedDocuments.length - verifiedDocuments.length - rejectedDocuments.length
    };

    // Get detailed status for each document
    const documentDetails = requiredDocuments.map(docType => {
      const doc = documents[docType];
      return {
        type: docType,
        name: getDocumentDisplayName(docType),
        status: doc?.status || 'not_uploaded',
        url: doc?.url || null,
        number: doc?.number || null,
        uploadedAt: doc?.uploadedAt || null,
        verifiedAt: doc?.verifiedAt || null,
        rejectedAt: doc?.rejectedAt || null,
        rejectionReason: doc?.rejectionReason || null,
        verifiedBy: doc?.verifiedBy || null
      };
    });

    res.status(200).json({
      success: true,
      message: 'Document status retrieved successfully',
      data: {
        verificationStatus,
        documentStatus,
        documents: documentDetails,
        isComplete: uploadedDocuments.length === requiredDocuments.length,
        isVerified: verificationStatus === 'approved',
        canStartWorking: verificationStatus === 'approved'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting document status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENT_STATUS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve document status',
        details: 'An error occurred while retrieving document status'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/documents/request-verification
 * @desc    Request verification for uploaded documents
 * @access  Private (Driver only)
 */
router.post('/documents/request-verification', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Driver does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const documents = userData.driver?.documents || {};

    // Check if all required documents are uploaded
    const requiredDocuments = ['drivingLicense', 'profilePhoto', 'aadhaarCard', 'bikeInsurance', 'rcBook'];
    const uploadedDocuments = requiredDocuments.filter(doc => documents[doc]?.url);

    if (uploadedDocuments.length !== requiredDocuments.length) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INCOMPLETE_DOCUMENTS',
          message: 'Incomplete documents',
          details: `Please upload all required documents. Missing: ${requiredDocuments.filter(doc => !documents[doc]?.url).join(', ')}`
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if verification is already requested
    if (userData.driver?.verificationStatus === 'pending_verification') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VERIFICATION_ALREADY_REQUESTED',
          message: 'Verification already requested',
          details: 'Document verification has already been requested and is pending review'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update verification status
    await userRef.update({
      'driver.verificationStatus': 'pending_verification',
      'driver.verificationRequestedAt': new Date(),
      updatedAt: new Date()
    });

    // Create verification request record
    const verificationRequestRef = db.collection('documentVerificationRequests').doc();
    const verificationRequest = {
      id: verificationRequestRef.id,
      driverId: uid,
      driverName: userData.name,
      driverPhone: userData.phone,
      documents: documents,
      status: 'pending',
      requestedAt: new Date(),
      reviewedAt: null,
      reviewedBy: null,
      reviewNotes: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await verificationRequestRef.set(verificationRequest);

    // Send notification to admin (if notification service is available)
    try {
      // This would integrate with your notification service
      console.log(`Document verification requested for driver: ${userData.name} (${uid})`);
    } catch (error) {
      console.warn('Failed to send admin notification:', error);
    }

    res.status(200).json({
      success: true,
      message: 'Document verification requested successfully',
      data: {
        verificationStatus: 'pending_verification',
        verificationRequestId: verificationRequestRef.id,
        requestedAt: new Date(),
        estimatedReviewTime: '24-48 hours'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error requesting document verification:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_REQUEST_ERROR',
        message: 'Failed to request document verification',
        details: 'An error occurred while requesting document verification'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/documents/verification-history
 * @desc    Get document verification history
 * @access  Private (Driver only)
 */
router.get('/documents/verification-history', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 10, offset = 0 } = req.query;
    const db = getFirestore();
    
    // Get verification requests for this driver
    const verificationRequestsQuery = db.collection('documentVerificationRequests')
      .where('driverId', '==', uid)
      .orderBy('requestedAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    const verificationRequestsSnapshot = await verificationRequestsQuery.get();
    const verificationRequests = [];

    verificationRequestsSnapshot.forEach(doc => {
      verificationRequests.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Get total count
    const totalQuery = db.collection('documentVerificationRequests')
      .where('driverId', '==', uid);
    const totalSnapshot = await totalQuery.get();

    res.status(200).json({
      success: true,
      message: 'Verification history retrieved successfully',
      data: {
        verificationRequests,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: totalSnapshot.size
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting verification history:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_HISTORY_RETRIEVAL_ERROR',
        message: 'Failed to retrieve verification history',
        details: 'An error occurred while retrieving verification history'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Helper function to get document display names
function getDocumentDisplayName(docType) {
  const displayNames = {
    drivingLicense: 'Driving License',
    profilePhoto: 'Profile Photo',
    aadhaarCard: 'Aadhaar Card',
    bikeInsurance: 'Bike Insurance',
    rcBook: 'RC Book'
  };
  return displayNames[docType] || docType;
}

// Helper function to calculate distance between two points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
}

/**
 * @route   POST /api/driver/tracking/start
 * @desc    Start real-time tracking for a trip
 * @access  Private (Driver only)
 */
router.post('/tracking/start', [
  requireDriver,
  body('bookingId')
    .notEmpty()
    .withMessage('Booking ID is required'),
  body('initialLocation')
    .isObject()
    .withMessage('Initial location is required'),
  body('initialLocation.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('initialLocation.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  body('initialLocation.accuracy')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Accuracy must be a positive number')
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
    const { bookingId, initialLocation } = req.body;
    const db = getFirestore();
    
    // Verify booking exists and driver is assigned
    const bookingRef = db.collection('bookings').doc(bookingId);
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
    
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only track bookings assigned to you'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Create or update trip tracking record
    const tripTrackingRef = db.collection('tripTracking').doc(bookingId);
    const tripTrackingData = {
      tripId: bookingId,
      bookingId: bookingId,
      driverId: uid,
      customerId: bookingData.customerId,
      currentStatus: bookingData.status,
      currentLocation: {
        ...initialLocation,
        timestamp: new Date()
      },
      route: {
        pickup: bookingData.pickup?.coordinates,
        dropoff: bookingData.dropoff?.coordinates,
        currentRoute: null,
        distance: null,
        duration: null
      },
      trackingHistory: [{
        location: initialLocation,
        status: bookingData.status,
        timestamp: new Date()
      }],
      isActive: true,
      startedAt: new Date(),
      lastUpdated: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await tripTrackingRef.set(tripTrackingData);

    // Update driver location
    await db.collection('driverLocations').doc(uid).update({
      currentTripId: bookingId,
      currentLocation: {
        ...initialLocation,
        timestamp: new Date()
      },
      lastUpdated: new Date()
    });

    // Update booking with tracking info
    await bookingRef.update({
      'tracking.isActive': true,
      'tracking.startedAt': new Date(),
      'tracking.currentLocation': initialLocation,
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Trip tracking started successfully',
      data: {
        tripId: bookingId,
        trackingData: tripTrackingData,
        isActive: true
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error starting trip tracking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TRACKING_START_ERROR',
        message: 'Failed to start trip tracking',
        details: 'An error occurred while starting trip tracking'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/tracking/update
 * @desc    Update real-time location during trip
 * @access  Private (Driver only)
 */
router.post('/tracking/update', [
  requireDriver,
  body('bookingId')
    .notEmpty()
    .withMessage('Booking ID is required'),
  body('location')
    .isObject()
    .withMessage('Location is required'),
  body('location.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('location.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  body('location.accuracy')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Accuracy must be a positive number'),
  body('status')
    .optional()
    .isString()
    .withMessage('Status must be a string'),
  body('speed')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Speed must be a positive number'),
  body('heading')
    .optional()
    .isFloat({ min: 0, max: 360 })
    .withMessage('Heading must be between 0 and 360 degrees')
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
    const { bookingId, location, status, speed, heading } = req.body;
    const db = getFirestore();
    
    // Verify trip tracking is active
    const tripTrackingRef = db.collection('tripTracking').doc(bookingId);
    const tripTrackingDoc = await tripTrackingRef.get();
    
    if (!tripTrackingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRIP_TRACKING_NOT_FOUND',
          message: 'Trip tracking not found',
          details: 'Trip tracking for this booking does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const tripTrackingData = tripTrackingDoc.data();
    
    if (tripTrackingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only update tracking for your own trips'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!tripTrackingData.isActive) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TRIP_NOT_ACTIVE',
          message: 'Trip not active',
          details: 'Trip tracking is not active for this booking'
        },
        timestamp: new Date().toISOString()
      });
    }

    const currentTime = new Date();
    const locationUpdate = {
      ...location,
      timestamp: currentTime,
      speed: speed || null,
      heading: heading || null
    };

    // Update trip tracking
    const updateData = {
      currentLocation: locationUpdate,
      lastUpdated: currentTime,
      updatedAt: currentTime
    };

    if (status) {
      updateData.currentStatus = status;
    }

    // Add to tracking history (keep last 100 entries)
    const trackingHistory = tripTrackingData.trackingHistory || [];
    trackingHistory.push({
      location: locationUpdate,
      status: status || tripTrackingData.currentStatus,
      timestamp: currentTime
    });

    // Keep only last 100 entries
    if (trackingHistory.length > 100) {
      trackingHistory.splice(0, trackingHistory.length - 100);
    }

    updateData.trackingHistory = trackingHistory;

    await tripTrackingRef.update(updateData);

    // Update driver location
    await db.collection('driverLocations').doc(uid).update({
      currentLocation: locationUpdate,
      lastUpdated: currentTime
    });

    // Update booking with current location
    await db.collection('bookings').doc(bookingId).update({
      'tracking.currentLocation': locationUpdate,
      'driver.currentLocation': locationUpdate,
      updatedAt: currentTime
    });

    res.status(200).json({
      success: true,
      message: 'Location updated successfully',
      data: {
        tripId: bookingId,
        location: locationUpdate,
        status: status || tripTrackingData.currentStatus,
        timestamp: currentTime
      },
      timestamp: currentTime.toISOString()
    });

  } catch (error) {
    console.error('Error updating trip tracking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TRACKING_UPDATE_ERROR',
        message: 'Failed to update trip tracking',
        details: 'An error occurred while updating trip tracking'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/tracking/stop
 * @desc    Stop real-time tracking for a trip
 * @access  Private (Driver only)
 */
router.post('/tracking/stop', [
  requireDriver,
  body('bookingId')
    .notEmpty()
    .withMessage('Booking ID is required'),
  body('finalLocation')
    .optional()
    .isObject()
    .withMessage('Final location must be an object'),
  body('finalLocation.latitude')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('finalLocation.longitude')
    .optional()
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

    const { uid } = req.user;
    const { bookingId, finalLocation } = req.body;
    const db = getFirestore();
    
    // Verify trip tracking is active
    const tripTrackingRef = db.collection('tripTracking').doc(bookingId);
    const tripTrackingDoc = await tripTrackingRef.get();
    
    if (!tripTrackingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRIP_TRACKING_NOT_FOUND',
          message: 'Trip tracking not found',
          details: 'Trip tracking for this booking does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const tripTrackingData = tripTrackingDoc.data();
    
    if (tripTrackingData.driverId !== uid) {
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

    const currentTime = new Date();

    // Update trip tracking
    const updateData = {
      isActive: false,
      endedAt: currentTime,
      lastUpdated: currentTime,
      updatedAt: currentTime
    };

    if (finalLocation) {
      updateData.finalLocation = {
        ...finalLocation,
        timestamp: currentTime
      };
    }

    await tripTrackingRef.update(updateData);

    // Update driver location
    await db.collection('driverLocations').doc(uid).update({
      currentTripId: null,
      lastUpdated: currentTime
    });

    // Update booking
    await db.collection('bookings').doc(bookingId).update({
      'tracking.isActive': false,
      'tracking.endedAt': currentTime,
      updatedAt: currentTime
    });

    res.status(200).json({
      success: true,
      message: 'Trip tracking stopped successfully',
      data: {
        tripId: bookingId,
        endedAt: currentTime,
        isActive: false
      },
      timestamp: currentTime.toISOString()
    });

  } catch (error) {
    console.error('Error stopping trip tracking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TRACKING_STOP_ERROR',
        message: 'Failed to stop trip tracking',
        details: 'An error occurred while stopping trip tracking'
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
