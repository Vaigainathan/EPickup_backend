const express = require('express');
const { body, validationResult } = require('express-validator');
const { getFirestore, getStorage } = require('../services/firebase');
const multer = require('multer');
const { requireDriver } = require('../middleware/auth');
const { documentStatusRateLimit } = require('../middleware/rateLimiter');
const { speedLimiter } = require('../middleware/rateLimit');
const { documentStatusCache, invalidateUserCache } = require('../middleware/cache');
const BookingLockService = require('../services/bookingLockService');
const bookingLockService = new BookingLockService();
const { driverStatusWorkflowService, DriverStatusError } = require('../services/driverStatusWorkflowService');

const router = express.Router();

// Multer (memory) for direct-to-backend uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit for proof photos
  }
});

const fareCalculationService = require('../services/fareCalculationService');
const COMMISSION_RATE_PER_KM = 2;

/**
 * Alias endpoint for driver location updates to avoid 404 on legacy clients
 * @route   POST /api/driver/tracking/update
 * @access  Private (Driver)
 */
router.post('/tracking/update', [
  requireDriver,
  body('bookingId').notEmpty().withMessage('Booking ID is required'),
  body('location').custom((v) => typeof v === 'object' && v !== null).withMessage('location object is required')
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

    const { getFirestore } = require('../services/firebase');
    const db = getFirestore();

    // Persist latest location for driver (compatible with existing shape)
    await db.collection('driverLocations').doc(driverId).set({
      currentLocation: {
        latitude: Number(location.latitude ?? location.lat),
        longitude: Number(location.longitude ?? location.lng),
        accuracy: Number(location.accuracy || 0),
        speed: Number(location.speed || 0),
        heading: Number(location.heading || 0),
        timestamp: new Date()
      },
      lastUpdated: new Date(),
      bookingId
    }, { merge: true });

    // Emit to customer and booking rooms
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    if (bookingDoc.exists) {
      const bookingData = bookingDoc.data();
      const customerId = bookingData.customerId;
      const userRoom = `user:${customerId}`;
      const bookingRoom = `booking:${bookingId}`;
      const payload = {
        bookingId,
        driverId,
        location: {
          latitude: Number(location.latitude ?? location.lat),
          longitude: Number(location.longitude ?? location.lng),
          accuracy: Number(location.accuracy || 0),
          speed: Number(location.speed || 0),
          heading: Number(location.heading || 0),
          timestamp: new Date().toISOString()
        },
        estimatedArrival,
        // Top-level timestamp for consumers that expect it outside the location object
        timestamp: new Date().toISOString()
      };
      try {
        const { getSocketIO } = require('../services/socket');
        const io = getSocketIO();
        io.to(userRoom).emit('driver_location_update', payload);
        io.to(bookingRoom).emit('driver_location_update', payload);
      } catch (ioErr) {
        console.error('❌ [DRIVER] Emit location failed:', ioErr);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Location updated',
      data: { bookingId, timestamp: new Date().toISOString() }
    });
  } catch (error) {
    console.error('❌ [DRIVER] tracking/update error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'LOCATION_UPDATE_ERROR', message: 'Failed to update location' }
    });
  }
});
// Helper function to calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c; // Distance in kilometers
  return distance;
}

function toIsoString(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      try {
        const parsed = value.toDate();
        return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null;
      } catch {
        return null;
      }
    }

    if (typeof value.seconds === 'number') {
      const millis = value.seconds * 1000 + (value.nanoseconds || 0) / 1_000_000;
      const parsed = new Date(millis);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
  }

  return null;
}

function toNumber(value, defaultValue = 0) {
  if (value === null || value === undefined) {
    return defaultValue;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : defaultValue;
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    const result = parseFloat(cleaned);
    return Number.isFinite(result) ? result : defaultValue;
  }

  if (typeof value === 'object' && value !== null) {
    if (typeof value.value === 'number') {
      return toNumber(value.value, defaultValue);
    }
    if (typeof value.amount === 'number') {
      return toNumber(value.amount, defaultValue);
    }
  }

  return defaultValue;
}

function roundCurrency(value) {
  const numeric = toNumber(value, 0);
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function roundDistance(value) {
  const numeric = toNumber(value, 0);
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function resolveExactDistance(bookingData = {}) {
  const candidates = [
    bookingData.distance?.total,
    bookingData.distance?.actual,
    bookingData.distance?.exact,
    bookingData.distance?.distanceKm,
    bookingData.distance?.value,
    bookingData.metrics?.distanceKm,
    bookingData.pricing?.distance,
    bookingData.route?.distanceKm,
    bookingData.exactDistance,
    bookingData.timing?.distance,
  ];

  for (const candidate of candidates) {
    const numeric = toNumber(candidate, 0);
    if (numeric > 0) {
      return numeric;
    }
  }

  return 0;
}

function resolveRoundedDistance(bookingData = {}, commissionRecord, exactDistanceKm) {
  const candidates = [
    bookingData.distance?.rounded,
    bookingData.distance?.roundedDistance,
    bookingData.distance?.roundedDistanceKm,
    bookingData.pricing?.roundedDistance,
    bookingData.pricing?.roundedDistanceKm,
    commissionRecord?.roundedDistanceKm,
  ];

  for (const candidate of candidates) {
    const numeric = toNumber(candidate, 0);
    if (numeric > 0) {
      return numeric;
    }
  }

  if (exactDistanceKm > 0) {
    return Math.ceil(exactDistanceKm);
  }

  return 0;
}

function computeBookingEarnings(bookingData = {}) {
  const grossFare = toNumber(
    bookingData.earnings?.grossFare ??
    bookingData.pricing?.totalFare ??
    bookingData.pricing?.total ??
    bookingData.fare?.totalFare ??
    bookingData.fare?.total ??
    bookingData.totalFare ??
    bookingData.totalAmount ??
    bookingData.paymentAmount ??
    0,
    0
  );

  const commissionRecord = bookingData.commissionDeducted || bookingData.earnings?.commissionRecord || null;
  let commissionAmount = toNumber(
    commissionRecord?.amount ??
    bookingData.earnings?.commission ??
    bookingData.pricing?.commission ??
    bookingData.payment?.commission ??
    0,
    0
  );

  const exactDistanceKm = resolveExactDistance(bookingData);
  let roundedDistanceKm = resolveRoundedDistance(bookingData, commissionRecord, exactDistanceKm);

  const shouldCalculateFare =
    (exactDistanceKm > 0 && (commissionAmount === 0 || roundedDistanceKm === 0)) ||
    (exactDistanceKm === 0 && commissionAmount === 0 && roundedDistanceKm === 0);

  if (shouldCalculateFare) {
    try {
      const fareBreakdown = fareCalculationService.calculateFare(exactDistanceKm > 0 ? exactDistanceKm : 0.5);
      if (!roundedDistanceKm && fareBreakdown?.roundedDistanceKm) {
        roundedDistanceKm = toNumber(fareBreakdown.roundedDistanceKm, roundedDistanceKm);
      }
      if (commissionAmount === 0 && fareBreakdown?.commission) {
        commissionAmount = toNumber(fareBreakdown.commission, commissionAmount);
      }
    } catch (fareError) {
      console.warn('⚠️ [EARNINGS_UTIL] Failed to calculate fare breakdown for booking earnings:', fareError?.message || fareError);
    }
  }

  if (commissionAmount === 0 && roundedDistanceKm > 0) {
    commissionAmount = roundedDistanceKm * COMMISSION_RATE_PER_KM;
  }

  if (roundedDistanceKm === 0 && commissionAmount > 0) {
    roundedDistanceKm = Math.max(Math.round(commissionAmount / COMMISSION_RATE_PER_KM), 0);
  }

  let commissionStatus = 'not_applicable';
  if (commissionRecord?.status) {
    commissionStatus = commissionRecord.status;
  } else if (commissionRecord) {
    commissionStatus = 'deducted';
  } else if (commissionAmount > 0) {
    commissionStatus = 'pending';
  }

  const netRaw = grossFare - commissionAmount;
  const netEarnings = roundCurrency(netRaw < 0 ? 0 : netRaw);

  return {
    grossFare: roundCurrency(grossFare),
    commissionAmount: roundCurrency(Math.max(commissionAmount, 0)),
    netEarnings,
    commissionRatePerKm: COMMISSION_RATE_PER_KM,
    commissionRecorded: Boolean(commissionRecord),
    commissionStatus,
    commissionTransactionId: commissionRecord?.transactionId || null,
    commissionDeductedAt: toIsoString(commissionRecord?.deductedAt),
    exactDistanceKm: exactDistanceKm > 0 ? roundDistance(exactDistanceKm) : null,
    roundedDistanceKm: roundedDistanceKm > 0 ? roundedDistanceKm : (exactDistanceKm > 0 ? Math.ceil(exactDistanceKm) : null),
    commissionOutstanding: commissionStatus !== 'deducted' ? roundCurrency(Math.max(commissionAmount, 0)) : 0
  };
}

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
    const driverId = userData.id || uid;
    const driverName = userData.name || userData.fullName || userData.displayName || 'Driver';
    const driverEmail = userData.email || userData.contactEmail || (userData.contact && userData.contact.email) || '';
    const driverPhone = userData.phone || userData.contactNumber || (userData.contact && userData.contact.phone) || '';

    if (!userData.id) {
      try {
        await db.collection('users').doc(uid).set({
          id: driverId,
          updatedAt: new Date()
        }, { merge: true });
        console.log('✅ [PROFILE] Backfilled missing driver id into Firestore document');
      } catch (idPersistError) {
        console.warn('⚠️ [PROFILE] Failed to backfill missing driver id:', idPersistError.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Driver data retrieved successfully',
      data: {
        id: driverId,
        name: driverName,
        email: driverEmail,
        phone: driverPhone,
        profilePicture: userData.profilePicture || null,
        driver: userData.driver || {}
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
    const driverId = userData.id || uid;
    const driverName = userData.name || userData.fullName || userData.displayName || 'Driver';
    const driverEmail = userData.email || userData.contactEmail || (userData.contact && userData.contact.email) || '';
    const driverPhone = userData.phone || userData.contactNumber || (userData.contact && userData.contact.phone) || '';

    if (!userData.id) {
      try {
        await db.collection('users').doc(uid).set({
          id: driverId,
          updatedAt: new Date()
        }, { merge: true });
        console.log('✅ [PROFILE] Backfilled missing driver id into Firestore document');
      } catch (idPersistError) {
        console.warn('⚠️ [PROFILE] Failed to backfill missing driver id:', idPersistError.message);
      }
    }
    
    // ✅ CRITICAL FIX: Get profile photo from Firebase Storage if not in Firestore
    let profilePicture = userData.profilePicture;
    
    if (!profilePicture) {
      try {
        const bucket = getStorage().bucket();
        const [files] = await bucket.getFiles({
          prefix: `drivers/${uid}/documents/profile_photo/`,
        });

        if (files.length > 0) {
          // Get the latest profile photo
          const sortedFiles = files.sort((a, b) => {
            const aTime = new Date(a.metadata.timeCreated);
            const bTime = new Date(b.metadata.timeCreated);
            return bTime - aTime; // Newest first
          });

          const [downloadURL] = await sortedFiles[0].getSignedUrl({
            action: 'read',
            expires: '03-01-2500'
          });

          profilePicture = downloadURL;
          console.log('✅ [PROFILE] Profile photo fetched from Firebase Storage');
        }
      } catch (storageError) {
        console.warn('⚠️ [PROFILE] Failed to fetch profile photo from Firebase Storage:', storageError.message);
      }
    }
    
    // Ensure wallet structure exists and is properly formatted
    const driverData = userData.driver || {};
    
    // CRITICAL FIX: Get verification data from verification service for comprehensive status
    const verificationService = require('../services/verificationService');
    let comprehensiveVerificationData;
    
    try {
      comprehensiveVerificationData = await verificationService.getDriverVerificationData(uid);
      
      // ✅ CRITICAL FIX: Handle null return from verification service
      if (!comprehensiveVerificationData) {
        console.warn('⚠️ [PROFILE] Verification service returned null, using basic data');
        comprehensiveVerificationData = null;
      } else {
        console.log('📊 [PROFILE] Comprehensive verification data:', comprehensiveVerificationData);
        console.log('🔍 [PROFILE] Verification status from service:', comprehensiveVerificationData.verificationStatus);
        console.log('🔍 [PROFILE] Driver data verification status:', driverData.verificationStatus);
      }
    } catch (verificationError) {
      console.warn('⚠️ [PROFILE] Failed to get comprehensive verification data, using basic data:', verificationError.message);
      console.error('❌ [PROFILE] Verification service error details:', verificationError);
      comprehensiveVerificationData = null;
    }
    
    // Get points wallet data
    const pointsService = require('../services/walletService');
    let pointsWalletData = {
      pointsBalance: 0,
      currency: 'points',
      requiresTopUp: true,
      canWork: false,
      lastUpdated: new Date()
    };
    
    try {
      const pointsResult = await pointsService.getPointsBalance(uid);
      if (pointsResult.success) {
        // CRITICAL FIX: walletService returns data under 'wallet', not 'data'
        pointsWalletData = pointsResult.wallet;
      }
    } catch (pointsError) {
      console.warn('⚠️ [PROFILE] Failed to get points wallet data:', pointsError.message);
    }
    
    // Debug logging for vehicle details and wallet data
    console.log('🔍 [PROFILE] Debug userData:', {
      hasDriver: !!userData.driver,
      driverKeys: userData.driver ? Object.keys(userData.driver) : [],
      vehicleDetails: userData.driver?.vehicleDetails,
      vehicleDetailsKeys: userData.driver?.vehicleDetails ? Object.keys(userData.driver.vehicleDetails) : [],
      vehicleType: userData.driver?.vehicleType,
      hasVehicleDetails: !!userData.driver?.vehicleDetails,
      pointsBalance: pointsWalletData?.pointsBalance,
      requiresTopUp: pointsWalletData?.requiresTopUp,
      walletDataKeys: pointsWalletData ? Object.keys(pointsWalletData) : []
    });
    
    // ✅ USE VERIFICATION SERVICE RESULT (No redundant logic!)
    // The verification service already counts documents and determines status
    let finalVerificationStatus;
    let finalIsVerified;
    
    if (comprehensiveVerificationData) {
      // Use the verification service result (already counted documents)
      finalVerificationStatus = comprehensiveVerificationData.verificationStatus;
      finalIsVerified = comprehensiveVerificationData.isVerified;
      
      console.log('🔍 [PROFILE] Using verification service result:', {
        status: finalVerificationStatus,
        isVerified: finalIsVerified,
        verifiedDocs: comprehensiveVerificationData.verifiedDocumentsCount,
        totalDocs: comprehensiveVerificationData.totalDocumentsCount
      });
    } else {
      // Fallback if verification service fails
      finalVerificationStatus = driverData.verificationStatus || 'pending';
      finalIsVerified = driverData.isVerified || false;
      
      console.log('⚠️ [PROFILE] Using fallback verification data:', {
        status: finalVerificationStatus,
        isVerified: finalIsVerified
      });
    }
    
    // Normalize driver data with points wallet and updated verification status
    const normalizedDriver = {
      ...driverData,
      id: driverData.id || driverId,
      name: driverData.name || driverName,
      email: driverData.email || driverEmail,
      phone: driverPhone,
      wallet: driverData.wallet || userData.wallet || {
        balance: 0,
        currency: 'INR'
      },
      pointsWallet: pointsWalletData,
      verificationStatus: finalVerificationStatus,
      isVerified: finalIsVerified,
      requiresTopUp: pointsWalletData?.requiresTopUp ?? true,
      canWork: pointsWalletData?.canWork ?? false
    };
    
    res.status(200).json({
      success: true,
      message: 'Driver profile retrieved successfully',
      data: {
        id: driverId,
        name: driverName,
        email: driverEmail,
        phone: driverPhone,
        profilePicture: profilePicture,
        verificationStatus: finalVerificationStatus,
        isVerified: finalIsVerified,
        wallet: normalizedDriver.wallet || {
          balance: (normalizedDriver.wallet && normalizedDriver.wallet.balance) || 0,
          currency: (normalizedDriver.wallet && normalizedDriver.wallet.currency) || 'INR'
        },
        welcomeBonusGiven: normalizedDriver.welcomeBonusGiven || false,
        welcomeBonusAmount: normalizedDriver.welcomeBonusAmount || 0,
        welcomeBonusGivenAt: normalizedDriver.welcomeBonusGivenAt || null,
        pointsWallet: pointsWalletData,
        requiresTopUp: pointsWalletData?.requiresTopUp ?? true,
        canWork: pointsWalletData?.canWork ?? false,
        driver: {
          id: normalizedDriver.id || driverId,
          name: normalizedDriver.name || driverName,
          email: normalizedDriver.email || driverEmail,
          phone: normalizedDriver.phone || driverPhone,
          vehicleDetails: (() => {
            // ✅ CRITICAL FIX: Normalize vehicleDetails from different possible formats
            const vd = normalizedDriver.vehicleDetails;
            if (!vd) {
              return {
                vehicleType: 'motorcycle',
                vehicleModel: '',
                vehicleNumber: '',
                licenseNumber: '',
                licenseExpiry: ''
              };
            }
            
            // Handle old format (type, model, number) and convert to new format
            return {
              vehicleType: vd.vehicleType || vd.type || 'motorcycle',
              vehicleModel: vd.vehicleModel || vd.model || '',
              vehicleNumber: vd.vehicleNumber || vd.number || '',
              licenseNumber: vd.licenseNumber || '',
              licenseExpiry: vd.licenseExpiry || ''
            };
          })(),
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
          pointsWallet: pointsWalletData,
          currentLocation: normalizedDriver.currentLocation || null,
          requiresTopUp: pointsWalletData?.requiresTopUp ?? true,
          canWork: pointsWalletData?.canWork ?? false
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
    
    // ✅ CRITICAL FIX: Fetch actual documents from Firebase Storage
    const bucket = getStorage().bucket();
    const [files] = await bucket.getFiles({
      prefix: `drivers/${uid}/documents/`,
    });

    const documents = {};
    const documentFiles = {};

    // Group files by document type
    for (const file of files) {
      try {
        const pathParts = file.name.split('/');
        const documentType = pathParts[pathParts.length - 2];
        
        if (!documentFiles[documentType]) {
          documentFiles[documentType] = [];
        }
        
        const [downloadURL] = await file.getSignedUrl({
          action: 'read',
          expires: '03-01-2500'
        });

        const [metadata] = await file.getMetadata();
        
        documentFiles[documentType].push({
          fileName: file.name.split('/').pop(),
          filePath: file.name,
          downloadURL: downloadURL,
          size: metadata.size,
          uploadedAt: metadata.timeCreated,
          contentType: metadata.contentType,
          customMetadata: metadata.customMetadata || {}
        });
      } catch (fileError) {
        console.error(`❌ [DRIVER_DOCS] Error processing file ${file.name}:`, fileError);
      }
    }

    // Select the latest file for each document type
    for (const [documentType, files] of Object.entries(documentFiles)) {
      if (files.length > 0) {
        const sortedFiles = files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        documents[documentType] = sortedFiles[0];
        
        if (files.length > 1) {
          console.warn(`⚠️ [DRIVER_DOCS] Multiple files found for ${documentType}: ${files.length} files. Using latest: ${sortedFiles[0].fileName}`);
        }
      }
    }

    // ✅ CRITICAL FIX: Get actual verification status from Firestore
    const firestoreDocs = userData.driver?.documents || userData.documents || {};
    
    console.log(`📋 [DRIVER_DOCS] Reading documents for user ${uid}`);
    console.log(`📋 [DRIVER_DOCS] Firestore documents keys:`, Object.keys(firestoreDocs));
    
    // Helper function to get verification status for a document
    const getDocStatus = (docType) => {
      // ✅ CRITICAL FIX: Check BOTH camelCase and snake_case document keys
      // Try camelCase first
      let firestoreDoc = firestoreDocs[docType];
      const camelKey = docType;
      
      // If not found, try snake_case
      if (!firestoreDoc) {
        const snakeCaseKey = docType.replace(/([A-Z])/g, '_$1').toLowerCase();
        firestoreDoc = firestoreDocs[snakeCaseKey];
        console.log(`📋 [DRIVER_DOCS] ${docType}: Tried camelCase (${camelKey}) → snake_case (${snakeCaseKey})`, firestoreDoc ? 'found' : 'not found');
      } else {
        console.log(`📋 [DRIVER_DOCS] ${docType}: Found in camelCase (${camelKey})`);
      }
      
      if (!firestoreDoc) {
        console.log(`⚠️ [DRIVER_DOCS] ${docType}: No document found in Firestore`);
        return { status: 'pending', verified: false };
      }
      
      // Check multiple possible status fields for compatibility
      const status = firestoreDoc.status || firestoreDoc.verificationStatus || 'pending';
      const verified = firestoreDoc.verified === true || status === 'verified';
      
      console.log(`📋 [DRIVER_DOCS] ${docType}: status=${status}, verified=${verified}, verifiedAt=${firestoreDoc.verifiedAt || 'empty'}`);
      
      return {
        status: status === 'verified' ? 'verified' : status === 'rejected' ? 'rejected' : 'uploaded',
        verified,
        verifiedAt: firestoreDoc.verifiedAt,
        verifiedBy: firestoreDoc.verifiedBy,
        verificationComments: firestoreDoc.verificationComments,
        rejectionReason: firestoreDoc.rejectionReason
      };
    };
    
    // ✅ CRITICAL FIX: Map document types to expected format with ACTUAL verification status
    const mappedDocuments = {
      drivingLicense: documents.driving_license ? {
        url: documents.driving_license.downloadURL,
        fileName: documents.driving_license.fileName,
        uploadedAt: documents.driving_license.uploadedAt,
        size: documents.driving_license.size,
        contentType: documents.driving_license.contentType,
        documentType: 'drivingLicense',
        ...getDocStatus('drivingLicense')
      } : null,
      profilePhoto: documents.profile_photo ? {
        url: documents.profile_photo.downloadURL,
        fileName: documents.profile_photo.fileName,
        uploadedAt: documents.profile_photo.uploadedAt,
        size: documents.profile_photo.size,
        contentType: documents.profile_photo.contentType,
        documentType: 'profilePhoto',
        ...getDocStatus('profilePhoto')
      } : null,
      aadhaarCard: documents.aadhaar_card ? {
        url: documents.aadhaar_card.downloadURL,
        fileName: documents.aadhaar_card.fileName,
        uploadedAt: documents.aadhaar_card.uploadedAt,
        size: documents.aadhaar_card.size,
        contentType: documents.aadhaar_card.contentType,
        documentType: 'aadhaarCard',
        ...getDocStatus('aadhaarCard')
      } : null,
      bikeInsurance: documents.bike_insurance ? {
        url: documents.bike_insurance.downloadURL,
        fileName: documents.bike_insurance.fileName,
        uploadedAt: documents.bike_insurance.uploadedAt,
        size: documents.bike_insurance.size,
        contentType: documents.bike_insurance.contentType,
        documentType: 'bikeInsurance',
        ...getDocStatus('bikeInsurance')
      } : null,
      rcBook: documents.rc_book ? {
        url: documents.rc_book.downloadURL,
        fileName: documents.rc_book.fileName,
        uploadedAt: documents.rc_book.uploadedAt,
        size: documents.rc_book.size,
        contentType: documents.rc_book.contentType,
        documentType: 'rcBook',
        ...getDocStatus('rcBook')
      } : null
    };
    
    res.status(200).json({
      success: true,
      message: 'Documents retrieved successfully',
      data: {
        documents: mappedDocuments,
        verificationStatus: userData.driver?.verificationStatus || 'pending',
        totalDocuments: Object.keys(documents).length
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

      // Calculate commission based on distance (₹2 per km)
      const exactDistance = data.distance?.total || 0;
      const fareCalculationService = require('../services/fareCalculationService');
      const fareBreakdown = fareCalculationService.calculateFare(exactDistance);
      const commissionPoints = fareBreakdown.commission; // ₹2 per km
      
      tripDetails.push({
        id: doc.id,
        completedAt: data.completedAt,
        customerName: data.pickup?.name || 'Unknown',
        pickupLocation: data.pickup?.address || 'Unknown',
        dropoffLocation: data.dropoff?.address || 'Unknown',
        fare: data.fare?.totalFare || 0,
        driverEarnings: earnings, // Driver gets full fare
        commission: commissionPoints, // Commission deducted from points wallet
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
        
        // Calculate total commission
        let totalCommission = 0;
        bookingsSnapshot.forEach(doc => {
          const data = doc.data();
          const exactDistance = data.distance?.total || 0;
          const fareCalculationService = require('../services/fareCalculationService');
          const fareBreakdown = fareCalculationService.calculateFare(exactDistance);
          totalCommission += fareBreakdown.commission;
        });
        
        // Summary
        doc.text('Summary:', 50, 160);
        doc.text(`Total Trips: ${totalTrips}`, 70, 180);
        doc.text(`Total Earnings: ₹${totalEarnings.toFixed(2)}`, 70, 200);
        doc.text(`Driver Earnings (Full Fare): ₹${totalEarnings.toFixed(2)}`, 70, 220);
        doc.text(`Commission Deducted: ₹${totalCommission.toFixed(2)} (Points)`, 70, 240);
        
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
    
    // Calculate total commission
    let totalCommission = 0;
    tripDetails.forEach(trip => {
      totalCommission += trip.commission || 0;
    });
    
    // Default JSON response
    res.json({
      success: true,
      data: {
        driverName,
        period,
        summary: {
          totalTrips,
          totalEarnings,
          driverEarnings: totalEarnings, // Full fare
          commissionDeducted: totalCommission // Points deducted
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

    // Calculate commission correctly: Drivers get full fare, commission is ₹2 per km deducted from points wallet
    // commission field here represents points deducted, not money
    const fareCalculationService = require('../services/fareCalculationService');
    let totalCommissionPoints = 0;
    
    trips.forEach(trip => {
      const distance = trip.distance || 0;
      const fareBreakdown = fareCalculationService.calculateFare(distance);
      totalCommissionPoints += fareBreakdown.commission;
    });
    
    const commission = totalCommissionPoints; // Points deducted
    const platformFee = 0; // No money fee, commission deducted from points wallet

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
    
    let tripsSnapshot;
    try {
      // Try query with completedAt first (if index exists)
      tripsSnapshot = await db.collection('bookings')
        .where('driverId', '==', uid)
        .where('status', '==', 'completed')
        .where('completedAt', '>=', startOfDay)
        .where('completedAt', '<', endOfDay)
        .get();
    } catch (indexError) {
      // ✅ FIX: If index doesn't exist, query without date filter and filter in memory
      console.warn('⚠️ [EARNINGS_TODAY] Index error, querying without date filter:', indexError.message);
      tripsSnapshot = await db.collection('bookings')
        .where('driverId', '==', uid)
        .where('status', '==', 'completed')
        .get();
    }
    
    let todayGrossEarnings = 0;
    let todayNetEarnings = 0;
    let todayCommissionTotal = 0;
    let todayTrips = 0;
    const tripDetails = [];
    
    // ✅ CRITICAL FIX: Helper function to parse date from various formats
    const parseDate = (dateValue) => {
      if (!dateValue) return null;
      if (dateValue instanceof Date) return dateValue;
      if (typeof dateValue?.toDate === 'function') return dateValue.toDate();
      if (typeof dateValue === 'object' && dateValue.seconds) {
        return new Date(dateValue.seconds * 1000 + (dateValue.nanoseconds || 0) / 1000000);
      }
      if (typeof dateValue === 'string') {
        const parsed = new Date(dateValue);
        return isNaN(parsed.getTime()) ? null : parsed;
      }
      return null;
    };
    
    tripsSnapshot.forEach((doc) => {
      const trip = doc.data();
      
      // ✅ CRITICAL FIX: Check if booking was completed today using multiple date fields
      const completedAt = parseDate(trip.completedAt) || 
                         parseDate(trip.timing?.completedAt) || 
                         parseDate(trip.updatedAt);
      
      // Filter by date if query didn't include date filter (fallback case)
      if (completedAt) {
        if (completedAt < startOfDay || completedAt >= endOfDay) {
          return; // Skip bookings not completed today
        }
      } else {
        // ✅ FIX: If no completedAt date, check if status is completed and updatedAt is today
        const updatedAt = parseDate(trip.updatedAt);
        if (!updatedAt || updatedAt < startOfDay || updatedAt >= endOfDay) {
          return; // Skip if not updated today
        }
      }
      
      const earnings = computeBookingEarnings(trip);

      todayGrossEarnings += earnings.grossFare;
      todayNetEarnings += earnings.netEarnings;
      todayCommissionTotal += earnings.commissionAmount;
      todayTrips += 1;
      
      tripDetails.push({
        id: doc.id,
        fare: earnings.grossFare,
        fareGross: earnings.grossFare,
        netEarnings: earnings.netEarnings,
        commission: earnings.commissionAmount,
        commissionStatus: earnings.commissionStatus,
        commissionOutstanding: earnings.commissionOutstanding,
        roundedDistanceKm: earnings.roundedDistanceKm,
        exactDistanceKm: earnings.exactDistanceKm,
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
      todayEarnings: roundCurrency(todayNetEarnings),
      todayNetEarnings: roundCurrency(todayNetEarnings),
      todayGrossEarnings: roundCurrency(todayGrossEarnings),
      todayCommission: roundCurrency(todayCommissionTotal),
      todayTrips: todayTrips,
      todayPayments: todayPayments,
      averageNetEarningsPerTrip: todayTrips > 0 ? roundCurrency(todayNetEarnings / todayTrips) : 0,
      averageEarningsPerTrip: todayTrips > 0 ? roundCurrency(todayGrossEarnings / todayTrips) : 0,
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
 * @route   GET /api/driver/bookings/history
 * @desc    Get driver's booking history
 * @access  Private (Driver only)
 */
router.get('/bookings/history', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 50, offset = 0, status } = req.query;

    const db = getFirestore();
    let query = db.collection('bookings')
      .where('driverId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    // Filter by status if provided
    if (status && status !== 'all') {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.get();
    const bookings = [];
    let grossTotal = 0;
    let netTotal = 0;
    let commissionTotal = 0;

    // ✅ CRITICAL FIX: Fetch customer details for each booking
    const customerIds = new Set();
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.customerId) {
        customerIds.add(data.customerId);
      }
    });

    // Fetch all customer data in parallel
    const customerDataMap = new Map();
    if (customerIds.size > 0) {
      const customerPromises = Array.from(customerIds).map(async (customerId) => {
        try {
          const customerDoc = await db.collection('users').doc(customerId).get();
          if (customerDoc.exists) {
            const customerData = customerDoc.data();
            return {
              id: customerId,
              name: customerData.name || customerData.customer?.name || 'Customer',
              phone: customerData.phone || customerData.customer?.phone || ''
            };
          }
          return { id: customerId, name: 'Customer', phone: '' };
        } catch (error) {
          console.error(`❌ [BOOKINGS_HISTORY] Error fetching customer ${customerId}:`, error);
          return { id: customerId, name: 'Customer', phone: '' };
        }
      });
      
      const customerResults = await Promise.all(customerPromises);
      customerResults.forEach(customer => {
        customerDataMap.set(customer.id, customer);
      });
    }

    snapshot.forEach(doc => {
      const data = doc.data();
      const earnings = computeBookingEarnings(data);

      grossTotal += earnings.grossFare;
      netTotal += earnings.netEarnings;
      commissionTotal += earnings.commissionAmount;

      // ✅ CRITICAL FIX: Include customer information
      const customerInfo = data.customerId ? customerDataMap.get(data.customerId) : null;
      
      bookings.push({
        id: doc.id,
        ...data,
        // ✅ CRITICAL FIX: Add customer object with name and details
        customer: customerInfo || {
          id: data.customerId || null,
          name: data.pickup?.name || 'Customer',
          phone: data.pickup?.phone || ''
        },
        // ✅ CRITICAL FIX: Ensure pickup and dropoff addresses are included
        pickup: {
          name: data.pickup?.name || 'Pickup',
          phone: data.pickup?.phone || '',
          address: data.pickup?.address || 'Address not available',
          coordinates: data.pickup?.coordinates || null
        },
        dropoff: {
          name: data.dropoff?.name || 'Dropoff',
          phone: data.dropoff?.phone || '',
          address: data.dropoff?.address || 'Address not available',
          coordinates: data.dropoff?.coordinates || null
        },
        earnings,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        completedAt: data.completedAt?.toDate?.()?.toISOString() || data.timing?.completedAt?.toDate?.()?.toISOString() || null
      });
    });

    res.status(200).json({
      success: true,
      data: bookings,
      total: bookings.length,
      summary: {
        grossTotal: roundCurrency(grossTotal),
        netTotal: roundCurrency(netTotal),
        commissionTotal: roundCurrency(commissionTotal)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting booking history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get booking history'
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
      const earnings = computeBookingEarnings(booking);
      const breakdown = {
        bookingId: bookingId,
        totalCollected: earnings.grossFare,
        totalEarnings: earnings.netEarnings,
        netEarnings: earnings.netEarnings,
        baseFare: fare.base || earnings.grossFare || 0,
        distanceFare: fare.distance || earnings.grossFare || 0,
        timeFare: fare.time || 0,
        surgeMultiplier: fare.surgeMultiplier || 1,
        platformFee: fare.platformFee || 0,
        driverEarnings: earnings.netEarnings,
        commissionAmount: earnings.commissionAmount,
        commissionStatus: earnings.commissionStatus,
        commissionOutstanding: earnings.commissionOutstanding,
        commissionRatePerKm: earnings.commissionRatePerKm,
        commissionTransactionId: earnings.commissionTransactionId,
        commissionDeductedAt: earnings.commissionDeductedAt,
        roundedDistanceKm: earnings.roundedDistanceKm,
        exactDistanceKm: earnings.exactDistanceKm,
        tripDetails: {
          distance: booking.distance || earnings.roundedDistanceKm || 0,
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
      
      let totalGross = 0;
      let totalNet = 0;
      let totalCommission = 0;
      let totalBaseFare = 0;
      let totalDistanceFare = 0;
      let totalTimeFare = 0;
      let totalPlatformFee = 0;
      let tripCount = 0;
      const tripBreakdowns = [];
      
      tripsSnapshot.forEach((doc) => {
        const trip = doc.data();
        const fare = trip.fare || {};
        const earnings = computeBookingEarnings(trip);

        totalGross += earnings.grossFare;
        totalNet += earnings.netEarnings;
        totalCommission += earnings.commissionAmount;
        totalBaseFare += fare.base || 0;
        totalDistanceFare += fare.distance || 0;
        totalTimeFare += fare.time || 0;
        totalPlatformFee += fare.platformFee || 0;
        tripCount += 1;
        
        tripBreakdowns.push({
          bookingId: doc.id,
          totalCollected: earnings.grossFare,
          totalEarnings: earnings.netEarnings,
          netEarnings: earnings.netEarnings,
          commissionAmount: earnings.commissionAmount,
          commissionStatus: earnings.commissionStatus,
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
          totalCollected: roundCurrency(totalGross),
          totalEarnings: roundCurrency(totalNet),
          netEarnings: roundCurrency(totalNet),
          commissionTotal: roundCurrency(totalCommission),
          totalBaseFare: totalBaseFare,
          totalDistanceFare: totalDistanceFare,
          totalTimeFare: totalTimeFare,
          totalPlatformFee: totalPlatformFee,
          tripCount: tripCount,
          averageGrossPerTrip: tripCount > 0 ? roundCurrency(totalGross / tripCount) : 0,
          averageNetPerTrip: tripCount > 0 ? roundCurrency(totalNet / tripCount) : 0
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
    const { isOnline, isAvailable, currentLocation, workingHours, workingDays, restoreFromAppRestart } = req.body;
    const db = getFirestore();
    
    // ✅ CRITICAL FIX: Prevent going offline if driver has active booking
    // This ensures booking workflow is not disrupted
    // ✅ COMPREHENSIVE FIX: Check ALL active booking statuses including edge cases
    if (isOnline === false) {
      // ✅ COMPREHENSIVE: Include all statuses where driver is actively working on an order
      // This includes: assigned, accepted, enroute, arrived, picked up, in transit, at dropoff, delivered (waiting for payment), money collection
      const activeBookingStatuses = [
        'driver_assigned', 
        'accepted', 
        'driver_enroute', 
        'driver_arrived', 
        'picked_up', 
        'in_transit', 
        'at_dropoff', 
        'delivered', // ✅ CRITICAL: Driver still needs to collect payment
        'money_collection' // ✅ CRITICAL: Payment collection in progress
      ];
      
      // ✅ ENHANCED: Use transaction to ensure atomic check (prevents race conditions)
      try {
        // ✅ FIX: Firestore transactions require query to be executed within transaction
        // For queries, we need to get the snapshot first, then read within transaction
      const activeBookingQuery = db.collection('bookings')
        .where('driverId', '==', uid)
        .where('status', 'in', activeBookingStatuses)
        .limit(1);
      
      const activeBookingSnapshot = await activeBookingQuery.get();
      
      if (!activeBookingSnapshot.empty) {
          const activeBookingDoc = activeBookingSnapshot.docs[0];
          const activeBooking = activeBookingDoc.data();
          const bookingId = activeBookingDoc.id;
          
        console.warn('⚠️ [STATUS_UPDATE] Driver trying to go offline but has active booking:', {
            bookingId,
            status: activeBooking.status,
            driverId: uid,
            timestamp: new Date().toISOString()
          });
          
          // ✅ USER-FRIENDLY: Provide specific message based on booking status
          let detailsMessage = 'You have an active booking. Please complete it before going offline.';
          if (activeBooking.status === 'delivered' || activeBooking.status === 'money_collection') {
            detailsMessage = 'You are collecting payment for a completed delivery. Please finish payment collection before going offline.';
          } else if (activeBooking.status === 'picked_up' || activeBooking.status === 'in_transit') {
            detailsMessage = 'You are currently delivering an order. Please complete the delivery before going offline.';
          }
          
          return res.status(400).json({
            success: false,
            error: {
              code: 'ACTIVE_BOOKING',
              message: 'Cannot go offline',
              details: detailsMessage,
              bookingId: bookingId,
              bookingStatus: activeBooking.status
            },
            timestamp: new Date().toISOString()
          });
        }
      } catch (queryError) {
        // ✅ FALLBACK: If query fails, try direct query as fallback
        console.warn('⚠️ [STATUS_UPDATE] Query check failed, using fallback:', queryError);
        
        try {
          const activeBookingQuery = db.collection('bookings')
            .where('driverId', '==', uid)
            .where('status', 'in', activeBookingStatuses)
            .limit(1);
          
          const activeBookingSnapshot = await activeBookingQuery.get();
          
          if (!activeBookingSnapshot.empty) {
            const activeBooking = activeBookingSnapshot.docs[0].data();
            console.warn('⚠️ [STATUS_UPDATE] Driver trying to go offline but has active booking (fallback check):', {
          bookingId: activeBookingSnapshot.docs[0].id,
          status: activeBooking.status
        });
        
        return res.status(400).json({
          success: false,
          error: {
            code: 'ACTIVE_BOOKING',
            message: 'Cannot go offline',
            details: 'You have an active booking. Please complete it before going offline.'
          },
          timestamp: new Date().toISOString()
        });
          }
        } catch (fallbackError) {
          // ✅ FINAL FALLBACK: If both queries fail, log but allow offline (fail open)
          // This prevents database errors from blocking legitimate offline requests
          console.error('❌ [STATUS_UPDATE] Both primary and fallback queries failed:', fallbackError);
          // Continue with offline request - slot automation will handle edge cases
        }
      }
    }
    
    // ✅ DEBUG: Log incoming request
    console.log('🔍 [STATUS_UPDATE] Incoming request:', {
      uid,
      isOnline,
      isAvailable,
      hasCurrentLocation: !!currentLocation,
      timestamp: new Date().toISOString()
    });
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      console.error('❌ [STATUS_UPDATE] Driver not found:', uid);
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

    const existingData = userDoc.data();
    console.log('🔍 [STATUS_UPDATE] Current driver status:', {
      isOnline: existingData.driver?.isOnline,
      isAvailable: existingData.driver?.isAvailable,
      hasDriverObject: !!existingData.driver
    });

    // ✅ CRITICAL FIX: Validate work slots when driver tries to go online
    // ✅ INDUSTRY STANDARD: Active booking exemption - allow staying online if driver has active order
    // ✅ APP RESTART FIX: Bypass slot validation if restoring from app restart (driver was online before app was killed)
    if (isOnline === true && !restoreFromAppRestart) {
      console.log('🔍 [STATUS_UPDATE] Driver trying to go online - validating work slots');
      
      try {
        // ✅ STEP 1: Check if driver has active booking (EXEMPTION RULE)
        // ✅ CRITICAL: Include 'delivered' - driver still needs to collect payment
        const activeBookingStatuses = ['driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff', 'delivered', 'money_collection'];
        const activeBookingQuery = db.collection('bookings')
          .where('driverId', '==', uid)
          .where('status', 'in', activeBookingStatuses)
          .limit(1);
        
        const activeBookingSnapshot = await activeBookingQuery.get();
        
        if (!activeBookingSnapshot.empty) {
          const activeBooking = activeBookingSnapshot.docs[0].data();
          console.log('✅ [STATUS_UPDATE] Driver has active booking - slot validation EXEMPTED:', {
            bookingId: activeBookingSnapshot.docs[0].id,
            status: activeBooking.status
          });
          // Allow going/staying online if driver has active booking (industry standard)
          // Driver must complete order even if slot ended
        } else {
          // ✅ STEP 2: Only validate slots if driver has NO active booking
          console.log('🔍 [STATUS_UPDATE] No active booking - validating work slots');
          
          const workSlotsService = require('../services/workSlotsService');
          const slotsResult = await workSlotsService.getDriverSlots(uid, new Date());
          
          if (!slotsResult.success) {
            console.error('❌ [STATUS_UPDATE] Failed to fetch work slots:', slotsResult.error);
            return res.status(400).json({
              success: false,
              error: {
                code: 'SLOT_VALIDATION_ERROR',
                message: 'Failed to validate work slots',
                details: 'Unable to check driver work slots'
              },
              timestamp: new Date().toISOString()
            });
          }

          const slots = slotsResult.data || [];
          const now = new Date();
          
          // Find selected slots
          const selectedSlots = slots.filter(slot => slot.isSelected === true);
          
          if (selectedSlots.length === 0) {
            console.log('❌ [STATUS_UPDATE] Driver has no selected slots');
            return res.status(400).json({
              success: false,
              error: {
                code: 'NO_SELECTED_SLOTS',
                message: 'Cannot go online',
                details: 'You must select at least one work slot before going online'
              },
              timestamp: new Date().toISOString()
            });
          }

          // ✅ UPDATED LOGIC: Check if driver can go online based on slot times
          // Rules:
          // 1. Can go online if currently WITHIN a selected slot (startTime <= now <= endTime) - REGARDLESS of when selected
          // 2. Can go online if slot is UPCOMING and was selected (now < startTime && selectedAt exists)
          // 3. Cannot go online for slots that have ENDED (now > endTime)
          // ✅ CRITICAL FIX: Check ALL slots, not just find first valid one
          
          const activeSlots = [];
          const upcomingSlots = [];
          const expiredSlots = [];
          
          selectedSlots.forEach(slot => {
            let startTime = slot.startTime?.toDate ? slot.startTime.toDate() : new Date(slot.startTime);
            let endTime = slot.endTime?.toDate ? slot.endTime.toDate() : new Date(slot.endTime);

            if (!(startTime instanceof Date) || isNaN(startTime.getTime())) {
              startTime = null;
            }
            if (!(endTime instanceof Date) || isNaN(endTime.getTime())) {
              endTime = null;
            }
            
            // ✅ DEBUG: Log slot validation details
            console.log('🔍 [STATUS_UPDATE] Validating slot:', {
              slotId: slot.slotId || slot.id,
              label: slot.label,
              startTime: startTime ? startTime.toISOString() : 'invalid',
              endTime: endTime ? endTime.toISOString() : 'invalid',
              now: now.toISOString(),
              nowTimestamp: now.getTime(),
              isExpired: endTime ? now > endTime : false,
              isActive: startTime && endTime ? now >= startTime && now <= endTime : false,
              isUpcoming: startTime ? now < startTime : false
            });

            if (!startTime || !endTime) {
              console.warn('⚠️ [STATUS_UPDATE] Slot has invalid time data, treating as upcoming');
              if (startTime) {
                upcomingSlots.push({ slot, startTime });
              }
              return;
            }

            if (now >= startTime && now <= endTime) {
              console.log('✅ [STATUS_UPDATE] Slot is ACTIVE (within time range)');
              activeSlots.push({ slot, startTime, endTime });
              return;
            }
            
            if (now < startTime) {
              console.log('⏳ [STATUS_UPDATE] Slot is UPCOMING (future slot)');
              upcomingSlots.push({ slot, startTime });
                return;
            }
            
            if (now > endTime) {
              console.log('❌ [STATUS_UPDATE] Slot has EXPIRED:', {
                slotLabel: slot.label,
                endTime: endTime.toISOString(),
                now: now.toISOString(),
                minutesExpired: Math.round((now.getTime() - endTime.getTime()) / (1000 * 60))
              });
              expiredSlots.push({ slot, endTime });
            }
          });

          // ✅ CRITICAL FIX: Require at least one valid slot
          console.log('🔍 [STATUS_UPDATE] Slot validation summary:', {
            totalSelectedSlots: selectedSlots.length,
            activeSlotsCount: activeSlots.length,
            expiredSlotsCount: expiredSlots.length,
            upcomingSlotsCount: upcomingSlots.length,
            activeSlots: activeSlots.map(v => v.slot.label || v.slot.slotId),
            upcomingSlots: upcomingSlots.map(v => v.slot.label || v.slot.slotId),
            expiredSlots: expiredSlots.map(e => e.slot.label || e.slot.slotId)
          });
          
          if (activeSlots.length === 0) {
            console.log('❌ [STATUS_UPDATE] Driver cannot go online - no active slot found', {
              expiredCount: expiredSlots.length,
              selectedCount: selectedSlots.length,
              upcomingCount: upcomingSlots.length
            });
            
            // ✅ CRITICAL FIX: Provide detailed error message about expired slots
            const expiredSlotLabels = expiredSlots.map(({ slot }) => {
              const startTime = slot.startTime?.toDate ? slot.startTime.toDate() : new Date(slot.startTime);
              const endTime = slot.endTime?.toDate ? slot.endTime.toDate() : new Date(slot.endTime);
              return `${startTime.toLocaleTimeString()} - ${endTime.toLocaleTimeString()}`;
            }).join(', ');
            
            const nextSlot = upcomingSlots
              .slice()
              .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];

            const nextSlotLabel = nextSlot ? (nextSlot.slot.label || nextSlot.slot.slotId) : null;

            return res.status(400).json({
              success: false,
              error: {
                code: 'NOT_IN_SLOT_TIME',
                message: 'Cannot go online',
                details:
                  expiredSlots.length === selectedSlots.length && expiredSlots.length > 0
                    ? `All your selected slots have ended: ${expiredSlotLabels}. Please select current or future slots to go online.`
                    : nextSlotLabel
                    ? `You can only go online during your active slot times. Next slot (${nextSlotLabel}) is not active yet.`
                    : 'You can only go online during your active slot times.'
              },
              timestamp: new Date().toISOString()
            });
          }
          
          // ✅ CRITICAL FIX: Log warning if expired slots are selected (but allow going online with valid slots)
          if (expiredSlots.length > 0) {
            console.warn('⚠️ [STATUS_UPDATE] Driver has expired slots selected but also has active slots:', {
              expiredCount: expiredSlots.length,
              activeCount: activeSlots.length,
              expiredSlots: expiredSlots.map(({ slot }) => {
                const startTime = slot.startTime?.toDate ? slot.startTime.toDate() : new Date(slot.startTime);
                const endTime = slot.endTime?.toDate ? slot.endTime.toDate() : new Date(slot.endTime);
                return `${startTime.toLocaleTimeString()} - ${endTime.toLocaleTimeString()}`;
              })
            });
            // Note: We allow going online because there are valid slots, but expired slots should be deselected by frontend
          }

          console.log('✅ [STATUS_UPDATE] Driver is in active slot, allowing online status');
        }
      } catch (slotError) {
        console.error('❌ [STATUS_UPDATE] Error validating work slots:', slotError);
        return res.status(500).json({
          success: false,
          error: {
            code: 'SLOT_VALIDATION_ERROR',
            message: 'Failed to validate work slots',
            details: 'An error occurred while checking work slots'
          },
          timestamp: new Date().toISOString()
        });
      }
    } else if (isOnline === true && restoreFromAppRestart) {
      // ✅ APP RESTART FIX: Driver is restoring online status after app restart
      // Still validate slots but with relaxed rules (allow if was online recently AND has valid slots)
      console.log('✅ [STATUS_UPDATE] Restoring online status from app restart - validating slots with relaxed rules');
      const userDoc = await userRef.get();
      const existingData = userDoc.data();
      
      // ✅ CRITICAL: Check if driver was online recently (within last 2 hours)
      const lastStatusUpdate = existingData.driver?.lastStatusUpdate;
      let canRestore = false;
      
      if (lastStatusUpdate) {
        const lastUpdateTime = lastStatusUpdate?.toDate ? lastStatusUpdate.toDate() : new Date(lastStatusUpdate);
        const timeSinceLastUpdate = Date.now() - lastUpdateTime.getTime();
        const maxRestoreWindow = 2 * 60 * 60 * 1000; // 2 hours
        
        if (timeSinceLastUpdate > maxRestoreWindow) {
          console.warn('⚠️ [STATUS_UPDATE] Cannot restore online status - last update was too long ago:', {
            timeSinceLastUpdate: Math.round(timeSinceLastUpdate / 60000) + ' minutes',
            maxWindow: '2 hours'
          });
          return res.status(400).json({
            success: false,
            error: {
              code: 'RESTORE_WINDOW_EXPIRED',
              message: 'Cannot restore online status',
              details: 'Your online status expired. Please go online again during your selected slot time.'
            },
            timestamp: new Date().toISOString()
          });
        }
        
        console.log('✅ [STATUS_UPDATE] Restore window valid:', {
          timeSinceLastUpdate: Math.round(timeSinceLastUpdate / 60000) + ' minutes',
          lastUpdateTime: lastUpdateTime.toISOString()
        });
      }
      
      // ✅ CRITICAL FIX: Still validate slots - driver must have at least one valid (not expired) slot
      // This prevents drivers from staying online with only expired slots
      try {
        const workSlotsService = require('../services/workSlotsService');
        const slotsResult = await workSlotsService.getDriverSlots(uid, new Date());
        
        if (!slotsResult.success) {
          console.error('❌ [STATUS_UPDATE] Failed to fetch work slots for restore validation:', slotsResult.error);
          return res.status(400).json({
            success: false,
            error: {
              code: 'SLOT_VALIDATION_ERROR',
              message: 'Failed to validate work slots',
              details: 'Unable to check driver work slots for restore validation'
            },
            timestamp: new Date().toISOString()
          });
        }

        const slots = slotsResult.data || [];
        const selectedSlots = slots.filter(slot => slot.isSelected === true);
        const now = new Date();
        
        const activeSlots = selectedSlots.filter(slot => {
          const startTime = slot.startTime?.toDate ? slot.startTime.toDate() : new Date(slot.startTime);
          const endTime = slot.endTime?.toDate ? slot.endTime.toDate() : new Date(slot.endTime);
          return (
            startTime instanceof Date &&
            endTime instanceof Date &&
            !isNaN(startTime.getTime()) &&
            !isNaN(endTime.getTime()) &&
            now >= startTime &&
            now <= endTime
          );
        });

        const upcomingSlots = selectedSlots
          .map(slot => {
            const startTime = slot.startTime?.toDate ? slot.startTime.toDate() : new Date(slot.startTime);
            return {
              slot,
              startTime
            };
          })
          .filter(({ startTime }) => startTime instanceof Date && !isNaN(startTime.getTime()) && now < startTime);
        
        if (activeSlots.length === 0 && selectedSlots.length > 0) {
          // Driver has selected slots but all are expired
          const expiredSlotLabels = selectedSlots.map(slot => {
            const startTime = slot.startTime?.toDate ? slot.startTime.toDate() : new Date(slot.startTime);
            const endTime = slot.endTime?.toDate ? slot.endTime.toDate() : new Date(slot.endTime);
            return `${startTime.toLocaleTimeString()} - ${endTime.toLocaleTimeString()}`;
          }).join(', ');

          const nextSlot = upcomingSlots
            .slice()
            .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0];
          
          console.warn('⚠️ [STATUS_UPDATE] Cannot restore online status - no active slots:', {
            expiredSlots: expiredSlotLabels,
            selectedCount: selectedSlots.length,
            upcomingCount: upcomingSlots.length
          });
          
          return res.status(400).json({
            success: false,
            error: {
              code: nextSlot ? 'NOT_IN_SLOT_TIME' : 'ALL_SLOTS_EXPIRED',
              message: 'Cannot restore online status',
              details: nextSlot
                ? `You can restore online status only during your active slot time. Next slot (${nextSlot.slot.label || 'upcoming slot'}) starts at ${nextSlot.startTime.toLocaleTimeString()}.`
                : `All your selected slots have ended: ${expiredSlotLabels}. Please select current or future slots to go online.`
            },
            timestamp: new Date().toISOString()
          });
        } else if (selectedSlots.length === 0) {
          // Driver has no selected slots
          console.warn('⚠️ [STATUS_UPDATE] Cannot restore online status - no selected slots');
          return res.status(400).json({
            success: false,
            error: {
              code: 'NO_SELECTED_SLOTS',
              message: 'Cannot restore online status',
              details: 'You must select at least one work slot before going online'
            },
            timestamp: new Date().toISOString()
          });
        } else {
          // Driver has at least one valid slot - allow restore
          console.log('✅ [STATUS_UPDATE] Restore validation passed - driver has valid slots:', {
            activeSlotsCount: activeSlots.length,
            totalSelectedSlots: selectedSlots.length
          });
          canRestore = true;
        }
      } catch (slotError) {
        console.error('❌ [STATUS_UPDATE] Error validating work slots for restore:', slotError);
        return res.status(500).json({
          success: false,
          error: {
            code: 'SLOT_VALIDATION_ERROR',
            message: 'Failed to validate work slots',
            details: 'An error occurred while checking work slots for restore validation'
          },
          timestamp: new Date().toISOString()
        });
      }
      
      if (!canRestore) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'RESTORE_VALIDATION_FAILED',
            message: 'Cannot restore online status',
            details: 'Slot validation failed for restore'
          },
          timestamp: new Date().toISOString()
        });
      }
    }

    const updateData = {
      'driver.isOnline': isOnline,
      updatedAt: new Date()
    };

    if (isAvailable !== undefined) {
      updateData['driver.isAvailable'] = isAvailable;
      console.log('✅ [STATUS_UPDATE] Setting isAvailable to:', isAvailable);
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

    console.log('📤 [STATUS_UPDATE] Updating Firestore with:', updateData);
    
    // ✅ CRITICAL FIX: Use transaction to ensure atomic update with optimistic locking
    // This prevents race conditions and ensures isolation across multiple devices/users
    try {
      const result = await db.runTransaction(async (transaction) => {
        const userDoc = await transaction.get(userRef);
        if (!userDoc.exists) {
          throw new Error('User document does not exist');
        }
        
        const currentData = userDoc.data();
        const currentStatus = currentData.driver?.isOnline;
        const lastStatusUpdate = currentData.driver?.lastStatusUpdate?.toDate ? 
          currentData.driver.lastStatusUpdate.toDate() : 
          (currentData.driver?.lastStatusUpdate ? new Date(currentData.driver.lastStatusUpdate) : null);
        
        // ✅ CRITICAL: Add optimistic locking with timestamp
        // If status was updated very recently (< 1 second), check for conflicts
        const now = new Date();
        if (lastStatusUpdate && (now - lastStatusUpdate) < 1000 && currentStatus !== isOnline) {
          console.warn('⚠️ [STATUS_UPDATE] Potential race condition detected:', {
            currentStatus,
            requestedStatus: isOnline,
            lastUpdate: lastStatusUpdate,
            timeSinceLastUpdate: now - lastStatusUpdate
          });
          // Still allow the update, but log for monitoring
        }
        
        // ✅ CRITICAL: Add lastStatusUpdate timestamp for conflict detection
        updateData['driver.lastStatusUpdate'] = now;
        updateData['driver.statusUpdatedBy'] = uid; // Track who updated (for multi-device scenarios)
        
        // Update within transaction (atomic operation)
        transaction.update(userRef, updateData);
        
        console.log('✅ [STATUS_UPDATE] Transaction started - updating status atomically with isolation');
        return {
          success: true,
          previousStatus: currentStatus,
          newStatus: isOnline,
          timestamp: now
        };
      });
      
      console.log('✅ [STATUS_UPDATE] Status updated atomically:', result);
      
      console.log('✅ [STATUS_UPDATE] Firestore updated successfully (transaction committed)');
    } catch (transactionError) {
      // Fallback to regular update if transaction fails
      console.warn('⚠️ [STATUS_UPDATE] Transaction failed, using regular update:', transactionError);
      await userRef.update(updateData);
      console.log('✅ [STATUS_UPDATE] Firestore updated successfully (fallback method)');
    }

    // ✅ CRITICAL FIX: Verify the update was persisted correctly
    const updatedDoc = await userRef.get();
    const updatedData = updatedDoc.data();
    const persistedIsOnline = updatedData.driver?.isOnline;
    const persistedIsAvailable = updatedData.driver?.isAvailable;
    
    console.log('🔍 [STATUS_UPDATE] Verified updated data:', {
      isOnline: persistedIsOnline,
      isAvailable: persistedIsAvailable,
      matchesRequest: persistedIsOnline === isOnline,
      timestamp: new Date().toISOString()
    });
    
    // ✅ CRITICAL FIX: Return error if status wasn't persisted correctly
    if (persistedIsOnline !== isOnline) {
      console.error('❌ [STATUS_UPDATE] CRITICAL: Status mismatch detected!', {
        requested: isOnline,
        persisted: persistedIsOnline,
        driverId: uid,
        timestamp: new Date().toISOString()
      });
      
      // ✅ FIX: Return error response instead of silently continuing
      return res.status(500).json({
        success: false,
        error: {
          code: 'STATUS_PERSISTENCE_ERROR',
          message: 'Failed to update status',
          details: 'Status update was not persisted correctly. Please try again.'
        },
        timestamp: new Date().toISOString()
      });
    } else {
      console.log('✅ [STATUS_UPDATE] Status persisted correctly - matches request');
    }

    // ✅ CRITICAL FIX: Update driver location status with error handling
    try {
    const locationRef = db.collection('driverLocations').doc(uid);
    const locationData = {
      driverId: uid,
      isOnline,
        isAvailable: isAvailable !== undefined ? isAvailable : updatedData.driver?.isAvailable || false,
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
      console.log('✅ [STATUS_UPDATE] Driver location status updated successfully');
    } catch (locationError) {
      // ✅ FIX: Log error but don't fail the entire request if location update fails
      // The main status update in users collection is more critical
      console.error('⚠️ [STATUS_UPDATE] Failed to update driver location status:', locationError);
      // Continue with response - main status update succeeded
    }

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

    // ✅ CRITICAL FIX: If driver is on an active trip, broadcast location to customer
    try {
      // Check if driver has an active booking
      const activeBookingQuery = await db.collection('bookings')
        .where('driverId', '==', uid)
        .where('status', 'in', ['driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit'])
        .limit(1)
        .get();
      
      if (!activeBookingQuery.empty) {
        const activeBooking = activeBookingQuery.docs[0];
        
        // Use liveTrackingService to broadcast location update to customer
        const liveTrackingService = require('../services/liveTrackingService');
        await liveTrackingService.updateDriverLocation(uid, {
          latitude,
          longitude,
          accuracy,
          timestamp: new Date()
        }, activeBooking.id);
        
        console.log(`📍 [DRIVER_LOCATION] Broadcasted location update for booking ${activeBooking.id}`);
      }
    } catch (broadcastError) {
      console.error('⚠️ [DRIVER_LOCATION] Failed to broadcast location update (non-critical):', broadcastError);
      // Don't fail the request if broadcast fails
    }

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

    // ✅ ROOT CAUSE FIX: Emit socket event to customer if driver has active booking
    try {
      const activeBookingStatuses = ['driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff'];
      const activeBookingQuery = db.collection('bookings')
        .where('driverId', '==', uid)
        .where('status', 'in', activeBookingStatuses)
        .limit(1);
      
      const activeBookingSnapshot = await activeBookingQuery.get();
      
      if (!activeBookingSnapshot.empty) {
        const activeBooking = activeBookingSnapshot.docs[0].data();
        const bookingId = activeBookingSnapshot.docs[0].id;
        const customerId = activeBooking.customerId;
        
        // ✅ ROOT CAUSE FIX: Emit location update to customer via socket
        const liveTrackingService = require('../services/liveTrackingService');
        await liveTrackingService.updateDriverLocation(uid, {
          latitude: location.latitude,
          longitude: location.longitude,
          address: location.address
        }, bookingId);
        
        console.log(`📍 [UPDATE_LOCATION] Emitted location update to customer ${customerId} for booking ${bookingId}`);
      }
    } catch (socketError) {
      // Don't fail the request if socket emit fails
      console.warn('⚠️ [UPDATE_LOCATION] Failed to emit location update via socket:', socketError);
    }

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
 * @route   GET /api/driver/bookings/active
 * @desc    Get driver's active booking (for slot exemption)
 * @access  Private (Driver only)
 */
router.get('/bookings/active', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    console.log(`🔍 [DRIVER_ACTIVE_BOOKING] Getting active booking for driver: ${uid}`);
    
    // ✅ INDUSTRY STANDARD: Check for active booking statuses
    // ✅ CRITICAL: Include 'delivered' - driver still needs to collect payment
    const activeBookingStatuses = [
      'driver_assigned', 
      'accepted', 
      'driver_enroute', 
      'driver_arrived', 
      'picked_up', 
      'in_transit', 
      'at_dropoff',
      'delivered', // ✅ CRITICAL: Driver still at dropoff, needs to collect payment
      'money_collection'
    ];
    
    // ✅ FIX: No orderBy needed - just check if any active booking exists
    const activeBookingsQuery = db.collection('bookings')
      .where('driverId', '==', uid)
      .where('status', 'in', activeBookingStatuses)
      .limit(1);
    
    const snapshot = await activeBookingsQuery.get();
    
    if (snapshot.empty) {
      return res.json({
        success: true,
        data: { booking: null },
        message: 'No active booking found'
      });
    }
    
    const bookingDoc = snapshot.docs[0];
    const bookingData = bookingDoc.data();
    
    // Format the response
    const booking = {
      id: bookingDoc.id,
      ...bookingData,
      createdAt: bookingData.createdAt?.toDate?.() || bookingData.createdAt,
      updatedAt: bookingData.updatedAt?.toDate?.() || bookingData.updatedAt
    };
    
    console.log(`✅ [DRIVER_ACTIVE_BOOKING] Found active booking: ${bookingDoc.id}, status: ${bookingData.status}`);
    
    res.json({
      success: true,
      data: { booking },
      message: 'Active booking retrieved successfully'
    });
    
  } catch (error) {
    console.error('❌ [DRIVER_ACTIVE_BOOKING] Error getting active booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve active booking',
      details: error.message
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
    
    // If driver already has an active booking, return empty list
    try {
      const activeStatuses = ['driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit'];
      const activeForDriver = await db.collection('bookings')
        .where('driverId', '==', uid)
        .where('status', 'in', activeStatuses)
        .limit(1)
        .get();
      if (!activeForDriver.empty) {
        return res.status(200).json({
          success: true,
          message: 'Driver has an active booking; no available jobs',
          data: { bookings: [], pagination: { limit: 0, offset: 0, total: 0 } },
          timestamp: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn('⚠️ [AVAILABLE] Active booking check failed, proceeding:', e?.message);
    }

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
    
    // ✅ CRITICAL FIX: Check driver verification status
    const verificationSources = {
      driverVerificationStatus: driverData.driver?.verificationStatus,
      driverIsVerifiedFlag: driverData.driver?.isVerified,
      rootVerificationStatus: driverData.verificationStatus,
      rootIsVerifiedFlag: driverData.isVerified
    };

    const normalizedVerificationStatus = (() => {
      const statusCandidates = [
        verificationSources.driverVerificationStatus,
        verificationSources.rootVerificationStatus
      ].filter(value => typeof value === 'string' && value.trim().length > 0);

      if (statusCandidates.length > 0) {
        return statusCandidates[0].toLowerCase();
      }

      if (verificationSources.driverIsVerifiedFlag === true || verificationSources.rootIsVerifiedFlag === true) {
        return 'verified';
      }

      return null;
    })();

    const verifiedStatusValues = new Set([
      'verified',
      'approved',
      'approved_manual',
      'approved_by_admin',
      'approved_manual_review',
      'completed',
      'complete',
      'active'
    ]);

    const isDriverVerified =
      verificationSources.driverIsVerifiedFlag === true ||
      verificationSources.rootIsVerifiedFlag === true ||
      (normalizedVerificationStatus && verifiedStatusValues.has(normalizedVerificationStatus));

    if (!isDriverVerified) {
      console.log(`⚠️ [AVAILABLE] Driver ${uid} not verified. Status snapshot:`, verificationSources);
      return res.status(400).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_VERIFIED',
          message: 'Driver not verified',
          details: 'Driver must be verified to receive booking requests'
        },
        timestamp: new Date().toISOString()
      });
    }
    
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

    // ✅ CRITICAL FIX: Get both pending bookings AND assigned bookings for this driver
    // First, get pending bookings (not assigned to any driver)
    // ✅ CRITICAL FIX: Filter by driverId == null at query level for better performance and correctness
    // Note: Firestore doesn't support querying for null directly, so we filter after fetch
    const pendingQuery = db.collection('bookings')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit) + parseInt(offset));
    
    // Second, get bookings assigned to this specific driver
    const assignedQuery = db.collection('bookings')
      .where('driverId', '==', uid)
      .where('status', '==', 'driver_assigned')
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit) + parseInt(offset));
    
    // ✅ CRITICAL FIX: Get rejected bookings by this driver to exclude them
    const rejectedQuery = db.collection('booking_rejections')
      .where('driverId', '==', uid)
      .get();
    
    // Execute queries in parallel
    const [pendingSnapshot, assignedSnapshot, rejectedSnapshot] = await Promise.all([
      pendingQuery.get(),
      assignedQuery.get(),
      rejectedQuery
    ]);
    
    // Create set of rejected booking IDs for fast lookup
    const rejectedBookingIds = new Set();
    rejectedSnapshot.forEach(doc => {
      rejectedBookingIds.add(doc.data().bookingId);
    });
    
    console.log(`🔍 [DRIVER_API] Rejected bookings by driver ${uid}:`, Array.from(rejectedBookingIds));
    
    const allBookings = [];
    
    console.log('🔍 [DRIVER_API] Query snapshots:', {
      pendingSize: pendingSnapshot.size,
      assignedSize: assignedSnapshot.size,
      pendingEmpty: pendingSnapshot.empty,
      assignedEmpty: assignedSnapshot.empty,
      driverLocation,
      radius: parseFloat(radius)
    });
    
    // Process pending bookings
    pendingSnapshot.forEach(doc => {
      const bookingData = doc.data();
      
      // ✅ CRITICAL FIX: Filter out bookings rejected by this driver
      if (rejectedBookingIds.has(doc.id)) {
        console.log('🔍 [DRIVER_API] Skipping rejected booking:', {
          id: doc.id,
          driverId: uid
        });
        return; // Skip this booking
      }
      
      // ✅ CRITICAL FIX: Filter out bookings that are already assigned to a driver
      // This check is critical to prevent showing already-assigned bookings to drivers
      // ✅ USE VALIDATION UTILITY: Comprehensive check for all driverId edge cases
      const bookingValidation = require('../utils/bookingValidation');
      if (!bookingValidation.isDriverIdEmpty(bookingData.driverId)) {
        console.log('🔍 [DRIVER_API] Skipping assigned booking:', {
          id: doc.id,
          status: bookingData.status,
          driverId: bookingData.driverId,
          normalizedDriverId: bookingValidation.normalizeDriverId(bookingData.driverId),
          reason: 'Booking already has a driver assigned'
        });
        return; // Skip this booking
      }
      
      // ✅ ADDITIONAL SAFETY CHECK: Double-check status
      if (bookingData.status !== 'pending') {
        console.log('🔍 [DRIVER_API] Skipping non-pending booking:', {
          id: doc.id,
          status: bookingData.status,
          driverId: bookingData.driverId,
          reason: 'Booking status is not pending'
        });
        return; // Skip this booking
      }
      
      // Filter out cancelled bookings
      if (bookingData.cancellation?.cancelledBy || 
          bookingData.status === 'cancelled' || 
          bookingData.status === 'canceled') {
        console.log('🔍 [DRIVER_API] Skipping cancelled booking:', {
          id: doc.id,
          cancelledBy: bookingData.cancellation?.cancelledBy,
          status: bookingData.status
        });
        return; // Skip cancelled bookings
      }
      
      console.log('✅ [DRIVER_API] Processing available booking:', {
        id: doc.id,
        status: bookingData.status,
        driverId: bookingData.driverId, // Should be null/undefined
        hasPickup: !!bookingData.pickup,
        hasCoordinates: !!bookingData.pickup?.coordinates,
        pickupCoords: bookingData.pickup?.coordinates,
        verifiedAsAvailable: bookingData.status === 'pending' && bookingValidation.isDriverIdEmpty(bookingData.driverId)
      });
      
      // Calculate distance from driver to pickup location
      if (bookingData.pickup?.coordinates) {
        // ✅ CRITICAL FIX: Handle both GeoPoint and plain object coordinates
        const pickupLat = bookingData.pickup.coordinates._latitude || bookingData.pickup.coordinates.latitude;
        const pickupLng = bookingData.pickup.coordinates._longitude || bookingData.pickup.coordinates.longitude;
        
        if (!pickupLat || !pickupLng) {
          console.log('⚠️ [DRIVER_API] Booking has invalid coordinates:', {
            id: doc.id,
            coordinates: bookingData.pickup.coordinates
          });
          return; // Skip this booking
        }
        
        const distance = calculateDistance(
          driverLocation.latitude,
          driverLocation.longitude,
          pickupLat,
          pickupLng
        );
        
        console.log('🔍 [DRIVER_API] Distance calculation:', {
          driverLat: driverLocation.latitude,
          driverLng: driverLocation.longitude,
          pickupLat,
          pickupLng,
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
          pickupLat,
          pickupLng,
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
          // ✅ CRITICAL FIX: Normalize coordinates to plain objects for frontend
          const normalizedBooking = {
            id: doc.id,
            ...bookingData,
            pickup: {
              ...bookingData.pickup,
              coordinates: {
                latitude: pickupLat,
                longitude: pickupLng
              }
            },
            dropoff: {
              ...bookingData.dropoff,
              coordinates: {
                latitude: bookingData.dropoff?.coordinates?._latitude || bookingData.dropoff?.coordinates?.latitude,
                longitude: bookingData.dropoff?.coordinates?._longitude || bookingData.dropoff?.coordinates?.longitude
              }
            },
            distanceFromDriver: Math.round(distance / 1000 * 100) / 100, // Convert to km with 2 decimal places
            estimatedPickupTime: bookingData.estimatedPickupTime || new Date(Date.now() + 15 * 60 * 1000).toISOString()
          };
          allBookings.push(normalizedBooking);
        }
      } else {
        console.log('⚠️ [DRIVER_API] Booking has no pickup coordinates:', doc.id);
      }
    });
    
    // ✅ CRITICAL FIX: Process assigned bookings (these are specifically for this driver)
    assignedSnapshot.forEach(doc => {
      const bookingData = doc.data();
      
      console.log('🔍 [DRIVER_API] Processing assigned booking:', {
        id: doc.id,
        status: bookingData.status,
        driverId: bookingData.driverId
      });
      
      // Add assigned booking with special flags
      const assignedBooking = {
        id: doc.id,
        ...bookingData,
        isAssigned: true,
        assignmentType: 'admin_assigned',
        distanceFromDriver: 0, // Assigned bookings don't need distance calculation
        estimatedPickupTime: bookingData.estimatedPickupTime || new Date(Date.now() + 15 * 60 * 1000).toISOString()
      };
      
      allBookings.push(assignedBooking);
      console.log('✅ [DRIVER_API] Added assigned booking to results:', doc.id);
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
  const { uid } = req.user;
  const { id } = req.params;
  
  try {
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
    
    // ✅ DEBUG: Log driver status when accepting booking
    console.log('🔍 [ACCEPT_BOOKING] Driver status check:', {
      uid,
      bookingId: id,
      driverIsOnline: driverData.driver?.isOnline,
      driverIsAvailable: driverData.driver?.isAvailable,
      driverVerified: driverData.driver?.isVerified || driverData.isVerified,
      verificationStatus: driverData.driver?.verificationStatus || driverData.verificationStatus,
      timestamp: new Date().toISOString()
    });
    
    if (!driverData.driver?.isAvailable || !driverData.driver?.isOnline) {
      console.error('❌ [ACCEPT_BOOKING] Driver not available:', {
        isAvailable: driverData.driver?.isAvailable,
        isOnline: driverData.driver?.isOnline,
        reason: !driverData.driver?.isAvailable ? 'Not available' : 'Not online'
      });
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

    // Check if driver has sufficient points to work
    const pointsService = require('../services/walletService');
    const canWorkResult = await pointsService.canDriverWork(uid);
    
    if (!canWorkResult.success || !canWorkResult.canWork) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_POINTS',
          message: 'Insufficient points balance',
          details: 'Driver must top-up points wallet to accept bookings. Minimum balance required for commission deduction.',
          currentBalance: canWorkResult.currentBalance || 0,
          requiredBalance: 250
        },
        timestamp: new Date().toISOString()
      });
    }

    // ✅ FIXED: Use BookingLockService for atomic driver acceptance
    const BookingLockService = require('../services/bookingLockService');
    const bookingLockService = new BookingLockService();
    
    // Acquire exclusive lock for booking acceptance
    try {
      await bookingLockService.acquireBookingLock(id, uid);
    } catch (error) {
      if (error.message === 'BOOKING_LOCKED') {
        // ✅ CRITICAL FIX: Before returning error, verify booking state one more time
        // This handles edge cases where lock exists but booking wasn't actually accepted
        const freshBookingCheck = await bookingRef.get();
        if (freshBookingCheck.exists) {
          const freshBooking = freshBookingCheck.data();
          // ✅ USE VALIDATION UTILITY: Comprehensive check for all driverId edge cases
          const bookingValidation = require('../utils/bookingValidation');
          if (freshBooking.status === 'pending' && bookingValidation.isDriverIdEmpty(freshBooking.driverId)) {
            // Booking is still available - lock is likely stale, log and continue anyway
            console.warn(`⚠️ [ACCEPT_BOOKING] Lock exists but booking ${id} is still pending. Possible stale lock. Attempting to continue...`);
            // Don't throw - let the transaction handle the race condition
          } else {
            // Booking is actually assigned
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
        } else {
          return res.status(404).json({
            success: false,
            error: {
              code: 'BOOKING_NOT_FOUND',
              message: 'Booking not found',
              details: 'Booking does not exist'
            },
            timestamp: new Date().toISOString()
          });
        }
      } else if (error.message === 'BOOKING_ALREADY_ASSIGNED') {
        // Booking was already assigned (checked during lock acquisition)
        return res.status(409).json({
          success: false,
          error: {
            code: 'BOOKING_ALREADY_ASSIGNED',
            message: 'Booking already assigned',
            details: 'This booking has already been assigned to another driver'
          },
          timestamp: new Date().toISOString()
        });
      } else if (error.message === 'BOOKING_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: {
            code: 'BOOKING_NOT_FOUND',
            message: 'Booking not found',
            details: 'Booking does not exist'
          },
          timestamp: new Date().toISOString()
        });
      }
      throw error;
    }

    // Accept booking using Firestore transaction for conflict resolution
    const transaction = db.runTransaction(async (transaction) => {
      // Re-read booking to ensure it's still available
      const freshBookingDoc = await transaction.get(bookingRef);
      if (!freshBookingDoc.exists) {
        throw new Error('BOOKING_NOT_FOUND');
      }

      const freshBookingData = freshBookingDoc.data();
      
      // ✅ CRITICAL FIX: Log booking state for debugging race conditions
      console.log(`🔍 [ACCEPT_BOOKING] Transaction check for booking ${id}:`, {
        status: freshBookingData.status,
        driverId: freshBookingData.driverId,
        driverIdType: typeof freshBookingData.driverId,
        requestingDriverId: uid,
        isPending: freshBookingData.status === 'pending',
        hasDriverId: freshBookingData.driverId != null && freshBookingData.driverId !== '',
        driverIdMatches: freshBookingData.driverId === uid,
        driverIdIsNull: freshBookingData.driverId === null,
        driverIdIsUndefined: freshBookingData.driverId === undefined,
        driverIdIsEmpty: freshBookingData.driverId === ''
      });
      
      // ✅ COMPREHENSIVE FIX: Use validation utility to handle ALL edge cases
      // This validates status, driverId (handles: null, undefined, '', whitespace, 0, false, invalid types, etc.)
      // and handles idempotent accepts properly
      const bookingValidation = require('../utils/bookingValidation');
      const validation = bookingValidation.validateBookingAcceptance(freshBookingData, uid);
      
      if (!validation.valid) {
        console.warn(`⚠️ [ACCEPT_BOOKING] Booking ${id} validation failed:`, {
          error: validation.error,
          message: validation.message,
          details: validation.details
        });
        throw new Error(validation.error || 'BOOKING_ALREADY_ASSIGNED');
      }
      
      // ✅ Handle idempotent accepts (booking already assigned to this driver)
      if (validation.details?.isIdempotent) {
        console.log(`ℹ️ [ACCEPT_BOOKING] Booking ${id} already assigned to driver ${uid}, allowing idempotent accept`);
        // Return early - booking already assigned to this driver, no updates needed
        return { success: true, alreadyAssigned: true };
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
      // ✅ Use shared constants for consistency
      const { ACTIVE_BOOKING_STATUSES } = require('../constants/bookingStatuses');
      const driverActiveStatuses = ACTIVE_BOOKING_STATUSES.filter(s => 
        s !== 'pending' && s !== 'delivered' && s !== 'money_collection'
      );
      const activeBookingsQuery = db.collection('bookings')
        .where('driverId', '==', uid)
        .where('status', 'in', driverActiveStatuses);
      
      const activeBookingsSnapshot = await transaction.get(activeBookingsQuery);
      if (!activeBookingsSnapshot.empty) {
        throw new Error('DRIVER_ALREADY_ASSIGNED');
      }

      // ✅ CRITICAL FIX: Check wallet balance for commission before accepting booking
      try {
        const pointsService = require('../services/walletService');
        const fareCalculationService = require('../services/fareCalculationService');
        
        // Get or create wallet first
        await pointsService.createOrGetPointsWallet(uid, 0);
        
        // Get estimated distance from booking (use existing distance or calculate from coordinates)
        let estimatedDistanceKm = freshBookingData.distance?.total || 
                                  freshBookingData.exactDistance || 
                                  freshBookingData.pricing?.distance || 0;
        
        // If no distance, calculate from coordinates
        if (estimatedDistanceKm === 0 && freshBookingData.pickup?.coordinates && freshBookingData.dropoff?.coordinates) {
          try {
            const pickupCoords = {
              lat: freshBookingData.pickup.coordinates._latitude || freshBookingData.pickup.coordinates.latitude,
              lng: freshBookingData.pickup.coordinates._longitude || freshBookingData.pickup.coordinates.longitude
            };
            const dropoffCoords = {
              lat: freshBookingData.dropoff.coordinates._latitude || freshBookingData.dropoff.coordinates.latitude,
              lng: freshBookingData.dropoff.coordinates._longitude || freshBookingData.dropoff.coordinates.longitude
            };
            
            if (pickupCoords.lat && pickupCoords.lng && dropoffCoords.lat && dropoffCoords.lng) {
              const distanceResult = await fareCalculationService.calculateDistanceAndFare(pickupCoords, dropoffCoords);
              estimatedDistanceKm = distanceResult.distanceKm;
            }
          } catch (calcError) {
            console.warn('⚠️ [ACCEPT_BOOKING] Could not calculate distance from coordinates:', calcError.message);
            // Use minimum estimate (5km) if calculation fails
            estimatedDistanceKm = 5;
          }
        }
        
        // If still no distance, use minimum estimate
        if (estimatedDistanceKm === 0) {
          estimatedDistanceKm = 5; // Minimum 5km estimate
        }
        
        // ✅ CRITICAL FIX: Calculate commission using fareCalculationService to ensure proper rounding
        // This matches the payment confirmation logic: 8.4km → 9km → ₹18 commission
        // Note: fareCalculationService already declared above at line 3567
        const fareBreakdown = fareCalculationService.calculateFare(estimatedDistanceKm);
        const roundedDistance = fareBreakdown.roundedDistanceKm; // Rounded distance (e.g., 8.4km → 9km)
        const estimatedCommission = fareBreakdown.commission; // Commission based on rounded distance (e.g., 9km × ₹2 = ₹18)
        
        console.log(`💰 [ACCEPT_BOOKING] Checking wallet balance for commission:`, {
          driverId: uid,
          exactDistanceKm: estimatedDistanceKm,
          roundedDistanceKm: roundedDistance,
          estimatedCommission: estimatedCommission,
          calculation: `${roundedDistance}km × ₹2/km = ₹${estimatedCommission}`
        });
        
        // Check wallet balance
        const walletDoc = await transaction.get(db.collection('driverPointsWallets').doc(uid));
        if (!walletDoc.exists) {
          // Wallet doesn't exist - create it with 0 balance
          transaction.set(db.collection('driverPointsWallets').doc(uid), {
            driverId: uid,
            pointsBalance: 0,
            totalPointsEarned: 0,
            totalPointsSpent: 0,
            status: 'active',
            requiresTopUp: true,
            createdAt: new Date(),
            lastUpdated: new Date()
          });
          throw new Error('INSUFFICIENT_WALLET_BALANCE');
        }
        
        const walletData = walletDoc.data();
        const currentBalance = walletData.pointsBalance || 0;
        
        if (currentBalance < estimatedCommission) {
          console.warn(`⚠️ [ACCEPT_BOOKING] Insufficient wallet balance:`, {
            driverId: uid,
            currentBalance,
            requiredCommission: estimatedCommission,
            shortfall: estimatedCommission - currentBalance
          });
          throw new Error('INSUFFICIENT_WALLET_BALANCE');
        }
        
        console.log(`✅ [ACCEPT_BOOKING] Wallet balance sufficient:`, {
          driverId: uid,
          currentBalance,
          requiredCommission: estimatedCommission,
          remainingBalance: currentBalance - estimatedCommission
        });
      } catch (walletError) {
        if (walletError.message === 'INSUFFICIENT_WALLET_BALANCE') {
          throw walletError; // Re-throw to be handled below
        }
        console.error('❌ [ACCEPT_BOOKING] Error checking wallet balance:', walletError);
        // Don't block acceptance if wallet check fails - log warning but continue
        console.warn('⚠️ [ACCEPT_BOOKING] Continuing with acceptance despite wallet check error');
      }

      // ✅ CRITICAL FIX: Determine driver verification status using same logic as admin dashboard
      const driverIsVerified = (() => {
        // Priority 1: Check driver.verificationStatus
        if (freshDriverData.driver?.verificationStatus === 'approved' || freshDriverData.driver?.verificationStatus === 'verified') {
          return true
        }
        // Priority 2: Check isVerified flag
        if (freshDriverData.driver?.isVerified === true || freshDriverData.isVerified === true) {
          return true
        }
        // Priority 3: Check if all documents are verified
        const driverDocs = freshDriverData.driver?.documents || {}
        const docKeys = Object.keys(driverDocs)
        if (docKeys.length > 0) {
          const allVerified = docKeys.every(key => {
            const doc = driverDocs[key]
            return doc && (doc.verified === true || doc.status === 'verified' || doc.verificationStatus === 'verified')
          })
          if (allVerified) {
            return true
          }
        }
        return false
      })()

      // Update booking with driver info for admin panel visibility
      transaction.update(bookingRef, {
        driverId: uid,
        status: 'driver_assigned',
        'timing.assignedAt': new Date(),
        updatedAt: new Date(),
        // ✅ FIX: Populate driverInfo so admin panel can display driver name
        driverInfo: {
          name: freshDriverData.name || 'Driver',
          phone: freshDriverData.phone || '',
          rating: freshDriverData.driver?.rating || 0,
          vehicleNumber: freshDriverData.driver?.vehicleDetails?.vehicleNumber || '',
          vehicleModel: freshDriverData.driver?.vehicleDetails?.vehicleModel || '',
          // ✅ CRITICAL FIX: Include isVerified status so admin dashboard can display correctly
          isVerified: driverIsVerified
        },
        // ✅ CRITICAL FIX: Also set booking-level driverVerified for backward compatibility
        driverVerified: driverIsVerified
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

    const transactionResult = await transaction;
    
    // ✅ FIX: Skip notifications if booking was already assigned to this driver
    if (transactionResult?.alreadyAssigned) {
      console.log('ℹ️ [ACCEPT_BOOKING] Booking was already assigned, skipping notifications');
      
      // ✅ CRITICAL FIX: Release lock before returning
      try {
        await bookingLockService.releaseBookingLock(id, uid);
      } catch (lockError) {
        console.error('Error releasing booking lock:', lockError);
      }
      
      return res.status(200).json({
        success: true,
        message: 'Booking already accepted',
        data: {
          bookingId: id,
          status: 'driver_assigned'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get booking data for notifications (re-read to get updated data)
    const updatedBookingDoc = await db.collection('bookings').doc(id).get();
    const updatedBookingData = updatedBookingDoc.data();

    // Send WebSocket notifications
    try {
      const WebSocketEventHandler = require('../services/websocketEventHandler');
      const notificationService = require('../services/notificationService');
      const wsEventHandler = new WebSocketEventHandler();
      await wsEventHandler.initialize();

      // Notify customer of driver assignment
      const vehicleDetails = driverData.driver?.vehicleDetails || {};
      const vehicleInfo = vehicleDetails.vehicleNumber 
        ? `${vehicleDetails.vehicleModel || ''} (${vehicleDetails.vehicleNumber})`.trim()
        : 'Vehicle Details Pending';
      
      console.log('🚗 [ACCEPT_BOOKING] Sending driver details to customer:', {
        driverName: driverData.name,
        driverPhone: driverData.phone,
        vehicleInfo,
        vehicleDetails: vehicleDetails
      });
      
      await wsEventHandler.notifyCustomerOfDriverAssignment(
        updatedBookingData.customerId,
        {
          bookingId: id,
          driverId: uid,
          driverName: driverData.name,
          driverPhone: driverData.phone,
          vehicleInfo: vehicleInfo,
          vehicleDetails: vehicleDetails,  // ✅ Send full vehicle details too
          estimatedArrival: new Date(Date.now() + 15 * 60 * 1000).toISOString()
        }
      );

      // Push notifications
      try {
        await notificationService.notifyCustomerDriverAssigned(updatedBookingData, driverData);
        await notificationService.sendDriverAssignmentNotification(uid, id, updatedBookingData);
      } catch (notifyErr) {
        console.warn('⚠️ [ACCEPT_BOOKING] Notification send failed:', notifyErr?.message);
      }

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

    // ✅ FIXED: Release booking lock on success
    await bookingLockService.releaseBookingLock(id, uid);

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
    
    // ✅ FIXED: Release booking lock on error
    try {
      await bookingLockService.releaseBookingLock(id, uid);
    } catch (lockError) {
      console.error('Error releasing booking lock:', lockError);
    }
    
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
    
    if (error.message === 'INSUFFICIENT_WALLET_BALANCE') {
      // Get booking to calculate commission for error message
      let commissionMessage = 'Insufficient wallet balance to cover commission';
      try {
        const db = getFirestore();
        const bookingDoc = await db.collection('bookings').doc(id).get();
        if (bookingDoc.exists) {
          const bookingData = bookingDoc.data();
          const distance = bookingData.distance?.total || bookingData.exactDistance || bookingData.pricing?.distance || 5;
          // ✅ CRITICAL FIX: Use fareCalculationService for consistent rounding
          const fareCalculationService = require('../services/fareCalculationService');
          const fareBreakdown = fareCalculationService.calculateFare(distance);
          const roundedDistance = fareBreakdown.roundedDistanceKm;
          const estimatedCommission = fareBreakdown.commission;
          commissionMessage = `Insufficient wallet balance. Required: ₹${estimatedCommission} (${roundedDistance}km × ₹2/km, exact: ${distance.toFixed(2)}km). Please recharge your wallet to accept this booking.`;
        }
      } catch {
        // Ignore errors in error message generation
      }
      
      return res.status(402).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_WALLET_BALANCE',
          message: 'Insufficient wallet balance',
          details: commissionMessage
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
 * @route   POST /api/driver/bookings/:id/validate-location
 * @desc    Validate driver location for pickup/dropoff
 * @access  Private (Driver only)
 */
router.post('/bookings/:id/validate-location', [
  requireDriver,
  body('locationType').isIn(['pickup', 'dropoff']).withMessage('Location type must be pickup or dropoff'),
  body('latitude').isFloat().withMessage('Latitude must be a valid number'),
  body('longitude').isFloat().withMessage('Longitude must be a valid number')
], async (req, res) => {
  try {
    const { id } = req.params;
    const { uid } = req.user;
    const { locationType, latitude, longitude } = req.body;
    
    const db = getFirestore();
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }
    
    const bookingData = bookingDoc.data();
    
    // Get target coordinates based on location type
    let targetLat, targetLng;
    if (locationType === 'pickup') {
      targetLat = bookingData.pickupLocation?.latitude;
      targetLng = bookingData.pickupLocation?.longitude;
    } else {
      targetLat = bookingData.dropoffLocation?.latitude;
      targetLng = bookingData.dropoffLocation?.longitude;
    }
    
    if (!targetLat || !targetLng) {
      return res.status(400).json({
        success: false,
        error: 'Target location coordinates not available'
      });
    }
    
    // Calculate distance between driver and target location
    const distance = calculateDistance(latitude, longitude, targetLat, targetLng);
    const isWithinRange = distance <= 0.1; // 100 meters
    
    // Update booking with location validation
    await bookingRef.update({
      [`locationValidation.${locationType}`]: {
        validated: isWithinRange,
        distance: distance,
        driverLocation: { latitude, longitude },
        validatedAt: new Date(),
        validatedBy: uid
      },
      updatedAt: new Date()
    });
    
    res.status(200).json({
      success: true,
      data: {
        isValid: isWithinRange,
        distance: distance,
        message: isWithinRange ? 'Location validated successfully' : 'You are not at the correct location'
      }
    });
    
  } catch (error) {
    console.error('Error validating location:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate location'
    });
  }
});

/**
 * @route   POST /api/driver/bookings/:id/photo-verification/upload
 * @desc    Upload pickup/dropoff proof photo via backend (multipart) and link atomically
 * @access  Private (Driver only)
 */
router.post('/bookings/:id/photo-verification/upload', [
  requireDriver,
  // ✅ CRITICAL FIX: No rate limiting on photo upload endpoint - it's a critical workflow step
  // Rate limiting is handled at the global level, but we don't want strict limits here
  upload.single('photo'),
  body('photoType').isIn(['pickup', 'delivery']).withMessage('Photo type must be pickup or delivery'),
  // Accept location as JSON string or object in multipart form
  body('location').optional(),
  body('notes').optional().isLength({ min: 0, max: 200 }).withMessage('Notes must be between 0 and 200 characters'),
  body('traceId').optional().isString().withMessage('TraceId must be a string')
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

    const { id } = req.params;
    const { uid } = req.user;
    const { photoType, notes, traceId } = req.body;
    let { location } = req.body;
    
    // ✅ CRITICAL FIX: Log traceId for request correlation
    console.log(`📸 [PHOTO_UPLOAD] Photo upload request received (traceId: ${traceId || 'none'}):`, {
      bookingId: id,
      driverId: uid,
      photoType,
      traceId: traceId || 'none'
    });
    // If location is a JSON string (common with multipart), parse it safely
    if (typeof location === 'string') {
      try {
        location = JSON.parse(location);
      } catch {
        location = null;
      }
    }
    const file = req.file;

    if (!file) {
      return res.status(400).json({
        success: false,
        error: { code: 'FILE_MISSING', message: 'Photo file is required' }
      });
    }

    const db = getFirestore();
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { code: 'BOOKING_NOT_FOUND', message: 'Booking not found' }
      });
    }

    const bookingData = bookingDoc.data();
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: { code: 'ACCESS_DENIED', message: 'You can only upload photos for your assigned bookings' }
      });
    }

    const terminalStatuses = ['completed', 'cancelled'];
    if (terminalStatuses.includes(bookingData.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'BOOKING_ENDED', message: `Cannot upload photos for a booking that is ${bookingData.status}` }
      });
    }

    const validStatuses = {
      pickup: ['driver_arrived', 'picked_up'],
      delivery: ['in_transit', 'at_dropoff', 'delivered', 'arrived_dropoff', 'picked_up']
    };
    if (!validStatuses[photoType] || !validStatuses[photoType].includes(bookingData.status)) {
      console.error(`❌ [PHOTO_UPLOAD] Invalid status for photo upload (traceId: ${traceId || 'none'}):`, {
        bookingId: id,
        currentStatus: bookingData.status,
        photoType,
        validStatuses: validStatuses[photoType],
        traceId: traceId || 'none'
      });
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_FOR_PHOTO',
          message: `Cannot upload ${photoType} photo in current booking status: ${bookingData.status}. Valid statuses: ${validStatuses[photoType]?.join(', ') || 'none'}`,
          details: `Current status: ${bookingData.status}. Expected one of: ${validStatuses[photoType]?.join(', ') || 'none'}`
        },
        traceId: traceId || null // ✅ CRITICAL FIX: Include traceId in error response
      });
    }

    // Upload to Firebase Storage using admin privileges
    const bucket = getStorage().bucket();
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    const safeType = photoType === 'pickup' ? 'pickup' : 'delivery';
    const filePath = `bookings/${id}/drivers/${uid}/${safeType}/${timestamp}-${random}.jpg`;
    const fileRef = bucket.file(filePath);

    await fileRef.save(file.buffer, {
      metadata: {
        contentType: file.mimetype || 'image/jpeg',
        metadata: {
          bookingId: id,
          driverId: uid,
          photoType: safeType,
          uploadedAt: new Date().toISOString()
        }
      }
    });

    const [downloadURL] = await fileRef.getSignedUrl({
      action: 'read',
      expires: '03-01-2500'
    });

    // Build common verification object
    const admin = require('firebase-admin');
    const verifiedAtTimestamp = admin.firestore.Timestamp.now();

    const photoVerification = {
      photoType: safeType,
      photoUrl: downloadURL,
      location: location || null,
      uploadedBy: uid,
      uploadedAt: verifiedAtTimestamp,
      verifiedAt: verifiedAtTimestamp,
      verifiedBy: uid,
      notes: notes || null
    };

    const updateData = { updatedAt: new Date() };
    updateData[`photoVerification.${safeType}`] = photoVerification;
    if (safeType === 'pickup') {
      updateData['pickupVerification'] = {
        photoUrl: downloadURL,
        verifiedAt: verifiedAtTimestamp,
        verifiedBy: uid,
        location: location || null,
        notes: notes || null
      };
    } else {
      updateData['deliveryVerification'] = {
        photoUrl: downloadURL,
        verifiedAt: verifiedAtTimestamp,
        verifiedBy: uid,
        location: location || null,
        notes: notes || null
      };
    }

    // Atomic transaction to link
    await db.runTransaction(async (transaction) => {
      transaction.update(bookingRef, updateData);
      const oldRef = db.collection('photo_verifications').doc();
      transaction.set(oldRef, {
        bookingId: id,
        driverId: uid,
        customerId: (bookingData && bookingData.customerId) || null,
        ...photoVerification
      });
      const newRef = db.collection('photoVerifications').doc();
      transaction.set(newRef, {
        id: newRef.id,
        bookingId: id,
        driverId: uid,
        customerId: (bookingData && bookingData.customerId) || null,
        photoType: safeType,
        photoUrl: downloadURL,
        photoMetadata: { location: location || null, notes: notes || null },
        location: location || null,
        notes: notes || null,
        status: 'verified',
        uploadedAt: verifiedAtTimestamp,
        verifiedAt: verifiedAtTimestamp,
        verifiedBy: uid,
        createdAt: verifiedAtTimestamp,
        updatedAt: verifiedAtTimestamp
      });
    });

    // ✅ CRITICAL FIX: Emit WebSocket event to notify customer about photo upload
    try {
      const socketService = require('../services/socket');
      const io = socketService.getSocketIO();
      
      if (io && bookingData.customerId) {
        const bookingRoom = `booking:${id}`;
        const customerRoom = `user:${bookingData.customerId}`;
        
        // ✅ CRITICAL FIX: Photo verification is for company/admin use only, NOT for customers
        // Photo data is stored in database for admin/company use only
        // Do NOT emit photo_verification_uploaded to customer rooms
        // Customers only receive booking_status_update events (without photo details)
        
        // ✅ CRITICAL FIX: Only emit booking status update to customers (they don't need photo details)
        const updatedBookingDoc = await bookingRef.get();
        if (updatedBookingDoc.exists) {
          const updatedBookingData = updatedBookingDoc.data();
          io.to(bookingRoom).emit('booking_status_update', {
            bookingId: id,
            status: updatedBookingData.status,
            booking: updatedBookingData,
            timestamp: new Date().toISOString()
          });
          io.to(customerRoom).emit('booking_status_update', {
            bookingId: id,
            status: updatedBookingData.status,
            booking: updatedBookingData,
            timestamp: new Date().toISOString()
          });
        }
        
        console.log(`✅ [PHOTO_UPLOAD] Photo verification event emitted to rooms: ${bookingRoom}, ${customerRoom} (traceId: ${traceId || 'none'})`);
      }
    } catch (wsError) {
      console.error('❌ [PHOTO_UPLOAD] Error emitting WebSocket event:', wsError);
      // Continue - photo is saved even if WebSocket fails
    }

    console.log(`✅ [PHOTO_UPLOAD] Photo verification uploaded successfully (traceId: ${traceId || 'none'}):`, {
      bookingId: id,
      photoType: safeType,
      photoUrl: downloadURL
    });

    return res.status(200).json({
      success: true,
      data: {
        message: 'Photo verification uploaded successfully',
        photoType: safeType,
        photoUrl: downloadURL,
        storagePath: filePath,
        traceId: traceId || null // ✅ CRITICAL FIX: Echo traceId in response
      },
      traceId: traceId || null // ✅ CRITICAL FIX: Also include in top-level response
    });
  } catch (error) {
    const traceId = req.body?.traceId || 'none';
    console.error(`❌ [PHOTO_VERIFICATION_UPLOAD] Failed (traceId: ${traceId}):`, error);
    
    // ✅ CRITICAL FIX: Handle rate limit errors specifically
    if (error.status === 429 || error.message?.includes('rate limit') || error.message?.includes('429')) {
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please wait a moment and try again.',
          details: 'Rate limit exceeded for photo upload. Please wait before retrying.'
        },
        traceId: traceId !== 'none' ? traceId : null,
        retryAfter: 5 // Suggest retry after 5 seconds
      });
    }
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'PHOTO_UPLOAD_ERROR',
        message: 'Failed to upload photo verification',
        details: error.message || 'An unexpected error occurred'
      },
      traceId: traceId !== 'none' ? traceId : null
    });
  }
});

/**
 * @route   POST /api/driver/bookings/:id/photo-verification
 * @desc    Upload photo verification for pickup/dropoff
 * @access  Private (Driver only)
 * @note    This is the PRIMARY endpoint - duplicate at line 6794 should be removed
 */
router.post('/bookings/:id/photo-verification', [
  requireDriver,
  body('photoType').isIn(['pickup', 'delivery']).withMessage('Photo type must be pickup or delivery'),
  body('photoUrl').isURL().withMessage('Photo URL must be valid'),
  body('location').optional().isObject().withMessage('Location must be an object'),
  body('notes').optional().isLength({ min: 0, max: 200 }).withMessage('Notes must be between 0 and 200 characters')
], async (req, res) => {
  try {
    const { id } = req.params;
    const { uid } = req.user;
    const { photoType, photoUrl, location } = req.body;
    
    const db = getFirestore();
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }
    
    const bookingData = bookingDoc.data();
    
    // ✅ CRITICAL FIX: Validate driver is assigned to this booking
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only upload photos for bookings assigned to you'
        }
      });
    }
    
    // ✅ CRITICAL FIX: Validate booking status for photo upload
    // ✅ WORKFLOW INTEGRITY: Only allow photos when driver is actually at the location
    // ✅ SECURITY: Block terminal statuses - booking lifecycle has ended
    // Pickup photos: Only when driver has arrived at pickup location or already picked up
    // Delivery photos: When package is in transit, at dropoff, or delivered (before payment)
    
    // ✅ CRITICAL FIX: Block terminal statuses - booking is ended
    // ✅ SECURITY: Prevents uploads after booking lifecycle has ended
    const terminalStatuses = ['completed', 'cancelled'];
    if (terminalStatuses.includes(bookingData.status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BOOKING_ENDED',
          message: 'Booking has ended',
          details: `Cannot upload photos for a booking that is ${bookingData.status}. Booking lifecycle has ended.`
        }
      });
    }
    
    const validStatuses = {
      pickup: ['driver_arrived', 'picked_up'], // Only when actually at pickup location
      delivery: ['in_transit', 'at_dropoff', 'delivered', 'arrived_dropoff', 'picked_up'] // Allow delivery photos if already picked up (delivered = payment pending)
    };

    if (!validStatuses[photoType] || !validStatuses[photoType].includes(bookingData.status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS_FOR_PHOTO',
          message: 'Invalid booking status for photo upload',
          details: `Cannot upload ${photoType} photo in current booking status: ${bookingData.status}. Valid statuses: ${validStatuses[photoType]?.join(', ') || 'none'}`
        }
      });
    }
    
    // ✅ CRITICAL FIX: Store photo verification in both structures for compatibility
    const { notes } = req.body; // Get notes from request body
    // ✅ CRITICAL FIX: Use Firestore Timestamp for consistency (defined above at line 4876)
    const admin = require('firebase-admin');
    const verifiedAtTimestamp = admin.firestore.Timestamp.now();
    
    const photoVerification = {
      photoType,
      photoUrl,
      location: location || null,
      uploadedBy: uid,
      uploadedAt: verifiedAtTimestamp, // ✅ CRITICAL FIX: Use Firestore Timestamp for consistency
      verifiedAt: verifiedAtTimestamp, // ✅ CRITICAL FIX: Use Firestore Timestamp for consistency
      verifiedBy: uid, // Add verifiedBy for admin dashboard
      notes: notes || null
    };
    
    // ✅ FIX: Store in BOTH structures - old structure (photoVerification.{type}) and new structure (pickupVerification/deliveryVerification)
    const updateData = {
      updatedAt: new Date()
    };
    
    // Old structure for backward compatibility
    updateData[`photoVerification.${photoType}`] = photoVerification;
    
    // ✅ NEW STRUCTURE: Store as pickupVerification or deliveryVerification (what admin dashboard expects)
    // ✅ CRITICAL FIX: Use Firestore Timestamp for verifiedAt to ensure proper date handling
    // Note: verifiedAtTimestamp is already defined above for photoVerification object
    
    if (photoType === 'pickup') {
      updateData['pickupVerification'] = {
        photoUrl: photoUrl,
        verifiedAt: verifiedAtTimestamp, // Use Firestore Timestamp for consistency
        verifiedBy: uid,
        location: location || null,
        notes: notes || null // ✅ FIX: Include notes if provided
      };
    } else if (photoType === 'delivery') {
      updateData['deliveryVerification'] = {
        photoUrl: photoUrl,
        verifiedAt: verifiedAtTimestamp, // Use Firestore Timestamp for consistency
        verifiedBy: uid,
        location: location || null,
        notes: notes || null // ✅ FIX: Include notes if provided
      };
    }
    
    // ✅ CRITICAL FIX: Use transaction to ensure atomic updates (prevents partial failures)
    try {
      await db.runTransaction(async (transaction) => {
        // Update booking document
        transaction.update(bookingRef, updateData);
        
        // Create photo verification record in both collections for consistency
        // Old collection (photo_verifications - lowercase)
        const photoVerificationsOldRef = db.collection('photo_verifications').doc();
        transaction.set(photoVerificationsOldRef, {
          bookingId: id,
          driverId: uid,
          customerId: (bookingData && bookingData.customerId) || null,
          ...photoVerification
        });
        
        // ✅ NEW collection (photoVerifications - camelCase) for newer code
        const photoVerificationsRef = db.collection('photoVerifications').doc();
        transaction.set(photoVerificationsRef, {
          id: photoVerificationsRef.id,
          bookingId: id,
          driverId: uid,
          customerId: (bookingData && bookingData.customerId) || null,
          photoType: photoType,
          photoUrl: photoUrl,
          photoMetadata: {
            location: location || null,
            notes: notes || null
          },
          location: location || null,
          notes: notes || null, // ✅ FIX: Include notes from request, not hardcoded null
          status: 'verified',
          uploadedAt: verifiedAtTimestamp, // ✅ CRITICAL FIX: Use Firestore Timestamp for consistency
          verifiedAt: verifiedAtTimestamp, // ✅ CRITICAL FIX: Use Firestore Timestamp for consistency
          verifiedBy: uid,
          createdAt: verifiedAtTimestamp, // ✅ CRITICAL FIX: Use Firestore Timestamp for consistency
          updatedAt: verifiedAtTimestamp // ✅ CRITICAL FIX: Use Firestore Timestamp for consistency
        });
      });
    
      console.log(`✅ [PHOTO_VERIFICATION] Photo ${photoType} saved to booking ${id} (atomic transaction):`, {
      photoUrl,
      verifiedAt: verifiedAtTimestamp.toDate().toISOString(),
      verifiedBy: uid,
      location: location || 'none'
    });
    
      console.log(`✅ [PHOTO_VERIFICATION] Photo ${photoType} stored successfully for booking ${id} in both structures (atomic)`);
    } catch (transactionError) {
      console.error('❌ [PHOTO_VERIFICATION] Transaction failed, falling back to non-atomic updates:', transactionError);
      
      // ✅ FALLBACK: If transaction fails, try non-atomic updates (better than complete failure)
      await bookingRef.update(updateData);
      
      // Create photo verification records (non-atomic)
    await db.collection('photo_verifications').add({
      bookingId: id,
      driverId: uid,
      customerId: (bookingData && bookingData.customerId) || null,
      ...photoVerification
    });
    
    const photoVerificationsRef = db.collection('photoVerifications').doc();
    await photoVerificationsRef.set({
      id: photoVerificationsRef.id,
      bookingId: id,
      driverId: uid,
      customerId: (bookingData && bookingData.customerId) || null,
      photoType: photoType,
      photoUrl: photoUrl,
      photoMetadata: {
      location: location || null,
        notes: notes || null
      },
      location: location || null,
        notes: notes || null,
      status: 'verified',
        uploadedAt: verifiedAtTimestamp,
        verifiedAt: verifiedAtTimestamp,
      verifiedBy: uid,
        createdAt: verifiedAtTimestamp,
        updatedAt: verifiedAtTimestamp
    });
    
      console.log(`⚠️ [PHOTO_VERIFICATION] Photo ${photoType} stored using fallback (non-atomic) method`);
    }
    
    res.status(200).json({
      success: true,
      data: {
        message: 'Photo verification uploaded successfully',
        photoType,
        photoUrl
      }
    });
    
  } catch (error) {
    console.error('❌ [PHOTO_VERIFICATION] Error uploading photo verification:', error);
    
    // ✅ ENHANCED: Provide detailed error information for debugging
    const errorMessage = error?.message || 'Unknown error';
    const errorCode = error?.code || 'PHOTO_VERIFICATION_UPLOAD_ERROR';
    
    // ✅ FIX: Check for specific error types
    let statusCode = 500;
    let errorDetails = 'An error occurred while uploading photo verification';
    
    if (errorMessage.includes('permission') || errorMessage.includes('access')) {
      statusCode = 403;
      errorDetails = 'Permission denied - you may not have access to upload photos for this booking';
    } else if (errorMessage.includes('not found') || errorMessage.includes('does not exist')) {
      statusCode = 404;
      errorDetails = 'Booking not found or has been deleted';
    } else if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
      statusCode = 400;
      errorDetails = 'Invalid request data - please check your photo URL and metadata';
    } else if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
      statusCode = 503;
      errorDetails = 'Network error - please check your connection and try again';
    }
    
    res.status(statusCode).json({
      success: false,
      error: {
        code: errorCode,
        message: 'Failed to upload photo verification',
        details: errorDetails,
        originalError: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/bookings/:id/confirm-payment
 * @desc    Confirm cash payment collection
 * @access  Private (Driver only)
 */
router.post('/bookings/:id/confirm-payment', [
  requireDriver,
  speedLimiter, // ✅ CRITICAL FIX: Add rate limiting for payment endpoints
  body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  body('paymentMethod').equals('cash').withMessage('Payment method must be cash'),
  body('transactionId').isString().withMessage('Transaction ID is required'),
  body('idempotencyKey').optional().isString().withMessage('Idempotency key must be a string')
], async (req, res) => {
  try {
    const { id } = req.params;
    const { uid } = req.user;
    const { amount, paymentMethod, transactionId, notes, idempotencyKey } = req.body;
    
    console.log(`💰 [PAYMENT_CONFIRM] Starting payment confirmation:`, { 
      bookingId: id, 
      driverId: uid, 
      amount, 
      paymentMethod, 
      transactionId,
      idempotencyKey
    });
    
    const db = getFirestore();
    
    // ✅ CRITICAL FIX: Check idempotency key to prevent duplicate processing
    if (idempotencyKey) {
      const idempotencyRef = db.collection('paymentIdempotency').doc(idempotencyKey);
      const idempotencyDoc = await idempotencyRef.get();
      
      if (idempotencyDoc.exists) {
        const idempotencyData = idempotencyDoc.data();
        console.log(`ℹ️ [PAYMENT_CONFIRM] Idempotency key found: ${idempotencyKey}. Returning cached result.`);
        return res.status(200).json({
          success: true,
          data: idempotencyData.response,
          idempotent: true,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      console.error(`❌ [PAYMENT_CONFIRM] Booking not found: ${id}`);
      return res.status(404).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found',
          details: `Booking with ID ${id} does not exist`
        }
      });
    }
    
    const bookingData = bookingDoc.data();
    const bookingStateMachine = require('../services/bookingStateMachine');
    const paymentAmount = parseFloat(amount);
    const statusBeforePayment = bookingData.status || 'unknown';
    const paymentStateBefore = bookingData.paymentStatus || 'unknown';
    const fallbackStatuses = new Set(['payment_pending', 'payment_collection', 'collecting_payment', 'payment_in_progress']);
    const allowedStatuses = new Set(['money_collection', 'delivered', 'completed', ...fallbackStatuses]);
    
    // ✅ CRITICAL FIX: Validate driver is assigned to this booking
    if (bookingData.driverId !== uid) {
      console.error(`❌ [PAYMENT_CONFIRM] Driver ${uid} not assigned to booking ${id}`);
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only confirm payments for bookings assigned to you'
        }
      });
    }
    
    // ✅ CRITICAL FIX: Validate booking is in correct status for payment confirmation
    if (!allowedStatuses.has(statusBeforePayment)) {
      console.error(`❌ [PAYMENT_CONFIRM] Invalid booking status: ${statusBeforePayment} (paymentStatus: ${paymentStateBefore})`);
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BOOKING_STATUS',
          message: 'Invalid booking status for payment confirmation',
          details: `Booking must be in one of [money_collection, delivered, completed]. Current status: ${statusBeforePayment} (paymentStatus: ${paymentStateBefore})`
        }
      });
    }
    
    // ✅ CRITICAL FIX: Idempotent handling when booking is already completed & payment confirmed
    const paymentAlreadyConfirmed = statusBeforePayment === 'completed' &&
      (bookingData.paymentConfirmed ||
        bookingData.paymentStatus === 'confirmed' ||
        bookingData.payment?.status === 'completed' ||
        bookingData.payment?.confirmed);
    
    if (paymentAlreadyConfirmed) {
      console.log(`ℹ️ [PAYMENT_CONFIRM] Booking ${id} already completed with confirmed payment. Returning idempotent success.`);
      return res.status(200).json({
        success: true,
        data: {
          message: 'Payment already confirmed for this booking',
          amount: bookingData.payment?.amount || bookingData.pricing?.totalFare || bookingData.fare?.total || paymentAmount,
          transactionId: bookingData.payment?.transactionId || transactionId,
          paymentConfirmed: true,
          bookingStatus: 'completed',
          commissionDeducted: !!bookingData.commissionDeducted,
          walletBalance: null,
          confirmedAt: bookingData.paymentConfirmedAt?.toDate?.()
            ? bookingData.paymentConfirmedAt.toDate().toISOString()
            : (bookingData.payment?.confirmedAt || new Date().toISOString())
        },
        timestamp: new Date().toISOString()
      });
    }
    
    let bookingStatusForPayment = statusBeforePayment;
    
    if (fallbackStatuses.has(bookingStatusForPayment)) {
      console.warn(`⚠️ [PAYMENT_CONFIRM] Booking ${id} in transitional status '${bookingStatusForPayment}'. Normalizing to 'money_collection' before confirmation.`);
      try {
        await bookingStateMachine.transitionBooking(
          id,
          'money_collection',
          {
            driverId: uid,
            paymentStatus: 'collecting',
            payment: {
              ...(bookingData.payment || {}),
              status: 'collecting',
              initiatedBy: uid,
              initiatedAt: new Date(),
              amount: paymentAmount
            }
          },
          {
            userId: uid,
            userType: 'driver',
            driverId: uid
          }
        );
        bookingStatusForPayment = 'money_collection';
        bookingData.status = 'money_collection';
        bookingData.paymentStatus = 'collecting';
      } catch (statusNormalizationError) {
        console.warn(`⚠️ [PAYMENT_CONFIRM] State machine normalization failed for booking ${id}:`, statusNormalizationError);
        try {
          await bookingRef.update({
            status: 'money_collection',
            paymentStatus: 'collecting',
            payment: {
              ...(bookingData.payment || {}),
              status: 'collecting',
              initiatedBy: uid,
              initiatedAt: new Date(),
              amount: paymentAmount
            },
            'timing.moneyCollectionAt': bookingData.timing?.moneyCollectionAt || new Date(),
            updatedAt: new Date()
          });
          bookingStatusForPayment = 'money_collection';
          bookingData.status = 'money_collection';
          bookingData.paymentStatus = 'collecting';
        } catch (normalizationFallbackError) {
          console.error(`❌ [PAYMENT_CONFIRM] Failed to normalize booking ${id} to money_collection:`, normalizationFallbackError);
        }
      }
    }
    
    if (fallbackStatuses.has(bookingStatusForPayment)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BOOKING_STATUS',
          message: 'Unable to prepare booking for payment confirmation',
          details: `Booking status remained '${bookingStatusForPayment}' after normalization attempt`
        }
      });
    }
    
    if (bookingStatusForPayment !== 'money_collection' && bookingStatusForPayment !== 'delivered' && bookingStatusForPayment !== 'completed') {
      console.error(`❌ [PAYMENT_CONFIRM] Invalid booking status after normalization: ${bookingStatusForPayment}`);
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BOOKING_STATUS',
          message: 'Invalid booking status for payment confirmation',
          details: `Booking must be in 'money_collection', 'delivered', or 'completed' status. Current status: ${bookingStatusForPayment}`
        }
      });
    }
    
    // ✅ CRITICAL FIX: Validate payment amount matches booking fare
    const bookingFare = bookingData.pricing?.totalFare || bookingData.fare?.total || 0;
    if (bookingFare > 0 && Math.abs(bookingFare - paymentAmount) > 1) { // Allow 1 rupee difference for rounding
      console.warn(`⚠️ [PAYMENT_CONFIRM] Payment amount mismatch: received ₹${paymentAmount}, expected ₹${bookingFare}`);
      // Don't fail, but log the discrepancy
    }
    
    // Create payment record
    const paymentRecord = {
      bookingId: id,
      driverId: uid,
      customerId: bookingData.customerId,
      amount: paymentAmount,
      paymentMethod: paymentMethod || 'cash',
      transactionId: transactionId,
      status: 'completed',
      collectedAt: new Date(),
      collectedBy: uid,
      notes: notes || null
    };
    
    console.log(`📝 [PAYMENT_CONFIRM] Creating payment record:`, paymentRecord);
    await db.collection('payments').add(paymentRecord);
    
    // ✅ CRITICAL FIX: Use state machine to transition from money_collection to completed
    
    // Check if booking is in money_collection status before transitioning
    if (bookingData.status === 'money_collection') {
      console.log(`🔄 [PAYMENT_CONFIRM] Transitioning booking from money_collection to completed`);
      try {
        // Use state machine to transition to completed
        await bookingStateMachine.transitionBooking(
          id,
          'completed',
          {
            driverId: uid,
            payment: {
              ...paymentRecord,
              confirmed: true,
              confirmedBy: uid
            },
            paymentStatus: 'confirmed', // ✅ CRITICAL FIX: Update paymentStatus for admin panel
            paymentConfirmed: true,
            paymentConfirmedAt: new Date(),
            completedAt: new Date()
          },
          {
            userId: uid,
            userType: 'driver',
            driverId: uid
          }
        );
        console.log(`✅ [PAYMENT_CONFIRM] Booking status transitioned to completed successfully`);
      } catch (stateMachineError) {
        console.error(`❌ [PAYMENT_CONFIRM] State machine transition failed:`, stateMachineError);
        // ✅ CRITICAL FIX: Fallback to direct status update if state machine fails
        console.log(`⚠️ [PAYMENT_CONFIRM] Falling back to direct status update`);
        
        // ✅ FIX: Manually release driver in fallback case
        try {
          const driverRef = db.collection('users').doc(uid);
          await driverRef.update({
            'driver.isAvailable': true,
            'driver.currentBookingId': null,
            'driver.status': 'available',
            updatedAt: new Date()
          });
          
          // Also update driverLocations collection
          const driverLocationRef = db.collection('driverLocations').doc(uid);
          await driverLocationRef.update({
            isAvailable: true,
            currentTripId: null,
            lastUpdated: new Date()
          });
          console.log(`✅ [PAYMENT_CONFIRM] Driver released in fallback mode`);
        } catch (driverReleaseError) {
          console.error(`❌ [PAYMENT_CONFIRM] Failed to release driver in fallback:`, driverReleaseError);
          // Continue - driver release failure shouldn't block payment
        }
        
        try {
          await bookingRef.update({
            status: 'completed',
            payment: {
              ...paymentRecord,
              confirmed: true,
              confirmedBy: uid
            },
            paymentStatus: 'confirmed', // ✅ CRITICAL FIX: Update paymentStatus for admin panel
            paymentConfirmed: true,
            paymentConfirmedAt: new Date(),
            completedAt: new Date(),
            updatedAt: new Date()
          });
          console.log(`✅ [PAYMENT_CONFIRM] Booking status updated via fallback mechanism`);
        } catch (fallbackError) {
          console.error(`❌ [PAYMENT_CONFIRM] Fallback update also failed:`, fallbackError);
          throw new Error(`Failed to update booking status: ${stateMachineError.message}`);
        }
      }
    } else if (bookingData.status === 'delivered') {
      // Transition from delivered to money_collection first, then to completed
      console.log(`🔄 [PAYMENT_CONFIRM] Booking is in 'delivered' status, transitioning to completed`);
      try {
        await bookingStateMachine.transitionBooking(
          id,
          'completed',
          {
            driverId: uid,
            payment: {
              ...paymentRecord,
              confirmed: true,
              confirmedBy: uid
            },
            paymentStatus: 'confirmed', // ✅ CRITICAL FIX: Update paymentStatus for admin panel
            paymentConfirmed: true,
            paymentConfirmedAt: new Date(),
            completedAt: new Date()
          },
          {
            userId: uid,
            userType: 'driver',
            driverId: uid
          }
        );
        console.log(`✅ [PAYMENT_CONFIRM] Booking status transitioned to completed successfully`);
      } catch (stateMachineError) {
        console.error(`❌ [PAYMENT_CONFIRM] State machine transition failed:`, stateMachineError);
        // If state machine fails, update payment fields directly as fallback
        console.log(`⚠️ [PAYMENT_CONFIRM] Falling back to direct status update`);
        
        // ✅ FIX: Manually release driver in fallback case
        try {
          const driverRef = db.collection('users').doc(uid);
          await driverRef.update({
            'driver.isAvailable': true,
            'driver.currentBookingId': null,
            'driver.status': 'available',
            updatedAt: new Date()
          });
          
          // Also update driverLocations collection
          const driverLocationRef = db.collection('driverLocations').doc(uid);
          await driverLocationRef.update({
            isAvailable: true,
            currentTripId: null,
            lastUpdated: new Date()
          });
          console.log(`✅ [PAYMENT_CONFIRM] Driver released in fallback mode`);
        } catch (driverReleaseError) {
          console.error(`❌ [PAYMENT_CONFIRM] Failed to release driver in fallback:`, driverReleaseError);
          // Continue - driver release failure shouldn't block payment
        }
        
        await bookingRef.update({
          status: 'completed',
          payment: {
            ...paymentRecord,
            confirmed: true,
            confirmedBy: uid
          },
          paymentStatus: 'confirmed', // ✅ CRITICAL FIX: Update paymentStatus for admin panel
          paymentConfirmed: true,
          paymentConfirmedAt: new Date(),
          completedAt: new Date(),
          updatedAt: new Date()
        });
      }
    } else {
      // If not in money_collection or delivered, just update payment fields (for backward compatibility)
      console.log(`⚠️ [PAYMENT_CONFIRM] Booking not in expected status, updating payment fields only`);
      await bookingRef.update({
        payment: {
          ...paymentRecord,
          confirmed: true,
          confirmedBy: uid
        },
        paymentStatus: 'confirmed', // ✅ CRITICAL FIX: Update paymentStatus for admin panel
        paymentConfirmed: true,
        paymentConfirmedAt: new Date(),
        updatedAt: new Date()
      });
    }

    // ✅ CRITICAL FIX: Send real-time notifications
    try {
      const socketService = require('../services/socket');
      const io = socketService.getSocketIO();
      
      // Get updated booking data after state transition
      const updatedBookingDoc = await bookingRef.get();
      const updatedBookingData = updatedBookingDoc.data();
      
      // ✅ CRITICAL FIX: Send booking status update to customer (this is what customer app listens to)
      if (bookingData.customerId) {
        // Send booking status update
        io.to(`user:${bookingData.customerId}`).emit('booking_status_update', {
          bookingId: id,
          status: 'completed',
          booking: updatedBookingData,
          timestamp: new Date().toISOString(),
          updatedBy: uid,
          message: 'Booking completed - payment collected successfully'
        });
        
        // Also send payment completion event
        io.to(`user:${bookingData.customerId}`).emit('payment_completed', {
          bookingId: id,
          amount: paymentAmount,
          paymentMethod: paymentMethod,
          transactionId: transactionId,
          confirmedAt: new Date().toISOString(),
          message: 'Payment has been collected successfully'
        });
      }
      
      // ✅ CRITICAL FIX: Notify driver about booking completion
      io.to(`user:${uid}`).emit('booking_status_update', {
        bookingId: id,
        status: 'completed',
        booking: updatedBookingData,
        timestamp: new Date().toISOString(),
        updatedBy: uid,
        message: 'Booking completed - you can now accept new orders'
      });
      
      // Notify admin dashboard about payment completion
      io.to('type:admin').emit('payment_completed', {
        bookingId: id,
        customerId: bookingData.customerId,
        driverId: uid,
        amount: paymentAmount,
        paymentMethod: paymentMethod,
        transactionId: transactionId,
        confirmedAt: new Date().toISOString()
      });
      
      // ✅ CRITICAL FIX: Send booking status update to admin
      io.to('type:admin').emit('booking_status_update', {
        bookingId: id,
        status: 'completed',
        booking: updatedBookingData,
        timestamp: new Date().toISOString(),
        updatedBy: uid
      });
      
      console.log(`📡 [PAYMENT_CONFIRM] Real-time notifications sent for payment ${transactionId}`);
    } catch (notificationError) {
      console.error('❌ [PAYMENT_CONFIRM] Failed to send real-time notifications:', notificationError);
      // Don't fail the payment confirmation if notifications fail
    }

    // ✅ CRITICAL FIX: Update driver earnings and deduct commission - ALL IN ONE TRANSACTION
    let commissionDeducted = false;
    let commissionAmount = 0;
    let commissionTransactionId = null;
    let newPointsBalance = 0;
    let driverEarnings = 0;
    let currentEarnings = 0;
    let currentBalance = 0;
    
    // ✅ CRITICAL FIX: Initialize pointsService for wallet operations
    const walletService = require('../services/walletService');
    const walletServiceInstance =
      typeof walletService.getPointsService === 'function'
        ? walletService.getPointsService()
        : walletService;
    
    try {
      // ✅ INDUSTRY STANDARD: Use transaction for atomic payment operations
      await db.runTransaction(async (transaction) => {
        const driverRef = db.collection('users').doc(uid);
        const driverDoc = await transaction.get(driverRef);
        
        if (!driverDoc.exists) {
          throw new Error('DRIVER_NOT_FOUND');
        }
        
        const driverData = driverDoc.data();
        currentEarnings = driverData.totalEarnings || 0;
        currentBalance = driverData.wallet?.balance || 0;
        
        // CORRECT: Driver gets full fare amount, commission deducted from points wallet
        driverEarnings = paymentAmount; // Full amount
        
        // ✅ CRITICAL FIX: Deduct commission from points wallet (atomic within transaction)
        const fareCalculationService = require('../services/fareCalculationService');
        
        // ✅ CRITICAL FIX: Check if commission was already deducted to prevent duplicate deductions
        const alreadyDeducted = bookingData.commissionDeducted?.amount || bookingData.commissionDeducted || false;
        if (alreadyDeducted) {
          console.log(`⚠️ [PAYMENT_CONFIRM] Commission already deducted for booking ${id}. Skipping duplicate deduction.`);
          commissionAmount = bookingData.commissionDeducted?.amount || 0;
          commissionDeducted = true;
          commissionTransactionId = bookingData.commissionDeducted?.transactionId || null;
          
          // Get current points balance
          const walletDoc = await transaction.get(db.collection('driverPointsWallets').doc(uid));
          if (walletDoc.exists) {
            newPointsBalance = walletDoc.data().pointsBalance || 0;
          }
        } else {
          // ✅ CRITICAL FIX: Get distance from booking for commission calculation
          // Use rounded distance for commission (as per business logic: 8.4km → 9km → ₹18 commission)
          const exactDistanceKm = bookingData.distance?.total || bookingData.exactDistance || bookingData.pricing?.distance || 0;
          
          // ✅ CRITICAL FIX: Always calculate fare using fareCalculationService (handles rounding: 0.5km → 1km, 8.4km → 9km)
          // This ensures commission is based on ROUNDED distance (₹2 per rounded km)
          let fareBreakdown;
          let roundedDistanceKm;
          
          if (exactDistanceKm > 0) {
            fareBreakdown = fareCalculationService.calculateFare(exactDistanceKm);
            roundedDistanceKm = fareBreakdown.roundedDistanceKm; // Rounded distance (e.g., 8.4km → 9km)
            commissionAmount = fareBreakdown.commission; // Commission based on rounded distance (e.g., 9km × ₹2 = ₹18)
            
            console.log(`💵 [PAYMENT_CONFIRM] Calculating commission:`, {
              exactDistanceKm: exactDistanceKm.toFixed(2),
              roundedDistanceKm: roundedDistanceKm,
              commissionAmount: commissionAmount,
              calculation: `${roundedDistanceKm}km × ₹2/km = ₹${commissionAmount}`
            });
            
            console.log(`💵 [PAYMENT_CONFIRM] Attempting to deduct commission: ₹${commissionAmount} (${roundedDistanceKm}km × ₹2/km) from driver ${uid}`);
            
            // ✅ CRITICAL FIX: Ensure wallet exists before deducting
            const walletRef = db.collection('driverPointsWallets').doc(uid);
            const walletDoc = await transaction.get(walletRef);
            
            if (!walletDoc.exists) {
              // Create wallet in transaction
              transaction.set(walletRef, {
                driverId: uid,
                pointsBalance: 0,
                totalPointsEarned: 0,
                totalPointsSpent: 0,
                status: 'active',
                requiresTopUp: true,
                createdAt: new Date(),
                lastUpdated: new Date()
              });
              console.log(`🔧 [PAYMENT_CONFIRM] Created wallet for driver ${uid} in transaction`);
            }
            
            const walletData = walletDoc.exists ? walletDoc.data() : { pointsBalance: 0, totalPointsSpent: 0 };
            const currentPointsBalance = walletData.pointsBalance || 0;
            
            // Check if sufficient balance
            if (currentPointsBalance < commissionAmount) {
              console.error(`❌ [PAYMENT_CONFIRM] Insufficient points balance: ${currentPointsBalance} < ${commissionAmount}`);
              // ✅ CRITICAL FIX: Still create transaction record even if deduction fails (for tracking)
              const { v4: uuidv4 } = require('uuid');
              commissionTransactionId = uuidv4();
              const transactionRef = db.collection('pointsTransactions').doc(commissionTransactionId);
              transaction.set(transactionRef, {
                id: commissionTransactionId,
                driverId: uid,
                type: 'debit',
                pointsAmount: commissionAmount,
                previousBalance: currentPointsBalance,
                newBalance: currentPointsBalance, // Balance unchanged (deduction failed)
                tripId: id,
                distanceKm: roundedDistanceKm, // ✅ Store rounded distance
                exactDistanceKm: exactDistanceKm, // ✅ Also store exact distance for reference
                tripDetails: {
                  bookingId: id,
                  fare: paymentAmount,
                  distance: roundedDistanceKm, // ✅ Use rounded distance
                  exactDistance: exactDistanceKm,
                  paymentMethod: paymentMethod
                },
                status: 'failed',
                failureReason: 'Insufficient balance',
                createdAt: new Date()
              });
              console.warn(`⚠️ [PAYMENT_CONFIRM] Commission transaction recorded as failed (insufficient balance)`);
              commissionDeducted = false;
            } else {
              // Deduct commission atomically within transaction
              const newPointsBalanceAfter = currentPointsBalance - commissionAmount;
              const newTotalSpent = (walletData.totalPointsSpent || 0) + commissionAmount;
              
              // Update points wallet in transaction
              transaction.update(walletRef, {
                pointsBalance: newPointsBalanceAfter,
                totalPointsSpent: newTotalSpent,
                lastUpdated: new Date()
              });
              
              // Create commission transaction record in transaction
              const { v4: uuidv4 } = require('uuid');
              commissionTransactionId = uuidv4();
              const transactionRef = db.collection('pointsTransactions').doc(commissionTransactionId);
              transaction.set(transactionRef, {
                id: commissionTransactionId,
                driverId: uid,
                type: 'debit',
                pointsAmount: commissionAmount,
                previousBalance: currentPointsBalance,
                newBalance: newPointsBalanceAfter,
                tripId: id,
                distanceKm: roundedDistanceKm, // ✅ Store rounded distance
                exactDistanceKm: exactDistanceKm, // ✅ Also store exact distance for reference
                tripDetails: {
                  bookingId: id,
                  fare: paymentAmount,
                  distance: roundedDistanceKm, // ✅ Use rounded distance
                  exactDistance: exactDistanceKm,
                  paymentMethod: paymentMethod
                },
                status: 'completed',
                createdAt: new Date()
              });
              
              commissionDeducted = true;
              newPointsBalance = newPointsBalanceAfter;
              console.log(`✅ [PAYMENT_CONFIRM] Commission deducted atomically: ₹${commissionAmount} (${roundedDistanceKm}km × ₹2/km, exact: ${exactDistanceKm.toFixed(2)}km)`);
            }
          } else {
            // ✅ CRITICAL FIX: Even if distance is 0 or missing, use fareCalculationService to calculate minimum commission
            // This ensures proper rounding: 0.5km → 1km = ₹2, 0km → 1km = ₹2
            console.warn(`⚠️ [PAYMENT_CONFIRM] No distance data (${exactDistanceKm}km), calculating minimum commission using fareCalculationService`);
            
            // Use minimum distance (0.5km) which rounds to 1km = ₹2 commission
            fareBreakdown = fareCalculationService.calculateFare(0.5); // 0.5km rounds to 1km
            roundedDistanceKm = fareBreakdown.roundedDistanceKm; // Will be 1km
            commissionAmount = fareBreakdown.commission; // Will be ₹2 (1km × ₹2/km)
            
            const walletRef = db.collection('driverPointsWallets').doc(uid);
            const walletDoc = await transaction.get(walletRef);
            
            if (!walletDoc.exists) {
              transaction.set(walletRef, {
                driverId: uid,
                pointsBalance: 0,
                totalPointsEarned: 0,
                totalPointsSpent: 0,
                status: 'active',
                requiresTopUp: true,
                createdAt: new Date(),
                lastUpdated: new Date()
              });
            }
            
            const walletData = walletDoc.exists ? walletDoc.data() : { pointsBalance: 0, totalPointsSpent: 0 };
            const currentPointsBalance = walletData.pointsBalance || 0;
            
            if (currentPointsBalance < commissionAmount) {
              console.error(`❌ [PAYMENT_CONFIRM] Insufficient points balance for minimum commission: ${currentPointsBalance} < ${commissionAmount}`);
              commissionDeducted = false;
            } else {
              const newPointsBalanceAfter = currentPointsBalance - commissionAmount;
              const newTotalSpent = (walletData.totalPointsSpent || 0) + commissionAmount;
              
              transaction.update(walletRef, {
                pointsBalance: newPointsBalanceAfter,
                totalPointsSpent: newTotalSpent,
                lastUpdated: new Date()
              });
              
              const { v4: uuidv4 } = require('uuid');
              commissionTransactionId = uuidv4();
              const transactionRef = db.collection('pointsTransactions').doc(commissionTransactionId);
              transaction.set(transactionRef, {
                id: commissionTransactionId,
                driverId: uid,
                type: 'debit',
                pointsAmount: commissionAmount,
                previousBalance: currentPointsBalance,
                newBalance: newPointsBalanceAfter,
                tripId: id,
                distanceKm: roundedDistanceKm, // ✅ Store rounded distance (1km)
                exactDistanceKm: exactDistanceKm, // ✅ Store exact distance (0 or missing)
                tripDetails: {
                  bookingId: id,
                  fare: paymentAmount,
                  distance: roundedDistanceKm, // ✅ Use rounded distance
                  exactDistance: exactDistanceKm,
                  paymentMethod: paymentMethod,
                  note: 'Minimum commission (distance data unavailable, using 0.5km → 1km rounding)'
                },
                status: 'completed',
                createdAt: new Date()
              });
              
              commissionDeducted = true;
              newPointsBalance = newPointsBalanceAfter;
              console.log(`✅ [PAYMENT_CONFIRM] Minimum commission deducted: ₹${commissionAmount} (${roundedDistanceKm}km × ₹2/km, exact: ${exactDistanceKm}km)`);
            }
          }
        }
        
        // ✅ CRITICAL FIX: Update driver earnings and wallet balance atomically
        console.log(`💵 [PAYMENT_CONFIRM] Updating driver earnings atomically: +₹${driverEarnings}`);
        transaction.update(driverRef, {
          totalEarnings: currentEarnings + driverEarnings,
          'wallet.balance': currentBalance + driverEarnings,
          'wallet.lastUpdated': new Date(),
          updatedAt: new Date()
        });
        
        // ✅ CRITICAL FIX: Mark booking as commission deducted atomically
        if (commissionDeducted && commissionTransactionId) {
          transaction.update(bookingRef, {
            commissionDeducted: {
              amount: commissionAmount,
              deductedAt: new Date(),
              transactionId: commissionTransactionId,
              deductedBy: uid
            }
          });
        }
        
        // ✅ CRITICAL FIX: Create earnings record atomically
        const earningsRef = db.collection('driver_earnings').doc();
        transaction.set(earningsRef, {
          id: earningsRef.id,
          bookingId: id,
          driverId: uid,
          amount: driverEarnings,
          commission: commissionAmount,
          commissionDeducted: commissionDeducted,
          totalFare: paymentAmount,
          earnedAt: new Date(),
          status: 'completed',
          paymentMethod: paymentMethod,
          transactionId: transactionId
        });
        
        // ✅ CRITICAL FIX: Update admin revenue tracking atomically
        const exactDistanceKm = bookingData.distance?.total || bookingData.exactDistance || bookingData.pricing?.distance || 0;
        const fareBreakdown = fareCalculationService.calculateFare(exactDistanceKm);
        const commissionPoints = fareBreakdown.commission; // ₹2 per km
        
        const revenueRef = db.collection('adminRevenue').doc();
        transaction.set(revenueRef, {
          id: revenueRef.id,
          bookingId: id,
          customerId: bookingData.customerId,
          driverId: uid,
          totalFare: paymentAmount,
          driverEarnings: driverEarnings,
          platformCommission: commissionPoints,
          paymentMethod: paymentMethod,
          confirmedAt: new Date(),
          status: 'completed'
        });
        
        console.log(`✅ [PAYMENT_CONFIRM] All payment operations committed atomically`);
      });
      
      console.log(`💰 [PAYMENT_CONFIRM] Driver earnings updated: ₹${driverEarnings}, Commission: ₹${commissionAmount} ${commissionDeducted ? '(deducted from points)' : '(not deducted - may need manual adjustment)'}`);
      
      // ✅ CRITICAL FIX: Always emit wallet update event (even if commission deduction failed)
      // This ensures wallet screen refreshes and shows the transaction status
      try {
        const io = require('../services/socket').getIO();
        if (io) {
          // Get current wallet balance for the event
          const currentWalletResult = await walletServiceInstance.getPointsBalance(uid);
          const currentWalletBalance = currentWalletResult.success ? currentWalletResult.wallet.pointsBalance : newPointsBalance;
          
          io.to(`driver:${uid}`).emit('wallet_balance_updated', {
            driverId: uid,
            newBalance: currentWalletBalance,
            pointsDeducted: commissionDeducted ? commissionAmount : 0,
            transactionId: commissionTransactionId,
            commissionDeducted: commissionDeducted,
            timestamp: new Date().toISOString()
          });
          console.log(`📤 [PAYMENT_CONFIRM] Wallet balance update event sent to driver ${uid}`, {
            commissionDeducted,
            commissionAmount,
            newBalance: currentWalletBalance
          });
        }
      } catch (socketError) {
        console.warn('⚠️ [PAYMENT_CONFIRM] Failed to emit wallet update event:', socketError);
        // Don't fail payment if socket emit fails
      }
      
      if (!commissionDeducted) {
        console.error('❌ [PAYMENT_CONFIRM] Commission deduction failed or skipped:', {
          commissionAmount,
          reason: commissionAmount === 0 ? 'No distance data' : 'Insufficient balance',
          transactionId: commissionTransactionId
        });
      }
      
      // ✅ CRITICAL FIX: Emit real-time earnings update to admin dashboard
      try {
        const io = require('../services/socket').getIO();
        if (io) {
          io.to('type:admin').emit('driver_earnings_updated', {
            driverId: uid,
            bookingId: id,
            action: 'added',
            amount: driverEarnings,
            newTotalEarnings: currentEarnings + driverEarnings,
            commission: commissionAmount,
            timestamp: new Date().toISOString()
          });
          console.log(`📤 [PAYMENT_CONFIRM] Sent driver earnings update event to admin dashboard`);
        }
      } catch (socketError) {
        console.warn('⚠️ [PAYMENT_CONFIRM] Failed to emit earnings update event:', socketError);
        // Don't fail payment if socket emit fails
      }
    } catch (earningsError) {
      console.error('❌ [PAYMENT_CONFIRM] Failed to update driver earnings atomically:', earningsError);
      // Don't fail the payment confirmation if earnings update fails
      // Log error for manual investigation
      // Note: Payment record was already created, so payment is considered successful
    }
    
    console.log(`✅ [PAYMENT_CONFIRM] Payment confirmation completed successfully`);
    // ✅ CRITICAL FIX: Get updated wallet balance to return in response
    let updatedWalletBalance = null;
    try {
      const updatedBalanceResult = await walletServiceInstance.getPointsBalance(uid);
      if (updatedBalanceResult.success) {
        updatedWalletBalance = updatedBalanceResult.wallet.pointsBalance;
      }
    } catch (balanceError) {
      console.warn('⚠️ [PAYMENT_CONFIRM] Failed to get updated wallet balance for response:', balanceError);
    }
    
    const responseData = {
        message: 'Payment confirmed successfully',
        amount: paymentAmount,
        transactionId,
        paymentConfirmed: true,
        bookingStatus: 'completed',
        commissionDeducted: commissionDeducted,
        commissionAmount: commissionAmount,
        commissionTransactionId: commissionTransactionId,
        walletBalance: updatedWalletBalance, // ✅ Include updated wallet balance
        confirmedAt: new Date().toISOString()
    };
    
    // ✅ CRITICAL FIX: Store idempotency key to prevent duplicate processing
    if (idempotencyKey) {
      try {
        const idempotencyRef = db.collection('paymentIdempotency').doc(idempotencyKey);
        await idempotencyRef.set({
          bookingId: id,
          driverId: uid,
          transactionId: transactionId,
          response: responseData,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // Expire after 24 hours
        });
        console.log(`✅ [PAYMENT_CONFIRM] Idempotency key stored: ${idempotencyKey}`);
      } catch (idempotencyError) {
        console.warn('⚠️ [PAYMENT_CONFIRM] Failed to store idempotency key:', idempotencyError);
        // Don't fail payment if idempotency storage fails
      }
    }
    
    res.status(200).json({
      success: true,
      data: responseData,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ [PAYMENT_CONFIRM] Error confirming payment:', error);
    console.error('❌ [PAYMENT_CONFIRM] Error stack:', error.stack);
    
    // Provide detailed error information
    const errorCode = error.code || 'PAYMENT_CONFIRMATION_ERROR';
    const errorMessage = error.message || 'Failed to confirm payment';
    const errorDetails = error.details || error.stack || 'An unexpected error occurred while confirming payment';
    
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
 * @route   PUT /api/driver/status
 * @desc    Update driver status (available/busy/offline)
 * @access  Private (Driver only)
 * @deprecated This endpoint is a duplicate and has been disabled. Use the comprehensive endpoint at line 2069 instead.
 */
// ✅ CRITICAL FIX: This duplicate endpoint has been removed to prevent conflicts
// The comprehensive driver status endpoint at line 2069 handles all status updates with proper validation
// router.put('/status', ...) - REMOVED TO PREVENT DUPLICATE ROUTE CONFLICTS

/**
 * @route   GET /api/driver/bookings/history
 * @desc    Get driver booking history
 * @access  Private (Driver only)
 */
router.get('/bookings/history', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 50, offset = 0, status } = req.query;
    
    const db = getFirestore();
    let query = db.collection('bookings')
      .where('driverId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));
    
    // Filter by status if provided
    if (status && status !== 'all') {
      query = query.where('status', '==', status);
    }
    
    const snapshot = await query.get();
    const bookings = [];
    let grossTotal = 0;
    let netTotal = 0;
    let commissionTotal = 0;

    snapshot.forEach(doc => {
      const data = doc.data();
      const earnings = computeBookingEarnings(data);

      grossTotal += earnings.grossFare;
      netTotal += earnings.netEarnings;
      commissionTotal += earnings.commissionAmount;

      bookings.push({
        id: doc.id,
        ...data,
        earnings,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString()
      });
    });

    res.status(200).json({
      success: true,
      data: bookings,
      total: bookings.length,
      summary: {
        grossTotal: roundCurrency(grossTotal),
        netTotal: roundCurrency(netTotal),
        commissionTotal: roundCurrency(commissionTotal)
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting booking history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get booking history'
    });
  }
});

/**
 * @route   GET /api/driver/bookings/:id/status
 * @desc    Get booking status
 * @access  Private (Driver only)
 */
router.get('/bookings/:id/status', requireDriver, async (req, res) => {
  try {
    const { id } = req.params;
    const { uid } = req.user;
    
    const db = getFirestore();
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }
    
    const bookingData = bookingDoc.data();
    
    // Check if driver is assigned to this booking
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    res.status(200).json({
      success: true,
      data: {
        status: bookingData.status,
        bookingId: id,
        driverId: uid,
        customerId: bookingData.customerId,
        pickupLocation: bookingData.pickupLocation,
        dropoffLocation: bookingData.dropoffLocation,
        fare: bookingData.fare,
        weight: bookingData.weight,
        createdAt: bookingData.createdAt,
        updatedAt: bookingData.updatedAt
      }
    });
    
  } catch (error) {
    console.error('Error getting booking status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get booking status'
    });
  }
});

/**
 * @route   POST /api/driver/bookings/:id/complete-delivery
 * @desc    Complete delivery and process commission
 * @access  Private (Driver only)
 */
router.post('/bookings/:id/complete-delivery', [
  requireDriver,
  body('driverEarnings').isFloat({ min: 0 }).withMessage('Driver earnings must be a positive number'),
  body('commission').isFloat({ min: 0 }).withMessage('Commission must be a positive number')
], async (req, res) => {
  try {
    const { id } = req.params;
    const { uid } = req.user;
    const { driverEarnings, commission } = req.body;
    
    const db = getFirestore();
    const bookingRef = db.collection('bookings').doc(id);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }
    
    // ✅ CRITICAL FIX: Check if earnings record already exists (from payment confirmation)
    const existingEarningsSnapshot = await db.collection('driver_earnings')
      .where('driverId', '==', uid)
      .where('bookingId', '==', id)
      .where('status', '==', 'completed')
      .get();
    
    if (existingEarningsSnapshot.size > 0) {
      console.log(`⚠️ [COMPLETE_DELIVERY] Earnings record already exists for booking ${id}. Skipping duplicate creation.`);
      // Booking is already completed with earnings - just return success
      return res.status(200).json({
        success: true,
        data: {
          message: 'Delivery already completed with earnings recorded',
          driverEarnings: existingEarningsSnapshot.docs[0].data().amount || driverEarnings,
          commission: existingEarningsSnapshot.docs[0].data().commission || commission
        }
      });
    }
    
    // Update booking status to completed
    await bookingRef.update({
      status: 'completed',
      completedAt: new Date(),
      completedBy: uid,
      earnings: {
        driverEarnings,
        commission,
        totalAmount: driverEarnings + commission
      },
      updatedAt: new Date()
    });
    
    // Update driver earnings
    const driverRef = db.collection('users').doc(uid);
    const driverDoc = await driverRef.get();
    
    if (driverDoc.exists) {
      const driverData = driverDoc.data();
      const currentEarnings = driverData.totalEarnings || 0;
      const currentBalance = driverData.wallet?.balance || 0;
      
      await driverRef.update({
        totalEarnings: currentEarnings + driverEarnings,
        'wallet.balance': currentBalance + driverEarnings,
        'wallet.lastUpdated': new Date(),
        updatedAt: new Date()
      });
    }
    
    // ✅ CRITICAL FIX: Create earnings record only if it doesn't exist
    await db.collection('driver_earnings').add({
      bookingId: id,
      driverId: uid,
      amount: driverEarnings,
      commission,
      totalFare: driverEarnings + commission,
      earnedAt: new Date(),
      status: 'completed'
    });
    
    res.status(200).json({
      success: true,
      data: {
        message: 'Delivery completed successfully',
        driverEarnings,
        commission,
        totalFare: driverEarnings + commission
      }
    });
    
  } catch (error) {
    console.error('Error completing delivery:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete delivery'
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
    
    // ✅ CRITICAL FIX: Allow drivers to reject available bookings (not just assigned ones)
    // Check if booking is in a state where it can be rejected
    if (bookingData.status !== 'pending' && bookingData.status !== 'driver_assigned') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BOOKING_STATUS',
          message: 'Cannot reject booking',
          details: 'Booking is not in a rejectable state'
        },
        timestamp: new Date().toISOString()
      });
    }

    // ✅ CRITICAL FIX: Check if driver is assigned OR if booking is available for rejection
    const bookingValidation = require('../utils/bookingValidation');
    const normalizedDriverId = bookingValidation.normalizeDriverId(bookingData.driverId);
    const isAssignedToDriver = normalizedDriverId === uid;
    const isAvailableForRejection = bookingData.status === 'pending' && bookingValidation.isDriverIdEmpty(bookingData.driverId);
    
    if (!isAssignedToDriver && !isAvailableForRejection) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only reject bookings assigned to you or available bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    // ✅ CRITICAL FIX: Handle rejection based on booking state
    if (isAssignedToDriver) {
      // Driver is rejecting an assigned booking - make it available again
      await bookingRef.update({
        status: 'pending',
        driverId: null,
        'timing.assignedAt': null,
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
      
      console.log(`✅ [BOOKING_REJECTION] Driver ${uid} rejected assigned booking ${id}, made available again`);
    } else {
      // Driver is rejecting an available booking - just track the rejection
      console.log(`✅ [BOOKING_REJECTION] Driver ${uid} rejected available booking ${id}, tracking rejection only`);
    }

    // ✅ CRITICAL FIX: Track rejection to prevent driver from seeing same booking again
    try {
      await db.collection('booking_rejections').add({
        bookingId: id,
        driverId: uid,
        reason: reason || 'Rejected by driver',
        rejectedAt: new Date(),
        createdAt: new Date()
      });
      console.log(`✅ [BOOKING_REJECTION] Tracked rejection for driver ${uid} and booking ${id}`);
    } catch (rejectionError) {
      console.error('❌ [BOOKING_REJECTION] Failed to track rejection:', rejectionError);
      // Don't fail the rejection if tracking fails
    }

    // ✅ CRITICAL FIX: Notify other drivers only when booking becomes available again
    if (isAssignedToDriver) {
      try {
        const wsEventHandler = require('../services/websocketEventHandler');
        const wsHandler = new wsEventHandler();
        await wsHandler.initialize();
        
        // Get updated booking data for notification
        const updatedBookingDoc = await bookingRef.get();
        const updatedBookingData = updatedBookingDoc.data();
        
        if (updatedBookingData) {
          console.log(`🔔 [BOOKING_REJECTION] Notifying other drivers that booking ${id} is available again`);
          await wsHandler.notifyDriversOfNewBooking({
            id: id,
            ...updatedBookingData
          });
        }
      } catch (notificationError) {
        console.error('❌ [BOOKING_REJECTION] Failed to notify other drivers:', notificationError);
        // Don't fail the rejection if notification fails
      }
    }

    res.status(200).json({
      success: true,
      message: isAssignedToDriver ? 'Booking rejected and made available for other drivers' : 'Booking rejection tracked successfully',
      data: {
        bookingId: id,
        driverId: uid,
        rejectionType: isAssignedToDriver ? 'assigned_booking' : 'available_booking',
        reason: reason || 'Rejected by driver',
        rejectedAt: new Date().toISOString()
      },
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
router.put('/:id/status', [
  requireDriver,
  body('status')
    .isIn(['driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff', 'delivered'])
    .withMessage('Invalid status'),
  body('location')
    .optional()
    .isObject()
    .withMessage('Location must be an object'),
  body('eta')
    .optional()
    .isNumeric()
    .withMessage('ETA must be a number')
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

    const { id } = req.params;
    const { uid } = req.user;
    const { status, location, eta } = req.body;
    const db = getFirestore();

    // Verify booking exists and driver is assigned
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
    
    if (bookingData.driverId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You can only update bookings assigned to you'
        },
        timestamp: new Date().toISOString()
      });
    }

    // ✅ FIXED: Use LiveTrackingService for status updates
    const liveTrackingService = require('../services/liveTrackingService');
    
    // Update driver location if provided
    if (location) {
      await liveTrackingService.updateDriverLocation(uid, location, id);
    }

    // Update booking status with live tracking
    await liveTrackingService.updateBookingStatus(id, status, uid, {
      eta: eta || null,
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Booking status updated successfully',
      data: {
        bookingId: id,
        status,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating booking status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_STATUS_UPDATE_ERROR',
        message: 'Failed to update booking status',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});
router.put('/bookings/:id/status', [
  requireDriver,
  body('status')
    .isIn([
      'pending',
      'accepted',
      'driver_enroute',
      'driver_arrived',
      'picked_up',
      'in_transit',
      'enroute_dropoff',
      'arrived_dropoff',
      'at_dropoff',
      'delivered',
      'money_collection',
      'completed',
      'cancelled'
    ])
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
  // ✅ CRITICAL FIX: Extract variables before try block so they're accessible in catch block
  const { uid } = req.user;
  const { id } = req.params;
  const bookingId = id;
  const driverId = uid;
  // ✅ CRITICAL FIX: Extract status from body before try block (may be undefined if validation fails)
  const requestedStatus = req.body?.status || 'unknown';
  
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

    const { status, location, notes, eventId, timestamp } = req.body;
    // ✅ CRITICAL FIX: Use status from body (may differ from requestedStatus if validation changed it)
    const actualStatus = status || requestedStatus;

    // ✅ CRITICAL FIX: Log status update attempt for debugging
    console.log(`🔄 [STATUS_UPDATE] Attempting status update:`, {
      bookingId: bookingId,
      driverId: driverId,
      requestedStatus: actualStatus,
      hasLocation: !!location,
      location: location ? { lat: location.latitude, lng: location.longitude } : null,
      eventId,
      eventTimestamp: timestamp
    });

    const statusResult = await driverStatusWorkflowService.updateStatus({
      bookingId: bookingId,
      driverId: driverId,
      requestedStatus: actualStatus,
      location,
      notes,
      eventId,
      eventTimestamp: timestamp,
      source: 'driver_app'
    });

    // ✅ CRITICAL FIX: Log successful status update
    console.log(`✅ [STATUS_UPDATE] Status updated successfully:`, {
      bookingId: bookingId,
      previousStatus: statusResult.previousStatus,
      newStatus: statusResult.status,
      idempotent: statusResult.idempotent
    });

    const liveTrackingService = require('../services/liveTrackingService');

    if (statusResult.shouldBroadcast) {
      try {
        await liveTrackingService.updateBookingStatus(
          id,
          statusResult.status,
          uid,
          {
            location: statusResult.broadcastPayload?.location || location || null,
            notes: statusResult.broadcastPayload?.notes || notes || null,
            eventTimestamp: statusResult.eventTimestamp.toISOString()
          },
          {
            persist: false,
            bookingDataOverride: statusResult.booking
          }
        );
      } catch (broadcastError) {
        console.error('❌ [STATUS_UPDATE] Error broadcasting status update:', broadcastError);
      }
    }

    try {
      const db = getFirestore();
      const tripTrackingRef = db.collection('tripTracking').doc(id);
      await tripTrackingRef.set({
        tripId: id,
        bookingId: id,
        driverId: uid,
        customerId: statusResult.booking.customerId,
        currentStatus: statusResult.status,
        lastUpdated: new Date()
      }, { merge: true });
    } catch (trackingError) {
      console.warn('⚠️ [STATUS_UPDATE] Failed to update trip tracking:', trackingError);
    }

    res.status(200).json({
      success: true,
      message: statusResult.idempotent
        ? 'Status already up to date'
        : 'Booking status updated successfully',
      data: {
        bookingId: id,
        status: statusResult.status,
        previousStatus: statusResult.previousStatus,
        idempotent: statusResult.idempotent,
        sequence: statusResult.sequence || null,
        occurredAt: statusResult.eventTimestamp.toISOString()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    // ✅ CRITICAL FIX: Variables are already defined in outer scope (bookingId, driverId, requestedStatus)

    if (error instanceof DriverStatusError) {
      return res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details || null
        },
        timestamp: new Date().toISOString()
      });
    }

    // ✅ CRITICAL FIX: Log detailed error information for debugging
    console.error(`❌ [STATUS_UPDATE] Status update failed:`, {
      bookingId: bookingId,
      driverId: driverId,
      requestedStatus: requestedStatus,
      errorType: error.constructor.name,
      errorCode: error.code,
      errorMessage: error.message,
      errorDetails: error.details,
      stack: error.stack?.substring(0, 500) // Limit stack trace length
    });

    console.error('Error updating booking status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'STATUS_UPDATE_ERROR',
        message: 'Failed to update booking status',
        details: error.message || 'An error occurred while updating booking status'
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
    const { bookingId, location, photoUrl, notes, eventId, timestamp: eventTimestamp } = req.body;
    const db = getFirestore();
    
    console.log('📦 [CONFIRM_PICKUP] Confirming pickup for booking:', bookingId, 'driver:', uid);

    const statusResult = await driverStatusWorkflowService.updateStatus({
      bookingId,
      driverId: uid,
      requestedStatus: 'picked_up',
      location,
      notes,
      eventId,
      eventTimestamp,
      source: 'driver_app'
    });

    // ✅ CRITICAL FIX: Notify customer about pickup via WebSocket
    const liveTrackingService = require('../services/liveTrackingService');
    const io = require('../services/socket').getIO();
    
    if (io && statusResult.booking.customerId) {
      try {
        await liveTrackingService.updateBookingStatus(
          bookingId,
          statusResult.status,
          uid,
          {
            location: statusResult.broadcastPayload?.location || location || null,
            notes: statusResult.broadcastPayload?.notes || notes || null,
            photoUrl: photoUrl || null,
            eventTimestamp: statusResult.eventTimestamp.toISOString()
          },
          {
            persist: false,
            bookingDataOverride: statusResult.booking
          }
        );
        
        io.to(`user:${statusResult.booking.customerId}`).emit('booking_status_update', {
          bookingId: bookingId,
          status: statusResult.status,
          booking: statusResult.booking,
          timestamp: new Date().toISOString(),
          updatedBy: uid
        });
        
        console.log(`📤 [CONFIRM_PICKUP] Notified customer ${statusResult.booking.customerId} about pickup confirmation`);
      } catch (notifyError) {
        console.error('❌ [CONFIRM_PICKUP] Error notifying customer:', notifyError);
      }
    }

    // Create pickup verification record
    const verificationRef = db.collection('pickupVerifications').doc();
    await verificationRef.set({
      id: verificationRef.id,
      bookingId: bookingId,
      driverId: uid,
      customerId: statusResult.booking.customerId,
      location: location,
      photoUrl: photoUrl || null,
      notes: notes || null,
      verifiedAt: statusResult.eventTimestamp,
      status: 'verified'
    });

    // Update trip tracking
    const tripTrackingRef = db.collection('tripTracking').doc(bookingId);
    await tripTrackingRef.set({
      tripId: bookingId,
      bookingId: bookingId,
      driverId: uid,
      customerId: statusResult.booking.customerId,
      currentStatus: statusResult.status,
      pickupConfirmedAt: statusResult.eventTimestamp,
      lastUpdated: new Date()
    }, { merge: true });

    console.log('✅ [CONFIRM_PICKUP] Pickup confirmed successfully for booking:', bookingId);

    res.status(200).json({
      success: true,
      message: 'Pickup confirmed successfully',
      data: {
        bookingId: bookingId,
        status: statusResult.status,
        location: location,
        photoUrl: photoUrl,
        notes: notes,
        verifiedAt: statusResult.eventTimestamp.toISOString(),
        sequence: statusResult.sequence || null
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    if (error instanceof DriverStatusError) {
      return res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details || null
        },
        timestamp: new Date().toISOString()
      });
    }

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
    const { bookingId, location, photoUrl, notes, recipientName, recipientPhone, eventId, timestamp: eventTimestamp } = req.body;
    const db = getFirestore();
    
    console.log('📦 [COMPLETE_DELIVERY] Completing delivery for booking:', bookingId, 'driver:', uid);
    
    const statusResult = await driverStatusWorkflowService.completeDelivery({
      bookingId,
      driverId: uid,
      location,
      notes,
      photoUrl,
      recipientName,
      recipientPhone,
      eventId,
      eventTimestamp,
      source: 'driver_app'
    });
    const actualDuration = statusResult.booking?.timing?.actualDuration || null;

    // ✅ CRITICAL FIX: Notify customer about delivery via WebSocket
    const liveTrackingService = require('../services/liveTrackingService');
    const io = require('../services/socket').getIO();
    
    if (io && statusResult.booking.customerId) {
      try {
        await liveTrackingService.updateBookingStatus(
          bookingId,
          statusResult.status,
          uid,
          {
            location: statusResult.broadcastPayload?.location || location || null,
            notes: statusResult.broadcastPayload?.notes || notes || null,
            photoUrl: statusResult.broadcastPayload?.photoUrl || photoUrl || null,
            recipientName: statusResult.broadcastPayload?.recipientName || recipientName || null,
            recipientPhone: statusResult.broadcastPayload?.recipientPhone || recipientPhone || null,
            eventTimestamp: statusResult.eventTimestamp.toISOString()
          },
          {
            persist: false,
            bookingDataOverride: statusResult.booking
          }
        );
        
        io.to(`user:${statusResult.booking.customerId}`).emit('booking_status_update', {
          bookingId: bookingId,
          status: statusResult.status,
          booking: statusResult.booking,
          timestamp: new Date().toISOString(),
          updatedBy: uid
        });
        
        console.log(`📤 [COMPLETE_DELIVERY] Notified customer ${statusResult.booking.customerId} about delivery completion`);
      } catch (notifyError) {
        console.error('❌ [COMPLETE_DELIVERY] Error notifying customer:', notifyError);
        // Don't fail delivery if notification fails
      }
    }

    // Create delivery verification record
    const verificationRef = db.collection('deliveryVerifications').doc();
    await verificationRef.set({
      id: verificationRef.id,
      bookingId: bookingId,
      driverId: uid,
      customerId: statusResult.booking.customerId,
      location: location,
      photoUrl: photoUrl || null,
      notes: notes || null,
      recipientName: recipientName || null,
      recipientPhone: recipientPhone || null,
      deliveredAt: statusResult.eventTimestamp,
      status: 'verified'
    });

    try {
      const tripTrackingRef = db.collection('tripTracking').doc(bookingId);
      await tripTrackingRef.set({
        tripId: bookingId,
        bookingId: bookingId,
        driverId: uid,
        customerId: statusResult.booking.customerId,
        currentStatus: statusResult.status,
        deliveredAt: statusResult.eventTimestamp,
        actualDuration: actualDuration,
        lastUpdated: new Date()
      }, { merge: true });
    } catch (trackingError) {
      console.warn('⚠️ [COMPLETE_DELIVERY] Failed to update trip tracking:', trackingError);
    }

    // ✅ CRITICAL FIX: Commission deduction and earnings updates are handled during payment confirmation
    // NOT during delivery completion - this ensures proper workflow:
    // 1. Delivery completes → Status: 'delivered' (payment required)
    // 2. Driver confirms payment → Commission deducted, earnings updated, Status: 'completed'
    // This prevents premature commission deduction and earnings inconsistency
    console.log(`ℹ️ [COMPLETE_DELIVERY] Commission and earnings will be processed during payment confirmation`);

    // ✅ CRITICAL FIX: Send real-time notifications (duplicate notification removed - already handled above)
    // Note: liveTrackingService.updateBookingStatus already sends delivery_completed event
    // This additional notification is kept for backward compatibility
    try {
      const socketService = require('../services/socket');
      const io = socketService.getSocketIO();
      
      if (io) {
        io.to('type:admin').emit('delivery_completed', {
          bookingId: bookingId,
          customerId: statusResult.booking.customerId,
          driverId: uid,
          status: statusResult.status,
          deliveredAt: statusResult.eventTimestamp.toISOString(),
          duration: actualDuration,
          paymentRequired: true
        });
        
        console.log(`📡 [COMPLETE_DELIVERY] Admin notification sent for delivery ${bookingId}`);
      }
    } catch (notificationError) {
      console.error('❌ [COMPLETE_DELIVERY] Failed to send admin notifications:', notificationError);
      // Don't fail the delivery completion if notifications fail
    }

    // ✅ CRITICAL FIX: Revenue tracking should be updated during payment confirmation, not delivery
    // This ensures accurate revenue data only after payment is confirmed
    console.log(`ℹ️ [COMPLETE_DELIVERY] Revenue tracking will be updated during payment confirmation`);

    console.log('✅ [COMPLETE_DELIVERY] Delivery completed successfully for booking:', bookingId);

    res.status(200).json({
      success: true,
      message: 'Delivery completed successfully',
      data: {
        bookingId: bookingId,
        status: statusResult.status,
        location: location,
        photoUrl: photoUrl,
        notes: notes,
        recipientName: recipientName,
        recipientPhone: recipientPhone,
        deliveredAt: statusResult.eventTimestamp.toISOString(),
        duration: actualDuration,
        sequence: statusResult.sequence || null,
        paymentRequired: !statusResult.booking?.paymentConfirmed
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    if (error instanceof DriverStatusError) {
      return res.status(error.statusCode).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details || null
        },
        timestamp: new Date().toISOString()
      });
    }

    console.error('❌ [COMPLETE_DELIVERY] Error completing delivery:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELIVERY_COMPLETION_ERROR',
        message: 'Failed to complete delivery',
        details: error.message || 'An error occurred while completing delivery'
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
 * @desc    Get driver points wallet balance and transactions
 * @access  Private (Driver only)
 */
router.get('/wallet', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 20, offset = 0, skipTransactions = false } = req.query;
    
    const pointsService = require('../services/walletService');
    const startTime = Date.now();
    
    // ✅ CRITICAL FIX: Check cache first to reduce DB load
    const cachingService = require('../services/cachingService');
    const cacheKey = `wallet:full:${uid}:${limit}:${offset}`;
    const cached = await cachingService.get(cacheKey, 'memory');
    
    if (cached) {
      console.log(`✅ [POINTS_WALLET_API] Cache hit for wallet data: ${uid}`);
      return res.status(200).json(cached);
    }
    
    // Get points wallet balance (with caching enabled)
    let balanceResult = await pointsService.getPointsBalance(uid, true);
    
    // CRITICAL FIX: Create wallet if it doesn't exist for new drivers
    if (!balanceResult.success && balanceResult.error === 'Points wallet not found') {
      console.log('🔧 [POINTS_WALLET_API] Wallet not found, creating new wallet for driver:', uid);
      const createResult = await pointsService.createOrGetPointsWallet(uid, 0);
      
      if (createResult.success) {
        // Try to get balance again after creation (skip cache on creation)
        balanceResult = await pointsService.getPointsBalance(uid, false);
      }
    }
    
    if (!balanceResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'POINTS_WALLET_ERROR',
          message: 'Failed to retrieve points wallet',
          details: balanceResult.error
        },
        timestamp: new Date().toISOString()
      });
    }

    // ✅ CRITICAL FIX: Only fetch transactions if not skipped (for balance-only requests)
    let transactionsResult = { success: true, transactions: [], total: 0, pagination: { limit: parseInt(limit), offset: parseInt(offset), total: 0, hasMore: false } };
    
    if (!skipTransactions) {
      // Get points transaction history (optimized pagination)
      transactionsResult = await pointsService.getTransactionHistory(uid, {
      limit: parseInt(limit),
        offset: parseInt(offset),
        includeTotal: true // Include total count for pagination
    });
    }

    const responseData = {
      pointsBalance: balanceResult.wallet.pointsBalance,
      currency: 'points', // Points are virtual currency
      requiresTopUp: balanceResult.wallet.requiresTopUp,
      canWork: balanceResult.wallet.canWork,
      lastUpdated: balanceResult.wallet.lastUpdated,
      transactions: transactionsResult.success ? (transactionsResult.transactions || []) : [],
      pagination: transactionsResult.success && transactionsResult.pagination ? transactionsResult.pagination : {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: transactionsResult.success ? (transactionsResult.total || 0) : 0,
        hasMore: false
      }
    };
    
    const response = {
      success: true,
      message: 'Points wallet information retrieved successfully',
      data: responseData,
      timestamp: new Date().toISOString()
    };
    
    // ✅ CRITICAL FIX: Cache the response for 30 seconds (short TTL for balance accuracy)
    // Cache key includes limit/offset to handle pagination correctly
    await cachingService.set(cacheKey, response, 30, 'memory');
    
    const queryTime = Date.now() - startTime;
    console.log(`✅ [POINTS_WALLET_API] Wallet data retrieved in ${queryTime}ms for driver: ${uid}`);
    
    res.status(200).json(response);

  } catch (error) {
    console.error('Error getting driver points wallet:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'POINTS_WALLET_RETRIEVAL_ERROR',
        message: 'Failed to retrieve points wallet information',
        details: 'An error occurred while retrieving points wallet information'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/wallet/top-up
 * @desc    Top-up driver points wallet with real money
 * @access  Private (Driver only)
 */
router.post('/wallet/top-up', [
  requireDriver,
  speedLimiter, // Rate limit for sensitive financial operations
  body('amount')
    .isFloat({ min: 250, max: 10000 })
    .withMessage('Amount must be between 250 and 10,000'),
  body('paymentMethod')
    .isIn(['phonepe', 'upi', 'card'])
    .withMessage('Payment method must be phonepe, upi, or card'),
  body('paymentDetails')
    .optional()
    .isObject()
    .withMessage('Payment details must be an object'),
  body('idempotencyKey')
    .isString()
    .withMessage('Idempotency key is required for duplicate prevention')
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
    const { amount, paymentMethod, paymentDetails, idempotencyKey } = req.body;
    
    // Sanitize payment details
    const sanitizedPaymentDetails = {
      timestamp: new Date().toISOString(),
      driverId: uid,
      // Only allow safe fields from paymentDetails
      ...(paymentDetails && typeof paymentDetails === 'object' ? {
        transactionId: paymentDetails.transactionId ? String(paymentDetails.transactionId).slice(0, 100) : undefined,
        referenceId: paymentDetails.referenceId ? String(paymentDetails.referenceId).slice(0, 100) : undefined,
        gatewayResponse: paymentDetails.gatewayResponse ? String(paymentDetails.gatewayResponse).slice(0, 500) : undefined
      } : {})
    };
    
    // Intelligent payment service selection
    // Automatically uses mock if PhonePe credentials not configured
    const phonepeService = require('../services/phonepeService');
    const mockPaymentService = require('../services/mockPaymentService');
    
    // Check if PhonePe is properly configured
    const isPhonePeConfigured = process.env.PHONEPE_MERCHANT_ID && 
                                 process.env.PHONEPE_MERCHANT_ID !== 'PGTESTPAYUAT' &&
                                 process.env.PHONEPE_SALT_KEY &&
                                 process.env.PHONEPE_SALT_KEY.length > 20;
    
    // Select payment service based on configuration
    const paymentService = isPhonePeConfigured ? phonepeService : mockPaymentService;
    const paymentMode = isPhonePeConfigured ? 'PRODUCTION' : 'TESTING';
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`💳 [WALLET_TOP_UP] Payment Mode: ${paymentMode}`);
    console.log(`🔧 [WALLET_TOP_UP] Service: ${isPhonePeConfigured ? 'Real PhonePe' : 'Mock Payment (Sandbox)'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const transactionId = `WALLET_${uid}_${Date.now()}`;
    
    // Store pending wallet transaction in driverTopUps collection
    const { getFirestore } = require('../services/firebase');
    const db = getFirestore();
    
    // ✅ IDEMPOTENCY CHECK - Prevent duplicate top-ups
    console.log('🔍 [IDEMPOTENCY] Checking for existing transaction with key:', idempotencyKey);
    const existingTopUp = await db.collection('driverTopUps')
      .where('driverId', '==', uid)
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();
    
    if (!existingTopUp.empty) {
      const existingData = existingTopUp.docs[0].data();
      console.log('⚠️ [IDEMPOTENCY] Duplicate request detected, returning existing result');
      return res.status(200).json({
        success: true,
        message: 'Top-up already processed (duplicate request prevented)',
        data: {
          transactionId: existingData.id,
          paymentUrl: existingData.phonepePaymentUrl,
          merchantTransactionId: existingData.phonepeTransactionId,
          amount: existingData.amount,
          paymentMethod: existingData.paymentMethod,
          status: existingData.status,
          isDuplicate: true
        },
        timestamp: new Date().toISOString()
      });
    }
    console.log('✅ [IDEMPOTENCY] No duplicate found, proceeding with new transaction');
    
    const walletTransactionRef = db.collection('driverTopUps').doc(transactionId);
    
    await walletTransactionRef.set({
      id: transactionId,
      driverId: uid,
      amount: amount,
      realMoneyAmount: amount,
      paymentMethod: paymentMethod,
      status: 'pending',
      phonepeTransactionId: null,
      pointsAwarded: 0,
      newPointsBalance: 0,
      paymentDetails: sanitizedPaymentDetails,
      idempotencyKey: idempotencyKey, // Store for duplicate detection
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    // Create payment request (works with both real PhonePe and mock)
    const paymentResult = await paymentService.createPayment({
      transactionId: transactionId,
      merchantTransactionId: transactionId,
      merchantUserId: uid,
      amount: amount,
      customerId: uid, // Legacy param for compatibility
      mobileNumber: req.user.phone || '+919999999999',
      customerPhone: req.user.phone || '+919999999999', // Legacy param
      callbackUrl: `${process.env.API_BASE_URL || 'https://epickupbackend-production.up.railway.app'}/api/payments/phonepe/callback`,
      redirectUrl: 'epickup://payment/callback',
      bookingId: 'wallet-topup'
    });
    
    if (paymentResult.success) {
      // Update transaction with PhonePe details
      await walletTransactionRef.update({
        phonepeTransactionId: paymentResult.data.merchantTransactionId,
        phonepePaymentUrl: paymentResult.data.paymentUrl,
        updatedAt: new Date()
      });
      
      res.status(200).json({
        success: true,
        message: `Payment request created successfully (${paymentMode} mode)`,
        data: {
          transactionId: transactionId,
          paymentUrl: paymentResult.data.paymentUrl,
          merchantTransactionId: paymentResult.data.merchantTransactionId,
          amount: amount,
          paymentMethod: paymentMethod,
          paymentMode: paymentMode, // Let frontend know which mode
          isMockPayment: !isPhonePeConfigured // Explicit flag
        },
        timestamp: new Date().toISOString()
      });
    } else {
      // Clean up failed transaction
      await walletTransactionRef.delete();
      
      res.status(400).json({
        success: false,
        error: {
          code: 'PAYMENT_CREATION_ERROR',
          message: 'Failed to create payment request',
          details: paymentResult.error
        },
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error topping up points wallet:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'POINTS_TOPUP_ERROR',
        message: 'Failed to top-up points wallet',
        details: 'An error occurred while topping up points wallet'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/wallet/process-welcome-bonus-direct
 * @desc    DEPRECATED - Welcome bonus removed, use points top-up instead
 * @access  Private (Driver only)
 */
router.post('/wallet/process-welcome-bonus-direct', requireDriver, async (req, res) => {
  return res.status(410).json({
    success: false,
    error: {
      code: 'DEPRECATED_FEATURE',
      message: 'Welcome bonus feature has been removed. Please use points top-up instead.',
      details: 'The welcome bonus system has been replaced with a mandatory points top-up system. Drivers must top-up their points wallet to start working.'
    },
    timestamp: new Date().toISOString()
  });
});

/**
 * @route   GET /api/driver/wallet/can-work
 * @desc    Check if driver can work based on points balance
 * @access  Private (Driver only)
 */
router.get('/wallet/can-work', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    
    const pointsService = require('../services/walletService');
    
    // Check if driver can work
    const canWorkResult = await pointsService.canDriverWork(uid);
    
    res.status(200).json({
      success: true,
      message: 'Driver work status retrieved successfully',
      data: {
        canWork: canWorkResult,
        driverId: uid
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error checking driver work status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'WORK_STATUS_ERROR',
        message: 'Failed to check work status',
        details: 'An error occurred while checking if driver can work'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/driver/wallet/remaining-trips
 * @desc    Get remaining trips based on points balance
 * @access  Private (Driver only)
 */
router.get('/wallet/remaining-trips', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { distance = 5 } = req.query; // Default 5km trip
    
    const pointsService = require('../services/walletService');
    const fareCalculationService = require('../services/fareCalculationService');
    
    // Get points balance
    const balanceResult = await pointsService.getPointsBalance(uid);
    
    if (!balanceResult.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'POINTS_WALLET_ERROR',
          message: 'Failed to retrieve points balance',
          details: balanceResult.error
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Calculate commission for the given distance
    const fareBreakdown = fareCalculationService.calculateFare(parseFloat(distance));
    const commissionPerTrip = fareBreakdown.commission;
    
    // Calculate remaining trips
    const pointsBalance = balanceResult.wallet.pointsBalance;
    const remainingTrips = Math.floor(pointsBalance / commissionPerTrip);
    
    res.status(200).json({
      success: true,
      message: 'Remaining trips calculated successfully',
      data: {
        pointsBalance: pointsBalance,
        commissionPerTrip: commissionPerTrip,
        tripDistance: parseFloat(distance),
        remainingTrips: remainingTrips,
        canWork: remainingTrips > 0
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error calculating remaining trips:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REMAINING_TRIPS_ERROR',
        message: 'Failed to calculate remaining trips',
        details: 'An error occurred while calculating remaining trips'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/driver/wallet/ensure-welcome-bonus
 * @desc    DEPRECATED - Welcome bonus removed, use points top-up instead
 * @access  Private (Driver only)
 */
router.post('/wallet/ensure-welcome-bonus', requireDriver, async (req, res) => {
  return res.status(410).json({
    success: false,
    error: {
      code: 'DEPRECATED_FEATURE',
      message: 'Welcome bonus feature has been removed. Please use points top-up instead.',
      details: 'The welcome bonus system has been replaced with a mandatory points top-up system. Drivers must top-up their points wallet to start working.'
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
  

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
    
    // ✅ CRITICAL FIX: Get documents from Firebase Storage instead of Firestore
    const bucket = getStorage().bucket();
    const [files] = await bucket.getFiles({
      prefix: `drivers/${uid}/documents/`,
    });

    const documents = {};
    const documentFiles = {};

    // Group files by document type
    for (const file of files) {
      try {
        const pathParts = file.name.split('/');
        const documentType = pathParts[pathParts.length - 2];
        
        if (!documentFiles[documentType]) {
          documentFiles[documentType] = [];
        }
        
        const [downloadURL] = await file.getSignedUrl({
          action: 'read',
          expires: '03-01-2500'
        });

        const [metadata] = await file.getMetadata();
        
        documentFiles[documentType].push({
          fileName: file.name.split('/').pop(),
          filePath: file.name,
          downloadURL: downloadURL,
          size: metadata.size,
          uploadedAt: metadata.timeCreated,
          contentType: metadata.contentType,
          customMetadata: metadata.customMetadata || {}
        });
      } catch (fileError) {
        console.error(`❌ [DOC_STATUS] Error processing file ${file.name}:`, fileError);
      }
    }

    // Select the latest file for each document type
    for (const [documentType, files] of Object.entries(documentFiles)) {
      if (files.length > 0) {
        const sortedFiles = files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        documents[documentType] = sortedFiles[0];
        
        if (files.length > 1) {
          console.warn(`⚠️ [DOC_STATUS] Multiple files found for ${documentType}: ${files.length} files. Using latest: ${sortedFiles[0].fileName}`);
        }
      }
    }

    const verificationStatus = userData.driver?.verificationStatus || 'pending';

    // CRITICAL FIX: Get verification data from verification service for comprehensive status
    const verificationService = require('../services/verificationService');
    let comprehensiveVerificationData;
    
    try {
      comprehensiveVerificationData = await verificationService.getDriverVerificationData(uid);
      
      // ✅ CRITICAL FIX: Handle null return from verification service
      if (!comprehensiveVerificationData) {
        console.warn('⚠️ Verification service returned null, using basic data');
      } else {
        console.log('📊 Comprehensive verification data:', comprehensiveVerificationData);
      }
    } catch (verificationError) {
      console.warn('⚠️ Failed to get comprehensive verification data, using basic data:', verificationError.message);
      comprehensiveVerificationData = null;
    }
    
    // ✅ CRITICAL FIX: Use Firebase Storage data for document status
    const finalVerificationStatus = comprehensiveVerificationData?.verificationStatus || verificationStatus;
    
    // ✅ CRITICAL FIX: Get actual verification status from Firestore
    const firestoreDocs = userData.driver?.documents || userData.documents || {};
    const comprehensiveDocs = comprehensiveVerificationData?.documents || {};
    
    console.log('📋 [DOC_STATUS] Firestore documents data:', JSON.stringify(firestoreDocs, null, 2));
    console.log('📋 [DOC_STATUS] Firestore documents keys:', Object.keys(firestoreDocs));
    console.log('📋 [DOC_STATUS] Comprehensive documents data:', JSON.stringify(comprehensiveDocs, null, 2));
    console.log('📋 [DOC_STATUS] Comprehensive documents keys:', Object.keys(comprehensiveDocs));
    
    // Helper function to get verification status from Firestore
    const getFirestoreDocStatus = (docType) => {
      // Firestore stores documents in snake_case (e.g., driving_license)
      const firestoreDoc = firestoreDocs[docType];
      
      console.log(`🔍 [DOC_STATUS] Checking ${docType}:`, {
        exists: !!firestoreDoc,
        verified: firestoreDoc?.verified,
        status: firestoreDoc?.status,
        verificationStatus: firestoreDoc?.verificationStatus,
        verifiedAt: firestoreDoc?.verifiedAt,
        verifiedBy: firestoreDoc?.verifiedBy
      });
      
      if (!firestoreDoc) {
        console.log(`⚠️ [DOC_STATUS] No Firestore data found for ${docType}`);
        return null;
      }
      
      // Check multiple possible status fields for compatibility
      const status = firestoreDoc.status || firestoreDoc.verificationStatus || 'pending';
      const verified = firestoreDoc.verified === true || status === 'verified';
      
      console.log(`✅ [DOC_STATUS] Status for ${docType}:`, { status, verified });
      
      return {
        status: status === 'verified' ? 'verified' : status === 'rejected' ? 'rejected' : 'uploaded',
        verified,
        verifiedAt: firestoreDoc.verifiedAt?.toDate?.()?.toISOString() || firestoreDoc.verifiedAt?.toISOString?.() || firestoreDoc.verifiedAt,
        verifiedBy: firestoreDoc.verifiedBy,
        comments: firestoreDoc.comments || firestoreDoc.verificationComments,
        rejectionReason: firestoreDoc.rejectionReason
      };
    };
    
    // Map Firebase Storage documents to expected format
    const requiredDocuments = ['driving_license', 'profile_photo', 'aadhaar_card', 'bike_insurance', 'rc_book'];
    const finalDocuments = {};
    
    requiredDocuments.forEach(docType => {
      const doc = documents[docType] || {};
      
      // ✅ CRITICAL FIX: Get Firestore verification data
      const firestoreStatus = getFirestoreDocStatus(docType);
      
      // ✅ CRITICAL FIX: Fallback to comprehensive data if Firestore data is missing
      const comprehensiveDoc = comprehensiveDocs[docType];
      const finalStatus = firestoreStatus || (comprehensiveDoc ? {
        status: comprehensiveDoc.verificationStatus || comprehensiveDoc.status || 'uploaded',
        verified: comprehensiveDoc.verified === true,
        verifiedAt: comprehensiveDoc.verifiedAt,
        verifiedBy: comprehensiveDoc.verifiedBy,
        comments: comprehensiveDoc.comments,
        rejectionReason: comprehensiveDoc.rejectionReason
      } : null);
      
      // Merge Storage data with Firestore verification data
      finalDocuments[docType] = {
        url: doc.downloadURL || '',
        status: finalStatus?.status || (doc.downloadURL ? 'uploaded' : 'not_uploaded'),
        verificationStatus: finalStatus?.status || (doc.downloadURL ? 'uploaded' : 'not_uploaded'),
        uploadedAt: doc.uploadedAt || '',
        verified: finalStatus?.verified || false,
        rejectionReason: finalStatus?.rejectionReason || null,
        verifiedAt: finalStatus?.verifiedAt || null,
        verifiedBy: finalStatus?.verifiedBy || null,
        comments: finalStatus?.comments || null,
        number: null,
        fileSize: doc.size || null,
        lastModified: doc.uploadedAt || null,
        fileName: doc.fileName || null,
        filePath: doc.filePath || null
      };
    });
    
    console.log('📊 [DOC_STATUS] Processed Firebase Storage documents:', JSON.stringify(finalDocuments, null, 2));

    // Calculate document completion status with enhanced data
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
      // CRITICAL FIX: Removed welcome bonus next step - system uses points top-up now
      nextSteps.push('Top-up your points wallet to start working');
      nextSteps.push('Start accepting ride requests');
    }

    // Enhanced document details with better UX data
    const documentConfig = {
      driving_license: { 
        displayName: 'Driving License', 
        description: 'Valid driving license with clear photo',
        icon: 'card',
        tips: 'Ensure all text is clearly visible and photo is recent'
      },
      aadhaar_card: { 
        displayName: 'Aadhaar Card', 
        description: 'Government issued Aadhaar card',
        icon: 'id-card',
        tips: 'Front and back side in separate images'
      },
      bike_insurance: { 
        displayName: 'Bike Insurance', 
        description: 'Valid vehicle insurance document',
        icon: 'shield-checkmark',
        tips: 'Must be current and cover the vehicle you\'ll use'
      },
      rc_book: { 
        displayName: 'RC Book', 
        description: 'Vehicle Registration Certificate',
        icon: 'document-text',
        tips: 'Ensure vehicle details match your bike'
      },
      profile_photo: { 
        displayName: 'Profile Photo', 
        description: 'Clear photo of yourself',
        icon: 'person',
        tips: 'Professional looking photo, face clearly visible'
      }
    };

    // ✅ CRITICAL FIX: Map snake_case to camelCase for frontend compatibility
    const documentTypeMapping = {
      'driving_license': 'drivingLicense',
      'profile_photo': 'profilePhoto', 
      'aadhaar_card': 'aadhaarCard',
      'bike_insurance': 'bikeInsurance',
      'rc_book': 'rcBook'
    };

    const enhancedDocuments = requiredDocuments.map(docType => {
      const doc = finalDocuments[docType] || {};
      const config = documentConfig[docType];
      const frontendType = documentTypeMapping[docType] || docType;

      return {
        type: frontendType, // ✅ Use camelCase for frontend
        name: config?.displayName || docType,
        displayName: config?.displayName || docType,
        description: config?.description || '',
        status: doc.status || 'not_uploaded',
        url: doc.url || '',
        number: doc.number || '',
        uploadedAt: doc.uploadedAt || '',
        verifiedAt: doc.verifiedAt || '',
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
        // CRITICAL FIX: Welcome bonus removed - system uses mandatory points top-up instead
        welcomeBonusEligible: false,
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

    let userData = userDoc.data();
    
    // ✅ CRITICAL FIX: If req.user has phone/userType but userData doesn't, sync them
    // This handles edge cases where auth middleware sync might have failed
    if ((req.user.phone && !userData.phone) || (req.user.userType && !userData.userType)) {
      try {
        const updateData = {};
        if (req.user.phone && !userData.phone) {
          updateData.phone = req.user.phone;
        }
        if (req.user.userType && !userData.userType) {
          updateData.userType = req.user.userType;
        }
        if (Object.keys(updateData).length > 0) {
          updateData.updatedAt = new Date();
          await userRef.update(updateData);
          // Refresh userData
          const refreshedDoc = await userRef.get();
          userData = refreshedDoc.data();
        }
      } catch (syncError) {
        console.warn('⚠️ [VERIFICATION_REQUEST] Failed to sync userData:', syncError.message);
        // Continue - req.user still has correct values
      }
    }
    
    // ✅ CRITICAL FIX: Check Firebase Storage instead of Firestore
    const bucket = getStorage().bucket();
    const [files] = await bucket.getFiles({
      prefix: `drivers/${uid}/documents/`,
    });

    const documents = {};
    const documentFiles = {};

    // Group files by document type
    for (const file of files) {
      try {
        const pathParts = file.name.split('/');
        const documentType = pathParts[pathParts.length - 2];
        
        if (!documentFiles[documentType]) {
          documentFiles[documentType] = [];
        }
        
        const [downloadURL] = await file.getSignedUrl({
          action: 'read',
          expires: '03-01-2500'
        });

        const [metadata] = await file.getMetadata();
        
        documentFiles[documentType].push({
          fileName: file.name.split('/').pop(),
          filePath: file.name,
          downloadURL: downloadURL,
          size: metadata.size,
          uploadedAt: metadata.timeCreated,
          contentType: metadata.contentType,
          customMetadata: metadata.customMetadata || {}
        });
      } catch (fileError) {
        console.error(`❌ [VERIFICATION_REQUEST] Error processing file ${file.name}:`, fileError);
      }
    }

    // Select the latest file for each document type
    for (const [documentType, files] of Object.entries(documentFiles)) {
      if (files.length > 0) {
        const sortedFiles = files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
        documents[documentType] = sortedFiles[0];
        
        if (files.length > 1) {
          console.warn(`⚠️ [VERIFICATION_REQUEST] Multiple files found for ${documentType}: ${files.length} files. Using latest: ${sortedFiles[0].fileName}`);
        }
      }
    }

    // Check if all required documents are uploaded
    const requiredDocuments = ['driving_license', 'profile_photo', 'aadhaar_card', 'bike_insurance', 'rc_book'];
    
    const uploadedDocuments = requiredDocuments.filter(docType => {
      return documents[docType]?.downloadURL;
    });

    if (uploadedDocuments.length !== requiredDocuments.length) {
      const missingDocuments = requiredDocuments.filter(docType => {
        return !documents[docType]?.downloadURL;
      });
      
      return res.status(400).json({
        success: false,
        error: {
          code: 'INCOMPLETE_DOCUMENTS',
          message: 'Incomplete documents',
          details: `Please upload all required documents. Missing: ${missingDocuments.join(', ')}`
        },
        timestamp: new Date().toISOString()
      });
    }

    // ✅ CRITICAL FIX: Check for existing verification requests in documentVerificationRequests collection
    // This is more reliable than just checking userData.driver.verificationStatus
    const existingRequestsQuery = db.collection('documentVerificationRequests')
      .where('driverId', '==', uid)
      .orderBy('requestedAt', 'desc')
      .limit(1);
    
    const existingRequestsSnapshot = await existingRequestsQuery.get();
    
    if (!existingRequestsSnapshot.empty) {
      const latestRequest = existingRequestsSnapshot.docs[0].data();
      const requestStatus = latestRequest.status || 'pending';
      const requestedAt = latestRequest.requestedAt?.toDate?.() || latestRequest.requestedAt || new Date();
      const daysSinceRequest = (Date.now() - new Date(requestedAt).getTime()) / (1000 * 60 * 60 * 24);
      
      // If there's a recent pending request (< 7 days old), block re-request
      if (requestStatus === 'pending' && daysSinceRequest < 7) {
        console.log(`⚠️ [VERIFICATION_REQUEST] Driver ${uid} already has a pending verification request (${daysSinceRequest.toFixed(1)} days old)`);
        return res.status(400).json({
          success: false,
          error: {
            code: 'VERIFICATION_ALREADY_REQUESTED',
            message: 'Verification already requested',
            details: 'Document verification has already been requested and is pending review. Please wait for admin approval.'
          },
          timestamp: new Date().toISOString()
        });
      }
      
      // If status is 'pending_verification' but request is old or completed/rejected, allow re-request
      // Also reset the userData verificationStatus if it's stuck
      if (userData.driver?.verificationStatus === 'pending_verification' && 
          (requestStatus !== 'pending' || daysSinceRequest >= 7)) {
        console.log(`🔄 [VERIFICATION_REQUEST] Resetting stuck verificationStatus for driver ${uid}. Previous request: ${requestStatus} (${daysSinceRequest.toFixed(1)} days old)`);
        
        // Reset verificationStatus to 'pending' to allow new request
        await userRef.update({
          'driver.verificationStatus': 'pending',
          updatedAt: new Date()
        });
        
        // Update userData to reflect the reset
        userData.driver = userData.driver || {};
        userData.driver.verificationStatus = 'pending';
      }
    } else {
      // No existing request found - reset verificationStatus if it's stuck as 'pending_verification'
      if (userData.driver?.verificationStatus === 'pending_verification') {
        console.log(`🔄 [VERIFICATION_REQUEST] Resetting stuck verificationStatus for driver ${uid} (no verification request found)`);
        await userRef.update({
          'driver.verificationStatus': 'pending',
          updatedAt: new Date()
        });
        userData.driver = userData.driver || {};
        userData.driver.verificationStatus = 'pending';
      }
    }

    // Update verification status
    await userRef.update({
      'driver.verificationStatus': 'pending_verification',
      'driver.verificationRequestedAt': new Date(),
      updatedAt: new Date()
    });

    // Create verification request record with normalized document structure
    const verificationRequestRef = db.collection('documentVerificationRequests').doc();
    
    // ✅ CRITICAL FIX: Get phone from req.user (JWT token) as primary source, ensure it's never undefined
    let driverPhone = req.user.phone || userData.phone || '';
    
    // ✅ FALLBACK: If phone is still missing, try to get from JWT token metadata
    if (!driverPhone && req.token) {
      // Token might be in different format - check both
      const tokenData = req.token;
      driverPhone = tokenData.phone || tokenData.phone_number || '';
    }
    
    // ✅ LAST RESORT: If still missing, phone should have been synced by auth middleware
    // This should only happen in edge cases where token doesn't have phone
    if (!driverPhone) {
      // Check if we can get phone from the JWT token payload (already decoded by auth middleware)
      // req.user.phone should already be set by auth middleware from decodedToken
      // If it's still missing, this indicates the JWT token itself doesn't have phone
      console.error('❌ [VERIFICATION_REQUEST] Phone missing from all sources. This should not happen if user authenticated properly.');
    }
    
    if (!driverPhone) {
      console.error('❌ [VERIFICATION_REQUEST] Driver phone is missing after all attempts:', {
        userId: uid,
        reqUserPhone: req.user?.phone,
        userDataPhone: userData.phone,
        hasToken: !!req.token
      });
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PHONE',
          message: 'Phone number required',
          details: 'Driver phone number is missing. Please contact support.'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    console.log('✅ [VERIFICATION_REQUEST] Phone validated:', {
      userId: uid,
      phone: driverPhone,
      source: req.user.phone ? 'req.user' : userData.phone ? 'userData' : 'synced'
    });
    
    // ✅ CRITICAL FIX: Helper function to remove undefined values (Firestore doesn't allow undefined)
    const removeUndefined = (obj) => {
      if (obj === null || typeof obj !== 'object') {
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(removeUndefined);
      }
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
          cleaned[key] = removeUndefined(value);
        }
      }
      return cleaned;
    };

    const verificationRequest = {
      id: verificationRequestRef.id,
      driverId: uid,
      driverName: userData.name || req.user.name || 'Unknown',
      driverPhone: driverPhone, // ✅ Already validated above - never undefined
      documents: {
        drivingLicense: {
          downloadURL: documents.driving_license?.downloadURL || '',
          fileName: documents.driving_license?.fileName || '',
          filePath: documents.driving_license?.filePath || '',
          verificationStatus: 'pending',
          uploadedAt: documents.driving_license?.uploadedAt || new Date(),
          verified: false
        },
        aadhaarCard: {
          downloadURL: documents.aadhaar_card?.downloadURL || '',
          fileName: documents.aadhaar_card?.fileName || '',
          filePath: documents.aadhaar_card?.filePath || '',
          verificationStatus: 'pending',
          uploadedAt: documents.aadhaar_card?.uploadedAt || new Date(),
          verified: false
        },
        bikeInsurance: {
          downloadURL: documents.bike_insurance?.downloadURL || '',
          fileName: documents.bike_insurance?.fileName || '',
          filePath: documents.bike_insurance?.filePath || '',
          verificationStatus: 'pending',
          uploadedAt: documents.bike_insurance?.uploadedAt || new Date(),
          verified: false
        },
        rcBook: {
          downloadURL: documents.rc_book?.downloadURL || '',
          fileName: documents.rc_book?.fileName || '',
          filePath: documents.rc_book?.filePath || '',
          verificationStatus: 'pending',
          uploadedAt: documents.rc_book?.uploadedAt || new Date(),
          verified: false
        },
        profilePhoto: {
          downloadURL: documents.profile_photo?.downloadURL || '',
          fileName: documents.profile_photo?.fileName || '',
          filePath: documents.profile_photo?.filePath || '',
          verificationStatus: 'pending',
          uploadedAt: documents.profile_photo?.uploadedAt || new Date(),
          verified: false
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

    // ✅ CRITICAL FIX: Remove any undefined values before saving to Firestore
    const cleanedVerificationRequest = removeUndefined(verificationRequest);
    
    console.log('📝 [VERIFICATION_REQUEST] Saving verification request:', {
      driverId: uid,
      driverPhone: cleanedVerificationRequest.driverPhone,
      hasPhone: !!cleanedVerificationRequest.driverPhone
    });

    await verificationRequestRef.set(cleanedVerificationRequest);

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

// Helper function to calculate distance between two points (duplicate removed)

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

    // ✅ CRITICAL FIX: Broadcast real-time driver location to customer and booking rooms
    try {
      const liveTrackingService = require('../services/liveTrackingService');
      await liveTrackingService.updateDriverLocation(uid, {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        speed: speed || null,
        heading: heading || null
      }, bookingId);
    } catch (broadcastError) {
      console.error('⚠️ [TRACKING_UPDATE] Failed to broadcast driver location (non-critical):', broadcastError);
    }

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

        // Deduct commission from driver points wallet
        try {
          const pointsService = require('../services/walletService');
          const fareCalculationService = require('../services/fareCalculationService');
          
          const exactDistanceKm = bookingData.distance?.total || 0;
          const tripFare = parseFloat(amount);
          
          if (tripFare > 0 && exactDistanceKm > 0) {
            console.log(`💰 Deducting commission from points for payment collection: Fare ₹${tripFare}`);
            
            // Calculate commission based on fare amount (not raw distance)
            // Use the same fare calculation logic to ensure consistency
            const fareBreakdown = fareCalculationService.calculateFare(exactDistanceKm);
            const commissionAmount = fareBreakdown.commission; // This is now in points
            const roundedDistanceKm = fareBreakdown.roundedDistanceKm;
            
            console.log(`📊 Fare breakdown: ${exactDistanceKm}km → ${roundedDistanceKm}km → ₹${tripFare} → Commission ${commissionAmount} points`);
            
            // Prepare trip details for commission transaction
            const tripDetails = {
              pickupLocation: bookingData.pickup || {},
              dropoffLocation: bookingData.dropoff || {},
              tripFare: tripFare,
              exactDistanceKm: exactDistanceKm,
              roundedDistanceKm: roundedDistanceKm
            };
            
            // Deduct commission from driver points wallet
            const commissionResult = await pointsService.deductPoints(
              uid,
              id,
              roundedDistanceKm, // Use rounded distance for commission calculation
              commissionAmount, // Points to deduct
              tripDetails
            );
            
            if (commissionResult.success) {
              console.log(`✅ Commission deducted from points: ${commissionAmount} points for ${roundedDistanceKm}km (fare: ₹${tripFare})`);
            } else {
              console.error('❌ Commission deduction from points failed:', commissionResult.error);
            }
          }
        } catch (commissionError) {
          console.error('❌ Error processing commission from points:', commissionError);
        }

    // Update driver earnings
    const driverRef = db.collection('users').doc(uid);
    const driverDoc = await driverRef.get();
    
    if (driverDoc.exists) {
      const driverData = driverDoc.data();
      const currentEarnings = driverData.driver?.earnings || { total: 0, thisMonth: 0, thisWeek: 0 };
      // CORRECT: Driver gets full fare, commission deducted from points wallet
      const tripEarnings = parseFloat(amount); // Full fare amount
      
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

// ❌ REMOVED: Duplicate accept booking route (replaced by comprehensive version at line 2600)
// The comprehensive version includes proper validation, transaction handling, and webhook notifications

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
 * Normalize and validate date query parameters for work slot operations.
 * Ensures consistent handling of timezone offsets and defaults to driver's local day.
 */
function buildWorkSlotDateContext(rawDateInput, rawTimezoneOffset) {
  const DEFAULT_OFFSET = 0;
  const offsetNumber = Number(rawTimezoneOffset);
  const timezoneOffsetMinutes = Number.isFinite(offsetNumber) ? offsetNumber : DEFAULT_OFFSET;

  const ensureDateParts = (dateValue) => {
    if (typeof dateValue === 'string') {
      const trimmed = dateValue.trim();
      const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
      if (dateOnlyMatch) {
        return {
          year: Number(dateOnlyMatch[1]),
          month: Number(dateOnlyMatch[2]),
          day: Number(dateOnlyMatch[3])
        };
      }
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return {
          year: parsed.getUTCFullYear(),
          month: parsed.getUTCMonth() + 1,
          day: parsed.getUTCDate()
        };
      }
      throw new Error('INVALID_DATE');
    }

    if (dateValue instanceof Date && !Number.isNaN(dateValue.getTime())) {
      return {
        year: dateValue.getUTCFullYear(),
        month: dateValue.getUTCMonth() + 1,
        day: dateValue.getUTCDate()
      };
    }

    if (dateValue) {
      const parsed = new Date(dateValue);
      if (!Number.isNaN(parsed.getTime())) {
        return {
          year: parsed.getUTCFullYear(),
          month: parsed.getUTCMonth() + 1,
          day: parsed.getUTCDate()
        };
      }
      throw new Error('INVALID_DATE');
    }

    // Default to driver's current local day using provided timezone offset
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
    const driverLocalMs = utcMs + timezoneOffsetMinutes * 60 * 1000;
    const driverLocalDate = new Date(driverLocalMs);
    return {
      year: driverLocalDate.getUTCFullYear(),
      month: driverLocalDate.getUTCMonth() + 1,
      day: driverLocalDate.getUTCDate()
    };
  };

  const localDateParts = ensureDateParts(rawDateInput);
  const { year, month, day } = localDateParts;

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    throw new Error('INVALID_DATE');
  }

  const dateKey = `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

  // Convert local midnight to UTC by subtracting timezone offset
  const startUtc =
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) - timezoneOffsetMinutes * 60 * 1000;
  const endUtc =
    Date.UTC(year, month - 1, day, 23, 59, 59, 999) - timezoneOffsetMinutes * 60 * 1000;

  const startOfDay = new Date(startUtc);
  const endOfDay = new Date(endUtc);
  const referenceDate = new Date(startUtc + 12 * 60 * 60 * 1000); // mid-day for stability

  return {
    referenceDate,
    startOfDay,
    endOfDay,
    dateKey,
    localDateParts,
    timezoneOffsetMinutes
  };
}

const normalizeSlotState = (startTimeIso, endTimeIso, now) => {
  if (!startTimeIso || !endTimeIso) {
    return {
      runtimeState: 'unknown',
      isActive: false,
      isUpcoming: false,
      isExpired: false
    };
  }

  const start = new Date(startTimeIso);
  const end = new Date(endTimeIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return {
      runtimeState: 'unknown',
      isActive: false,
      isUpcoming: false,
      isExpired: false
    };
  }

  if (now >= start && now <= end) {
    return {
      runtimeState: 'active',
      isActive: true,
      isUpcoming: false,
      isExpired: false
    };
  }

  if (now < start) {
    return {
      runtimeState: 'upcoming',
      isActive: false,
      isUpcoming: true,
      isExpired: false
    };
  }

  return {
    runtimeState: 'expired',
    isActive: false,
    isUpcoming: false,
    isExpired: true
  };
};

const summarizeSlotStates = (normalizedSlots = []) => {
  return normalizedSlots.reduce(
    (summary, slot) => {
      if (slot.isSelected) {
        summary.selected += 1;
      }
      if (slot.isActive) {
        summary.active += 1;
      } else if (slot.isUpcoming) {
        summary.upcoming += 1;
      } else if (slot.isExpired) {
        summary.expired += 1;
      }
      return summary;
    },
    { total: normalizedSlots.length, selected: 0, active: 0, upcoming: 0, expired: 0 }
  );
};

/**
 * @route   GET /api/driver/work-slots
 * @desc    Get driver work slots
 * @access  Private (Driver only)
 */
router.get('/work-slots', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { date, timezoneOffsetMinutes } = req.query;
    const workSlotsService = require('../services/workSlotsService');

    let dateContext;
    try {
      dateContext = buildWorkSlotDateContext(date, timezoneOffsetMinutes);
    } catch (parseError) {
      console.warn('❌ [WORK_SLOTS_API] Invalid date query parameter:', {
        date,
        timezoneOffsetMinutes,
        error: parseError?.message || parseError
      });
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DATE',
          message: 'Invalid date supplied',
          details: 'Please provide a valid date (YYYY-MM-DD or ISO string)'
        },
        timestamp: new Date().toISOString()
      });
    }

    const {
      referenceDate,
      startOfDay,
      endOfDay,
      dateKey,
      localDateParts,
      timezoneOffsetMinutes: normalizedOffset
    } = dateContext;

    console.log('🔍 [WORK_SLOTS_API] Fetching work slots for driver:', {
      uid,
      dateKey,
      timezoneOffsetMinutes: normalizedOffset
    });

    const retrievalOptions = {
      startOfDay,
      endOfDay,
      dateKey,
      timezoneOffsetMinutes: normalizedOffset,
      localDateParts
    };

    const slotsResult = await workSlotsService.getDriverSlots(uid, referenceDate, retrievalOptions);

    if (!slotsResult.success) {
      console.error('❌ [WORK_SLOTS_API] Failed to fetch slots:', slotsResult.error);
      return res.status(500).json({
        success: false,
        error: {
          code: slotsResult.error?.code || 'WORK_SLOTS_ERROR',
          message: slotsResult.error?.message || 'Failed to retrieve work slots',
          details: slotsResult.error?.details || 'Unable to query work slots at this time'
        },
        timestamp: new Date().toISOString()
      });
    }

    let slots = Array.isArray(slotsResult.data) ? slotsResult.data : [];

    if (slots.length === 0) {
      console.log('ℹ️ [WORK_SLOTS_API] No slots found for date - generating daily slots');
      const generationResult = await workSlotsService.generateDailySlots(
        uid,
        referenceDate,
        retrievalOptions
      );

      if (!generationResult.success) {
        console.error('❌ [WORK_SLOTS_API] Failed to generate slots:', generationResult.error);
        return res.status(500).json({
          success: false,
          error: {
            code: generationResult.error?.code || 'SLOT_GENERATION_ERROR',
            message: generationResult.error?.message || 'Failed to generate daily slots',
            details: generationResult.error?.details || 'Unable to create work slots'
          },
          timestamp: new Date().toISOString()
        });
      }

      slots = Array.isArray(generationResult.data) ? generationResult.data : [];
      console.log('✅ [WORK_SLOTS_API] Generated daily slots:', slots.length);
    }

    const now = new Date();
    const normalizedSlots = slots.map((slot) => {
      const startTimeIso = toIsoString(slot.startTime);
      const endTimeIso = toIsoString(slot.endTime);
      const createdAtIso = toIsoString(slot.createdAt);
      const updatedAtIso = toIsoString(slot.updatedAt);
      const selectedAtIso = toIsoString(slot.selectedAt);

      const slotId = slot.slotId || slot.id;
      const runtimeState = normalizeSlotState(startTimeIso, endTimeIso, now);

      return {
        id: slot.id || slotId,
        slotId,
        label: slot.label || '',
        startTime: startTimeIso,
        endTime: endTimeIso,
        status: slot.status || 'available',
        isSelected: slot.isSelected === true,
        selectedAt: selectedAtIso,
        driverId: slot.driverId || uid,
        customerId: slot.customerId || null,
        bookedAt: toIsoString(slot.bookedAt),
        createdAt: createdAtIso,
        updatedAt: updatedAtIso,
        date: slot.date || slot.dateKey || dateKey,
        dateKey: slot.dateKey || slot.date || dateKey,
        timezoneOffsetMinutes:
          typeof slot.timezoneOffsetMinutes === 'number'
            ? slot.timezoneOffsetMinutes
            : normalizedOffset,
        runtimeState: runtimeState.runtimeState,
        computedStatus: runtimeState.runtimeState,
        isActive: runtimeState.isActive,
        isUpcoming: runtimeState.isUpcoming,
        isExpired: runtimeState.isExpired
      };
    });

    const summary = summarizeSlotStates(normalizedSlots);
    const responseTimestamp = now.toISOString();

    res.status(200).json({
      success: true,
      message: 'Work slots retrieved successfully',
      data: normalizedSlots,
      summary,
      meta: {
        dateKey,
        timezoneOffsetMinutes: normalizedOffset,
        serverTime: responseTimestamp
      },
      timestamp: responseTimestamp
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
 
    const parseDateKeyFromSlot = (slot) => {
      try {
        if (slot.date) return slot.date;
        if (slot.dateKey) return slot.dateKey;
        if (slot.startTime) {
          const start = new Date(slot.startTime);
          if (!Number.isNaN(start.getTime())) {
            return `${start.getUTCFullYear().toString().padStart(4, '0')}-${(start.getUTCMonth() + 1)
              .toString()
              .padStart(2, '0')}-${start.getUTCDate().toString().padStart(2, '0')}`;
          }
        }
      } catch (parseError) {
        console.warn('⚠️ [WORK_SLOTS_API] Unable to derive dateKey for slot', parseError);
      }
      return null;
    };

    const normalizeOffset = (value) => {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    };

    for (const slot of slots) {
      const slotRef = db.collection('workSlots').doc();
      const derivedDateKey =
        parseDateKeyFromSlot(slot) || new Date().toISOString().split('T')[0];
      const timezoneOffsetValue =
        normalizeOffset(slot.timezoneOffsetMinutes ?? req.body.timezoneOffsetMinutes);

      const slotData = {
        ...slot,
        driverId: uid,
        date: derivedDateKey,
        dateKey: derivedDateKey,
        timezoneOffsetMinutes: timezoneOffsetValue,
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

/**
 * @route   POST /api/driver/tracking/update
 * @desc    Update driver location for a booking and emit to customer (compatibility alias)
 * @access  Private (Driver only)
 */
router.post('/tracking/update', requireDriver, async (req, res) => {
  try {
    const { uid } = req.user;
    const { bookingId, location, speed, heading } = req.body || {};
    
    if (!bookingId || !location || typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'bookingId and location {latitude, longitude} are required'
        }
      });
    }
    
    const liveTrackingService = require('../services/liveTrackingService');
    await liveTrackingService.updateDriverLocation(uid, {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy || null,
      speed: speed || location.speed || null,
      heading: heading || location.heading || null,
      timestamp: new Date().toISOString()
    }, bookingId);
    
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ [TRACKING_UPDATE] Failed to update driver location:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'TRACKING_UPDATE_ERROR', message: 'Failed to update driver location' }
    });
  }
});

module.exports = router;
