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

module.exports = router;
