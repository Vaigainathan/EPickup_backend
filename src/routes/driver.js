const express = require('express');
const { body, validationResult } = require('express-validator');
const { getFirestore } = require('../services/firebase');
const { requireDriver } = require('../middleware/auth');
const { documentStatusRateLimit } = require('../middleware/rateLimiter');
const { documentStatusCache, invalidateUserCache } = require('../middleware/cache');
const admin = require('firebase-admin');

const router = express.Router();

/**
 * @route   GET /api/driver/
 * @desc    Get driver data (root endpoint)
 * @access  Private (Driver only)
 */
router.get('/', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
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
    
    res.status(200).json({
      success: true,
      message: 'Driver data retrieved successfully',
      data: {
        driver: {
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
    console.error('Error getting driver data:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DRIVER_RETRIEVAL_ERROR',
        message: 'Failed to retrieve driver data',
        details: 'An error occurred while retrieving driver data'
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
    .withMessage('Profile picture must be a valid URL'),
  body('vehicleDetails.vehicleType')
    .optional()
    .isIn(['motorcycle', 'electric'])
    .withMessage('Vehicle type must be motorcycle or electric'),
  body('vehicleDetails.vehicleNumber')
    .optional()
    .isLength({ min: 1 })
    .withMessage('Vehicle number is required'),
  body('vehicleDetails.vehicleYear')
    .optional()
    .isInt({ min: 2000, max: new Date().getFullYear() + 1 })
    .withMessage('Invalid vehicle year')
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
    const { name, email, profilePicture, vehicleDetails } = req.body;
    const db = getFirestore();
    
    const updateData = {
      updatedAt: new Date()
    };

    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (profilePicture) updateData.profilePicture = profilePicture;
    
    // Handle vehicle details update
    if (vehicleDetails) {
      updateData['driver.vehicleDetails'] = vehicleDetails;
    }

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
 * @route   GET /api/driver/profile
 * @desc    Get driver profile data
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
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found',
          details: 'Driver profile does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    
    // Ensure wallet structure exists and is properly formatted
    const driverData = userData.driver || {};
    
    // CRITICAL FIX: Get verification data from verification service for comprehensive status
    const verificationService = require('../services/verificationService');
    let comprehensiveVerificationData;
    
    try {
      comprehensiveVerificationData = await verificationService.getDriverVerificationData(uid);
      console.log('📊 [PROFILE] Comprehensive verification data:', comprehensiveVerificationData);
      console.log('🔍 [PROFILE] Verification status from service:', comprehensiveVerificationData?.verificationStatus);
      console.log('🔍 [PROFILE] Driver data verification status:', driverData.verificationStatus);
    } catch (verificationError) {
      console.warn('⚠️ [PROFILE] Failed to get comprehensive verification data, using basic data:', verificationError.message);
      console.error('❌ [PROFILE] Verification service error details:', verificationError);
    }
    
    const walletData = driverData.wallet || {};
    
    // Debug logging for vehicle details
    console.log('🔍 [PROFILE] Debug userData:', {
      hasDriver: !!userData.driver,
      driverKeys: userData.driver ? Object.keys(userData.driver) : [],
      vehicleDetails: userData.driver?.vehicleDetails,
      vehicleDetailsKeys: userData.driver?.vehicleDetails ? Object.keys(userData.driver.vehicleDetails) : []
    });
    
    // Normalize wallet data
    const normalizedWallet = {
      balance: walletData.balance || 0,
      currency: walletData.currency || 'INR',
      lastUpdated: walletData.lastUpdated || new Date(),
      transactions: walletData.transactions || []
    };
    
    // Use comprehensive verification data if available, otherwise fall back to basic data
    const finalVerificationStatus = comprehensiveVerificationData?.verificationStatus || driverData.verificationStatus || 'pending';
    const finalIsVerified = comprehensiveVerificationData?.verificationStatus === 'verified' || comprehensiveVerificationData?.verificationStatus === 'approved' || driverData.isVerified || false;
    
    console.log('🔍 [PROFILE] Final verification calculation:', {
      comprehensiveStatus: comprehensiveVerificationData?.verificationStatus,
      driverDataStatus: driverData.verificationStatus,
      finalStatus: finalVerificationStatus,
      finalIsVerified: finalIsVerified,
      hasComprehensiveData: !!comprehensiveVerificationData
    });
    
    // Normalize driver data with proper wallet structure and updated verification status
    const normalizedDriver = {
      ...driverData,
      wallet: normalizedWallet,
      verificationStatus: finalVerificationStatus,
      isVerified: finalIsVerified,
      welcomeBonusGiven: driverData.welcomeBonusGiven || false,
      welcomeBonusAmount: driverData.welcomeBonusAmount || 0,
      welcomeBonusGivenAt: driverData.welcomeBonusGivenAt || null
    };
    
    res.status(200).json({
      success: true,
      message: 'Driver profile retrieved successfully',
      data: {
        id: userData.id,
        name: userData.name,
        email: userData.email,
        phone: userData.phone,
        profilePicture: userData.profilePicture,
        verificationStatus: finalVerificationStatus,
        isVerified: finalIsVerified,
        wallet: normalizedDriver.wallet,
        welcomeBonusGiven: normalizedDriver.welcomeBonusGiven,
        welcomeBonusAmount: normalizedDriver.welcomeBonusAmount,
        welcomeBonusGivenAt: normalizedDriver.welcomeBonusGivenAt,
        driver: {
          vehicleDetails: normalizedDriver.vehicleDetails || {
            type: 'motorcycle',
            model: '',
            number: '',
            color: ''
          },
          verificationStatus: finalVerificationStatus,
          isOnline: normalizedDriver.isOnline || false,
          isAvailable: normalizedDriver.isAvailable || false,
          rating: normalizedDriver.rating || 0,
          totalTrips: normalizedDriver.totalTrips || 0,
          earnings: normalizedDriver.earnings || {
            total: 0,
            thisMonth: 0,
            thisWeek: 0
          },
          wallet: normalizedDriver.wallet,
          currentLocation: normalizedDriver.currentLocation || null,
          welcomeBonusGiven: normalizedDriver.welcomeBonusGiven,
          welcomeBonusAmount: normalizedDriver.welcomeBonusAmount,
          welcomeBonusGivenAt: normalizedDriver.welcomeBonusGivenAt
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
        message: 'Failed to retrieve driver profile',
        details: 'An error occurred while retrieving driver profile'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/documents
 * @desc    Get driver documents
 * @access  Private (Driver only)
 */
router.get('/documents', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
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
    const documents = userData.driver?.documents || {};
    
    res.status(200).json({
      success: true,
      message: 'Documents retrieved successfully',
      data: {
        documents: {
          drivingLicense: documents.drivingLicense || null,
          profilePhoto: documents.profilePhoto || null,
          aadhaarCard: documents.aadhaarCard || null,
          bikeInsurance: documents.bikeInsurance || null,
          rcBook: documents.rcBook || null
        },
        verificationStatus: userData.driver?.verificationStatus || 'pending'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting documents:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENTS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve documents',
        details: 'An error occurred while retrieving documents'
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

    // Invalidate cache for this user's document status
    invalidateUserCache(uid);

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
 * @route   POST /api/driver/earnings/report
 * @desc    Generate earnings report (PDF/CSV)
 * @access  Private (Driver only)
 */
router.post('/earnings/report', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { format = 'pdf', period = '30d' } = req.body;
    const db = getFirestore();
    
    console.log(`📊 Generating ${format} earnings report for driver ${uid} (${period})`);
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    switch (period) {
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
    }

    // Get completed bookings for the period
    const bookingsSnapshot = await db.collection('bookings')
      .where('driverId', '==', uid)
      .where('status', '==', 'completed')
      .where('completedAt', '>=', startDate)
      .where('completedAt', '<=', endDate)
      .orderBy('completedAt', 'desc')
      .get();

    let totalEarnings = 0;
    let totalTrips = 0;
    const tripDetails = [];

    bookingsSnapshot.forEach(doc => {
      const data = doc.data();
      const earnings = data.driverEarnings || data.fare?.totalFare || 0;
      totalEarnings += earnings;
      totalTrips++;

      tripDetails.push({
        id: doc.id,
        completedAt: data.completedAt,
        customerName: data.pickup?.name || 'Unknown',
        pickupLocation: data.pickup?.address || 'Unknown',
        dropoffLocation: data.dropoff?.address || 'Unknown',
        fare: data.fare?.totalFare || 0,
        driverEarnings: earnings,
        commission: (data.fare?.totalFare || 0) * 0.2,
        distance: data.distance || 0,
        duration: data.actualDuration || 0,
        rating: data.rating?.customerRating || 0
      });
    });

    // Get driver info
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    const driverName = userData.driver?.personalInfo?.name || 'Driver';

    if (format === 'pdf') {
      try {
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument();
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="earnings-report-${period}-${Date.now()}.pdf"`);
        
        doc.pipe(res);
        
        // Header
        doc.fontSize(20).text('EPickup Driver Earnings Report', 50, 50);
        doc.fontSize(12).text(`Driver: ${driverName}`, 50, 80);
        doc.text(`Period: ${period} (${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()})`, 50, 100);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 50, 120);
        
        // Summary
        doc.text('Summary:', 50, 160);
        doc.text(`Total Trips: ${totalTrips}`, 70, 180);
        doc.text(`Total Earnings: ₹${totalEarnings.toFixed(2)}`, 70, 200);
        doc.text(`Driver Earnings (80%): ₹${(totalEarnings * 0.8).toFixed(2)}`, 70, 220);
        doc.text(`Platform Commission (20%): ₹${(totalEarnings * 0.2).toFixed(2)}`, 70, 240);
        
        // Trip Details
        doc.text('Trip Details:', 50, 280);
        let yPosition = 300;
        
        tripDetails.forEach((trip, index) => {
          if (yPosition > 700) {
            doc.addPage();
            yPosition = 50;
          }
          
          doc.text(`Trip ${index + 1}:`, 70, yPosition);
          doc.text(`  Customer: ${trip.customerName}`, 90, yPosition + 15);
          doc.text(`  From: ${trip.pickupLocation}`, 90, yPosition + 30);
          doc.text(`  To: ${trip.dropoffLocation}`, 90, yPosition + 45);
          doc.text(`  Fare: ₹${trip.fare.toFixed(2)}`, 90, yPosition + 60);
          doc.text(`  Earnings: ₹${trip.driverEarnings.toFixed(2)}`, 90, yPosition + 75);
          doc.text(`  Date: ${new Date(trip.completedAt).toLocaleString()}`, 90, yPosition + 90);
          
          yPosition += 120;
        });
        
        doc.text('Thank you for using EPickup!', 50, yPosition + 20);
        
        doc.end();
        
        console.log(`✅ Generated PDF earnings report for driver ${uid}`);
        return;
        
      } catch (error) {
        console.error('❌ Error generating PDF report:', error);
      }
    }
    
    // Default JSON response
    res.json({
      success: true,
      data: {
        driverName,
        period,
        summary: {
          totalTrips,
          totalEarnings,
          driverEarnings: totalEarnings * 0.8,
          platformCommission: totalEarnings * 0.2
        },
        trips: tripDetails,
        generatedAt: new Date().toISOString()
      },
      message: 'Earnings report generated successfully'
    });

  } catch (error) {
    console.error('❌ Error generating earnings report:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate earnings report',
      details: error.message
    });
  }
});

/**
 * @route   GET /api/driver/earnings/detailed
 * @desc    Get detailed driver earnings breakdown
 * @access  Private (Driver only)
 */
router.get('/earnings/detailed', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { period = 'all', startDate, endDate, limit = 50 } = req.query;
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

    // Get detailed earnings from completed bookings
    let query = db.collection('bookings')
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
      
      query = query.where('timing.completedAt', '>=', start);
    } else if (startDate && endDate) {
      query = query
        .where('timing.completedAt', '>=', new Date(startDate))
        .where('timing.completedAt', '<=', new Date(endDate));
    }

    query = query.orderBy('timing.completedAt', 'desc').limit(parseInt(limit));
    
    const snapshot = await query.get();
    const trips = [];
    let totalEarnings = 0;
    let totalDistance = 0;
    let totalTrips = 0;

    snapshot.forEach(doc => {
      const tripData = doc.data();
      const tripEarnings = tripData.fare?.total || 0;
      const tripDistance = tripData.distance?.total || 0;
      
      trips.push({
        id: doc.id,
        customerName: tripData.pickup?.name || 'Unknown',
        pickupLocation: tripData.pickup?.address || '',
        dropoffLocation: tripData.dropoff?.address || '',
        fare: tripEarnings,
        distance: tripDistance,
        completedAt: tripData.timing?.completedAt || tripData.updatedAt,
        rating: tripData.rating?.customerRating || 0,
        paymentMethod: tripData.paymentMethod || 'cash',
        packageWeight: tripData.package?.weight || 0
      });
      
      totalEarnings += tripEarnings;
      totalDistance += tripDistance;
      totalTrips++;
    });

    // Calculate commission (assuming 80% for driver, 20% for platform)
    const commission = totalEarnings * 0.8;
    const platformFee = totalEarnings * 0.2;

    // Get earnings by payment method
    const earningsByMethod = trips.reduce((acc, trip) => {
      const method = trip.paymentMethod;
      acc[method] = (acc[method] || 0) + trip.fare;
      return acc;
    }, {});

    // Get earnings by day of week
    const earningsByDay = trips.reduce((acc, trip) => {
      const day = new Date(trip.completedAt).toLocaleDateString('en-US', { weekday: 'long' });
      acc[day] = (acc[day] || 0) + trip.fare;
      return acc;
    }, {});

    res.status(200).json({
      success: true,
      message: 'Detailed earnings retrieved successfully',
      data: {
        summary: {
          totalEarnings: totalEarnings,
          commission: commission,
          platformFee: platformFee,
          totalDistance: totalDistance,
          totalTrips: totalTrips,
          averageEarningsPerTrip: totalTrips > 0 ? totalEarnings / totalTrips : 0,
          averageDistancePerTrip: totalTrips > 0 ? totalDistance / totalTrips : 0
        },
        breakdown: {
          byPaymentMethod: earningsByMethod,
          byDayOfWeek: earningsByDay,
          period: period,
          dateRange: {
            startDate: startDate || null,
            endDate: endDate || null
          }
        },
        trips: trips,
        pagination: {
          limit: parseInt(limit),
          total: trips.length,
          hasMore: trips.length === parseInt(limit)
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting detailed earnings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DETAILED_EARNINGS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve detailed earnings',
        details: 'An error occurred while retrieving detailed earnings'
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
 * @route   GET /api/driver/earnings/today
 * @desc    Get driver's today's earnings
 * @access  Private (Driver only)
 */
router.get('/earnings/today', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    // Get today's date range
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    
    console.log('📊 [EARNINGS_TODAY] Fetching today\'s earnings for driver:', uid);
    console.log('📊 [EARNINGS_TODAY] Date range:', { startOfDay, endOfDay });
    
    // Get today's completed trips
    const tripsSnapshot = await db.collection('bookings')
      .where('driverId', '==', uid)
      .where('status', '==', 'completed')
      .where('completedAt', '>=', startOfDay)
      .where('completedAt', '<', endOfDay)
      .get();
    
    let todayEarnings = 0;
    let todayTrips = 0;
    const tripDetails = [];
    
    tripsSnapshot.forEach((doc) => {
      const trip = doc.data();
      const fare = trip.fare?.total || 0;
      todayEarnings += fare;
      todayTrips += 1;
      
      tripDetails.push({
        id: doc.id,
        fare: fare,
        completedAt: trip.completedAt?.toDate?.()?.toISOString() || null,
        pickupLocation: trip.pickup?.address || 'Unknown',
        dropoffLocation: trip.dropoff?.address || 'Unknown'
      });
    });
    
    // Get today's payments
    const paymentsSnapshot = await db.collection('payments')
      .where('driverId', '==', uid)
      .where('status', '==', 'completed')
      .where('createdAt', '>=', startOfDay)
      .where('createdAt', '<', endOfDay)
      .get();
    
    let todayPayments = 0;
    paymentsSnapshot.forEach((doc) => {
      const payment = doc.data();
      todayPayments += payment.amount || 0;
    });
    
    const result = {
      todayEarnings: todayEarnings,
      todayTrips: todayTrips,
      todayPayments: todayPayments,
      averageEarningsPerTrip: todayTrips > 0 ? Math.round(todayEarnings / todayTrips) : 0,
      tripDetails: tripDetails,
      date: today.toISOString().split('T')[0], // YYYY-MM-DD format
      lastUpdated: new Date().toISOString()
    };
    
    console.log('✅ [EARNINGS_TODAY] Today\'s earnings calculated:', result);
    
    res.status(200).json({
      success: true,
      message: 'Today\'s earnings retrieved successfully',
      data: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [EARNINGS_TODAY] Error getting today\'s earnings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TODAY_EARNINGS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve today\'s earnings',
        details: 'An error occurred while retrieving today\'s earnings'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/earnings/breakdown
 * @desc    Get detailed earnings breakdown for a trip
 * @access  Private (Driver only)
 */
router.get('/earnings/breakdown', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { bookingId, period = 'today' } = req.query;
    const db = getFirestore();
    
    console.log('📊 [EARNINGS_BREAKDOWN] Fetching earnings breakdown for driver:', uid, 'bookingId:', bookingId);
    
    if (bookingId) {
      // Get breakdown for specific booking
      const bookingDoc = await db.collection('bookings').doc(bookingId).get();
      
      if (!bookingDoc.exists) {
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
      
      const booking = bookingDoc.data();
      
      // Verify driver owns this booking
      if (booking.driverId !== uid) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'UNAUTHORIZED',
            message: 'Unauthorized access',
            details: 'You can only view your own booking earnings'
          },
          timestamp: new Date().toISOString()
        });
      }
      
      const fare = booking.fare || {};
      const breakdown = {
        bookingId: bookingId,
        totalEarnings: fare.total || 0,
        baseFare: fare.base || 0,
        distanceFare: fare.distance || 0,
        timeFare: fare.time || 0,
        surgeMultiplier: fare.surgeMultiplier || 1,
        platformFee: fare.platformFee || 0,
        driverEarnings: fare.driverEarnings || fare.total || 0,
        tripDetails: {
          distance: booking.distance || 0,
          duration: booking.duration || 0,
          pickupLocation: booking.pickup?.address || 'Unknown',
          dropoffLocation: booking.dropoff?.address || 'Unknown',
          completedAt: booking.completedAt?.toDate?.()?.toISOString() || null
        },
        paymentMethod: booking.paymentMethod || 'cash',
        status: booking.status || 'unknown'
      };
      
      res.status(200).json({
        success: true,
        message: 'Earnings breakdown retrieved successfully',
        data: breakdown,
        timestamp: new Date().toISOString()
      });
      
    } else {
      // Get breakdown for period (today, week, month)
      const now = new Date();
      let startDate, endDate;
      
      switch (period) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
          break;
        case 'week':
          startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
          endDate = now;
          break;
        case 'month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          endDate = now;
          break;
        default:
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      }
      
      // Get completed trips for the period
      const tripsSnapshot = await db.collection('bookings')
        .where('driverId', '==', uid)
        .where('status', '==', 'completed')
        .where('completedAt', '>=', startDate)
        .where('completedAt', '<', endDate)
        .get();
      
      let totalEarnings = 0;
      let totalBaseFare = 0;
      let totalDistanceFare = 0;
      let totalTimeFare = 0;
      let totalPlatformFee = 0;
      let tripCount = 0;
      const tripBreakdowns = [];
      
      tripsSnapshot.forEach((doc) => {
        const trip = doc.data();
        const fare = trip.fare || {};
        
        totalEarnings += fare.total || 0;
        totalBaseFare += fare.base || 0;
        totalDistanceFare += fare.distance || 0;
        totalTimeFare += fare.time || 0;
        totalPlatformFee += fare.platformFee || 0;
        tripCount += 1;
        
        tripBreakdowns.push({
          bookingId: doc.id,
          totalEarnings: fare.total || 0,
          baseFare: fare.base || 0,
          distanceFare: fare.distance || 0,
          timeFare: fare.time || 0,
          completedAt: trip.completedAt?.toDate?.()?.toISOString() || null
        });
      });
      
      const periodBreakdown = {
        period: period,
        dateRange: {
          start: startDate.toISOString(),
          end: endDate.toISOString()
        },
        summary: {
          totalEarnings: totalEarnings,
          totalBaseFare: totalBaseFare,
          totalDistanceFare: totalDistanceFare,
          totalTimeFare: totalTimeFare,
          totalPlatformFee: totalPlatformFee,
          tripCount: tripCount,
          averageEarningsPerTrip: tripCount > 0 ? Math.round(totalEarnings / tripCount) : 0
        },
        tripBreakdowns: tripBreakdowns
      };
      
      res.status(200).json({
        success: true,
        message: 'Period earnings breakdown retrieved successfully',
        data: periodBreakdown,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('❌ [EARNINGS_BREAKDOWN] Error getting earnings breakdown:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EARNINGS_BREAKDOWN_ERROR',
        message: 'Failed to retrieve earnings breakdown',
        details: 'An error occurred while retrieving earnings breakdown'
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
 * @route   GET /api/driver/trips/:id/summary
 * @desc    Get trip summary
 * @access  Private (Driver only)
 */
router.get('/trips/:id/summary', requireDriver, async (req, res) => {
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
          code: 'TRIP_NOT_FOUND',
          message: 'Trip not found',
          details: 'Trip with this ID does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const bookingData = bookingDoc.data();
    
    // Check if driver is assigned to this trip
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only view trips assigned to you'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Trip summary retrieved successfully',
      data: {
        trip: {
          id: bookingData.id,
          customerId: bookingData.customerId,
          pickupLocation: bookingData.pickupLocation,
          dropoffLocation: bookingData.dropoffLocation,
          status: bookingData.status,
          fare: bookingData.fare,
          distance: bookingData.distance,
          duration: bookingData.duration,
          createdAt: bookingData.createdAt,
          completedAt: bookingData.completedAt
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting trip summary:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TRIP_SUMMARY_ERROR',
        message: 'Failed to retrieve trip summary',
        details: 'An error occurred while retrieving trip summary'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/trips/:id/rating
 * @desc    Submit trip rating
 * @access  Private (Driver only)
 */
router.post('/trips/:id/rating', [
  requireDriver,
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('comment')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Comment must be less than 500 characters')
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
    const { rating, comment } = req.body;
    const db = getFirestore();
    
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRIP_NOT_FOUND',
          message: 'Trip not found',
          details: 'Trip with this ID does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const bookingData = bookingDoc.data();
    
    // Check if driver is assigned to this trip
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only rate trips assigned to you'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Update booking with driver rating
    await bookingRef.update({
      'driverRating.rating': rating,
      'driverRating.comment': comment || '',
      'driverRating.ratedAt': new Date(),
      updatedAt: new Date()
    });
    
    res.status(200).json({
      success: true,
      message: 'Rating submitted successfully',
      data: {
        rating: {
          rating,
          comment: comment || '',
          ratedAt: new Date()
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error submitting rating:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'RATING_SUBMISSION_ERROR',
        message: 'Failed to submit rating',
        details: 'An error occurred while submitting rating'
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
  body('currentLocation')
    .optional()
    .custom((value) => {
      if (value === null || value === undefined) return true;
      if (typeof value === 'object' && value !== null) return true;
      throw new Error('currentLocation must be an object or null');
    })
    .withMessage('currentLocation must be an object or null'),
  body('currentLocation.latitude')
    .optional()
    .custom((value) => {
      if (value === null || value === undefined) return true;
      if (typeof value === 'number' && value >= -90 && value <= 90) return true;
      throw new Error('Latitude must be between -90 and 90 or null');
    })
    .withMessage('Latitude must be between -90 and 90 or null'),
  body('currentLocation.longitude')
    .optional()
    .custom((value) => {
      if (value === null || value === undefined) return true;
      if (typeof value === 'number' && value >= -180 && value <= 180) return true;
      throw new Error('Longitude must be between -180 and 180 or null');
    })
    .withMessage('Longitude must be between -180 and 180 or null'),
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
    const { isOnline, isAvailable, currentLocation, workingHours, workingDays } = req.body;
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

    if (currentLocation) {
      updateData['driver.currentLocation'] = {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        timestamp: currentLocation.timestamp || new Date().toISOString()
      };
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
    const locationData = {
      driverId: uid,
      isOnline,
      isAvailable: isAvailable !== undefined ? isAvailable : userDoc.data().driver?.isAvailable || false,
      lastUpdated: new Date()
    };

    if (currentLocation) {
      locationData.currentLocation = {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        timestamp: currentLocation.timestamp || new Date().toISOString()
      };
    }

    await locationRef.set(locationData, { merge: true });

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
        
        // Check if pickup location is within Tirupattur service area
        const tirupatturCenter = {
          latitude: 12.4950,
          longitude: 78.5678
        };
        
        const pickupDistanceFromTirupattur = calculateDistance(
          bookingData.pickup.coordinates.latitude,
          bookingData.pickup.coordinates.longitude,
          tirupatturCenter.latitude,
          tirupatturCenter.longitude
        );

        // Check if within Tirupattur service area (27 km max) and driver radius
        const isWithinTirupatturArea = pickupDistanceFromTirupattur <= 27;
        const isWithinDriverRadius = distance <= parseFloat(radius);
        const isTestingMode = process.env.NODE_ENV === 'development' || 
                             process.env.TESTING_MODE === 'true' || 
                             process.env.BYPASS_RADIUS_CHECK === 'true';
        
        if ((isWithinTirupatturArea && isWithinDriverRadius) || isTestingMode) {
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
 * @route   POST /api/driver/register-availability
 * @desc    Register driver as available with location
 * @access  Private (Driver only)
 */
router.post('/register-availability', [
  requireDriver,
  body('location.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('location.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  body('location.address')
    .optional()
    .isLength({ min: 5, max: 200 })
    .withMessage('Address must be between 5 and 200 characters'),
  body('vehicleType')
    .optional()
    .isIn(['2_wheeler', '4_wheeler'])
    .withMessage('Vehicle type must be 2_wheeler or 4_wheeler')
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
    const { location, vehicleType = '2_wheeler' } = req.body;
    const db = getFirestore();

    // Update driver availability and location
    const driverRef = db.collection('users').doc(uid);
    const driverDoc = await driverRef.get();
    
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

    const updateData = {
      'driver.isOnline': true,
      'driver.isAvailable': true,
      'driver.currentLocation': {
        latitude: location.latitude,
        longitude: location.longitude,
        address: location.address || 'Current Location',
        timestamp: new Date()
      },
      'driver.lastSeen': new Date(),
      'driver.vehicleType': vehicleType,
      updatedAt: new Date()
    };

    await driverRef.update(updateData);

    // Also update driverLocations collection for real-time tracking
    await db.collection('driverLocations').doc(uid).set({
      driverId: uid,
      currentLocation: {
        latitude: location.latitude,
        longitude: location.longitude,
        address: location.address || 'Current Location',
        timestamp: new Date()
      },
      isOnline: true,
      isAvailable: true,
      lastUpdated: new Date()
    }, { merge: true });

    res.status(200).json({
      success: true,
      message: 'Driver availability registered successfully',
      data: {
        driverId: uid,
        isOnline: true,
        isAvailable: true,
        location: updateData['driver.currentLocation'],
        vehicleType: vehicleType,
        registeredAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error registering driver availability:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'AVAILABILITY_REGISTRATION_ERROR',
        message: 'Failed to register driver availability',
        details: 'An error occurred while registering driver availability'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/update-location
 * @desc    Update driver's current location
 * @access  Private (Driver only)
 */
router.post('/update-location', [
  requireDriver,
  body('location.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('location.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be between -180 and 180'),
  body('location.address')
    .optional()
    .isLength({ min: 5, max: 200 })
    .withMessage('Address must be between 5 and 200 characters')
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
    const { location } = req.body;
    const db = getFirestore();

    const locationData = {
      latitude: location.latitude,
      longitude: location.longitude,
      address: location.address || 'Current Location',
      timestamp: new Date()
    };

    // Update driver's location in users collection
    await db.collection('users').doc(uid).update({
      'driver.currentLocation': locationData,
      'driver.lastSeen': new Date(),
      updatedAt: new Date()
    });

    // Update driverLocations collection for real-time tracking
    await db.collection('driverLocations').doc(uid).set({
      driverId: uid,
      currentLocation: locationData,
      lastUpdated: new Date()
    }, { merge: true });

    res.status(200).json({
      success: true,
      message: 'Driver location updated successfully',
      data: {
        driverId: uid,
        location: locationData,
        updatedAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating driver location:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOCATION_UPDATE_ERROR',
        message: 'Failed to update driver location',
        details: 'An error occurred while updating driver location'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/set-availability
 * @desc    Set driver availability status
 * @access  Private (Driver only)
 */
router.post('/set-availability', [
  requireDriver,
  body('isAvailable')
    .isBoolean()
    .withMessage('isAvailable must be a boolean'),
  body('reason')
    .optional()
    .isLength({ min: 5, max: 100 })
    .withMessage('Reason must be between 5 and 100 characters')
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
    const { isAvailable, reason } = req.body;
    const db = getFirestore();

    const updateData = {
      'driver.isAvailable': isAvailable,
      'driver.lastSeen': new Date(),
      updatedAt: new Date()
    };

    if (reason) {
      updateData['driver.availabilityReason'] = reason;
    }

    // Update driver availability
    await db.collection('users').doc(uid).update(updateData);

    // Update driverLocations collection
    await db.collection('driverLocations').doc(uid).update({
      isAvailable: isAvailable,
      lastUpdated: new Date()
    });

    res.status(200).json({
      success: true,
      message: `Driver availability set to ${isAvailable ? 'available' : 'unavailable'}`,
      data: {
        driverId: uid,
        isAvailable: isAvailable,
        reason: reason || null,
        updatedAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error setting driver availability:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'AVAILABILITY_UPDATE_ERROR',
        message: 'Failed to update driver availability',
        details: 'An error occurred while updating driver availability'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/bookings/test-simple
 * @desc    SIMPLE TEST - Return hardcoded booking for testing
 * @access  Private (Driver only) - FOR TESTING ONLY
 */
router.get('/bookings/test-simple', requireDriver, async (req, res) => {
  try {
    console.log('🧪 [SIMPLE_TEST] Simple test endpoint accessed');
    
    const testBooking = {
      id: 'test-booking-123',
      customerId: 'test-customer-456',
      driverId: null,
      status: 'pending',
      pickup: {
        name: 'Test Customer',
        phone: '+919876543210',
        address: 'Test Pickup Address, Bangalore',
        coordinates: {
          latitude: 13.0681637,
          longitude: 77.5021978
        },
        instructions: 'Test pickup instructions'
      },
      dropoff: {
        name: 'Test Recipient',
        phone: '+919876543211',
        address: 'Test Dropoff Address, Bangalore',
        coordinates: {
          latitude: 13.0827,
          longitude: 80.2707
        },
        instructions: 'Test dropoff instructions'
      },
      package: {
        weight: 5.0,
        weightUnit: 'kg',
        description: 'Test package for debugging',
        dimensions: null,
        isFragile: false,
        requiresSpecialHandling: false
      },
      vehicle: {
        type: '2_wheeler',
        required: false
      },
      fare: {
        base: 50,
        distance: 20,
        time: 0,
        total: 70,
        currency: 'INR'
      },
      paymentMethod: 'cash',
      paymentStatus: 'pending',
      timing: {
        createdAt: new Date(),
        estimatedPickupTime: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        estimatedDeliveryTime: new Date(Date.now() + 45 * 60 * 1000).toISOString()
      },
      distance: {
        total: 5.2,
        unit: 'km'
      },
      rating: {
        customerRating: null,
        customerFeedback: null,
        driverRating: null,
        driverFeedback: null
      },
      cancellation: {
        cancelledBy: null,
        reason: null,
        cancelledAt: null,
        refundAmount: null
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      distanceFromDriver: 0.5,
      estimatedPickupTime: new Date(Date.now() + 15 * 60 * 1000).toISOString()
    };

    console.log('✅ [SIMPLE_TEST] Returning test booking');

    res.status(200).json({
      success: true,
      message: 'SIMPLE TEST - Hardcoded booking for testing',
      data: [testBooking], // Return as array
      timestamp: new Date().toISOString(),
      debug: {
        testMode: true,
        hardcodedBooking: true
      }
    });

  } catch (error) {
    console.error('❌ [SIMPLE_TEST] Error:', error);
    res.status(500).json({
      success: false,
      error: 'SIMPLE TEST - Failed to return test booking',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/bookings/test-backdoor
 * @desc    TESTING BACKDOOR - Get all bookings without any restrictions
 * @access  Private (Driver only) - FOR TESTING ONLY
 */
router.get('/bookings/test-backdoor', requireDriver, async (req, res) => {
  try {
    console.log('🚪 [TEST_BACKDOOR] Testing backdoor accessed - bypassing all restrictions');
    
    const db = getFirestore();
    
    // Get ALL pending bookings without any filtering
    const query = db.collection('bookings')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(20);
    
    const snapshot = await query.get();
    const allBookings = [];
    
    console.log('🔍 [TEST_BACKDOOR] Found bookings in database:', snapshot.size);
    
    // If no bookings exist, create a test booking
    if (snapshot.empty) {
      console.log('📝 [TEST_BACKDOOR] No bookings found, creating test booking...');
      
      const testBooking = {
        customerId: 'test-customer-123',
        driverId: null,
        status: 'pending',
        pickup: {
          name: 'Anjuu',
          phone: '+919876543210',
          address: 'Adiyur Lake, Tirupathur, Tamil Nadu',
          coordinates: {
            latitude: 12.4950,
            longitude: 78.5678
          },
          instructions: 'Call when you arrive'
        },
        dropoff: {
          name: 'Test Recipient',
          phone: '+919876543211',
          address: '456 Park Avenue, Tirupathur, Tamil Nadu',
          coordinates: {
            latitude: 12.5000,
            longitude: 78.5700
          },
          instructions: 'Leave at reception'
        },
        package: {
          weight: 11.5,
          weightUnit: 'kg',
          description: 'Package delivery',
          dimensions: null,
          isFragile: false,
          requiresSpecialHandling: false
        },
        vehicle: {
          type: '2_wheeler',
          required: false
        },
        fare: {
          base: 50,
          distance: 25,
          time: 15,
          total: 90,
          currency: 'INR'
        },
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        timing: {
          createdAt: new Date(),
          estimatedPickupTime: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          estimatedDeliveryTime: new Date(Date.now() + 45 * 60 * 1000).toISOString()
        },
        distance: {
          total: 2.5,
          unit: 'km'
        },
        rating: {
          customerRating: null,
          customerFeedback: null,
          driverRating: null,
          driverFeedback: null
        },
        cancellation: {
          cancelledBy: null,
          reason: null,
          cancelledAt: null,
          refundAmount: null
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        distanceFromDriver: 0.5,
        estimatedPickupTime: new Date(Date.now() + 15 * 60 * 1000).toISOString()
      };

      try {
        const docRef = await db.collection('bookings').add(testBooking);
        console.log('✅ [TEST_BACKDOOR] Test booking created with ID:', docRef.id);
        
        allBookings.push({
          id: docRef.id,
          ...testBooking
        });
      } catch (error) {
        console.error('❌ [TEST_BACKDOOR] Error creating test booking:', error);
      }
    } else {
      snapshot.forEach(doc => {
        const bookingData = doc.data();
        allBookings.push({
          id: doc.id,
          ...bookingData,
          distanceFromDriver: 0, // Set to 0 for testing
          estimatedPickupTime: bookingData.estimatedPickupTime || new Date(Date.now() + 15 * 60 * 1000).toISOString()
        });
      });
    }

    console.log('✅ [TEST_BACKDOOR] Returning bookings:', allBookings.length);

    res.status(200).json({
      success: true,
      message: 'TEST BACKDOOR - All bookings retrieved without restrictions',
      data: allBookings, // Return bookings directly as array
      timestamp: new Date().toISOString(),
      debug: {
        totalBookings: allBookings.length,
        bypassedFilters: ['distance', 'availability', 'online_status'],
        testingMode: true
      }
    });

  } catch (error) {
    console.error('❌ [TEST_BACKDOOR] Error:', error);
    res.status(500).json({
      success: false,
      error: 'TEST BACKDOOR - Failed to retrieve bookings',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/bookings/available
 * @desc    Get available bookings for driver
 * @access  Private (Driver only)
 */
router.get('/bookings/available', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 10, offset = 0, radius = 25 } = req.query;
    const db = getFirestore();
    
    // Get driver's current location and availability status
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
          details: 'Driver location is not available. Please update your location first.'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if driver is available
    console.log('🔍 [DRIVER_API] Driver availability status:', {
      isAvailable: driverData.driver?.isAvailable,
      isOnline: driverData.driver?.isOnline,
      hasDriverData: !!driverData.driver
    });
    
    if (!driverData.driver?.isAvailable || !driverData.driver?.isOnline) {
      console.log('❌ [DRIVER_API] Driver not available for bookings');
      return res.status(400).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_AVAILABLE',
          message: 'Driver not available',
          details: 'Driver must be online and available to see bookings'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    console.log('✅ [DRIVER_API] Driver is available and online');

    // Get available bookings (pending status, not assigned to any driver)
    const query = db.collection('bookings')
      .where('status', '==', 'pending')
      .where('driverId', '==', null)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit) + parseInt(offset));
    
    const snapshot = await query.get();
    const allBookings = [];
    
    console.log('🔍 [DRIVER_API] Query snapshot:', {
      size: snapshot.size,
      empty: snapshot.empty,
      driverLocation,
      radius: parseFloat(radius)
    });
    
    snapshot.forEach(doc => {
      const bookingData = doc.data();
      console.log('🔍 [DRIVER_API] Processing booking:', {
        id: doc.id,
        status: bookingData.status,
        hasPickup: !!bookingData.pickup,
        hasCoordinates: !!bookingData.pickup?.coordinates,
        pickupCoords: bookingData.pickup?.coordinates
      });
      
      // Calculate distance from driver to pickup location
      if (bookingData.pickup?.coordinates) {
        const distance = calculateDistance(
          driverLocation.latitude,
          driverLocation.longitude,
          bookingData.pickup.coordinates.latitude,
          bookingData.pickup.coordinates.longitude
        );
        
        console.log('🔍 [DRIVER_API] Distance calculation:', {
          driverLat: driverLocation.latitude,
          driverLng: driverLocation.longitude,
          pickupLat: bookingData.pickup.coordinates.latitude,
          pickupLng: bookingData.pickup.coordinates.longitude,
          distanceKm: distance,
          radiusKm: parseFloat(radius),
          isWithinRadius: distance <= parseFloat(radius)
        });
        
        // Check if pickup location is within Tirupattur service area
        const tirupatturCenter = {
          latitude: 12.4950,
          longitude: 78.5678
        };
        
        const pickupDistanceFromTirupattur = calculateDistance(
          bookingData.pickup.coordinates.latitude,
          bookingData.pickup.coordinates.longitude,
          tirupatturCenter.latitude,
          tirupatturCenter.longitude
        );

        // Check if within Tirupattur service area (27 km max) and driver radius
        const isWithinTirupatturArea = pickupDistanceFromTirupattur <= 27;
        const isWithinDriverRadius = distance <= parseFloat(radius);
        const isTestingMode = process.env.NODE_ENV === 'development' || 
                             process.env.TESTING_MODE === 'true' || 
                             process.env.BYPASS_RADIUS_CHECK === 'true';
        const isDeveloperMode = process.env.DEVELOPER_MODE === 'true';
        
        console.log('🔍 [DRIVER_API] Service area check:', {
          pickupDistanceFromTirupattur,
          isWithinTirupatturArea,
          driverDistance: distance,
          isWithinDriverRadius,
          NODE_ENV: process.env.NODE_ENV,
          DEVELOPER_MODE: process.env.DEVELOPER_MODE,
          TESTING_MODE: process.env.TESTING_MODE,
          BYPASS_RADIUS_CHECK: process.env.BYPASS_RADIUS_CHECK
        });
        
        console.log('🔍 [DRIVER_API] Filtering decision:', {
          isWithinTirupatturArea,
          isWithinDriverRadius,
          isTestingMode: isTestingMode || isDeveloperMode,
          willInclude: (isWithinTirupatturArea && isWithinDriverRadius) || isTestingMode || isDeveloperMode
        });
        
        if ((isWithinTirupatturArea && isWithinDriverRadius) || isTestingMode || isDeveloperMode) {
          allBookings.push({
            id: doc.id,
            ...bookingData,
            distanceFromDriver: Math.round(distance / 1000 * 100) / 100, // Convert to km with 2 decimal places
            estimatedPickupTime: bookingData.estimatedPickupTime || new Date(Date.now() + 15 * 60 * 1000).toISOString()
          });
        }
      } else {
        console.log('⚠️ [DRIVER_API] Booking has no pickup coordinates:', doc.id);
      }
    });

    // Sort by distance (closest first)
    allBookings.sort((a, b) => a.distanceFromDriver - b.distanceFromDriver);

    // Apply pagination
    const bookings = allBookings.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    console.log('🔍 [DRIVER_API] Final response:', {
      allBookingsCount: allBookings.length,
      paginatedBookingsCount: bookings.length,
      offset: parseInt(offset),
      limit: parseInt(limit),
      firstBooking: bookings[0] || null
    });

    const responseData = {
      success: true,
      message: 'Available bookings retrieved successfully',
      data: {
        bookings,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: allBookings.length,
          hasMore: (parseInt(offset) + parseInt(limit)) < allBookings.length
        },
        driverLocation: {
          latitude: driverLocation.latitude,
          longitude: driverLocation.longitude,
          address: driverLocation.address || 'Current Location',
          timestamp: driverLocation.timestamp || new Date().toISOString()
        },
        searchRadius: parseFloat(radius),
        // Debug info
        debug: {
          allBookingsProcessed: allBookings.length,
          bookingsAfterPagination: bookings.length,
          testingMode: process.env.NODE_ENV === 'development' || 
                      process.env.TESTING_MODE === 'true' || 
                      process.env.BYPASS_RADIUS_CHECK === 'true',
          timestamp: new Date().toISOString()
        }
      },
      timestamp: new Date().toISOString()
    };

    console.log('🔍 [DRIVER_API] Sending response with bookings:', {
      hasBookings: !!responseData.data.bookings,
      bookingsLength: responseData.data.bookings?.length || 0,
      bookingsType: typeof responseData.data.bookings,
      firstBookingId: responseData.data.bookings?.[0]?.id || null
    });

    res.status(200).json(responseData);

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

    // Accept booking using Firestore transaction for conflict resolution
    const transaction = db.runTransaction(async (transaction) => {
      // Re-read booking to ensure it's still available
      const freshBookingDoc = await transaction.get(bookingRef);
      if (!freshBookingDoc.exists) {
        throw new Error('BOOKING_NOT_FOUND');
      }

      const freshBookingData = freshBookingDoc.data();
      
      // Check if booking is still available (not assigned to another driver)
      if (freshBookingData.status !== 'pending' || freshBookingData.driverId !== null) {
        throw new Error('BOOKING_ALREADY_ASSIGNED');
      }

      // Check if driver is still available
      const freshDriverDoc = await transaction.get(db.collection('users').doc(uid));
      if (!freshDriverDoc.exists) {
        throw new Error('DRIVER_NOT_FOUND');
      }

      const freshDriverData = freshDriverDoc.data();
      if (!freshDriverData.driver?.isAvailable || !freshDriverData.driver?.isOnline) {
        throw new Error('DRIVER_NOT_AVAILABLE');
      }

      // Check if driver is verified (both documents and vehicle data)
      // This check is done inside the transaction to prevent race conditions
      const userVerificationStatus = freshDriverData.driver?.verificationStatus || freshDriverData.verificationStatus;
      const userIsVerified = freshDriverData.driver?.isVerified || freshDriverData.isVerified;
      
      if (!userIsVerified && userVerificationStatus !== 'approved' && userVerificationStatus !== 'verified') {
        throw new Error('DRIVER_NOT_VERIFIED');
      }

      // Check if driver is already assigned to another booking
      const activeBookingsQuery = db.collection('bookings')
        .where('driverId', '==', uid)
        .where('status', 'in', ['driver_assigned', 'driver_enroute', 'picked_up', 'in_transit']);
      
      const activeBookingsSnapshot = await transaction.get(activeBookingsQuery);
      if (!activeBookingsSnapshot.empty) {
        throw new Error('DRIVER_ALREADY_ASSIGNED');
      }

      // Update booking
      transaction.update(bookingRef, {
        driverId: uid,
        status: 'driver_assigned',
        'timing.driverAssignedAt': new Date(),
        updatedAt: new Date()
      });

      // Update driver availability
      transaction.update(db.collection('users').doc(uid), {
        'driver.isAvailable': false,
        'driver.currentBookingId': id,
        updatedAt: new Date()
      });

      // Update driver location to show current trip
      transaction.set(db.collection('driverLocations').doc(uid), {
        driverId: uid,
        currentTripId: id,
        lastUpdated: new Date()
      }, { merge: true });

      return { success: true };
    });

    await transaction;

    // Get booking data for notifications (re-read to get updated data)
    const updatedBookingDoc = await db.collection('bookings').doc(id).get();
    const updatedBookingData = updatedBookingDoc.data();

    // Send WebSocket notifications
    try {
      const WebSocketEventHandler = require('../services/websocketEventHandler');
      const wsEventHandler = new WebSocketEventHandler();
      await wsEventHandler.initialize();

      // Notify customer of driver assignment
      await wsEventHandler.notifyCustomerOfDriverAssignment(
        updatedBookingData.customerId,
        {
          bookingId: id,
          driverId: uid,
          driverName: driverData.name,
          driverPhone: driverData.phone,
          vehicleInfo: driverData.driver?.vehicleInfo || 'Vehicle Info',
          estimatedArrival: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        }
      );

      // Notify booking status update
      await wsEventHandler.notifyBookingStatusUpdate(id, 'driver_assigned', {
        driverId: uid,
        driverName: driverData.name,
        assignedAt: new Date().toISOString()
      });

    } catch (wsError) {
      console.error('Error sending WebSocket notifications:', wsError);
      // Don't fail the request if WebSocket fails
    }

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
    
    // Handle specific transaction errors
    if (error.message === 'DRIVER_NOT_VERIFIED') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_VERIFIED',
          message: 'Driver not verified',
          details: 'Driver must be verified (documents and vehicle details approved) before accepting bookings'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    if (error.message === 'BOOKING_ALREADY_ASSIGNED') {
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
    
    if (error.message === 'DRIVER_ALREADY_ASSIGNED') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'DRIVER_ALREADY_ASSIGNED',
          message: 'Driver already assigned',
          details: 'You are already assigned to another active booking'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    if (error.message === 'DRIVER_NOT_AVAILABLE') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_AVAILABLE',
          message: 'Driver not available',
          details: 'Driver is no longer available to accept bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

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
    .isIn(['pending', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'enroute_dropoff', 'arrived_dropoff', 'delivered', 'cancelled'])
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

    // Validate radius for pickup and dropoff confirmations
    if (location && (status === 'picked_up' || status === 'delivered')) {
      const targetLocation = status === 'picked_up' ? bookingData.pickup?.coordinates : bookingData.dropoff?.coordinates;
      
      if (targetLocation) {
        const distance = calculateDistance(
          location.latitude,
          location.longitude,
          targetLocation.latitude,
          targetLocation.longitude
        );
        
        // Check if within 100 meters (0.1 km)
        if (distance > 0.1) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'OUTSIDE_RADIUS',
              message: 'Outside confirmation radius',
              details: `You must be within 100m of the ${status === 'picked_up' ? 'pickup' : 'dropoff'} location to confirm. You are currently ${(distance * 1000).toFixed(0)}m away.`
            },
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    // Update booking status
    const updateData = {
      status,
      updatedAt: new Date()
    };

    // Add timing information based on status
    switch (status) {
      case 'accepted':
        updateData['timing.acceptedAt'] = new Date();
        break;
      case 'driver_enroute':
        updateData['timing.driverEnrouteAt'] = new Date();
        break;
      case 'driver_arrived':
        updateData['timing.driverArrivedAt'] = new Date();
        break;
      case 'picked_up':
        updateData['timing.pickedUpAt'] = new Date();
        break;
      case 'enroute_dropoff':
        updateData['timing.enrouteDropoffAt'] = new Date();
        break;
      case 'arrived_dropoff':
        updateData['timing.arrivedDropoffAt'] = new Date();
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
 * @route   POST /api/driver/confirm-pickup
 * @desc    Confirm pickup completion with photo verification
 * @access  Private (Driver only)
 */
router.post('/confirm-pickup', [
  requireDriver,
  body('bookingId')
    .isString()
    .notEmpty()
    .withMessage('Booking ID is required'),
  body('location')
    .isObject()
    .withMessage('Location is required'),
  body('location.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Valid latitude is required'),
  body('location.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Valid longitude is required'),
  body('photoUrl')
    .optional()
    .isString()
    .withMessage('Photo URL must be a string'),
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
    const { bookingId, location, photoUrl, notes } = req.body;
    const db = getFirestore();
    
    console.log('📦 [CONFIRM_PICKUP] Confirming pickup for booking:', bookingId, 'driver:', uid);
    
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
    
    // Check if driver is assigned to this booking
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only confirm pickup for bookings assigned to you'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Validate radius for pickup confirmation
    const pickupLocation = bookingData.pickup?.coordinates;
    if (pickupLocation) {
      const distance = calculateDistance(
        location.latitude,
        location.longitude,
        pickupLocation.latitude,
        pickupLocation.longitude
      );
      
      // Check if within 100 meters (0.1 km)
      if (distance > 0.1) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'OUTSIDE_RADIUS',
            message: 'Outside pickup radius',
            details: `You must be within 100m of the pickup location to confirm. You are currently ${(distance * 1000).toFixed(0)}m away.`
          },
          timestamp: new Date().toISOString()
        });
      }
    }

    // Update booking status to picked_up
    const updateData = {
      status: 'picked_up',
      'timing.pickedUpAt': new Date(),
      'driver.currentLocation': {
        ...location,
        timestamp: new Date()
      },
      updatedAt: new Date()
    };

    // Add photo verification if provided
    if (photoUrl) {
      updateData['pickupVerification'] = {
        photoUrl: photoUrl,
        verifiedAt: new Date(),
        verifiedBy: uid,
        location: location
      };
    }

    // Add notes if provided
    if (notes) {
      updateData['driver.pickupNotes'] = notes;
    }

    await bookingRef.update(updateData);

    // Create pickup verification record
    const verificationRef = db.collection('pickupVerifications').doc();
    await verificationRef.set({
      id: verificationRef.id,
      bookingId: bookingId,
      driverId: uid,
      customerId: bookingData.customerId,
      location: location,
      photoUrl: photoUrl || null,
      notes: notes || null,
      verifiedAt: new Date(),
      status: 'verified'
    });

    // Update trip tracking
    const tripTrackingRef = db.collection('tripTracking').doc(bookingId);
    await tripTrackingRef.set({
      tripId: bookingId,
      bookingId: bookingId,
      driverId: uid,
      customerId: bookingData.customerId,
      currentStatus: 'picked_up',
      pickupConfirmedAt: new Date(),
      lastUpdated: new Date()
    }, { merge: true });

    console.log('✅ [CONFIRM_PICKUP] Pickup confirmed successfully for booking:', bookingId);

    res.status(200).json({
      success: true,
      message: 'Pickup confirmed successfully',
      data: {
        bookingId: bookingId,
        status: 'picked_up',
        location: location,
        photoUrl: photoUrl,
        notes: notes,
        verifiedAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [CONFIRM_PICKUP] Error confirming pickup:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PICKUP_CONFIRMATION_ERROR',
        message: 'Failed to confirm pickup',
        details: 'An error occurred while confirming pickup'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/complete-delivery
 * @desc    Complete delivery process with final confirmation
 * @access  Private (Driver only)
 */
router.post('/complete-delivery', [
  requireDriver,
  body('bookingId')
    .isString()
    .notEmpty()
    .withMessage('Booking ID is required'),
  body('location')
    .isObject()
    .withMessage('Location is required'),
  body('location.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Valid latitude is required'),
  body('location.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Valid longitude is required'),
  body('photoUrl')
    .optional()
    .isString()
    .withMessage('Photo URL must be a string'),
  body('notes')
    .optional()
    .isLength({ min: 5, max: 200 })
    .withMessage('Notes must be between 5 and 200 characters'),
  body('recipientName')
    .optional()
    .isString()
    .withMessage('Recipient name must be a string'),
  body('recipientPhone')
    .optional()
    .isString()
    .withMessage('Recipient phone must be a string')
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
    const { bookingId, location, photoUrl, notes, recipientName, recipientPhone } = req.body;
    const db = getFirestore();
    
    console.log('📦 [COMPLETE_DELIVERY] Completing delivery for booking:', bookingId, 'driver:', uid);
    
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
    
    // Check if driver is assigned to this booking
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only complete delivery for bookings assigned to you'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Validate radius for delivery confirmation
    const dropoffLocation = bookingData.dropoff?.coordinates;
    if (dropoffLocation) {
      const distance = calculateDistance(
        location.latitude,
        location.longitude,
        dropoffLocation.latitude,
        dropoffLocation.longitude
      );
      
      // Check if within 100 meters (0.1 km)
      if (distance > 0.1) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'OUTSIDE_RADIUS',
            message: 'Outside delivery radius',
            details: `You must be within 100m of the dropoff location to complete delivery. You are currently ${(distance * 1000).toFixed(0)}m away.`
          },
          timestamp: new Date().toISOString()
        });
      }
    }

    // Calculate final trip metrics
    const startTime = bookingData.timing?.pickedUpAt?.toDate?.() || new Date();
    const endTime = new Date();
    const duration = Math.round((endTime - startTime) / 1000 / 60); // minutes

    // Update booking status to delivered
    const updateData = {
      status: 'delivered',
      'timing.deliveredAt': new Date(),
      'timing.actualDeliveryTime': endTime.toISOString(),
      'timing.actualDuration': duration,
      'driver.currentLocation': {
        ...location,
        timestamp: new Date()
      },
      updatedAt: new Date()
    };

    // Add delivery verification if provided
    if (photoUrl) {
      updateData['deliveryVerification'] = {
        photoUrl: photoUrl,
        verifiedAt: new Date(),
        verifiedBy: uid,
        location: location
      };
    }

    // Add recipient information
    if (recipientName || recipientPhone) {
      updateData['recipient'] = {
        name: recipientName || bookingData.recipient?.name || 'Unknown',
        phone: recipientPhone || bookingData.recipient?.phone || null,
        confirmedAt: new Date(),
        confirmedBy: uid
      };
    }

    // Add notes if provided
    if (notes) {
      updateData['driver.deliveryNotes'] = notes;
    }

    await bookingRef.update(updateData);

    // Create delivery verification record
    const verificationRef = db.collection('deliveryVerifications').doc();
    await verificationRef.set({
      id: verificationRef.id,
      bookingId: bookingId,
      driverId: uid,
      customerId: bookingData.customerId,
      location: location,
      photoUrl: photoUrl || null,
      notes: notes || null,
      recipientName: recipientName || null,
      recipientPhone: recipientPhone || null,
      deliveredAt: new Date(),
      status: 'verified'
    });

    // Update trip tracking
    const tripTrackingRef = db.collection('tripTracking').doc(bookingId);
    await tripTrackingRef.set({
      tripId: bookingId,
      bookingId: bookingId,
      driverId: uid,
      customerId: bookingData.customerId,
      currentStatus: 'delivered',
      deliveredAt: new Date(),
      actualDuration: duration,
      lastUpdated: new Date()
    }, { merge: true });

    // Calculate and update driver earnings
    const fare = bookingData.fare || {};
    const driverEarnings = fare.driverEarnings || fare.total || 0;
    
    // Update driver's total earnings
    const driverRef = db.collection('users').doc(uid);
    await driverRef.update({
      'driver.earnings.total': admin.firestore.FieldValue.increment(driverEarnings),
      'driver.earnings.thisMonth': admin.firestore.FieldValue.increment(driverEarnings),
      'driver.earnings.thisWeek': admin.firestore.FieldValue.increment(driverEarnings),
      'driver.tripsCompleted': admin.firestore.FieldValue.increment(1),
      updatedAt: new Date()
    });

    console.log('✅ [COMPLETE_DELIVERY] Delivery completed successfully for booking:', bookingId);

    res.status(200).json({
      success: true,
      message: 'Delivery completed successfully',
      data: {
        bookingId: bookingId,
        status: 'delivered',
        location: location,
        photoUrl: photoUrl,
        notes: notes,
        recipientName: recipientName,
        recipientPhone: recipientPhone,
        deliveredAt: new Date().toISOString(),
        duration: duration,
        earnings: driverEarnings
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [COMPLETE_DELIVERY] Error completing delivery:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELIVERY_COMPLETION_ERROR',
        message: 'Failed to complete delivery',
        details: 'An error occurred while completing delivery'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/bookings/:id/validate-radius
 * @desc    Validate if driver is within service radius for a booking
 * @access  Private (Driver only)
 */
router.post('/bookings/:id/validate-radius', [
  requireDriver,
  body('driverLocation')
    .isObject()
    .withMessage('Driver location is required'),
  body('driverLocation.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Valid latitude is required'),
  body('driverLocation.longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Valid longitude is required'),
  body('serviceRadiusKm')
    .optional()
    .isFloat({ min: 1, max: 50 })
    .withMessage('Service radius must be between 1 and 50 km')
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
    const { driverLocation, serviceRadiusKm = 25 } = req.body;
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
    
    // Check if driver is assigned to this booking
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only validate radius for bookings assigned to you'
        },
        timestamp: new Date().toISOString()
      });
    }

    // First check if pickup location is within Tirupattur service area
    const tirupatturCenter = {
      latitude: 12.4950,
      longitude: 78.5678
    };
    
    const pickupDistanceFromTirupattur = calculateDistance(
      bookingData.pickup.coordinates.latitude,
      bookingData.pickup.coordinates.longitude,
      tirupatturCenter.latitude,
      tirupatturCenter.longitude
    );

    // Check if pickup is within Tirupattur service area (27 km max)
    if (pickupDistanceFromTirupattur > 27) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'OUTSIDE_SERVICE_AREA',
          message: 'Pickup location outside service area',
          details: 'This pickup location is outside the Tirupattur service area (27 km radius)'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Calculate distance to pickup location
    const pickupDistance = calculateDistance(
      driverLocation.latitude,
      driverLocation.longitude,
      bookingData.pickup.coordinates.latitude,
      bookingData.pickup.coordinates.longitude
    );

    // Calculate ETA (simplified - in real app, use Google Distance Matrix API)
    const eta = Math.ceil(pickupDistance * 2); // Rough estimate: 2 minutes per km

    const isWithinRadius = pickupDistance <= serviceRadiusKm;

    res.status(200).json({
      success: true,
      data: {
        isWithinRadius,
        distance: pickupDistance,
        distanceFormatted: pickupDistance < 1 
          ? `${Math.round(pickupDistance * 1000)}m` 
          : `${pickupDistance.toFixed(1)}km`,
        eta,
        etaFormatted: `${eta} min`,
        serviceRadiusKm,
        pickupLocation: bookingData.pickup.coordinates,
        driverLocation
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error validating radius:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'RADIUS_VALIDATION_ERROR',
        message: 'Failed to validate radius',
        details: 'An error occurred while validating radius'
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
    const driverData = userData.driver || {};
    const walletData = driverData.wallet || {};
    
    // Debug logging
    console.log('🔍 [WALLET_API] Debug wallet data:', {
      userId: uid,
      hasDriverData: !!driverData,
      driverKeys: Object.keys(driverData),
      hasWalletData: !!walletData,
      walletKeys: Object.keys(walletData),
      walletBalance: walletData.balance,
      welcomeBonusGiven: driverData.welcomeBonusGiven,
      welcomeBonusAmount: driverData.welcomeBonusAmount
    });
    
    // Ensure wallet structure exists
    const walletBalance = walletData.balance || 0;
    const walletCurrency = walletData.currency || 'INR';
    const welcomeBonusGiven = driverData.welcomeBonusGiven || false;
    const welcomeBonusAmount = driverData.welcomeBonusAmount || 0;

    // Get wallet transactions with error handling
    let transactions = [];
    let totalCount = 0;
    
    try {
      const transactionsQuery = db.collection('driverWalletTransactions')
        .where('driverId', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(parseInt(limit))
        .offset(parseInt(offset));

      const transactionsSnapshot = await transactionsQuery.get();

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
      totalCount = totalSnapshot.size;
    } catch (error) {
      console.error('Error getting wallet transactions:', error);
      // If index is not ready, return empty transactions but still return wallet balance
      transactions = [];
      totalCount = 0;
    }

    const responseData = {
      balance: walletBalance,
      currency: walletCurrency,
      welcomeBonusGiven: welcomeBonusGiven,
      welcomeBonusAmount: welcomeBonusAmount,
      lastUpdated: walletData.lastUpdated || new Date(),
      transactions,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: totalCount
      }
    };
    
    console.log('🔍 [WALLET_API] Response data:', responseData);
    
    res.status(200).json({
      success: true,
      message: 'Wallet information retrieved successfully',
      data: responseData,
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
 * @route   POST /api/driver/wallet/process-welcome-bonus-direct
 * @desc    Process welcome bonus directly using verification service data
 * @access  Private (Driver only)
 */
router.post('/wallet/process-welcome-bonus-direct', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    console.log('🎁 [WALLET_API] Processing welcome bonus directly for driver:', uid);
    
    // Get verification data directly from verification service
    const verificationService = require('../services/verificationService');
    let comprehensiveVerificationData;
    
    try {
      comprehensiveVerificationData = await verificationService.getDriverVerificationData(uid);
      console.log('📊 [WALLET_API] Direct verification data:', comprehensiveVerificationData);
    } catch (verificationError) {
      console.error('❌ [WALLET_API] Failed to get verification data:', verificationError);
      return res.status(500).json({
        success: false,
        error: {
          code: 'VERIFICATION_SERVICE_ERROR',
          message: 'Failed to get verification data',
          details: verificationError.message
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Check if driver is verified using comprehensive data
    const isVerified = comprehensiveVerificationData?.verificationStatus === 'verified' || comprehensiveVerificationData?.verificationStatus === 'approved';
    
    if (!isVerified) {
      console.log('❌ [WALLET_API] Driver not verified (direct check):', {
        uid,
        verificationStatus: comprehensiveVerificationData?.verificationStatus,
        isVerified
      });
      return res.status(400).json({
        success: false,
        error: {
          code: 'NOT_VERIFIED',
          message: 'Driver not verified',
          details: 'Welcome bonus can only be given to verified drivers'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Get user data to check if welcome bonus already given
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    const userData = userDoc.data();
    const driverData = userData.driver || {};
    const welcomeBonusGiven = driverData.welcomeBonusGiven || false;
    const currentBalance = driverData.wallet?.balance || 0;
    
    if (welcomeBonusGiven) {
      console.log('✅ [WALLET_API] Welcome bonus already given (direct check):', uid);
      return res.status(200).json({
        success: true,
        message: 'Welcome bonus already given',
        data: {
          welcomeBonusGiven: true,
          welcomeBonusAmount: driverData.welcomeBonusAmount || 0,
          currentBalance: currentBalance
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Give welcome bonus using atomic transaction
    const newBalance = currentBalance + 500;
    const batch = db.batch();
    
    // Update user document
    batch.update(userRef, {
      'driver.welcomeBonusGiven': true,
      'driver.welcomeBonusAmount': 500,
      'driver.welcomeBonusGivenAt': new Date(),
      'driver.wallet.balance': newBalance,
      'driver.wallet.lastUpdated': new Date(),
      'driver.wallet.transactions': [
        ...(driverData.wallet?.transactions || []),
        {
          id: `welcome_bonus_${Date.now()}`,
          type: 'credit',
          amount: 500,
          description: 'Welcome Bonus - Driver Verification',
          timestamp: new Date(),
          status: 'completed',
          reference: 'WELCOME_BONUS'
        }
      ]
    });
    
    await batch.commit();
    
    console.log('✅ [WALLET_API] Welcome bonus processed successfully (direct):', {
      uid,
      previousBalance: currentBalance,
      newBalance,
      bonusAmount: 500
    });
    
    res.status(200).json({
      success: true,
      message: 'Welcome bonus processed successfully',
      data: {
        welcomeBonusGiven: true,
        welcomeBonusAmount: 500,
        previousBalance: currentBalance,
        newBalance: newBalance,
        bonusProcessed: true
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [WALLET_API] Error processing welcome bonus (direct):', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'WELCOME_BONUS_ERROR',
        message: 'Failed to process welcome bonus',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/wallet/ensure-welcome-bonus
 * @desc    Ensure welcome bonus is given to verified drivers
 * @access  Private (Driver only)
 */
router.post('/wallet/ensure-welcome-bonus', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    console.log('🎁 [WALLET_API] Processing welcome bonus for driver:', uid);
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.log('❌ [WALLET_API] User not found:', uid);
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
    const driverData = userData.driver || {};
    
    // CRITICAL FIX: Get verification data from verification service for comprehensive status
    const verificationService = require('../services/verificationService');
    let comprehensiveVerificationData;
    
    try {
      comprehensiveVerificationData = await verificationService.getDriverVerificationData(uid);
      console.log('📊 [WALLET_API] Comprehensive verification data:', comprehensiveVerificationData);
    } catch (verificationError) {
      console.warn('⚠️ [WALLET_API] Failed to get comprehensive verification data, using basic data:', verificationError.message);
    }
    
    // Use comprehensive verification data if available, otherwise fall back to basic data
    const finalVerificationStatus = comprehensiveVerificationData?.verificationStatus || driverData.verificationStatus || 'pending';
    const isVerified = finalVerificationStatus === 'verified' || finalVerificationStatus === 'approved';
    const welcomeBonusGiven = driverData.welcomeBonusGiven || false;
    const currentBalance = driverData.wallet?.balance || 0;
    
    console.log('🔍 [WALLET_API] Driver status check:', {
      uid,
      isVerified,
      verificationStatus: finalVerificationStatus,
      originalVerificationStatus: driverData.verificationStatus,
      welcomeBonusGiven,
      currentBalance
    });
    
    if (!isVerified) {
      console.log('❌ [WALLET_API] Driver not verified:', uid);
      return res.status(400).json({
        success: false,
        error: {
          code: 'NOT_VERIFIED',
          message: 'Driver not verified',
          details: 'Welcome bonus can only be given to verified drivers'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    if (welcomeBonusGiven) {
      console.log('✅ [WALLET_API] Welcome bonus already given:', uid);
      return res.status(200).json({
        success: true,
        message: 'Welcome bonus already given',
        data: {
          welcomeBonusGiven: true,
          welcomeBonusAmount: driverData.welcomeBonusAmount || 0,
          currentBalance: currentBalance
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Give welcome bonus
    const newBalance = currentBalance + 500;
    console.log('💰 [WALLET_API] Processing welcome bonus:', {
      uid,
      previousBalance: currentBalance,
      newBalance,
      bonusAmount: 500
    });
    
    // Use transaction to ensure atomicity
    const batch = db.batch();
    
    // Update wallet with welcome bonus
    batch.update(userRef, {
      'driver.wallet': {
        balance: newBalance,
        currency: 'INR',
        lastUpdated: new Date(),
        transactions: driverData.wallet?.transactions || []
      },
      'driver.welcomeBonusGiven': true,
      'driver.welcomeBonusAmount': 500,
      'driver.welcomeBonusGivenAt': new Date(),
      updatedAt: new Date()
    });

    // Create welcome bonus transaction record
    const transactionRef = db.collection('driverWalletTransactions').doc();
    batch.set(transactionRef, {
      id: transactionRef.id,
      driverId: uid,
      type: 'credit',
      amount: 500,
      previousBalance: currentBalance,
      newBalance: newBalance,
      paymentMethod: 'welcome_bonus',
      status: 'completed',
      metadata: {
        source: 'welcome_bonus',
        description: 'Welcome bonus for completing verification',
        triggeredBy: 'api_call'
      },
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // Commit the transaction
    await batch.commit();
    
    console.log('✅ [WALLET_API] Welcome bonus processed successfully:', {
      uid,
      transactionId: transactionRef.id,
      newBalance
    });

    res.status(200).json({
      success: true,
      message: 'Welcome bonus processed successfully',
      data: {
        welcomeBonusGiven: true,
        welcomeBonusAmount: 500,
        previousBalance: currentBalance,
        newBalance: newBalance,
        transactionId: transactionRef.id
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [WALLET_API] Error processing welcome bonus:', error);
    
    // Provide more specific error details
    let errorCode = 'WELCOME_BONUS_ERROR';
    let errorMessage = 'Failed to process welcome bonus';
    let errorDetails = 'An error occurred while processing welcome bonus';
    
    if (error.code === 'permission-denied') {
      errorCode = 'PERMISSION_DENIED';
      errorMessage = 'Permission denied';
      errorDetails = 'Insufficient permissions to update wallet';
    } else if (error.code === 'unavailable') {
      errorCode = 'SERVICE_UNAVAILABLE';
      errorMessage = 'Service temporarily unavailable';
      errorDetails = 'Database service is temporarily unavailable';
    } else if (error.message && error.message.includes('transaction')) {
      errorCode = 'TRANSACTION_ERROR';
      errorMessage = 'Transaction failed';
      errorDetails = 'Failed to create wallet transaction';
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: errorCode,
        message: errorMessage,
        details: errorDetails
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
    .isIn(['upi'])
    .withMessage('Payment method must be upi'),
  body('upiId')
    .optional()
    .isString()
    .withMessage('UPI ID must be a string'),
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
    const { amount, paymentMethod, upiId } = req.body;
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

    // Generate unique transaction ID for PhonePe
    const transactionId = `WALLET_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create wallet transaction record (pending status)
    const transactionRef = db.collection('driverWalletTransactions').doc();
    const transactionData = {
      id: transactionRef.id,
      driverId: uid,
      type: 'credit',
      amount: amount,
      previousBalance: currentBalance,
      newBalance: currentBalance, // Will be updated after successful payment
      paymentMethod: paymentMethod,
      status: 'pending',
      phonepeTransactionId: transactionId,
      metadata: {
        upiId: upiId || null,
        source: 'wallet_topup',
        gateway: 'phonepe'
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await transactionRef.set(transactionData);

    // Initiate PhonePe payment for wallet top-up
    const phonepeService = require('../services/phonepeService');
    const paymentData = {
      transactionId,
      amount,
      customerId: uid,
      bookingId: `wallet_topup_${uid}`,
      customerPhone: userData.phone || userData.driver?.phone,
      customerEmail: userData.email,
      customerName: userData.name || userData.driver?.name
    };

    const paymentResult = await phonepeService.createPayment(paymentData);

    if (paymentResult.success) {
      // Update transaction with PhonePe details
      await transactionRef.update({
        phonepePaymentUrl: paymentResult.data.paymentUrl,
        phonepeMerchantId: paymentResult.data.merchantId,
        updatedAt: new Date()
      });

      res.status(200).json({
        success: true,
        message: 'Payment initiated successfully',
        data: {
          transactionId: transactionRef.id,
          phonepeTransactionId: transactionId,
          paymentUrl: paymentResult.data.paymentUrl,
          amount: amount,
          status: 'pending',
          instructions: 'Complete payment using the provided URL to add money to your wallet'
        },
        timestamp: new Date().toISOString()
      });
    } else {
      // Update transaction status to failed
      await transactionRef.update({
        status: 'failed',
        failureReason: paymentResult.error?.message || 'Payment initiation failed',
        updatedAt: new Date()
      });

      res.status(400).json({
        success: false,
        error: {
          code: 'PAYMENT_INITIATION_ERROR',
          message: 'Failed to initiate payment',
          details: paymentResult.error?.message || 'Payment gateway error'
        },
        timestamp: new Date().toISOString()
      });
    }

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
 * @route   GET /api/driver/wallet/payment-status/:transactionId
 * @desc    Check wallet payment status
 * @access  Private (Driver only)
 */
router.get('/wallet/payment-status/:transactionId', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { transactionId } = req.params;
    const db = getFirestore();

    // Get wallet transaction
    const transactionDoc = await db.collection('driverWalletTransactions').doc(transactionId).get();
    
    if (!transactionDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TRANSACTION_NOT_FOUND',
          message: 'Transaction not found',
          details: 'Wallet transaction does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const transactionData = transactionDoc.data();

    // Verify driver owns this transaction
    if (transactionData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only check your own transactions'
        },
        timestamp: new Date().toISOString()
      });
    }

    // If payment is still pending, check with PhonePe
    if (transactionData.status === 'pending' && transactionData.phonepeTransactionId) {
      const phonepeService = require('../services/phonepeService');
      const verificationResult = await phonepeService.verifyPayment(transactionData.phonepeTransactionId);
      
      if (verificationResult.success) {
        // Update transaction status based on PhonePe response
        const phonepeStatus = verificationResult.data.status;
        let newStatus = 'pending';
        
        if (phonepeStatus === 'COMPLETED') {
          newStatus = 'completed';
        } else if (phonepeStatus === 'FAILED') {
          newStatus = 'failed';
        }

        await transactionDoc.ref.update({
          status: newStatus,
          phonepeStatus: phonepeStatus,
          lastChecked: new Date(),
          updatedAt: new Date()
        });

        transactionData.status = newStatus;
        transactionData.phonepeStatus = phonepeStatus;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        transactionId: transactionData.id,
        status: transactionData.status,
        amount: transactionData.amount,
        paymentMethod: transactionData.paymentMethod,
        phonepeTransactionId: transactionData.phonepeTransactionId,
        phonepeStatus: transactionData.phonepeStatus,
        paymentUrl: transactionData.phonepePaymentUrl,
        createdAt: transactionData.createdAt,
        completedAt: transactionData.completedAt,
        failureReason: transactionData.failureReason
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error checking wallet payment status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PAYMENT_STATUS_ERROR',
        message: 'Failed to check payment status',
        details: 'An error occurred while checking payment status'
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
      updateData['pickupVerification'] = {
        photoUrl: photoUrl,
        verifiedAt: new Date(),
        verifiedBy: uid,
        location: location,
        notes: notes
      };
    } else if (photoType === 'delivery') {
      updateData['deliveryVerification'] = {
        photoUrl: photoUrl,
        verifiedAt: new Date(),
        verifiedBy: uid,
        location: location,
        notes: notes
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
      bookingUpdateData['pickupVerification'] = {
        photoUrl: photoUrl,
        verifiedAt: new Date(),
        verifiedBy: uid,
        location: location,
        notes: notes
      };
    } else if (photoData.photoType === 'delivery') {
      bookingUpdateData['deliveryVerification'] = {
        photoUrl: photoUrl,
        verifiedAt: new Date(),
        verifiedBy: uid,
        location: location,
        notes: notes
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
 * @route   GET /api/driver/availability
 * @desc    Get current driver availability status
 * @access  Private (Driver only)
 */
router.get('/availability', requireDriver, async (req, res) => {
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
    const driverData = userData.driver || {};
    const availability = driverData.availability || {};

    // Get current status from driverLocations collection
    const locationDoc = await db.collection('driverLocations').doc(uid).get();
    const locationData = locationDoc.exists ? locationDoc.data() : {};

    res.status(200).json({
      success: true,
      message: 'Driver availability retrieved successfully',
      data: {
        isOnline: driverData.isOnline || false,
        isAvailable: driverData.isAvailable || false,
        currentStatus: driverData.isOnline && driverData.isAvailable ? 'available' : 
                      driverData.isOnline ? 'online_unavailable' : 'offline',
        workingHours: availability.workingHours || {},
        workingDays: availability.workingDays || [],
        maxBookingsPerDay: availability.maxBookingsPerDay || 10,
        currentBookings: locationData.currentTripId ? 1 : 0,
        lastSeen: locationData.lastUpdated || userData.updatedAt,
        currentLocation: locationData.currentLocation || null,
        preferredAreas: availability.preferredAreas || []
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting driver availability:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'AVAILABILITY_RETRIEVAL_ERROR',
        message: 'Failed to retrieve driver availability',
        details: 'An error occurred while retrieving driver availability'
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
router.get('/documents/status', requireDriver, documentStatusRateLimit, documentStatusCache, async (req, res) => {
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

    // CRITICAL FIX: Get verification data from verification service for comprehensive status
    const verificationService = require('../services/verificationService');
    let comprehensiveVerificationData;
    
    try {
      comprehensiveVerificationData = await verificationService.getDriverVerificationData(uid);
      console.log('📊 Comprehensive verification data:', comprehensiveVerificationData);
    } catch (verificationError) {
      console.warn('⚠️ Failed to get comprehensive verification data, using basic data:', verificationError.message);
    }

    // Use comprehensive data if available, otherwise fall back to basic data
    let finalDocuments = comprehensiveVerificationData?.documents || documents;
    const finalVerificationStatus = comprehensiveVerificationData?.verificationStatus || verificationStatus;
    
    // CRITICAL FIX: If comprehensive data failed, ensure we have proper document structure
    if (!comprehensiveVerificationData) {
      console.log('📊 Using basic data from users collection');
      console.log('📊 Raw documents from users:', JSON.stringify(documents, null, 2));
      
      // Ensure all required documents have proper structure
      const requiredDocuments = ['drivingLicense', 'profilePhoto', 'aadhaarCard', 'bikeInsurance', 'rcBook'];
      finalDocuments = {};
      
      requiredDocuments.forEach(docType => {
        const doc = documents[docType] || {};
        finalDocuments[docType] = {
          url: doc.url || doc.downloadURL || '',
          status: doc.verificationStatus || doc.status || 'not_uploaded',
          verificationStatus: doc.verificationStatus || doc.status || 'not_uploaded',
          uploadedAt: doc.uploadedAt || '',
          verified: doc.verified || false,
          rejectionReason: doc.rejectionReason || null,
          verifiedAt: doc.verifiedAt || null,
          verifiedBy: doc.verifiedBy || null,
          comments: doc.comments || null,
          number: doc.number || null,
          fileSize: doc.fileSize || null,
          lastModified: doc.lastModified || doc.uploadedAt || null
        };
      });
      
      console.log('📊 Processed final documents:', JSON.stringify(finalDocuments, null, 2));
    }

    // Calculate document completion status with enhanced data
    const requiredDocuments = ['drivingLicense', 'profilePhoto', 'aadhaarCard', 'bikeInsurance', 'rcBook'];
    const uploadedDocuments = requiredDocuments.filter(doc => finalDocuments[doc]?.url);
    const verifiedDocuments = requiredDocuments.filter(doc => 
      finalDocuments[doc]?.status === 'verified' || 
      finalDocuments[doc]?.verificationStatus === 'verified' ||
      finalDocuments[doc]?.verified === true
    );
    const rejectedDocuments = requiredDocuments.filter(doc => 
      finalDocuments[doc]?.status === 'rejected' || 
      finalDocuments[doc]?.verificationStatus === 'rejected'
    );

    const documentStatus = {
      total: requiredDocuments.length,
      uploaded: uploadedDocuments.length,
      verified: verifiedDocuments.length,
      rejected: rejectedDocuments.length,
      pending: uploadedDocuments.length - verifiedDocuments.length - rejectedDocuments.length
    };

    // Calculate overall progress
    const overallProgress = documentStatus.total > 0 
      ? Math.round((documentStatus.verified / documentStatus.total) * 100)
      : 0;

    // Determine next steps based on final verification status
    const nextSteps = [];
    if (finalVerificationStatus === 'pending') {
      nextSteps.push('Upload all required documents');
      nextSteps.push('Ensure documents are clear and readable');
    } else if (finalVerificationStatus === 'pending_verification') {
      nextSteps.push('Wait for admin review (24-48 hours)');
      nextSteps.push('Check back regularly for updates');
    } else if (finalVerificationStatus === 'rejected') {
      nextSteps.push('Review rejection reasons for each document');
      nextSteps.push('Re-upload rejected documents with improvements');
    } else if (finalVerificationStatus === 'approved') {
      nextSteps.push('Start accepting ride requests');
      nextSteps.push('Complete your first ride to earn welcome bonus');
    }

    // Enhanced document details with better UX data
    const documentConfig = {
      drivingLicense: { 
        displayName: 'Driving License', 
        description: 'Valid driving license with clear photo',
        icon: 'card',
        tips: 'Ensure all text is clearly visible and photo is recent'
      },
      aadhaarCard: { 
        displayName: 'Aadhaar Card', 
        description: 'Government issued Aadhaar card',
        icon: 'id-card',
        tips: 'Front and back side in separate images'
      },
      bikeInsurance: { 
        displayName: 'Bike Insurance', 
        description: 'Valid vehicle insurance document',
        icon: 'shield-checkmark',
        tips: 'Must be current and cover the vehicle you\'ll use'
      },
      rcBook: { 
        displayName: 'RC Book', 
        description: 'Vehicle Registration Certificate',
        icon: 'document-text',
        tips: 'Ensure vehicle details match your bike'
      },
      profilePhoto: { 
        displayName: 'Profile Photo', 
        description: 'Clear photo of yourself',
        icon: 'person',
        tips: 'Professional looking photo, face clearly visible'
      }
    };

    const enhancedDocuments = requiredDocuments.map(docType => {
      const doc = finalDocuments[docType] || {};
      const config = documentConfig[docType];

      return {
        type: docType,
        name: config?.displayName || docType,
        displayName: config?.displayName || docType,
        description: config?.description || '',
        status: doc.verificationStatus || doc.status || 'not_uploaded',
        url: doc.url || '',
        number: doc.number || '',
        uploadedAt: doc.uploadedAt?.toDate?.()?.toISOString() || doc.uploadedAt || '',
        verifiedAt: doc.verifiedAt?.toDate?.()?.toISOString() || doc.verifiedAt || '',
        rejectedAt: doc.rejectedAt || '',
        rejectionReason: doc.rejectionReason || '',
        verifiedBy: doc.verifiedBy || '',
        isRequired: true,
        fileSize: doc.fileSize,
        lastModified: doc.lastModified || doc.uploadedAt,
        // Enhanced UX fields
        icon: config?.icon || 'document',
        tips: config?.tips || 'Ensure document is clear and readable'
      };
    });

    // Get detailed status for each document using comprehensive data
    const documentDetails = requiredDocuments.map(docType => {
      const doc = finalDocuments[docType];
      return {
        type: docType,
        name: getDocumentDisplayName(docType),
        status: doc?.status || doc?.verificationStatus || 'not_uploaded',
        url: doc?.url || null,
        number: doc?.number || null,
        uploadedAt: doc?.uploadedAt?.toDate?.()?.toISOString() || doc?.uploadedAt || null,
        verifiedAt: doc?.verifiedAt?.toDate?.()?.toISOString() || doc?.verifiedAt || null,
        rejectedAt: doc?.rejectedAt || null,
        rejectionReason: doc?.rejectionReason || null,
        verifiedBy: doc?.verifiedBy || null
      };
    });

    // Use documentDetails in response
    console.log('Document details processed:', documentDetails.length);

    res.status(200).json({
      success: true,
      message: 'Document status retrieved successfully',
      data: {
        verificationStatus: finalVerificationStatus,
        documentStatus,
        documents: enhancedDocuments,
        isComplete: uploadedDocuments.length === requiredDocuments.length,
        isVerified: finalVerificationStatus === 'approved' || finalVerificationStatus === 'verified',
        canStartWorking: finalVerificationStatus === 'approved' || finalVerificationStatus === 'verified',
        // Enhanced UX data
        overallProgress,
        estimatedReviewTime: finalVerificationStatus === 'pending_verification' ? '24-48 hours' : null,
        lastStatusUpdate: userData.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        nextSteps,
        welcomeBonusEligible: (finalVerificationStatus === 'verified' || finalVerificationStatus === 'approved') && !userData.driver?.welcomeBonusGiven,
        // Add comprehensive data source info
        dataSource: comprehensiveVerificationData ? 'comprehensive' : 'basic',
        comprehensiveData: comprehensiveVerificationData ? {
          source: comprehensiveVerificationData.source,
          documentSummary: comprehensiveVerificationData.documentSummary
        } : null
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
    const documents = userData.documents || userData.driver?.documents || {};

    // Check if all required documents are uploaded
    const requiredDocuments = ['drivingLicense', 'profilePhoto', 'aadhaarCard', 'bikeInsurance', 'rcBook'];
    
    // Map camelCase to snake_case for backend proxy storage
    const documentFieldMap = {
      'drivingLicense': 'driving_license',
      'profilePhoto': 'profile_photo', 
      'aadhaarCard': 'aadhaar_card',
      'bikeInsurance': 'bike_insurance',
      'rcBook': 'rc_book'
    };
    
    const uploadedDocuments = requiredDocuments.filter(doc => {
      const snakeCaseKey = documentFieldMap[doc];
      return documents[doc]?.downloadURL || documents[doc]?.url || 
             documents[snakeCaseKey]?.downloadURL || documents[snakeCaseKey]?.url;
    });

    if (uploadedDocuments.length !== requiredDocuments.length) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INCOMPLETE_DOCUMENTS',
          message: 'Incomplete documents',
          details: `Please upload all required documents. Missing: ${requiredDocuments.filter(doc => {
            const snakeCaseKey = documentFieldMap[doc];
            return !documents[doc]?.downloadURL && !documents[doc]?.url && 
                   !documents[snakeCaseKey]?.downloadURL && !documents[snakeCaseKey]?.url;
          }).join(', ')}`
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

    // Create verification request record with normalized document structure
    const verificationRequestRef = db.collection('documentVerificationRequests').doc();
    const verificationRequest = {
      id: verificationRequestRef.id,
      driverId: uid,
      driverName: userData.name,
      driverPhone: userData.phone,
      documents: {
        drivingLicense: {
          downloadURL: documents.drivingLicense?.downloadURL || documents.drivingLicense?.url || documents.driving_license?.downloadURL || documents.driving_license?.url || '',
          verificationStatus: documents.drivingLicense?.status || documents.driving_license?.status || 'pending',
          uploadedAt: documents.drivingLicense?.uploadedAt || documents.driving_license?.uploadedAt || new Date(),
          verified: documents.drivingLicense?.verified || documents.driving_license?.verified || false
        },
        aadhaarCard: {
          downloadURL: documents.aadhaarCard?.downloadURL || documents.aadhaarCard?.url || documents.aadhaar_card?.downloadURL || documents.aadhaar_card?.url || '',
          verificationStatus: documents.aadhaarCard?.status || documents.aadhaar_card?.status || 'pending',
          uploadedAt: documents.aadhaarCard?.uploadedAt || documents.aadhaar_card?.uploadedAt || new Date(),
          verified: documents.aadhaarCard?.verified || documents.aadhaar_card?.verified || false
        },
        bikeInsurance: {
          downloadURL: documents.bikeInsurance?.downloadURL || documents.bikeInsurance?.url || documents.bike_insurance?.downloadURL || documents.bike_insurance?.url || '',
          verificationStatus: documents.bikeInsurance?.status || documents.bike_insurance?.status || 'pending',
          uploadedAt: documents.bikeInsurance?.uploadedAt || documents.bike_insurance?.uploadedAt || new Date(),
          verified: documents.bikeInsurance?.verified || documents.bike_insurance?.verified || false
        },
        rcBook: {
          downloadURL: documents.rcBook?.downloadURL || documents.rcBook?.url || documents.rc_book?.downloadURL || documents.rc_book?.url || '',
          verificationStatus: documents.rcBook?.status || documents.rc_book?.status || 'pending',
          uploadedAt: documents.rcBook?.uploadedAt || documents.rc_book?.uploadedAt || new Date(),
          verified: documents.rcBook?.verified || documents.rc_book?.verified || false
        },
        profilePhoto: {
          downloadURL: documents.profilePhoto?.downloadURL || documents.profilePhoto?.url || documents.profile_photo?.downloadURL || documents.profile_photo?.url || '',
          verificationStatus: documents.profilePhoto?.status || documents.profile_photo?.status || 'pending',
          uploadedAt: documents.profilePhoto?.uploadedAt || documents.profile_photo?.uploadedAt || new Date(),
          verified: documents.profilePhoto?.verified || documents.profile_photo?.verified || false
        }
      },
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

/**
 * @route   POST /api/driver/bookings/:id/payment
 * @desc    Collect payment from customer
 * @access  Private (Driver only)
 */
router.post('/bookings/:id/payment', [
  requireDriver,
  body('amount')
    .isNumeric()
    .withMessage('Amount must be a number'),
  body('paymentMethod')
    .isIn(['cash', 'upi'])
    .withMessage('Payment method must be cash or upi'),
  body('collectedAt')
    .isISO8601()
    .withMessage('Collected at must be a valid date')
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
    const { amount, paymentMethod, collectedAt } = req.body;
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
          details: 'The specified booking does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const bookingData = bookingDoc.data();

    // Verify driver is assigned to this booking
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only collect payment for your assigned bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Verify booking is in correct status for payment collection
    if (!['delivered', 'payment_pending'].includes(bookingData.status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Invalid booking status',
          details: 'Payment can only be collected for delivered bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    const currentTime = new Date();

    // Update booking with payment information
    const updateData = {
      status: 'completed',
      payment: {
        amount: parseFloat(amount),
        method: paymentMethod,
        collectedAt: new Date(collectedAt),
        collectedBy: uid,
        status: 'collected'
      },
      'timing.completedAt': currentTime,
      updatedAt: currentTime
    };

    await bookingRef.update(updateData);

    // Deduct commission from driver wallet
    try {
      const walletService = require('../services/walletService');
      const fareCalculationService = require('../services/fareCalculationService');
      
      const exactDistanceKm = bookingData.distance?.total || 0;
      const tripFare = parseFloat(amount);
      
      if (tripFare > 0 && exactDistanceKm > 0) {
        console.log(`💰 Deducting commission for payment collection: Fare ₹${tripFare}`);
        
        // Calculate commission based on fare amount (not raw distance)
        // Use the same fare calculation logic to ensure consistency
        const fareBreakdown = fareCalculationService.calculateFare(exactDistanceKm);
        const commissionAmount = fareBreakdown.commission;
        const roundedDistanceKm = fareBreakdown.roundedDistanceKm;
        
        console.log(`📊 Fare breakdown: ${exactDistanceKm}km → ${roundedDistanceKm}km → ₹${tripFare} → Commission ₹${commissionAmount}`);
        
        // Prepare trip details for commission transaction
        const tripDetails = {
          pickupLocation: bookingData.pickup || {},
          dropoffLocation: bookingData.dropoff || {},
          tripFare: tripFare,
          exactDistanceKm: exactDistanceKm,
          roundedDistanceKm: roundedDistanceKm
        };
        
        // Deduct commission from driver wallet
        const commissionResult = await walletService.deductCommission(
          uid,
          id,
          roundedDistanceKm, // Use rounded distance for commission calculation
          commissionAmount,
          tripDetails
        );
        
        if (commissionResult.success) {
          console.log(`✅ Commission deducted: ₹${commissionAmount} for ${roundedDistanceKm}km (fare: ₹${tripFare})`);
        } else {
          console.error('❌ Commission deduction failed:', commissionResult.error);
        }
      }
    } catch (commissionError) {
      console.error('❌ Error processing commission:', commissionError);
    }

    // Update driver earnings
    const driverRef = db.collection('users').doc(uid);
    const driverDoc = await driverRef.get();
    
    if (driverDoc.exists) {
      const driverData = driverDoc.data();
      const currentEarnings = driverData.driver?.earnings || { total: 0, thisMonth: 0, thisWeek: 0 };
      const tripEarnings = parseFloat(amount) * 0.8; // 80% for driver, 20% for platform
      
      const newEarnings = {
        total: currentEarnings.total + tripEarnings,
        thisMonth: currentEarnings.thisMonth + tripEarnings,
        thisWeek: currentEarnings.thisWeek + tripEarnings
      };

      await driverRef.update({
        'driver.earnings': newEarnings,
        'driver.totalTrips': (driverData.driver?.totalTrips || 0) + 1,
        updatedAt: currentTime
      });
    }

    // Create payment record
    const paymentRecord = {
      bookingId: id,
      driverId: uid,
      customerId: bookingData.customerId,
      amount: parseFloat(amount),
      method: paymentMethod,
      collectedAt: new Date(collectedAt),
      status: 'collected',
      createdAt: currentTime,
      updatedAt: currentTime
    };

    await db.collection('payments').add(paymentRecord);

    res.status(200).json({
      success: true,
      message: 'Payment collected successfully',
      data: {
        bookingId: id,
        amount: parseFloat(amount),
        method: paymentMethod,
        collectedAt: new Date(collectedAt),
        status: 'collected'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error collecting payment:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PAYMENT_COLLECTION_ERROR',
        message: 'Failed to collect payment',
        details: 'An error occurred while collecting payment'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/availability
 * @desc    Get current driver availability status
 * @access  Private (Driver only)
 */
router.get('/availability', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const userDoc = await db.collection('users').doc(uid).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    
    res.status(200).json({
      success: true,
      data: {
        isOnline: userData.isOnline || false,
        isAvailable: userData.isAvailable || false,
        status: userData.status || 'offline',
        lastSeen: userData.lastSeen || null,
        currentLocation: userData.currentLocation || null
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting driver availability:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_AVAILABILITY_ERROR',
        message: 'Failed to get driver availability',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/bookings/:id/accept
 * @desc    Accept a booking request
 * @access  Private (Driver only)
 */
router.post('/bookings/:id/accept', requireDriver, async (req, res) => {
  try {
    const { id } = req.params;
    const { uid } = req.user;
    const db = getFirestore();
    
    const bookingRef = db.collection('bookings').doc(id);
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
    
    // Check if booking is still available
    if (bookingData.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_AVAILABLE',
          message: 'Booking is no longer available'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update booking status
    await bookingRef.update({
      status: 'accepted',
      driverId: uid,
      acceptedAt: new Date(),
      updatedAt: new Date()
    });

    // Update driver status to busy
    await db.collection('users').doc(uid).update({
      isAvailable: false,
      currentBookingId: id,
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Booking accepted successfully',
      data: {
        bookingId: id,
        status: 'accepted',
        acceptedAt: new Date()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error accepting booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ACCEPT_BOOKING_ERROR',
        message: 'Failed to accept booking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/bookings/:id/reject
 * @desc    Reject a booking request
 * @access  Private (Driver only)
 */
router.post('/bookings/:id/reject', requireDriver, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const { uid } = req.user;
    const db = getFirestore();
    
    const bookingRef = db.collection('bookings').doc(id);
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
    
    // Check if booking is still pending
    if (bookingData.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_AVAILABLE',
          message: 'Booking is no longer available'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update booking status
    await bookingRef.update({
      status: 'rejected',
      rejectedBy: uid,
      rejectionReason: reason || 'No reason provided',
      rejectedAt: new Date(),
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Booking rejected successfully',
      data: {
        bookingId: id,
        status: 'rejected',
        rejectedAt: new Date(),
        reason: reason || 'No reason provided'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error rejecting booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REJECT_BOOKING_ERROR',
        message: 'Failed to reject booking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/trips/track
 * @desc    Track trip progress
 * @access  Private (Driver only)
 */
router.post('/trips/track', requireDriver, async (req, res) => {
  try {
    const { bookingId, status, location, notes } = req.body;
    const { uid } = req.user;
    const db = getFirestore();
    
    if (!bookingId || !status) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'Booking ID and status are required'
        },
        timestamp: new Date().toISOString()
      });
    }

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
    
    // Verify driver is assigned to this booking
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'You are not assigned to this booking'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update booking with tracking information
    const updateData = {
      status: status,
      updatedAt: new Date()
    };

    // Add location if provided
    if (location) {
      updateData.driverLocation = {
        latitude: location.latitude,
        longitude: location.longitude,
        address: location.address,
        timestamp: new Date()
      };
    }

    // Add status-specific timestamps
    switch (status) {
      case 'in_progress':
        updateData.startedAt = new Date();
        break;
      case 'picked_up':
        updateData.pickedUpAt = new Date();
        break;
      case 'completed':
        updateData.completedAt = new Date();
        updateData.actualDuration = bookingData.estimatedDuration || 0;
        break;
    }

    // Add notes if provided
    if (notes) {
      updateData.driverNotes = notes;
    }

    await bookingRef.update(updateData);

    // Update driver location if provided
    if (location) {
      await db.collection('users').doc(uid).update({
        currentLocation: {
          latitude: location.latitude,
          longitude: location.longitude,
          address: location.address,
          timestamp: new Date()
        },
        lastSeen: new Date(),
        updatedAt: new Date()
      });
    }

    res.status(200).json({
      success: true,
      message: 'Trip tracking updated successfully',
      data: {
        bookingId,
        status,
        updatedAt: new Date(),
        location: location || null
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error tracking trip:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TRACK_TRIP_ERROR',
        message: 'Failed to track trip',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/photo/verify
 * @desc    Verify pickup/delivery with photo
 * @access  Private (Driver only)
 */
router.post('/photo/verify', requireDriver, async (req, res) => {
  try {
    const { bookingId, type, photoUrl, notes } = req.body;
    const { uid } = req.user;
    const db = getFirestore();
    
    if (!bookingId || !type || !photoUrl) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'Booking ID, type, and photo URL are required'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!['pickup', 'delivery'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_TYPE',
          message: 'Type must be either "pickup" or "delivery"'
        },
        timestamp: new Date().toISOString()
      });
    }

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
    
    // Verify driver is assigned to this booking
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'You are not assigned to this booking'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Create photo verification record
    const photoVerification = {
      id: `photo_${Date.now()}`,
      bookingId,
      driverId: uid,
      type,
      photoUrl,
      notes: notes || null,
      verifiedAt: new Date(),
      status: 'verified'
    };

    await db.collection('photoVerifications').add(photoVerification);

    // Update booking with photo verification
    const updateData = {
      updatedAt: new Date()
    };

    if (type === 'pickup') {
      updateData.pickupVerification = {
        photoUrl: photoUrl,
        verifiedAt: new Date(),
        verifiedBy: uid,
        location: null,
        notes: notes
      };
    } else if (type === 'delivery') {
      updateData.deliveryVerification = {
        photoUrl: photoUrl,
        verifiedAt: new Date(),
        verifiedBy: uid,
        location: null,
        notes: notes
      };
    }

    await bookingRef.update(updateData);

    res.status(200).json({
      success: true,
      message: 'Photo verification submitted successfully',
      data: {
        bookingId,
        type,
        photoUrl,
        verifiedAt: new Date()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error verifying photo:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PHOTO_VERIFICATION_ERROR',
        message: 'Failed to verify photo',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== WORK SLOTS API ENDPOINTS ====================

/**
 * @route   GET /api/driver/work-slots
 * @desc    Get driver work slots
 * @access  Private (Driver only)
 */
router.get('/work-slots', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { date } = req.query;
    const db = getFirestore();
    
    console.log('🔍 [WORK_SLOTS_API] Fetching work slots for driver:', uid, 'date:', date);
    
    let query = db.collection('workSlots').where('driverId', '==', uid);
    
    if (date) {
      query = query.where('date', '==', date);
    }
    
    query = query.orderBy('startTime');
    
    const snapshot = await query.get();
    const slots = [];
    
    snapshot.forEach((doc) => {
      slots.push({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || null,
        updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || null
      });
    });
    
    console.log('✅ [WORK_SLOTS_API] Retrieved work slots:', slots.length);
    
    res.status(200).json({
      success: true,
      message: 'Work slots retrieved successfully',
      data: slots,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [WORK_SLOTS_API] Error fetching work slots:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'WORK_SLOTS_ERROR',
        message: 'Failed to retrieve work slots',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/work-slots
 * @desc    Create work slots for driver
 * @access  Private (Driver only)
 */
router.post('/work-slots', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { slots } = req.body;
    const db = getFirestore();
    
    console.log('🔍 [WORK_SLOTS_API] Creating work slots for driver:', uid, 'slots:', slots?.length);
    
    if (!slots || !Array.isArray(slots)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SLOTS',
          message: 'Invalid slots data',
          details: 'Slots must be an array'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    const batch = db.batch();
    const createdSlots = [];
    
    for (const slot of slots) {
      const slotRef = db.collection('workSlots').doc();
      const slotData = {
        ...slot,
        driverId: uid,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      batch.set(slotRef, slotData);
      createdSlots.push({
        id: slotRef.id,
        ...slotData
      });
    }
    
    await batch.commit();
    
    console.log('✅ [WORK_SLOTS_API] Created work slots:', createdSlots.length);
    
    res.status(201).json({
      success: true,
      message: 'Work slots created successfully',
      data: createdSlots,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [WORK_SLOTS_API] Error creating work slots:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'WORK_SLOTS_CREATE_ERROR',
        message: 'Failed to create work slots',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/driver/work-slots/:slotId
 * @desc    Update work slot
 * @access  Private (Driver only)
 */
router.put('/work-slots/:slotId', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { slotId } = req.params;
    const updates = req.body;
    const db = getFirestore();
    
    console.log('🔍 [WORK_SLOTS_API] Updating work slot:', slotId, 'for driver:', uid);
    
    const slotRef = db.collection('workSlots').doc(slotId);
    const slotDoc = await slotRef.get();
    
    if (!slotDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SLOT_NOT_FOUND',
          message: 'Work slot not found',
          details: 'The specified work slot does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    const slotData = slotDoc.data();
    
    // Verify driver owns this slot
    if (slotData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'SLOT_ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only update your own work slots'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    const updateData = {
      ...updates,
      updatedAt: new Date()
    };
    
    await slotRef.update(updateData);
    
    console.log('✅ [WORK_SLOTS_API] Updated work slot:', slotId);
    
    res.status(200).json({
      success: true,
      message: 'Work slot updated successfully',
      data: {
        id: slotId,
        ...slotData,
        ...updateData
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [WORK_SLOTS_API] Error updating work slot:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'WORK_SLOTS_UPDATE_ERROR',
        message: 'Failed to update work slot',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   DELETE /api/driver/work-slots/:slotId
 * @desc    Delete work slot
 * @access  Private (Driver only)
 */
router.delete('/work-slots/:slotId', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { slotId } = req.params;
    const db = getFirestore();
    
    console.log('🔍 [WORK_SLOTS_API] Deleting work slot:', slotId, 'for driver:', uid);
    
    const slotRef = db.collection('workSlots').doc(slotId);
    const slotDoc = await slotRef.get();
    
    if (!slotDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SLOT_NOT_FOUND',
          message: 'Work slot not found',
          details: 'The specified work slot does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    const slotData = slotDoc.data();
    
    // Verify driver owns this slot
    if (slotData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'SLOT_ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only delete your own work slots'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    await slotRef.delete();
    
    console.log('✅ [WORK_SLOTS_API] Deleted work slot:', slotId);
    
    res.status(200).json({
      success: true,
      message: 'Work slot deleted successfully',
      data: { id: slotId },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [WORK_SLOTS_API] Error deleting work slot:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'WORK_SLOTS_DELETE_ERROR',
        message: 'Failed to delete work slot',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/documents/:type/download
 * @desc    Download driver document
 * @access  Private (Driver only)
 */
router.get('/documents/:type/download', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { type } = req.params;
    const db = getFirestore();
    
    console.log(`📥 Driver ${uid} requesting download for document type: ${type}`);
    
    // Validate document type
    const validTypes = ['drivingLicense', 'profilePhoto', 'aadhaarCard', 'bikeInsurance', 'rcBook'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DOCUMENT_TYPE',
          message: 'Invalid document type',
          details: `Document type must be one of: ${validTypes.join(', ')}`
        },
        timestamp: new Date().toISOString()
      });
    }
    
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
    const documents = userData.driver?.documents || {};
    const document = documents[type];
    
    if (!document || !document.url) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DOCUMENT_NOT_FOUND',
          message: 'Document not found',
          details: `${type} document has not been uploaded`
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get document metadata
    const documentInfo = {
      type: type,
      displayName: getDocumentDisplayName(type),
      url: document.url,
      number: document.number || '',
      uploadedAt: document.uploadedAt?.toDate?.()?.toISOString() || document.uploadedAt || '',
      status: document.status || document.verificationStatus || 'pending',
      fileSize: document.fileSize || null,
      lastModified: document.lastModified || document.uploadedAt
    };

    // Return document info with download URL
    res.status(200).json({
      success: true,
      message: 'Document download info retrieved successfully',
      data: {
        document: documentInfo,
        downloadUrl: document.url, // Firebase Storage URL - accessible directly
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting document download info:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENT_DOWNLOAD_ERROR',
        message: 'Failed to get document download info',
        details: 'An error occurred while retrieving document download information'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/documents/download-all
 * @desc    Get download URLs for all driver documents
 * @access  Private (Driver only)
 */
router.get('/documents/download-all', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    console.log(`📥 Driver ${uid} requesting download URLs for all documents`);
    
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
    const documents = userData.driver?.documents || {};
    
    const documentTypes = ['drivingLicense', 'profilePhoto', 'aadhaarCard', 'bikeInsurance', 'rcBook'];
    const downloadableDocuments = [];
    
    documentTypes.forEach(type => {
      const document = documents[type];
      if (document && document.url) {
        downloadableDocuments.push({
          type: type,
          displayName: getDocumentDisplayName(type),
          url: document.url,
          number: document.number || '',
          uploadedAt: document.uploadedAt?.toDate?.()?.toISOString() || document.uploadedAt || '',
          status: document.status || document.verificationStatus || 'pending',
          fileSize: document.fileSize || null,
          lastModified: document.lastModified || document.uploadedAt
        });
      }
    });

    res.status(200).json({
      success: true,
      message: 'Document download URLs retrieved successfully',
      data: {
        documents: downloadableDocuments,
        totalDocuments: downloadableDocuments.length,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting all document download URLs:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENTS_DOWNLOAD_ERROR',
        message: 'Failed to get document download URLs',
        details: 'An error occurred while retrieving document download URLs'
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
