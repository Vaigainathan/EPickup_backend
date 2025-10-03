const express = require('express');
const router = express.Router();
const { getFirestore } = require('firebase-admin/firestore');
const { authenticateToken } = require('../middleware/auth');

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
      name: customerData.customer?.name || '',
      email: customerData.customer?.email || '',
      address: customerData.customer?.address || '',
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
    const { name, email, address, preferences } = req.body;
    const db = getFirestore();
    
    console.log(`📝 Updating customer profile for: ${userId}`);
    
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
    
    if (name !== undefined) updateData['customer.name'] = name;
    if (email !== undefined) updateData['customer.email'] = email;
    if (address !== undefined) updateData['customer.address'] = address;
    if (preferences !== undefined) updateData['customer.preferences'] = preferences;
    
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
 * @route POST /api/customer/upload-photo
 * @desc Upload customer profile photo
 * @access Private (Customer only)
 */
router.post('/upload-photo', authenticateToken, async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const { photoUrl } = req.body;
    const db = getFirestore();
    
    console.log(`📸 Uploading customer photo for: ${userId}`);
    
    // Update customer photo in users collection
    await db.collection('users').doc(userId).update({
      'customer.profilePhoto': photoUrl,
      updatedAt: new Date()
    });
    
    console.log(`✅ Updated customer photo: ${userId}`);
    
    res.json({
      success: true,
      message: 'Profile photo updated successfully',
      data: { photoUrl }
    });
    
  } catch (error) {
    console.error('❌ Error uploading customer photo:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload profile photo',
      details: error.message
    });
  }
});

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
 * @route POST /api/customer/bookings
 * @desc Create new booking
 * @access Private (Customer only)
 */
router.post('/bookings', async (req, res) => {
  try {
    const { uid: userId } = req.user;
    const bookingData = req.body;
    const db = getFirestore();
    
    console.log(`📝 Creating booking for customer: ${userId}`);
    
    // Validate required booking fields
    if (!bookingData.pickup || !bookingData.dropoff || !bookingData.package) {
      return res.status(400).json({
        success: false,
        error: 'Missing required booking fields',
        details: 'pickup, dropoff, and package are required'
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
      
      const distanceAndFare = await fareCalculationService.calculateDistanceAndFare(pickupCoords, dropoffCoords);
      fareDetails = distanceAndFare.fare;
      distance = distanceAndFare.distanceKm;
      
      console.log(`💰 Calculated fare for booking: ₹${fareDetails.baseFare} (${distance}km)`);
    } catch (error) {
      console.error('❌ Error calculating fare, using fallback:', error);
      // Fallback to basic calculation if service fails
      distance = 5; // Default distance
      fareDetails = fareCalculationService.calculateFare(distance);
    }
    
    // Add customer ID and fare information to booking data
    const newBooking = {
      ...bookingData,
      customerId: userId,
      status: 'pending',
      paymentStatus: 'pending',
      fare: {
        baseFare: fareDetails.baseFare,
        distanceFare: fareDetails.baseFare - fareCalculationService.MINIMUM_FARE,
        totalFare: fareDetails.baseFare,
        currency: 'INR',
        commission: fareDetails.commission,
        driverNet: fareDetails.driverNet,
        companyRevenue: fareDetails.companyRevenue
      },
      pricing: {
        baseFare: fareDetails.baseFare,
        distanceFare: fareDetails.baseFare - fareCalculationService.MINIMUM_FARE,
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
    
    // Create booking in Firestore
    const bookingRef = await db.collection('bookings').add(newBooking);
    
    console.log(`✅ Created booking ${bookingRef.id} for customer: ${userId}`);
    
    res.json({
      success: true,
      data: {
        id: bookingRef.id,
        ...newBooking
      },
      message: 'Booking created successfully'
    });
    
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
    
    const customerDoc = await db.collection('users').doc(userId).get();
    
    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found'
      });
    }
    
    const customerData = customerDoc.data();
    const addresses = customerData.customer?.addresses || [];
    
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
    
    // Update booking status to delivered
    await db.collection('bookings').doc(bookingId).update({
      status: 'delivered',
      paymentConfirmed: true,
      paymentData,
      updatedAt: new Date()
    });
    
    // Add payment record
    await db.collection('payments').add(paymentData);
    
    console.log(`✅ [PAYMENT_CONFIRM] Payment confirmed for booking ${bookingId}: ₹${amount}`);
    
    res.json({
      success: true,
      message: 'Payment confirmed successfully',
      data: {
        paymentId: paymentData.id,
        amount: paymentData.amount,
        status: 'confirmed'
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

module.exports = router;