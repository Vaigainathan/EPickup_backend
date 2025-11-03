const express = require('express');
const router = express.Router();
const { getFirestore } = require('firebase-admin/firestore');
const { authenticateToken } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

/**
 * @route GET /api/customer/profile
 * @desc Get customer profile (backend handles UID mapping)
 * @access Private (Customer only)
 */
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user; // This is the customer UID from JWT
    const db = getFirestore();
    
    console.log(`📋 Getting customer profile for: ${userId}`);
    
    // Get customer data from users collection
    const customerDoc = await db.collection('users').doc(userId).get();
    
    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Customer profile not found'
      });
    }
    
    const customerData = customerDoc.data();
    
    // Return customer-specific data
    const customerProfile = {
      id: userId,
      phone: customerData.phone,
      name: customerData.customer?.name || customerData.name || '',
      email: customerData.customer?.email || customerData.email || '',
      address: customerData.customer?.address || '',
      profilePicture: customerData.profilePicture || customerData.customer?.profilePhoto || customerData.photoURL || customerData.profile?.photo || null,
      preferences: customerData.customer?.preferences || {},
      userType: 'customer',
      isActive: customerData.isActive !== false,
      accountStatus: customerData.accountStatus || 'active',
      createdAt: customerData.createdAt?.toDate?.() || customerData.createdAt,
      updatedAt: customerData.updatedAt?.toDate?.() || customerData.updatedAt
    };
    
    console.log(`✅ Retrieved customer profile: ${userId}`);
    
    res.json({
      success: true,
      data: customerProfile
    });
    
  } catch (error) {
    console.error('❌ Error getting customer profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve customer profile',
      details: error.message
    });
  }
});

/**
 * @route PUT /api/customer/profile
 * @desc Update customer profile
 * @access Private (Customer only)
 */
router.put('/profile', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { name, email, phone, address, preferences, profilePicture } = req.body;
    const db = getFirestore();
    
    console.log(`📝 Updating customer profile for: ${userId}`);
    console.log(`📝 Update data received:`, { name, email, phone, address, preferences, profilePicture });
    
    // Validate email format if provided
    if (email && !email.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format',
        details: 'Please provide a valid email address'
      });
    }
    
    // Update customer data in users collection
    const updateData = {
      updatedAt: new Date()
    };
    
    if (name !== undefined) {
      updateData['customer.name'] = name;
      updateData['name'] = name; // Also update at root level
    }
    if (email !== undefined) {
      updateData['customer.email'] = email;
      updateData['email'] = email; // Also update at root level
    }
    if (phone !== undefined) updateData['phone'] = phone; // Update phone at root level
    if (address !== undefined) updateData['customer.address'] = address;
    if (preferences !== undefined) updateData['customer.preferences'] = preferences;
    if (profilePicture !== undefined) {
      updateData['profilePicture'] = profilePicture;
      updateData['customer.profilePhoto'] = profilePicture;
      updateData['photoURL'] = profilePicture;
    }
    
    await db.collection('users').doc(userId).update(updateData);
    
    console.log(`✅ Updated customer profile: ${userId}`);
    
    res.json({
      success: true,
      message: 'Customer profile updated successfully'
    });
    
  } catch (error) {
    console.error('❌ Error updating customer profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update customer profile',
      details: error.message
    });
  }
});

/**
 * @route POST /api/customer/set-password
 * @desc Set customer password
 * @access Private (Customer only)
 */
router.post('/set-password', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { password } = req.body;
    const db = getFirestore();
    
    console.log(`🔐 Setting password for customer: ${userId}`);
    
    if (!password || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long'
      });
    }
    
    // Update customer data to indicate password is set
    await db.collection('users').doc(userId).update({
      'customer.hasPassword': true,
      'customer.passwordSetAt': new Date(),
      updatedAt: new Date()
    });
    
    console.log(`✅ Password set for customer: ${userId}`);
    
    res.json({
      success: true,
      message: 'Password set successfully'
    });
    
  } catch (error) {
    console.error('❌ Error setting password:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to set password',
      details: error.message
    });
  }
});

/**
 * @route POST /api/customer/deactivate-account
 * @desc Deactivate customer account
 * @access Private (Customer only)
 */
router.post('/deactivate-account', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { reason } = req.body;
    const db = getFirestore();
    
    console.log(`⏸️ Deactivating customer account: ${userId}`);
    
    // Update customer account status
    await db.collection('users').doc(userId).update({
      accountStatus: 'inactive',
      deactivatedAt: new Date(),
      deactivationReason: reason || 'User requested deactivation',
      updatedAt: new Date()
    });
    
    console.log(`✅ Customer account deactivated: ${userId}`);
    
    res.json({
      success: true,
      message: 'Account deactivated successfully'
    });
    
  } catch (error) {
    console.error('❌ Error deactivating account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to deactivate account',
      details: error.message
    });
  }
});

/**
 * @route DELETE /api/customer/delete-account
 * @desc Delete customer account permanently
 * @access Private (Customer only)
 */
router.delete('/delete-account', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { reason } = req.body;
    const db = getFirestore();
    
    console.log(`🗑️ Deleting customer account: ${userId}`);
    
    // Update account status to deleted (soft delete for data retention)
    await db.collection('users').doc(userId).update({
      accountStatus: 'deleted',
      deletedAt: new Date(),
      deletionReason: reason || 'User requested permanent deletion',
      updatedAt: new Date()
    });
    
    console.log(`✅ Customer account deleted: ${userId}`);
    
    res.json({
      success: true,
      message: 'Account deleted successfully'
    });
    
  } catch (error) {
    console.error('❌ Error deleting account:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete account',
      details: error.message
    });
  }
});

// REMOVED: /api/customer/upload-photo endpoint
// This was redundant - profile photo uploads now use /api/file-upload/customer-document
// which handles file upload to Firebase Storage and returns downloadURL

/**
 * @route GET /api/customer/bookings
 * @desc Get customer bookings
 * @access Private (Customer only)
 */
router.get('/bookings', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { status, limit = 20, offset = 0 } = req.query;
    const db = getFirestore();
    
    console.log(`📋 Getting bookings for customer: ${userId}`);
    
    let query = db.collection('bookings').where('customerId', '==', userId);
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
    query = query.orderBy('createdAt', 'desc')
                .limit(parseInt(limit))
                .offset(parseInt(offset));
    
    const snapshot = await query.get();
    const bookings = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      bookings.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });
    
    console.log(`✅ Retrieved ${bookings.length} bookings for customer: ${userId}`);
    
    res.json({
      success: true,
      data: bookings,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: bookings.length
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting customer bookings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve bookings',
      details: error.message
    });
  }
});

/**
 * @route GET /api/customer/bookings/:id
 * @desc Get single booking by ID
 * @access Private (Customer only)
 */
router.get('/bookings/:id', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { id: bookingId } = req.params;
    const db = getFirestore();
    
    console.log(`📋 Getting booking ${bookingId} for customer: ${userId}`);
    
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found',
        details: 'The requested booking does not exist'
      });
    }
    
    const bookingData = bookingDoc.data();
    
    // Check if customer owns this booking
    if (bookingData.customerId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
        details: 'You can only access your own bookings'
      });
    }
    
    // Format the response
    const booking = {
      id: bookingDoc.id,
      ...bookingData,
      createdAt: bookingData.createdAt?.toDate?.() || bookingData.createdAt,
      updatedAt: bookingData.updatedAt?.toDate?.() || bookingData.updatedAt
    };
    
    res.json({
      success: true,
      data: booking
    });
    
  } catch (error) {
    console.error('❌ Error getting booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve booking',
      details: error.message
    });
  }
});

/**
 * @route GET /api/customer/active-booking
 * @desc Get customer's active booking
 * @access Private (Customer only)
 */
router.get('/active-booking', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const db = getFirestore();
    
    console.log(`🔍 Getting active booking for customer: ${userId}`);
    
    // ✅ CRITICAL FIX: Only consider bookings with assigned drivers as "active"
    // ✅ Use shared constants for consistency (includes money_collection and delivered for payment flow)
    const { ACTIVE_BOOKING_WITH_DRIVER_STATUSES } = require('../constants/bookingStatuses');
    const activeBookingsQuery = db.collection('bookings')
      .where('customerId', '==', userId)
      .where('status', 'in', ACTIVE_BOOKING_WITH_DRIVER_STATUSES)
      .orderBy('createdAt', 'desc')
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
    
    res.json({
      success: true,
      data: { booking },
      message: 'Active booking retrieved successfully'
    });
    
  } catch (error) {
    console.error('❌ Error getting active booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve active booking',
      details: error.message
    });
  }
});

/**
 * @route GET /api/customer/pending-booking
 * @desc Get customer's pending booking (for driver matching screen)
 * @access Private (Customer only)
 */
router.get('/pending-booking', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const db = getFirestore();
    
    console.log(`🔍 Getting pending booking for customer: ${userId}`);
    
    // ✅ Use shared constants for consistency
    const { PENDING_BOOKING_STATUSES } = require('../constants/bookingStatuses');
    const pendingBookingsQuery = db.collection('bookings')
      .where('customerId', '==', userId)
      .where('status', 'in', PENDING_BOOKING_STATUSES)
      .orderBy('createdAt', 'desc')
      .limit(1);
    
    const snapshot = await pendingBookingsQuery.get();
    
    if (snapshot.empty) {
      return res.json({
        success: true,
        data: { booking: null },
        message: 'No pending booking found'
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
    
    res.json({
      success: true,
      data: { booking },
      message: 'Pending booking retrieved successfully'
    });
    
  } catch (error) {
    console.error('❌ Error getting pending booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve pending booking',
      details: error.message
    });
  }
});

/**
 * @route POST /api/customer/bookings
 * @desc Create new booking
 * @access Private (Customer only)
 */
router.post('/bookings', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const bookingData = req.body;
    const db = getFirestore();
    
    console.log(`📝 Creating booking for customer: ${userId}`);
    
    // Validate required booking fields
    if (!bookingData.pickup || !bookingData.dropoff || !bookingData.package) {
      console.error('❌ Missing required booking fields:', {
        hasPickup: !!bookingData.pickup,
        hasDropoff: !!bookingData.dropoff,
        hasPackage: !!bookingData.package,
        bookingData: bookingData
      });
      return res.status(400).json({
        success: false,
        error: 'Missing required booking fields',
        details: 'pickup, dropoff, and package are required'
      });
    }
    
    // Validate pickup coordinates
    if (!bookingData.pickup.coordinates || !bookingData.pickup.coordinates.latitude || !bookingData.pickup.coordinates.longitude) {
      console.error('❌ Invalid pickup coordinates:', bookingData.pickup);
      return res.status(400).json({
        success: false,
        error: 'Invalid pickup coordinates',
        details: 'Pickup location coordinates are required'
      });
    }
    
    // Validate dropoff coordinates
    if (!bookingData.dropoff.coordinates || !bookingData.dropoff.coordinates.latitude || !bookingData.dropoff.coordinates.longitude) {
      console.error('❌ Invalid dropoff coordinates:', bookingData.dropoff);
      return res.status(400).json({
        success: false,
        error: 'Invalid dropoff coordinates',
        details: 'Dropoff location coordinates are required'
      });
    }
    
    // Calculate fare using the dedicated fare calculation service
    const fareCalculationService = require('../services/fareCalculationService');
    
    let fareDetails;
    let distance;
    
    try {
      // Calculate distance and fare using the proper service
      const pickupCoords = {
        lat: bookingData.pickup.coordinates.latitude,
        lng: bookingData.pickup.coordinates.longitude
      };
      const dropoffCoords = {
        lat: bookingData.dropoff.coordinates.latitude,
        lng: bookingData.dropoff.coordinates.longitude
      };
      
      console.log('📍 Calculating fare for coordinates:', { pickupCoords, dropoffCoords });
      
      const distanceAndFare = await fareCalculationService.calculateDistanceAndFare(pickupCoords, dropoffCoords);
      fareDetails = distanceAndFare.fare;
      distance = distanceAndFare.distanceKm;
      
      console.log(`💰 Calculated fare for booking: ₹${fareDetails.baseFare} (${distance}km)`);
    } catch (error) {
      console.error('❌ Error calculating fare, using fallback:', error);
      // Fallback to basic calculation if service fails
      distance = 5; // Default distance
      fareDetails = fareCalculationService.calculateFare(distance);
      console.log(`💰 Using fallback fare: ₹${fareDetails.baseFare} (${distance}km)`);
    }
    
    // Add customer ID and fare information to booking data
    const newBooking = {
      ...bookingData,
      customerId: userId,
      status: 'pending',
      paymentStatus: 'pending',
      fare: {
        baseFare: fareDetails.baseFare,
        distanceFare: fareDetails.baseFare, // Simple fare: distance charge only, no minimum fare
        totalFare: fareDetails.baseFare,
        currency: 'INR',
        commission: fareDetails.commission,
        driverNet: fareDetails.driverNet,
        companyRevenue: fareDetails.companyRevenue
      },
      pricing: {
        baseFare: fareDetails.baseFare,
        distanceFare: fareDetails.baseFare, // Simple fare: distance charge only, no minimum fare
        totalFare: fareDetails.baseFare,
        currency: 'INR',
        commission: fareDetails.commission,
        driverNet: fareDetails.driverNet,
        companyRevenue: fareDetails.companyRevenue
      },
      distance: distance,
      exactDistance: fareDetails.exactDistanceKm,
      roundedDistance: fareDetails.roundedDistanceKm,
      fareBreakdown: fareDetails.breakdown,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // ✅ FIXED: Use ActiveBookingService for atomic active booking check
    const ActiveBookingService = require('../services/activeBookingService');
    const activeBookingService = new ActiveBookingService();
    
    console.log(`🔍 [BACKEND] Checking for active booking for customer: ${userId}`);
    const activeBookingCheck = await activeBookingService.hasActiveBooking(userId);
    console.log(`🔍 [BACKEND] Active booking check result:`, activeBookingCheck);
    
    if (activeBookingCheck.hasActive) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'CUSTOMER_ACTIVE_BOOKING_EXISTS',
          message: 'You already have an active booking. Please complete or cancel it before creating a new one.',
          details: {
            existingBookingId: activeBookingCheck.bookingId,
            status: activeBookingCheck.status,
            createdAt: activeBookingCheck.createdAt
          }
        },
        timestamp: new Date().toISOString()
      });
    }

    // Create booking in Firestore
    try {
      const bookingRef = await db.collection('bookings').add(newBooking);
      
      console.log(`✅ Created booking ${bookingRef.id} for customer: ${userId}`);
      
      res.json({
        success: true,
        data: {
          booking: {
            id: bookingRef.id,
            ...newBooking
          }
        },
        message: 'Booking created successfully'
      });
    } catch (firestoreError) {
      console.error('❌ Firestore error creating booking:', firestoreError);
      return res.status(500).json({
        success: false,
        error: 'Failed to save booking to database',
        details: firestoreError.message
      });
    }
    
  } catch (error) {
    console.error('❌ Error creating booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create booking',
      details: error.message
    });
  }
});

/**
 * @route PUT /api/customer/bookings/:bookingId/cancel
 * @desc Cancel booking
 * @access Private (Customer only)
 */
router.put('/bookings/:bookingId/cancel', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { bookingId } = req.params;
    const { reason } = req.body;
    const db = getFirestore();
    
    console.log(`❌ Cancelling booking ${bookingId} for customer: ${userId}`);
    
    // Check if booking exists and belongs to customer
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }
    
    const bookingData = bookingDoc.data();
    
    if (bookingData.customerId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to cancel this booking'
      });
    }
    
    // Update booking status
    await db.collection('bookings').doc(bookingId).update({
      status: 'cancelled',
      cancellationReason: reason,
      cancelledAt: new Date(),
      updatedAt: new Date()
    });
    
    console.log(`✅ Cancelled booking ${bookingId} for customer: ${userId}`);
    
    res.json({
      success: true,
      message: 'Booking cancelled successfully'
    });
    
  } catch (error) {
    console.error('❌ Error cancelling booking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to cancel booking',
      details: error.message
    });
  }
});

/**
 * @route GET /api/customer/addresses
 * @desc Get customer addresses
 * @access Private (Customer only)
 */
router.get('/addresses', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const db = getFirestore();
    
    console.log(`📍 Getting addresses for customer: ${userId}`);
    
    // 🚀 BACKEND CACHING: Check cache first (optional)
    const cacheKey = `addresses_${userId}`;
    let cachedAddresses = null;
    
    try {
      const cachingService = require('../services/cachingService');
      cachedAddresses = await cachingService.get(cacheKey, 'memory');
      if (cachedAddresses) {
        console.log(`⚡ Cache hit for addresses: ${userId}`);
        return res.json({
          success: true,
          data: cachedAddresses
        });
      }
    } catch (cacheError) {
      console.log('⚠️ Cache check failed, proceeding with database query:', cacheError.message);
    }
    
    // 🚀 OPTIMIZED: Fetch customer document
    const customerDoc = await db.collection('users').doc(userId).get();
    
    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }
    
    const customerData = customerDoc.data();
    const addresses = customerData.customer?.addresses || [];
    
    // 🚀 BACKEND CACHING: Cache the result (optional)
    try {
      const cachingService = require('../services/cachingService');
      await cachingService.set(cacheKey, addresses, 300, 'memory'); // 5 minutes cache
      console.log(`✅ Cached addresses for customer: ${userId}`);
    } catch (cacheError) {
      console.log('⚠️ Cache set failed, but continuing:', cacheError.message);
    }
    
    console.log(`✅ Retrieved ${addresses.length} addresses for customer: ${userId}`);
    
    res.json({
      success: true,
      data: addresses
    });
    
  } catch (error) {
    console.error('❌ Error getting customer addresses:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve addresses',
      details: error.message
    });
  }
});

/**
 * @route POST /api/customer/addresses
 * @desc Add customer address
 * @access Private (Customer only)
 */
router.post('/addresses', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const addressData = req.body;
    const db = getFirestore();
    
    console.log(`📍 Adding address for customer: ${userId}`);
    
    // Get current addresses
    const customerDoc = await db.collection('users').doc(userId).get();
    const customerData = customerDoc.data();
    const addresses = customerData.customer?.addresses || [];
    
    // Add new address
    const newAddress = {
      id: `addr_${Date.now()}`,
      ...addressData,
      createdAt: new Date()
    };
    
    addresses.push(newAddress);
    
    // Update customer document
    await db.collection('users').doc(userId).update({
      'customer.addresses': addresses,
      updatedAt: new Date()
    });
    
    // 🚀 BACKEND CACHING: Invalidate cache when addresses are updated
    const cacheKey = `addresses_${userId}`;
    const cachingService = require('../services/cachingService');
    try {
      await cachingService.delete(cacheKey, 'memory');
      console.log(`🗑️ Invalidated address cache for customer: ${userId}`);
    } catch (cacheError) {
      console.log('⚠️ Cache invalidation failed, but continuing:', cacheError.message);
    }
    
    console.log(`✅ Added address for customer: ${userId}`);
    
    res.json({
      success: true,
      data: newAddress,
      message: 'Address added successfully'
    });
    
  } catch (error) {
    console.error('❌ Error adding customer address:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add address',
      details: error.message
    });
  }
});

/**
 * @route PUT /api/customer/addresses/:addressId
 * @desc Update customer address
 * @access Private (Customer only)
 */
router.put('/addresses/:addressId', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { addressId } = req.params;
    const addressData = req.body;
    const db = getFirestore();
    
    console.log(`📍 Updating address ${addressId} for customer: ${userId}`);
    
    // Get current addresses
    const customerDoc = await db.collection('users').doc(userId).get();
    const customerData = customerDoc.data();
    const addresses = customerData.customer?.addresses || [];
    
    // Find and update address
    const addressIndex = addresses.findIndex(addr => addr.id === addressId);
    
    if (addressIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Address not found'
      });
    }
    
    addresses[addressIndex] = {
      ...addresses[addressIndex],
      ...addressData,
      updatedAt: new Date()
    };
    
    // Update customer document
    await db.collection('users').doc(userId).update({
      'customer.addresses': addresses,
      updatedAt: new Date()
    });
    
    console.log(`✅ Updated address ${addressId} for customer: ${userId}`);
    
    res.json({
      success: true,
      data: addresses[addressIndex],
      message: 'Address updated successfully'
    });
    
  } catch (error) {
    console.error('❌ Error updating customer address:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update address',
      details: error.message
    });
  }
});

/**
 * @route DELETE /api/customer/addresses/:addressId
 * @desc Delete customer address
 * @access Private (Customer only)
 */
router.delete('/addresses/:addressId', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { addressId } = req.params;
    const db = getFirestore();
    
    console.log(`📍 Deleting address ${addressId} for customer: ${userId}`);
    
    // Get current addresses
    const customerDoc = await db.collection('users').doc(userId).get();
    const customerData = customerDoc.data();
    const addresses = customerData.customer?.addresses || [];
    
    // Remove address
    const filteredAddresses = addresses.filter(addr => addr.id !== addressId);
    
    // Update customer document
    await db.collection('users').doc(userId).update({
      'customer.addresses': filteredAddresses,
      updatedAt: new Date()
    });
    
    // 🚀 BACKEND CACHING: Invalidate cache when addresses are deleted
    const cacheKey = `addresses_${userId}`;
    const cachingService = require('../services/cachingService');
    try {
      await cachingService.delete(cacheKey, 'memory');
      console.log(`🗑️ Invalidated address cache for customer: ${userId}`);
    } catch (cacheError) {
      console.log('⚠️ Cache invalidation failed, but continuing:', cacheError.message);
    }
    
    console.log(`✅ Deleted address ${addressId} for customer: ${userId}`);
    
    res.json({
      success: true,
      message: 'Address deleted successfully'
    });
    
  } catch (error) {
    console.error('❌ Error deleting customer address:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete address',
      details: error.message
    });
  }
});

/**
 * @route GET /api/customer/recent-addresses
 * @desc Get customer recent addresses
 * @access Private (Customer only)
 */
router.get('/recent-addresses', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { type, limit = 10 } = req.query;
    const db = getFirestore();
    
    console.log(`📍 Getting recent addresses for customer: ${userId}`);
    
    // 🚀 OPTIMIZED: Build query with filters
    let query = db.collection('users').doc(userId).collection('recentAddresses');
    
    if (type) {
      query = query.where('type', '==', type);
    }
    
    // 🚀 OPTIMIZED: Use limit and orderBy for faster queries
    const snapshot = await query
      .orderBy('usedAt', 'desc')
      .limit(Math.min(parseInt(limit), 50)) // Cap at 50 for performance
      .get();
    
    const recentAddresses = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));
    
    console.log(`✅ Retrieved ${recentAddresses.length} recent addresses for customer: ${userId}`);
    
    res.json({
      success: true,
      data: recentAddresses
    });
    
  } catch (error) {
    console.error('❌ Error getting recent addresses:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve recent addresses',
      details: error.message
    });
  }
});

/**
 * @route POST /api/customer/recent-addresses
 * @desc Add or update recent address
 * @access Private (Customer only)
 */
router.post('/recent-addresses', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { address, coordinates, type } = req.body;
    const db = getFirestore();
    
    console.log(`📍 Adding/updating recent address for customer: ${userId}`);
    
    // Check if address already exists
    const existingSnapshot = await db
      .collection('users')
      .doc(userId)
      .collection('recentAddresses')
      .where('address', '==', address)
      .where('type', '==', type)
      .limit(1)
      .get();
    
    if (!existingSnapshot.empty) {
      // Update existing
      const doc = existingSnapshot.docs[0];
      await doc.ref.update({
        usedAt: new Date(),
        usageCount: (doc.data().usageCount || 0) + 1,
        coordinates,
      });
      
      res.json({
        success: true,
        data: {
          id: doc.id,
          ...doc.data(),
          usedAt: new Date(),
          usageCount: (doc.data().usageCount || 0) + 1,
          coordinates,
        },
        message: 'Recent address updated'
      });
    } else {
      // Create new
      const newDoc = await db
        .collection('users')
        .doc(userId)
        .collection('recentAddresses')
        .add({
          address,
          coordinates,
          type,
          usedAt: new Date(),
          usageCount: 1,
        });
      
      res.json({
        success: true,
        data: {
          id: newDoc.id,
          address,
          coordinates,
          type,
          usedAt: new Date(),
          usageCount: 1,
        },
        message: 'Recent address added'
      });
      
      // Cleanup old entries (keep max 50 per type) - only for new addresses
      try {
        const allSnapshot = await db
          .collection('users')
          .doc(userId)
          .collection('recentAddresses')
          .where('type', '==', type)
          .orderBy('usedAt', 'desc')
          .get();
        
        if (allSnapshot.size > 50) {
          const batch = db.batch();
          allSnapshot.docs.slice(50).forEach(doc => {
            batch.delete(doc.ref);
          });
          await batch.commit();
        }
      } catch (cleanupError) {
        console.warn('⚠️ Failed to cleanup old recent addresses:', cleanupError);
        // Don't fail the main operation for cleanup issues
      }
    }
    
  } catch (error) {
    console.error('❌ Error adding recent address:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add recent address',
      details: error.message
    });
  }
});

/**
 * @route GET /api/customer/payments/methods
 * @desc Get customer payment methods
 * @access Private (Customer only)
 */
router.get('/payments/methods', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const db = getFirestore();
    
    console.log(`💳 Getting payment methods for customer: ${userId}`);
    
    const customerDoc = await db.collection('users').doc(userId).get();
    
    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }
    
    const customerData = customerDoc.data();
    const paymentMethods = customerData.customer?.paymentMethods || [];
    
    console.log(`✅ Retrieved ${paymentMethods.length} payment methods for customer: ${userId}`);
    
    res.json({
      success: true,
      data: paymentMethods
    });
    
  } catch (error) {
    console.error('❌ Error getting customer payment methods:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment methods',
      details: error.message
    });
  }
});

/**
 * @route POST /api/customer/payments/methods
 * @desc Add customer payment method
 * @access Private (Customer only)
 */
router.post('/payments/methods', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const paymentMethodData = req.body;
    const db = getFirestore();
    
    console.log(`💳 Adding payment method for customer: ${userId}`);
    
    // Get current payment methods
    const customerDoc = await db.collection('users').doc(userId).get();
    const customerData = customerDoc.data();
    const paymentMethods = customerData.customer?.paymentMethods || [];
    
    // Add new payment method
    const newPaymentMethod = {
      id: `pm_${Date.now()}`,
      ...paymentMethodData,
      createdAt: new Date(),
      isDefault: paymentMethods.length === 0 // First method is default
    };
    
    paymentMethods.push(newPaymentMethod);
    
    // Update customer document
    await db.collection('users').doc(userId).update({
      'customer.paymentMethods': paymentMethods,
      updatedAt: new Date()
    });
    
    console.log(`✅ Added payment method for customer: ${userId}`);
    
    res.json({
      success: true,
      data: newPaymentMethod,
      message: 'Payment method added successfully'
    });
    
  } catch (error) {
    console.error('❌ Error adding customer payment method:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add payment method',
      details: error.message
    });
  }
});

/**
 * @route GET /api/customer/payments/history
 * @desc Get customer payment history
 * @access Private (Customer only)
 */
router.get('/payments/history', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { limit = 20, offset = 0, startDate, endDate } = req.query;
    const db = getFirestore();
    
    console.log(`💳 Getting payment history for customer: ${userId}`);
    
    let query = db.collection('payments').where('customerId', '==', userId);
    
    if (startDate) {
      query = query.where('createdAt', '>=', new Date(startDate));
    }
    
    if (endDate) {
      query = query.where('createdAt', '<=', new Date(endDate));
    }
    
    query = query.orderBy('createdAt', 'desc')
                .limit(parseInt(limit))
                .offset(parseInt(offset));
    
    const snapshot = await query.get();
    const payments = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      payments.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });
    
    console.log(`✅ Retrieved ${payments.length} payments for customer: ${userId}`);
    
    res.json({
      success: true,
      data: payments,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: payments.length
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting customer payment history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment history',
      details: error.message
    });
  }
});

/**
 * @route GET /api/customer/tracking/:bookingId
 * @desc Get booking tracking information
 * @access Private (Customer only)
 */
router.get('/tracking/:bookingId', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { bookingId } = req.params;
    const db = getFirestore();
    
    console.log(`📍 Getting tracking info for booking ${bookingId} for customer: ${userId}`);
    
    // Check if booking exists and belongs to customer
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }
    
    const bookingData = bookingDoc.data();
    
    if (bookingData.customerId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to track this booking'
      });
    }
    
    // Get tracking data
    const trackingQuery = await db.collection('tracking')
      .where('bookingId', '==', bookingId)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();
    
    let trackingData = null;
    if (!trackingQuery.empty) {
      const trackingDoc = trackingQuery.docs[0];
      trackingData = {
        id: trackingDoc.id,
        ...trackingDoc.data(),
        timestamp: trackingDoc.data().timestamp?.toDate?.() || trackingDoc.data().timestamp
      };
    }
    
    console.log(`✅ Retrieved tracking info for booking ${bookingId}`);
    
    res.json({
      success: true,
      data: {
        booking: {
          id: bookingId,
          status: bookingData.status,
          pickup: bookingData.pickup,
          dropoff: bookingData.dropoff,
          driverId: bookingData.driverId
        },
        tracking: trackingData
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting tracking info:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve tracking information',
      details: error.message
    });
  }
});

/**
 * @route GET /api/customer/notifications
 * @desc Get customer notifications
 * @access Private (Customer only)
 */
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { limit = 20, offset = 0, unreadOnly } = req.query;
    const db = getFirestore();
    
    console.log(`🔔 Getting notifications for customer: ${userId}`);
    
    let query = db.collection('notifications').where('customerId', '==', userId);
    
    if (unreadOnly === 'true') {
      query = query.where('read', '==', false);
    }
    
    query = query.orderBy('createdAt', 'desc')
                .limit(parseInt(limit))
                .offset(parseInt(offset));
    
    const snapshot = await query.get();
    const notifications = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      notifications.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });
    
    console.log(`✅ Retrieved ${notifications.length} notifications for customer: ${userId}`);
    
    res.json({
      success: true,
      data: notifications,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: notifications.length
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting customer notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve notifications',
      details: error.message
    });
  }
});

/**
 * @route PUT /api/customer/notifications/:notificationId/read
 * @desc Mark notification as read
 * @access Private (Customer only)
 */
router.put('/notifications/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { notificationId } = req.params;
    const db = getFirestore();
    
    console.log(`🔔 Marking notification ${notificationId} as read for customer: ${userId}`);
    
    // Check if notification exists and belongs to customer
    const notificationDoc = await db.collection('notifications').doc(notificationId).get();
    
    if (!notificationDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }
    
    const notificationData = notificationDoc.data();
    
    if (notificationData.customerId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Unauthorized to mark this notification as read'
      });
    }
    
    // Update notification status
    await db.collection('notifications').doc(notificationId).update({
      read: true,
      readAt: new Date(),
      updatedAt: new Date()
    });
    
    console.log(`✅ Marked notification ${notificationId} as read for customer: ${userId}`);
    
    res.json({
      success: true,
      message: 'Notification marked as read'
    });
    
  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to mark notification as read',
      details: error.message
    });
  }
});

/**
 * @route GET /api/customer/support/tickets
 * @desc Get customer support tickets
 * @access Private (Customer only)
 */
router.get('/support/tickets', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { status, limit = 20, offset = 0 } = req.query;
    const db = getFirestore();
    
    console.log(`🎫 Getting support tickets for customer: ${userId}`);
    
    let query = db.collection('supportTickets').where('customerId', '==', userId);
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
    query = query.orderBy('createdAt', 'desc')
                .limit(parseInt(limit))
                .offset(parseInt(offset));
    
    const snapshot = await query.get();
    const tickets = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      tickets.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });
    
    console.log(`✅ Retrieved ${tickets.length} support tickets for customer: ${userId}`);
    
    res.json({
      success: true,
      data: tickets,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: tickets.length
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting customer support tickets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve support tickets',
      details: error.message
    });
  }
});

/**
 * @route POST /api/customer/support/tickets
 * @desc Create support ticket
 * @access Private (Customer only)
 */
router.post('/support/tickets', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const ticketData = req.body;
    const db = getFirestore();
    
    console.log(`🎫 Creating support ticket for customer: ${userId}`);
    
    // Add customer ID to ticket data
    const newTicket = {
      ...ticketData,
      customerId: userId,
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Create ticket in Firestore
    const ticketRef = await db.collection('supportTickets').add(newTicket);
    
    console.log(`✅ Created support ticket ${ticketRef.id} for customer: ${userId}`);
    
    res.json({
      success: true,
      data: {
        id: ticketRef.id,
        ...newTicket
      },
      message: 'Support ticket created successfully'
    });
    
  } catch (error) {
    console.error('❌ Error creating support ticket:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create support ticket',
      details: error.message
    });
  }
});

/**
 * @route GET /api/customer/emergency/contacts
 * @desc Get customer emergency contacts
 * @access Private (Customer only)
 */
router.get('/emergency/contacts', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const db = getFirestore();
    
    console.log(`🚨 Getting emergency contacts for customer: ${userId}`);
    
    const customerDoc = await db.collection('users').doc(userId).get();
    
    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }
    
    const customerData = customerDoc.data();
    const emergencyContacts = customerData.customer?.emergencyContacts || [];
    
    console.log(`✅ Retrieved ${emergencyContacts.length} emergency contacts for customer: ${userId}`);
    
    res.json({
      success: true,
      data: emergencyContacts
    });
    
  } catch (error) {
    console.error('❌ Error getting customer emergency contacts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve emergency contacts',
      details: error.message
    });
  }
});

/**
 * @route POST /api/customer/emergency/contacts
 * @desc Add emergency contact
 * @access Private (Customer only)
 */
router.post('/emergency/contacts', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const contactData = req.body;
    const db = getFirestore();
    
    console.log(`🚨 Adding emergency contact for customer: ${userId}`);
    
    // Get current emergency contacts
    const customerDoc = await db.collection('users').doc(userId).get();
    const customerData = customerDoc.data();
    const emergencyContacts = customerData.customer?.emergencyContacts || [];
    
    // Add new emergency contact
    const newContact = {
      id: `ec_${Date.now()}`,
      ...contactData,
      createdAt: new Date()
    };
    
    emergencyContacts.push(newContact);
    
    // Update customer document
    await db.collection('users').doc(userId).update({
      'customer.emergencyContacts': emergencyContacts,
      updatedAt: new Date()
    });
    
    console.log(`✅ Added emergency contact for customer: ${userId}`);
    
    res.json({
      success: true,
      data: newContact,
      message: 'Emergency contact added successfully'
    });
    
  } catch (error) {
    console.error('❌ Error adding customer emergency contact:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add emergency contact',
      details: error.message
    });
  }
});

/**
 * @route POST /api/customer/emergency/alert
 * @desc Send emergency alert
 * @access Private (Customer only)
 */
router.post('/emergency/alert', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { location, message, bookingId } = req.body;
    const db = getFirestore();
    
    console.log(`🚨 Sending emergency alert for customer: ${userId}`);
    
    // Create emergency alert
    const emergencyAlert = {
      customerId: userId,
      location: location,
      message: message,
      bookingId: bookingId,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Create alert in Firestore
    const alertRef = await db.collection('emergencyAlerts').add(emergencyAlert);
    
    // Update customer document with alert history
    const customerDoc = await db.collection('users').doc(userId).get();
    const customerData = customerDoc.data();
    const alertHistory = customerData.customer?.alertHistory || [];
    
    alertHistory.push({
      id: alertRef.id,
      ...emergencyAlert
    });
    
    await db.collection('users').doc(userId).update({
      'customer.alertHistory': alertHistory,
      updatedAt: new Date()
    });
    
    console.log(`✅ Created emergency alert ${alertRef.id} for customer: ${userId}`);
    
    res.json({
      success: true,
      data: {
        id: alertRef.id,
        ...emergencyAlert
      },
      message: 'Emergency alert sent successfully'
    });
    
  } catch (error) {
    console.error('❌ Error sending emergency alert:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send emergency alert',
      details: error.message
    });
  }
});

/**
 * @route POST /api/customer/bookings/:id/confirm-payment
 * @desc Confirm cash payment received by driver
 * @access Private (Customer only)
 */
router.post('/bookings/:id/confirm-payment', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { id: bookingId } = req.params;
    const { amount, paymentMethod = 'cash' } = req.body;
    const db = getFirestore();
    
    console.log(`💰 [PAYMENT_CONFIRM] Confirming payment for booking ${bookingId} by customer ${userId}`);
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid payment amount is required'
      });
    }
    
    // Get booking details
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }
    
    const bookingData = bookingDoc.data();
    
    // Verify customer owns this booking
    if (bookingData.customerId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied - this booking does not belong to you'
      });
    }
    
    // Verify booking is in money collection status
    if (bookingData.status !== 'money_collection') {
      return res.status(400).json({
        success: false,
        error: 'Payment can only be confirmed during money collection phase'
      });
    }
    
    // Create payment record
    const paymentData = {
      bookingId,
      customerId: userId,
      driverId: bookingData.driverId,
      amount: parseFloat(amount),
      paymentMethod,
      status: 'confirmed',
      confirmedAt: new Date(),
      createdAt: new Date()
    };
    
    // ✅ CRITICAL FIX: Use state machine to transition from money_collection to completed
    const bookingStateMachine = require('../services/bookingStateMachine');
    
    // Add payment record
    await db.collection('payments').add(paymentData);
    
    // If booking is in money_collection, transition to completed
    if (bookingData.status === 'money_collection') {
      await bookingStateMachine.transitionBooking(
        bookingId,
        'completed',
        {
          payment: {
            ...paymentData,
            confirmed: true,
            confirmedByCustomer: true
          },
          paymentConfirmed: true,
          paymentConfirmedByCustomer: true
        },
        {
          userId: userId,
          userType: 'customer'
        }
      );
    } else {
      // For backward compatibility, just update payment fields
      await db.collection('bookings').doc(bookingId).update({
        payment: {
          ...paymentData,
          confirmed: true,
          confirmedByCustomer: true
        },
        paymentConfirmed: true,
        paymentConfirmedByCustomer: true,
        updatedAt: new Date()
      });
    }
    
    console.log(`✅ [PAYMENT_CONFIRM] Payment confirmed for booking ${bookingId}: ₹${amount}`);
    
    res.json({
      success: true,
      message: 'Payment confirmed successfully',
      data: {
        bookingId: bookingId,
        amount: paymentData.amount,
        status: bookingData.status === 'money_collection' ? 'completed' : bookingData.status
      }
    });
    
  } catch (error) {
    console.error('Error confirming payment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to confirm payment'
    });
  }
});

/**
 * @route POST /api/customer/bookings/:id/rate
 * @desc Submit driver rating and feedback
 * @access Private (Customer only)
 */
router.post('/bookings/:id/rate', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { id: bookingId } = req.params;
    const { rating, feedback, categories } = req.body;
    const db = getFirestore();
    
    console.log(`⭐ [RATING] Submitting rating for booking ${bookingId} by customer ${userId}`);
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        error: 'Rating must be between 1 and 5 stars'
      });
    }
    
    // Get booking details
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }
    
    const bookingData = bookingDoc.data();
    
    // Verify customer owns this booking
    if (bookingData.customerId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied - this booking does not belong to you'
      });
    }
    
    // Verify booking is completed
    if (bookingData.status !== 'delivered') {
      return res.status(400).json({
        success: false,
        error: 'Rating can only be submitted for completed bookings'
      });
    }
    
    // Check if rating already exists
    const existingRatingQuery = await db.collection('ratings')
      .where('bookingId', '==', bookingId)
      .where('customerId', '==', userId)
      .limit(1)
      .get();
    
    if (!existingRatingQuery.empty) {
      return res.status(400).json({
        success: false,
        error: 'Rating already submitted for this booking'
      });
    }
    
    // Create rating record
    const ratingData = {
      bookingId,
      customerId: userId,
      driverId: bookingData.driverId,
      rating: parseInt(rating),
      feedback: feedback || '',
      categories: categories || {},
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    // Add rating record
    const ratingRef = await db.collection('ratings').add(ratingData);
    
    // Update driver's average rating
    const driverRatingsQuery = await db.collection('ratings')
      .where('driverId', '==', bookingData.driverId)
      .get();
    
    const ratings = driverRatingsQuery.docs.map(doc => doc.data().rating);
    const averageRating = ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
    
    await db.collection('users').doc(bookingData.driverId).update({
      'driver.averageRating': averageRating,
      'driver.totalRatings': ratings.length,
      updatedAt: new Date()
    });
    
    console.log(`✅ [RATING] Rating submitted for booking ${bookingId}: ${rating} stars`);
    console.log(`⭐ [RATING] Updated driver ${bookingData.driverId} average rating: ${averageRating} (from ${ratings.length} total ratings)`);
    
    // ✅ CRITICAL FIX: Emit real-time rating update to admin dashboard (driver isolated)
    try {
      const socketService = require('../services/socket');
      const io = socketService.getIO();
      if (io) {
        io.to('type:admin').emit('driver_rating_updated', {
          driverId: bookingData.driverId,
          bookingId: bookingId,
          action: 'added',
          rating: parseInt(rating),
          newAverageRating: averageRating,
          totalRatings: ratings.length,
          timestamp: new Date().toISOString()
        });
        console.log(`📤 [RATING] Sent driver rating update event to admin dashboard for driver ${bookingData.driverId}`);
      }
    } catch (socketError) {
      console.warn('⚠️ [RATING] Failed to emit rating update event:', socketError);
      // Don't fail rating submission if socket emit fails
    }
    
    res.json({
      success: true,
      message: 'Rating submitted successfully',
      data: {
        ratingId: ratingRef.id,
        rating: ratingData.rating,
        averageRating: averageRating
      }
    });
    
  } catch (error) {
    console.error('Error submitting rating:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit rating'
    });
  }
});

/**
 * @route GET /api/customer/bookings/:id/rating
 * @desc Get rating for a specific booking
 * @access Private (Customer only)
 */
router.get('/bookings/:id/rating', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { id: bookingId } = req.params;
    const db = getFirestore();
    
    // Get rating for this booking
    const ratingQuery = await db.collection('ratings')
      .where('bookingId', '==', bookingId)
      .where('customerId', '==', userId)
      .limit(1)
      .get();
    
    if (ratingQuery.empty) {
      return res.json({
        success: true,
        data: null,
        message: 'No rating found for this booking'
      });
    }
    
    const ratingData = ratingQuery.docs[0].data();
    
    res.json({
      success: true,
      data: {
        ratingId: ratingQuery.docs[0].id,
        rating: ratingData.rating,
        feedback: ratingData.feedback,
        categories: ratingData.categories,
        createdAt: ratingData.createdAt
      }
    });
    
  } catch (error) {
    console.error('Error getting rating:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get rating'
    });
  }
});

/**
 * @route GET /api/customer/invoice/:bookingId
 * @desc Download invoice for completed booking
 * @access Private (Customer only)
 */
router.get('/invoice/:bookingId', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { bookingId } = req.params;
    const db = getFirestore();
    
    console.log(`📄 Generating invoice for booking ${bookingId} for customer: ${userId}`);
    
    // Get booking details
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }
    
    const bookingData = bookingDoc.data();
    
    // Verify booking belongs to customer
    if (bookingData.customerId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    // Only allow invoice download for completed bookings
    if (bookingData.status !== 'completed' && bookingData.status !== 'delivered') {
      return res.status(400).json({
        success: false,
        error: 'Invoice is only available for completed bookings'
      });
    }
    
    // Get customer details
    let customerData = {};
    try {
      const customerDoc = await db.collection('users').doc(userId).get();
      if (customerDoc.exists) {
        customerData = customerDoc.data();
      } else {
        console.warn(`⚠️ Customer document not found for user: ${userId}`);
      }
    } catch (error) {
      console.error(`❌ Error fetching customer data for user ${userId}:`, error);
      // Continue with empty customer data rather than failing
    }
    
    // Get driver details if available
    let driverData = null;
    if (bookingData.driverId) {
      try {
        const driverDoc = await db.collection('drivers').doc(bookingData.driverId).get();
        if (driverDoc.exists) {
          driverData = driverDoc.data();
        } else {
          console.warn(`⚠️ Driver document not found for driver: ${bookingData.driverId}`);
        }
      } catch (error) {
        console.error(`❌ Error fetching driver data for driver ${bookingData.driverId}:`, error);
        // Continue without driver data rather than failing
      }
    }
    
    // Generate invoice data
    const invoiceData = {
      invoiceId: `INV-${bookingId.substring(0, 8).toUpperCase()}`,
      invoiceDate: new Date().toISOString(),
      bookingId: bookingId,
      bookingDate: bookingData.createdAt ? (bookingData.createdAt.toDate ? bookingData.createdAt.toDate().toISOString() : new Date(bookingData.createdAt).toISOString()) : new Date().toISOString(),
      completedDate: bookingData.completedAt ? (bookingData.completedAt.toDate ? bookingData.completedAt.toDate().toISOString() : new Date(bookingData.completedAt).toISOString()) : (bookingData.updatedAt ? new Date(bookingData.updatedAt).toISOString() : new Date().toISOString()),
      
      // Customer details
      customer: {
        name: bookingData.pickup?.name || customerData.name || 'Customer',
        phone: customerData.phoneNumber || '', // Use customer's actual phone, not pickup.phone
        email: customerData.email || ''
      },
      
      // Driver details
      driver: driverData ? {
        name: driverData.personalInfo?.name || 'Driver',
        phone: driverData.personalInfo?.phone || '',
        vehicleNumber: driverData.vehicleInfo?.plateNumber || 'N/A'
      } : null,
      
      // Booking details
      pickup: {
        address: bookingData.pickup?.address || 'Pickup address',
        name: bookingData.pickup?.name || 'Sender'
        // phone removed - sender phone not needed
      },
      
      dropoff: {
        address: bookingData.dropoff?.address || 'Dropoff address',
        name: bookingData.dropoff?.name || 'Recipient',
        phone: bookingData.dropoff?.phone || ''
      },
      
      // Package details
      package: {
        weight: bookingData.package?.weight || 0,
        description: bookingData.package?.description || 'Package',
        value: bookingData.package?.value || 0
      },
      
      // Fare details
      fare: {
        baseFare: bookingData.fare?.base || bookingData.pricing?.baseFare || bookingData.baseFare || 0,
        distanceFare: bookingData.fare?.distance || bookingData.pricing?.distanceFare || bookingData.distanceFare || 0,
        totalFare: bookingData.fare?.total || bookingData.pricing?.totalFare || bookingData.totalFare || bookingData.amount || 0,
        currency: bookingData.fare?.currency || bookingData.currency || 'INR'
      },
      
      // Distance and timing
      distance: bookingData.distance?.value || bookingData.distance || 0,
      estimatedTime: bookingData.estimatedDuration || 0,
      actualTime: bookingData.actualDuration || 0,
      
      // Payment details
      paymentMethod: bookingData.paymentMethod || 'cash',
      paymentStatus: bookingData.paymentStatus || 'completed'
    };
    
    // Check if client wants PDF format
    const format = req.query.format || 'json';
    
    if (format === 'pdf') {
      // Generate PDF invoice (requires pdfkit or similar library)
      try {
        const PDFDocument = require('pdfkit');
        const doc = new PDFDocument();
        
        // Set response headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceData.invoiceId}.pdf"`);
        
        // Pipe PDF to response
        doc.pipe(res);
        
        // Add invoice content to PDF
        doc.fontSize(20).text('EPickup Invoice', 50, 50);
        doc.fontSize(12).text(`Invoice ID: ${invoiceData.invoiceId}`, 50, 80);
        doc.text(`Date: ${new Date(invoiceData.invoiceDate).toLocaleDateString()}`, 50, 100);
        doc.text(`Booking ID: ${invoiceData.bookingId}`, 50, 120);
        
        // Customer details
        doc.text('Customer Details:', 50, 160);
        doc.text(`Name: ${invoiceData.customer.name}`, 70, 180);
        doc.text(`Phone: ${invoiceData.customer.phone}`, 70, 200);
        doc.text(`Email: ${invoiceData.customer.email}`, 70, 220);
        
        // Driver details
        if (invoiceData.driver) {
          doc.text('Driver Details:', 50, 260);
          doc.text(`Name: ${invoiceData.driver.name}`, 70, 280);
          doc.text(`Phone: ${invoiceData.driver.phone}`, 70, 300);
          doc.text(`Vehicle: ${invoiceData.driver.vehicleNumber}`, 70, 320);
        }
        
        // Pickup details
        doc.text('Pickup Details:', 50, 360);
        doc.text(`Address: ${invoiceData.pickup.address}`, 70, 380);
        doc.text(`Sender: ${invoiceData.pickup.name}`, 70, 400);
        // Phone removed - sender phone not displayed
        
        // Dropoff details
        doc.text('Dropoff Details:', 50, 440);
        doc.text(`Address: ${invoiceData.dropoff.address}`, 70, 460);
        doc.text(`Contact: ${invoiceData.dropoff.name} (${invoiceData.dropoff.phone})`, 70, 480);
        
        // Package details
        doc.text('Package Details:', 50, 520);
        doc.text(`Weight: ${invoiceData.package.weight} kg`, 70, 540);
        doc.text(`Description: ${invoiceData.package.description}`, 70, 560);
        
        // Fare breakdown
        doc.text('Fare Breakdown:', 50, 600);
        doc.text(`Base Fare: ₹${invoiceData.fare.baseFare}`, 70, 620);
        doc.text(`Distance Fare: ₹${invoiceData.fare.distanceFare}`, 70, 640);
        doc.fontSize(14).text(`Total: ₹${invoiceData.fare.totalFare}`, 70, 670);
        
        // Payment details
        doc.fontSize(12).text('Payment Details:', 50, 710);
        doc.text(`Method: ${invoiceData.paymentMethod}`, 70, 730);
        doc.text(`Status: ${invoiceData.paymentStatus}`, 70, 750);
        
        // Footer
        doc.text('Thank you for using EPickup!', 50, 790);
        
        doc.end();
        
        console.log(`✅ Generated PDF invoice ${invoiceData.invoiceId} for booking ${bookingId}`);
        return;
        
      } catch (error) {
        console.error('❌ Error generating PDF invoice:', error);
        // Fallback to JSON if PDF generation fails
      }
    }
    
    // Default JSON response
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceData.invoiceId}.json"`);
    
    console.log(`✅ Generated invoice ${invoiceData.invoiceId} for booking ${bookingId}`);
    
    res.json({
      success: true,
      data: invoiceData,
      message: 'Invoice generated successfully'
    });
    
  } catch (error) {
    console.error('❌ Error generating invoice:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate invoice',
      details: error.message
    });
  }
});

/**
 * @route   POST /api/customer/cancel-active-booking
 * @desc    Cancel current active booking
 * @access  Private (Customer only)
 */
router.post('/cancel-active-booking', [
  authenticateToken,
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

    const { uid: customerId } = req.user;
    const { reason } = req.body;
    const ActiveBookingService = require('../services/activeBookingService');
    const activeBookingService = new ActiveBookingService();
    
    const result = await activeBookingService.cancelActiveBooking(customerId, reason);
    
    if (result.success) {
      res.status(200).json({
        success: true,
        message: 'Active booking cancelled successfully',
        data: result,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: {
          code: 'CANCELLATION_FAILED',
          message: result.message || 'Failed to cancel active booking'
        },
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error cancelling active booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CANCELLATION_ERROR',
        message: 'Failed to cancel active booking',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;