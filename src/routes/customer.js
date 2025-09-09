const express = require('express');
const { body, validationResult } = require('express-validator');
const { getFirestore } = require('../services/firebase');
const enhancedFileUploadService = require('../services/enhancedFileUploadService');
const auditService = require('../services/auditService');
const { requireCustomer } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /api/customer/profile
 * @desc    Get customer profile
 * @access  Private (Customer only)
 */
router.get('/profile', requireCustomer, async (req, res) => {
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
          details: 'Customer profile does not exist'
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
          customer: userData.customer
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting customer profile:', error);
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
 * @route   PUT /api/customer/profile
 * @desc    Update customer profile
 * @access  Private (Customer only)
 */
router.put('/profile', [
  requireCustomer,
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
          customer: userData.customer
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating customer profile:', error);
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
 * @route   GET /api/customer/addresses
 * @desc    Get customer saved addresses
 * @access  Private (Customer only)
 */
router.get('/addresses', requireCustomer, async (req, res) => {
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
          details: 'Customer does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const addresses = userData.customer?.savedAddresses || [];

    res.status(200).json({
      success: true,
      message: 'Addresses retrieved successfully',
      data: {
        addresses
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting customer addresses:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ADDRESSES_RETRIEVAL_ERROR',
        message: 'Failed to retrieve addresses',
        details: 'An error occurred while retrieving addresses'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/addresses
 * @desc    Add new address for customer
 * @access  Private (Customer only)
 */
router.post('/addresses', [
  requireCustomer,
  body('name')
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('address')
    .isLength({ min: 10, max: 200 })
    .withMessage('Address must be between 10 and 200 characters'),
  body('type')
    .isIn(['home', 'work', 'other'])
    .withMessage('Type must be home, work, or other'),
  body('coordinates.latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('coordinates.longitude')
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
    const { name, address, type, coordinates, isDefault = false } = req.body;
    const db = getFirestore();
    
    const newAddress = {
      id: `addr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      address,
      type,
      coordinates,
      isDefault,
      createdAt: new Date()
    };

    // If this is the default address, remove default from others
    if (isDefault) {
      const userRef = db.collection('users').doc(uid);
      const userDoc = await userRef.get();
      const userData = userDoc.data();
      
      if (userData.customer?.savedAddresses) {
        const updatedAddresses = userData.customer.savedAddresses.map(addr => ({
          ...addr,
          isDefault: false
        }));
        updatedAddresses.push(newAddress);
        
        await userRef.update({
          'customer.savedAddresses': updatedAddresses,
          updatedAt: new Date()
        });
      } else {
        await userRef.update({
          'customer.savedAddresses': [newAddress],
          updatedAt: new Date()
        });
      }
    } else {
      // Add address without changing defaults
      const userRef = db.collection('users').doc(uid);
      await userRef.update({
        'customer.savedAddresses': newAddress,
        updatedAt: new Date()
      });
    }

    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      data: {
        address: newAddress
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error adding customer address:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ADDRESS_ADDITION_ERROR',
        message: 'Failed to add address',
        details: 'An error occurred while adding address'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/customer/addresses/:id
 * @desc    Update customer address
 * @access  Private (Customer only)
 */
router.put('/addresses/:id', [
  requireCustomer,
  body('name')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('address')
    .optional()
    .isLength({ min: 10, max: 200 })
    .withMessage('Address must be between 10 and 200 characters'),
  body('type')
    .optional()
    .isIn(['home', 'work', 'other'])
    .withMessage('Type must be home, work, or other'),
  body('coordinates.latitude')
    .optional()
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be between -90 and 90'),
  body('coordinates.longitude')
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
    const { id } = req.params;
    const updateData = req.body;
    const db = getFirestore();
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Customer does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const addresses = userData.customer?.savedAddresses || [];
    const addressIndex = addresses.findIndex(addr => addr.id === id);

    if (addressIndex === -1) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ADDRESS_NOT_FOUND',
          message: 'Address not found',
          details: 'Address with this ID does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update address
    addresses[addressIndex] = {
      ...addresses[addressIndex],
      ...updateData,
      updatedAt: new Date()
    };

    await userRef.update({
      'customer.savedAddresses': addresses,
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Address updated successfully',
      data: {
        address: addresses[addressIndex]
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating customer address:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ADDRESS_UPDATE_ERROR',
        message: 'Failed to update address',
        details: 'An error occurred while updating address'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   DELETE /api/customer/addresses/:id
 * @desc    Delete customer address
 * @access  Private (Customer only)
 */
router.delete('/addresses/:id', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const db = getFirestore();
    
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          details: 'Customer does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    const addresses = userData.customer?.savedAddresses || [];
    const addressIndex = addresses.findIndex(addr => addr.id === id);

    if (addressIndex === -1) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ADDRESS_NOT_FOUND',
          message: 'Address not found',
          details: 'Address with this ID does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Remove address
    addresses.splice(addressIndex, 1);

    await userRef.update({
      'customer.savedAddresses': addresses,
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Address deleted successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error deleting customer address:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ADDRESS_DELETION_ERROR',
        message: 'Failed to delete address',
        details: 'An error occurred while deleting address'
      },
      timestamp: new Date().toISOString()
    });
  }
});

// Customer wallet features removed - only drivers have wallets

// Customer wallet add money feature removed - only drivers have wallets

/**
 * @route   GET /api/customer/bookings
 * @desc    Get customer bookings
 * @access  Private (Customer only)
 */
router.get('/bookings', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { status, limit = 20, offset = 0 } = req.query;
    const db = getFirestore();
    
    let query = db.collection('bookings').where('customerId', '==', uid);
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
    query = query.orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(parseInt(offset));
    
    const snapshot = await query.get();
    const bookings = [];
    
    snapshot.forEach(doc => {
      bookings.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.status(200).json({
      success: true,
      message: 'Bookings retrieved successfully',
      data: {
        bookings,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: bookings.length
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting customer bookings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKINGS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve bookings',
        details: 'An error occurred while retrieving bookings'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/bookings/history
 * @desc    Get customer booking history with pagination
 * @access  Private (Customer only)
 */
router.get('/bookings/history', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 20, offset = 0, status } = req.query;
    const db = getFirestore();
    
    // Build query without orderBy first to avoid index issues
    let query = db.collection('bookings')
      .where('customerId', '==', uid)
      .limit(parseInt(limit));
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
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
    
    // Sort by createdAt in memory if we have data
    if (bookings.length > 0) {
      bookings.sort((a, b) => {
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return dateB - dateA; // Descending order
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Booking history retrieved successfully',
      data: {
        bookings,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: bookings.length
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get booking history error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_HISTORY_ERROR',
        message: 'Failed to retrieve booking history',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/bookings/active
 * @desc    Get customer active bookings
 * @access  Private (Customer only)
 */
router.get('/bookings/active', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const activeStatuses = ['pending', 'confirmed', 'driver_assigned', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff'];
    
    const snapshot = await db.collection('bookings')
      .where('customerId', '==', uid)
      .where('status', 'in', activeStatuses)
      .get();
    
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
    
    res.status(200).json({
      success: true,
      message: 'Active bookings retrieved successfully',
      data: { bookings },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get active bookings error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ACTIVE_BOOKINGS_ERROR',
        message: 'Failed to retrieve active bookings'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/bookings/:id
 * @desc    Get specific customer booking
 * @access  Private (Customer only)
 */
router.get('/bookings/:id', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const db = getFirestore();
    
    const bookingDoc = await db.collection('bookings').doc(id).get();
    
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
    
    // Check if customer owns this booking
    if (bookingData.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only access your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    res.status(200).json({
      success: true,
      message: 'Booking retrieved successfully',
      data: {
        booking: {
          id: bookingDoc.id,
          ...bookingData
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting customer booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_RETRIEVAL_ERROR',
        message: 'Failed to retrieve booking',
        details: 'An error occurred while retrieving booking'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/customer/bookings/:id/cancel
 * @desc    Cancel customer booking
 * @access  Private (Customer only)
 */
router.put('/bookings/:id/cancel', [
  requireCustomer,
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
    
    // Check if customer owns this booking
    if (bookingData.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only cancel your own bookings'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if booking can be cancelled
    const cancellableStatuses = ['pending', 'confirmed', 'driver_assigned'];
    if (!cancellableStatuses.includes(bookingData.status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'CANCELLATION_NOT_ALLOWED',
          message: 'Cancellation not allowed',
          details: 'This booking cannot be cancelled in its current status'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Cancel booking
    await bookingRef.update({
      status: 'cancelled',
      'cancellation.cancelledBy': 'customer',
      'cancellation.reason': reason || 'Cancelled by customer',
      'cancellation.cancelledAt': new Date(),
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error cancelling customer booking:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_CANCELLATION_ERROR',
        message: 'Failed to cancel booking',
        details: 'An error occurred while cancelling booking'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/orders
 * @desc    Get customer order history with enhanced data
 * @access  Private (Customer only)
 */
router.get('/orders', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { status, limit = 20, offset = 0, includeDriver = 'true' } = req.query;
    const db = getFirestore();
    
    let query = db.collection('bookings').where('customerId', '==', uid);
    
    if (status) {
      query = query.where('status', '==', status);
    } else {
      // Default to completed orders for order history
      query = query.where('status', 'in', ['delivered', 'cancelled']);
    }
    
    query = query.orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(parseInt(offset));
    
    const snapshot = await query.get();
    const orders = [];
    
    // Process orders and enrich with additional data
    for (const doc of snapshot.docs) {
      const orderData = doc.data();
      
      // Format order data for frontend consumption
      const formattedOrder = {
        id: doc.id,
        bookingId: orderData.id || doc.id,
        status: orderData.status,
        date: orderData.timing?.createdAt?.toDate?.() || orderData.createdAt?.toDate?.() || new Date(),
        
        // Pickup information
        pickup: {
          name: orderData.pickup?.name || '',
          phone: orderData.pickup?.phone || '',
          address: orderData.pickup?.address || ''
        },
        
        // Dropoff information
        dropoff: {
          name: orderData.dropoff?.name || '',
          phone: orderData.dropoff?.phone || '',
          address: orderData.dropoff?.address || ''
        },
        
        // Vehicle information
        vehicleType: orderData.vehicle?.type || '2_wheeler',
        
        // Package information
        package: {
          weight: orderData.package?.weight || 0,
          description: orderData.package?.description || '',
          dimensions: orderData.package?.dimensions || null
        },
        
        // Fare information
        price: `₹${orderData.fare?.total || 0}`,
        fare: {
          base: orderData.fare?.base || 0,
          distance: orderData.fare?.distance || 0,
          time: orderData.fare?.time || 0,
          total: orderData.fare?.total || 0,
          currency: orderData.fare?.currency || 'INR'
        },
        
        // Distance information
        distance: orderData.distance?.total || 0,
        
        // Payment information
        paymentMethod: orderData.paymentMethod || 'cash',
        paymentStatus: orderData.paymentStatus || 'pending',
        
        // Timing information
        estimatedPickupTime: orderData.timing?.estimatedPickupTime,
        estimatedDeliveryTime: orderData.timing?.estimatedDeliveryTime,
        actualPickupTime: orderData.timing?.actualPickupTime,
        actualDeliveryTime: orderData.timing?.actualDeliveryTime,
        
        // Driver information (if available and requested)
        driver: null,
        
        // Rating information
        rating: orderData.rating || null,
        
        // Reorder information
        canReorder: orderData.status === 'delivered',
        reorderedFrom: orderData.reorderedFrom || null
      };
      
      // Fetch driver information if requested and available
      if (includeDriver === 'true' && orderData.driverId) {
        try {
          const driverDoc = await db.collection('users').doc(orderData.driverId).get();
          if (driverDoc.exists) {
            const driverData = driverDoc.data();
            formattedOrder.driver = {
              id: orderData.driverId,
              name: driverData.profile?.name || driverData.personalInfo?.name || 'Driver',
              phone: driverData.phoneNumber || '',
              rating: driverData.driver?.rating || 0,
              vehicleNumber: driverData.driver?.vehicleInfo?.vehicleNumber || '',
              profileImage: driverData.profile?.profilePicture || null
            };
          }
        } catch (driverError) {
          console.warn('Failed to fetch driver info for order:', doc.id, driverError.message);
        }
      }
      
      orders.push(formattedOrder);
    }

    res.status(200).json({
      success: true,
      message: 'Orders retrieved successfully',
      data: {
        orders,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: orders.length,
          hasMore: orders.length === parseInt(limit)
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting customer orders:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ORDERS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve orders',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/orders/:id
 * @desc    Get specific customer order
 * @access  Private (Customer only)
 */
router.get('/orders/:id', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const db = getFirestore();
    
    const orderDoc = await db.collection('bookings').doc(id).get();
    
    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ORDER_NOT_FOUND',
          message: 'Order not found',
          details: 'Order with this ID does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const orderData = orderDoc.data();
    
    // Check if customer owns this order
    if (orderData.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only access your own orders'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Format order data for frontend consumption
    const formattedOrder = {
      id: orderDoc.id,
      bookingId: orderData.id || orderDoc.id,
      status: orderData.status,
      date: orderData.timing?.createdAt?.toDate?.() || orderData.createdAt?.toDate?.() || new Date(),
      
      // Pickup information
      pickup: {
        name: orderData.pickup?.name || '',
        phone: orderData.pickup?.phone || '',
        address: orderData.pickup?.address || '',
        coordinates: orderData.pickup?.coordinates || null,
        instructions: orderData.pickup?.instructions || ''
      },
      
      // Dropoff information
      dropoff: {
        name: orderData.dropoff?.name || '',
        phone: orderData.dropoff?.phone || '',
        address: orderData.dropoff?.address || '',
        coordinates: orderData.dropoff?.coordinates || null,
        instructions: orderData.dropoff?.instructions || ''
      },
      
      // Vehicle information
      vehicleType: orderData.vehicle?.type || '2_wheeler',
      
      // Package information
      package: {
        weight: orderData.package?.weight || 0,
        description: orderData.package?.description || '',
        dimensions: orderData.package?.dimensions || null,
        isFragile: orderData.package?.isFragile || false,
        requiresSpecialHandling: orderData.package?.requiresSpecialHandling || false
      },
      
      // Fare information
      price: `₹${orderData.fare?.total || 0}`,
      fare: {
        base: orderData.fare?.base || 0,
        distance: orderData.fare?.distance || 0,
        time: orderData.fare?.time || 0,
        total: orderData.fare?.total || 0,
        currency: orderData.fare?.currency || 'INR'
      },
      
      // Distance information
      distance: orderData.distance?.total || 0,
      
      // Payment information
      paymentMethod: orderData.paymentMethod || 'cash',
      paymentStatus: orderData.paymentStatus || 'pending',
      
      // Timing information
      estimatedPickupTime: orderData.timing?.estimatedPickupTime,
      estimatedDeliveryTime: orderData.timing?.estimatedDeliveryTime,
      actualPickupTime: orderData.timing?.actualPickupTime,
      actualDeliveryTime: orderData.timing?.actualDeliveryTime,
      
      // Driver information
      driver: null,
      
      // Rating information
      rating: orderData.rating || null,
      
      // Reorder information
      canReorder: orderData.status === 'delivered',
      reorderedFrom: orderData.reorderedFrom || null,
      
      // Raw data for advanced features
      rawData: orderData
    };

    // Fetch driver information if available
    if (orderData.driverId) {
      try {
        const driverDoc = await db.collection('users').doc(orderData.driverId).get();
        if (driverDoc.exists) {
          const driverData = driverDoc.data();
          formattedOrder.driver = {
            id: orderData.driverId,
            name: driverData.profile?.name || driverData.personalInfo?.name || 'Driver',
            phone: driverData.phoneNumber || '',
            rating: driverData.driver?.rating || 0,
            vehicleNumber: driverData.driver?.vehicleInfo?.vehicleNumber || '',
            profileImage: driverData.profile?.profilePicture || null
          };
        }
      } catch (driverError) {
        console.warn('Failed to fetch driver info for order:', orderDoc.id, driverError.message);
      }
    }

    res.status(200).json({
      success: true,
      message: 'Order retrieved successfully',
      data: {
        order: formattedOrder
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting customer order:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ORDER_RETRIEVAL_ERROR',
        message: 'Failed to retrieve order',
        details: 'An error occurred while retrieving order'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/orders/:id/rate
 * @desc    Rate completed order
 * @access  Private (Customer only)
 */
router.post('/orders/:id/rate', [
  requireCustomer,
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('feedback')
    .optional()
    .isLength({ min: 5, max: 500 })
    .withMessage('Feedback must be between 5 and 500 characters')
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
    const { rating, feedback } = req.body;
    const db = getFirestore();
    
    const orderRef = db.collection('bookings').doc(id);
    const orderDoc = await orderRef.get();
    
    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ORDER_NOT_FOUND',
          message: 'Order not found',
          details: 'Order with this ID does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const orderData = orderDoc.data();
    
    // Check if customer owns this order
    if (orderData.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only rate your own orders'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if order is completed
    if (orderData.status !== 'delivered') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'RATING_NOT_ALLOWED',
          message: 'Rating not allowed',
          details: 'You can only rate completed orders'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if already rated
    if (orderData.rating?.customerRating) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_RATED',
          message: 'Already rated',
          details: 'This order has already been rated'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Add rating
    await orderRef.update({
      'rating.customerRating': rating,
      'rating.customerFeedback': feedback || null,
      updatedAt: new Date()
    });

    // Update driver rating if driver exists
    if (orderData.driverId) {
      const driverRef = db.collection('users').doc(orderData.driverId);
      const driverDoc = await driverRef.get();
      
      if (driverDoc.exists) {
        const driverData = driverDoc.data();
        const currentRating = driverData.driver?.rating || 0;
        const totalTrips = driverData.driver?.totalTrips || 0;
        
        // Calculate new average rating
        const newRating = ((currentRating * totalTrips) + rating) / (totalTrips + 1);
        
        await driverRef.update({
          'driver.rating': newRating,
          updatedAt: new Date()
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Order rated successfully',
      data: {
        rating,
        feedback
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error rating customer order:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ORDER_RATING_ERROR',
        message: 'Failed to rate order',
        details: 'An error occurred while rating order'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/orders/:id/reorder
 * @desc    Reorder from a previous order
 * @access  Private (Customer only)
 */
router.post('/orders/:id/reorder', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const { 
      pickupInstructions, 
      dropoffInstructions, 
      estimatedPickupTime,
      estimatedDeliveryTime 
    } = req.body;
    
    const db = getFirestore();
    
    // Get the original order
    const orderDoc = await db.collection('bookings').doc(id).get();
    
    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ORDER_NOT_FOUND',
          message: 'Order not found',
          details: 'Order with this ID does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const originalOrder = orderDoc.data();
    
    // Check if customer owns this order
    if (originalOrder.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only reorder from your own orders'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if order is completed
    if (originalOrder.status !== 'delivered') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REORDER_NOT_ALLOWED',
          message: 'Reorder not allowed',
          details: 'You can only reorder from completed orders'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Create new booking data from original order
    const newBookingData = {
      customerId: uid,
      pickup: {
        name: originalOrder.pickup.name,
        phone: originalOrder.pickup.phone,
        address: originalOrder.pickup.address,
        coordinates: originalOrder.pickup.coordinates,
        instructions: pickupInstructions || originalOrder.pickup.instructions || ''
      },
      dropoff: {
        name: originalOrder.dropoff.name,
        phone: originalOrder.dropoff.phone,
        address: originalOrder.dropoff.address,
        coordinates: originalOrder.dropoff.coordinates,
        instructions: dropoffInstructions || originalOrder.dropoff.instructions || ''
      },
      package: {
        weight: originalOrder.package.weight,
        description: originalOrder.package.description || '',
        dimensions: originalOrder.package.dimensions || null,
        isFragile: originalOrder.package.isFragile || false,
        requiresSpecialHandling: originalOrder.package.requiresSpecialHandling || false
      },
      vehicle: {
        type: originalOrder.vehicle.type,
        required: originalOrder.vehicle.required || false
      },
      paymentMethod: originalOrder.paymentMethod,
      estimatedPickupTime: estimatedPickupTime || null,
      estimatedDeliveryTime: estimatedDeliveryTime || null,
      reorderedFrom: id // Track the original order
    };

    // Create new booking using booking service
    const bookingService = require('../services/bookingService');
    const result = await bookingService.createBooking(newBookingData);

    res.status(201).json({
      success: true,
      message: 'Order recreated successfully',
      data: {
        booking: result.data,
        originalOrderId: id
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error reordering:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REORDER_ERROR',
        message: 'Failed to reorder',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/orders/:id/reorder-data
 * @desc    Get order data formatted for reordering
 * @access  Private (Customer only)
 */
router.get('/orders/:id/reorder-data', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const db = getFirestore();
    
    const orderDoc = await db.collection('bookings').doc(id).get();
    
    if (!orderDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ORDER_NOT_FOUND',
          message: 'Order not found',
          details: 'Order with this ID does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const orderData = orderDoc.data();
    
    // Check if customer owns this order
    if (orderData.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'Access denied',
          details: 'You can only access your own orders'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Check if order is completed
    if (orderData.status !== 'delivered') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REORDER_NOT_ALLOWED',
          message: 'Reorder not allowed',
          details: 'You can only reorder from completed orders'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Format data specifically for reordering (pre-filled form data)
    const reorderData = {
      originalOrderId: id,
      originalOrderDate: orderData.timing?.createdAt?.toDate?.() || orderData.createdAt?.toDate?.() || new Date(),
      
      // Pickup data for form
      pickup: {
        name: orderData.pickup?.name || '',
        phone: orderData.pickup?.phone || '',
        address: orderData.pickup?.address || '',
        coordinates: orderData.pickup?.coordinates || null,
        instructions: orderData.pickup?.instructions || ''
      },
      
      // Dropoff data for form
      dropoff: {
        name: orderData.dropoff?.name || '',
        phone: orderData.dropoff?.phone || '',
        address: orderData.dropoff?.address || '',
        coordinates: orderData.dropoff?.coordinates || null,
        instructions: orderData.dropoff?.instructions || ''
      },
      
      // Package data for form
      package: {
        weight: orderData.package?.weight || 0,
        description: orderData.package?.description || '',
        dimensions: orderData.package?.dimensions || null,
        isFragile: orderData.package?.isFragile || false,
        requiresSpecialHandling: orderData.package?.requiresSpecialHandling || false
      },
      
      // Vehicle data for form
      vehicle: {
        type: orderData.vehicle?.type || '2_wheeler',
        required: orderData.vehicle?.required || false
      },
      
      // Payment method
      paymentMethod: orderData.paymentMethod || 'cash',
      
      // Original order details for reference
      originalOrder: {
        fare: orderData.fare || {},
        distance: orderData.distance || {},
        driver: orderData.driverId ? {
          id: orderData.driverId,
          // Note: Driver details would need to be fetched separately if needed
        } : null,
        rating: orderData.rating || null
      }
    };

    res.status(200).json({
      success: true,
      message: 'Reorder data retrieved successfully',
      data: {
        reorderData
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting reorder data:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REORDER_DATA_ERROR',
        message: 'Failed to retrieve reorder data',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/upload-profile-picture
 * @desc    Upload profile picture
 * @access  Private (Customer only)
 */
router.post('/upload-profile-picture', [
  requireCustomer,
  enhancedFileUploadService.configureMulter().single('profilePicture')
], async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILE',
          message: 'No file uploaded',
          details: 'Please select a profile picture to upload'
        },
        timestamp: new Date().toISOString()
      });
    }

    const { uid } = req.user;

    // Validate file
    const validation = await enhancedFileUploadService.validateFile(req.file);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'FILE_VALIDATION_ERROR',
          message: 'File validation failed',
          details: validation.errors.join(', ')
        },
        timestamp: new Date().toISOString()
      });
    }

    // Get current profile picture to delete later
    const db = getFirestore();
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();
    const currentProfilePicture = userData.profilePicture;

    // Upload new profile picture
    const uploadResult = await enhancedFileUploadService.processAndUploadImage(
      req.file,
      uid,
      'profile'
    );

    // Update user profile
    await db.collection('users').doc(uid).update({
      profilePicture: uploadResult.url,
      updatedAt: new Date()
    });

    // Delete old profile picture if exists
    if (currentProfilePicture && currentProfilePicture.includes('firebase')) {
      try {
        const oldFilename = currentProfilePicture.split('/').pop();
        await enhancedFileUploadService.deleteFile(`profile/${uid}/${oldFilename}`);
      } catch (error) {
        console.warn('Failed to delete old profile picture:', error);
      }
    }

    // Log the action
    await auditService.logFileUpload(uid, uploadResult.filename, 'profile', true, {
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(200).json({
      success: true,
      message: 'Profile picture uploaded successfully',
      data: {
        profilePicture: uploadResult.url
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error uploading profile picture:', error);
    
    // Log the failed attempt
    await auditService.logFileUpload(req.user?.uid, null, 'profile', false, {
      error: error.message,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_PICTURE_UPLOAD_ERROR',
        message: 'Failed to upload profile picture',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   DELETE /api/customer/profile
 * @desc    Delete customer account
 * @access  Private (Customer only)
 */
router.delete('/profile', [
  requireCustomer,
  body('reason')
    .optional()
    .isLength({ min: 5, max: 200 })
    .withMessage('Reason must be between 5 and 200 characters')
], async (req, res) => {
  try {
    const { uid } = req.user;
    const { reason } = req.body;

    const db = getFirestore();

    // Soft delete - mark account as deleted
    await db.collection('users').doc(uid).update({
      accountStatus: 'deleted',
      deletedAt: new Date(),
      deletionReason: reason || 'No reason provided',
      updatedAt: new Date()
    });

    // Cancel any active bookings
    const activeBookings = await db
      .collection('bookings')
      .where('customerId', '==', uid)
      .where('status', 'in', ['pending', 'confirmed', 'driver_assigned'])
      .get();

    const batch = db.batch();
    activeBookings.docs.forEach(doc => {
      batch.update(doc.ref, {
        status: 'cancelled',
        'cancellation.cancelledBy': 'customer',
        'cancellation.reason': 'Account deleted',
        'cancellation.cancelledAt': new Date(),
        updatedAt: new Date()
      });
    });

    await batch.commit();

    // Log the action
    await auditService.logAccountDeletion(uid, reason, true, {
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(200).json({
      success: true,
      message: 'Account deleted successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error deleting account:', error);
    
    // Log the failed attempt
    await auditService.logAccountDeletion(req.user?.uid, req.body.reason, false, {
      error: error.message,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'ACCOUNT_DELETION_ERROR',
        message: 'Failed to delete account',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/deactivate-account
 * @desc    Deactivate customer account
 * @access  Private (Customer only)
 */
router.post('/deactivate-account', [
  requireCustomer,
  body('reason')
    .optional()
    .isLength({ min: 5, max: 200 })
    .withMessage('Reason must be between 5 and 200 characters')
], async (req, res) => {
  try {
    const { uid } = req.user;
    const { reason } = req.body;

    const db = getFirestore();

    await db.collection('users').doc(uid).update({
      accountStatus: 'suspended',
      suspendedAt: new Date(),
      suspensionReason: reason || 'No reason provided',
      updatedAt: new Date()
    });

    // Log the action
    await auditService.logAccountDeactivation(uid, reason, true, {
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(200).json({
      success: true,
      message: 'Account deactivated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error deactivating account:', error);
    
    // Log the failed attempt
    await auditService.logAccountDeactivation(req.user?.uid, req.body.reason, false, {
      error: error.message,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'ACCOUNT_DEACTIVATION_ERROR',
        message: 'Failed to deactivate account',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/reactivate-account
 * @desc    Reactivate customer account
 * @access  Private (Customer only)
 */
router.post('/reactivate-account', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();

    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.data();

    if (userData.accountStatus !== 'suspended') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ACCOUNT_NOT_SUSPENDED',
          message: 'Account not suspended',
          details: 'Account is not currently suspended'
        },
        timestamp: new Date().toISOString()
      });
    }

    await db.collection('users').doc(uid).update({
      accountStatus: 'active',
      reactivatedAt: new Date(),
      updatedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Account reactivated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error reactivating account:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ACCOUNT_REACTIVATION_ERROR',
        message: 'Failed to reactivate account',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/audit-log
 * @desc    Get customer audit log
 * @access  Private (Customer only)
 */
router.get('/audit-log', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 50, offset = 0 } = req.query;

    const auditLogs = await auditService.getUserAuditLogs(uid, parseInt(limit), parseInt(offset));

    res.status(200).json({
      success: true,
      message: 'Audit log retrieved successfully',
      data: {
        auditLogs
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting audit log:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'AUDIT_LOG_RETRIEVAL_ERROR',
        message: 'Failed to retrieve audit log',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/bookings/history
 * @desc    Get customer booking history with pagination
 * @access  Private (Customer only)
 */
router.get('/bookings/history', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 20, offset = 0, status } = req.query;
    const db = getFirestore();
    
    // Build query without orderBy first to avoid index issues
    let query = db.collection('bookings')
      .where('customerId', '==', uid)
      .limit(parseInt(limit));
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
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
    
    // Sort by createdAt in memory if we have data
    if (bookings.length > 0) {
      bookings.sort((a, b) => {
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return dateB - dateA; // Descending order
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Booking history retrieved successfully',
      data: {
        bookings,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: bookings.length
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get booking history error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BOOKING_HISTORY_ERROR',
        message: 'Failed to retrieve booking history',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/bookings/active
 * @desc    Get customer active bookings
 * @access  Private (Customer only)
 */
router.get('/bookings/active', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const activeStatuses = ['pending', 'confirmed', 'driver_assigned', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff'];
    
    const snapshot = await db.collection('bookings')
      .where('customerId', '==', uid)
      .where('status', 'in', activeStatuses)
      .orderBy('createdAt', 'desc')
      .get();
    
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
    
    res.status(200).json({
      success: true,
      message: 'Active bookings retrieved successfully',
      data: { bookings },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get active bookings error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ACTIVE_BOOKINGS_ERROR',
        message: 'Failed to retrieve active bookings'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/support/ticket
 * @desc    Create a new support ticket
 * @access  Private (Customer only)
 */
router.post('/support/ticket', [
  requireCustomer,
  body('subject').notEmpty().withMessage('Subject is required'),
  body('message').notEmpty().withMessage('Message is required'),
  body('category').isIn(['technical', 'billing', 'general', 'complaint']).withMessage('Valid category is required'),
  body('priority').isIn(['low', 'medium', 'high', 'urgent']).withMessage('Valid priority is required')
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
    const { subject, message, category, priority, bookingId } = req.body;
    const db = getFirestore();
    
    const ticketData = {
      id: `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      customerId: uid,
      subject,
      message,
      category,
      priority,
      status: 'open',
      bookingId: bookingId || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      responses: []
    };
    
    await db.collection('supportTickets').doc(ticketData.id).set(ticketData);
    
    res.status(201).json({
      success: true,
      message: 'Support ticket created successfully',
      data: { ticket: ticketData },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Create support ticket error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SUPPORT_TICKET_ERROR',
        message: 'Failed to create support ticket'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/support/tickets
 * @desc    Get customer support tickets
 * @access  Private (Customer only)
 */
router.get('/support/tickets', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 20, offset = 0, status } = req.query;
    const db = getFirestore();
    
    // Build query without orderBy first to avoid index issues
    let query = db.collection('supportTickets')
      .where('customerId', '==', uid)
      .limit(parseInt(limit));
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
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
    
    // Sort by createdAt in memory if we have data
    if (tickets.length > 0) {
      tickets.sort((a, b) => {
        const dateA = new Date(a.createdAt);
        const dateB = new Date(b.createdAt);
        return dateB - dateA; // Descending order
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Support tickets retrieved successfully',
      data: {
        tickets,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: tickets.length
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get support tickets error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SUPPORT_TICKETS_ERROR',
        message: 'Failed to retrieve support tickets',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/notifications
 * @desc    Get customer notifications
 * @access  Private (Customer only)
 */
router.get('/notifications', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 20, offset = 0, unreadOnly = false } = req.query;
    const db = getFirestore();
    
    let query = db.collection('notifications')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));
    
    if (unreadOnly === 'true') {
      query = query.where('isRead', '==', false);
    }
    
    const snapshot = await query.get();
    const notifications = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      notifications.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      });
    });
    
    res.status(200).json({
      success: true,
      message: 'Notifications retrieved successfully',
      data: {
        notifications,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: notifications.length
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATIONS_ERROR',
        message: 'Failed to retrieve notifications'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/notifications/mark-read
 * @desc    Mark notification as read
 * @access  Private (Customer only)
 */
router.post('/notifications/mark-read', [
  requireCustomer,
  body('notificationId').notEmpty().withMessage('Notification ID is required')
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
    const { notificationId } = req.body;
    const db = getFirestore();
    
    const notificationRef = db.collection('notifications').doc(notificationId);
    const notificationDoc = await notificationRef.get();
    
    if (!notificationDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOTIFICATION_NOT_FOUND',
          message: 'Notification not found'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    const notificationData = notificationDoc.data();
    if (notificationData.userId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized to access this notification'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    await notificationRef.update({
      isRead: true,
      readAt: new Date(),
      updatedAt: new Date()
    });
    
    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFICATION_UPDATE_ERROR',
        message: 'Failed to mark notification as read'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/feedback
 * @desc    Submit customer feedback
 * @access  Private (Customer only)
 */
router.post('/feedback', [
  requireCustomer,
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('feedback').optional().isString().withMessage('Feedback must be a string'),
  body('bookingId').optional().isString().withMessage('Booking ID must be a string')
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
    const { rating, feedback, bookingId, category = 'general' } = req.body;
    const db = getFirestore();
    
    const feedbackData = {
      id: `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      customerId: uid,
      bookingId: bookingId || null,
      rating,
      feedback: feedback || '',
      category,
      status: 'submitted',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await db.collection('feedback').doc(feedbackData.id).set(feedbackData);
    
    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      data: { feedback: feedbackData },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FEEDBACK_ERROR',
        message: 'Failed to submit feedback'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/profile/complete
 * @desc    Get complete customer profile with additional data
 * @access  Private (Customer only)
 */
router.get('/profile/complete', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    // Get user profile
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'PROFILE_NOT_FOUND',
          message: 'Profile not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const userData = userDoc.data();
    
    // Get additional profile data
    const [addressesSnapshot, bookingsSnapshot, feedbackSnapshot] = await Promise.all([
      db.collection('addresses').where('customerId', '==', uid).get(),
      db.collection('bookings').where('customerId', '==', uid).get(),
      db.collection('feedback').where('customerId', '==', uid).get()
    ]);
    
    const addresses = [];
    addressesSnapshot.forEach(doc => {
      const data = doc.data();
      addresses.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      });
    });
    
    const totalBookings = bookingsSnapshot.size;
    const completedBookings = bookingsSnapshot.docs.filter(doc => 
      doc.data().status === 'delivered'
    ).length;
    
    const totalFeedback = feedbackSnapshot.size;
    const averageRating = totalFeedback > 0 ? 
      feedbackSnapshot.docs.reduce((sum, doc) => sum + (doc.data().rating || 0), 0) / totalFeedback : 0;
    
    res.status(200).json({
      success: true,
      message: 'Complete profile retrieved successfully',
      data: {
        profile: {
          id: userData.id,
          name: userData.name,
          email: userData.email,
          phone: userData.phone,
          profilePicture: userData.profilePicture,
          customer: userData.customer,
          addresses,
          stats: {
            totalBookings,
            completedBookings,
            totalFeedback,
            averageRating: Math.round(averageRating * 10) / 10
          }
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get complete profile error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_ERROR',
        message: 'Failed to retrieve complete profile'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/emergency/alert
 * @desc    Send emergency alert
 * @access  Private (Customer only)
 */
router.post('/emergency/alert', [
  requireCustomer,
  body('type').isIn(['medical', 'safety', 'technical', 'other']).withMessage('Valid emergency type is required'),
  body('message').notEmpty().withMessage('Emergency message is required'),
  body('location').optional().isObject().withMessage('Location must be an object'),
  body('bookingId').optional().isString().withMessage('Booking ID must be a string')
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
    const { type, message, location, bookingId } = req.body;
    const db = getFirestore();
    
    const alertData = {
      id: `emergency_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      customerId: uid,
      type,
      message,
      location: location || null,
      bookingId: bookingId || null,
      status: 'active',
      priority: 'high',
      createdAt: new Date(),
      updatedAt: new Date(),
      resolvedAt: null,
      resolvedBy: null
    };
    
    await db.collection('emergencyAlerts').doc(alertData.id).set(alertData);
    
    // Send real-time notification to admin
    // This would integrate with your WebSocket service
    
    res.status(201).json({
      success: true,
      message: 'Emergency alert sent successfully',
      data: { alert: alertData },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Send emergency alert error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EMERGENCY_ALERT_ERROR',
        message: 'Failed to send emergency alert'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/emergency/contacts
 * @desc    Get customer emergency contacts
 * @access  Private (Customer only)
 */
router.get('/emergency/contacts', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const snapshot = await db.collection('emergencyContacts')
      .where('customerId', '==', uid)
      .orderBy('createdAt', 'desc')
      .get();
    
    const contacts = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      contacts.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      });
    });
    
    res.status(200).json({
      success: true,
      message: 'Emergency contacts retrieved successfully',
      data: { contacts },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get emergency contacts error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EMERGENCY_CONTACTS_ERROR',
        message: 'Failed to retrieve emergency contacts'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/emergency/contacts
 * @desc    Add emergency contact
 * @access  Private (Customer only)
 */
router.post('/emergency/contacts', [
  requireCustomer,
  body('name').notEmpty().withMessage('Contact name is required'),
  body('phone').isMobilePhone().withMessage('Valid phone number is required'),
  body('relationship').notEmpty().withMessage('Relationship is required')
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
    const { name, phone, relationship, isPrimary = false } = req.body;
    const db = getFirestore();
    
    const contactData = {
      id: `contact_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      customerId: uid,
      name,
      phone,
      relationship,
      isPrimary,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await db.collection('emergencyContacts').doc(contactData.id).set(contactData);
    
    res.status(201).json({
      success: true,
      message: 'Emergency contact added successfully',
      data: { contact: contactData },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Add emergency contact error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EMERGENCY_CONTACT_ERROR',
        message: 'Failed to add emergency contact'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   DELETE /api/customer/emergency/contacts/:id
 * @desc    Delete emergency contact
 * @access  Private (Customer only)
 */
router.delete('/emergency/contacts/:id', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const db = getFirestore();
    
    const contactRef = db.collection('emergencyContacts').doc(id);
    const contactDoc = await contactRef.get();
    
    if (!contactDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CONTACT_NOT_FOUND',
          message: 'Emergency contact not found'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    const contactData = contactDoc.data();
    if (contactData.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized to delete this contact'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    await contactRef.delete();
    
    res.status(200).json({
      success: true,
      message: 'Emergency contact deleted successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Delete emergency contact error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EMERGENCY_CONTACT_DELETE_ERROR',
        message: 'Failed to delete emergency contact'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/payment/history
 * @desc    Get customer payment history
 * @access  Private (Customer only)
 */
router.get('/payment/history', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 20, offset = 0, status } = req.query;
    const db = getFirestore();
    
    let query = db.collection('payments')
      .where('customerId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
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
    
    res.status(200).json({
      success: true,
      message: 'Payment history retrieved successfully',
      data: {
        payments,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: payments.length
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get payment history error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PAYMENT_HISTORY_ERROR',
        message: 'Failed to retrieve payment history'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/faq/categories
 * @desc    Get FAQ categories
 * @access  Private (Customer only)
 */
router.get('/faq/categories', requireCustomer, async (req, res) => {
  try {
    const db = getFirestore();
    
    const snapshot = await db.collection('faqCategories')
      .orderBy('order', 'asc')
      .get();
    
    const categories = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      categories.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      });
    });
    
    res.status(200).json({
      success: true,
      message: 'FAQ categories retrieved successfully',
      data: { categories },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get FAQ categories error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FAQ_CATEGORIES_ERROR',
        message: 'Failed to retrieve FAQ categories'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/faq/list
 * @desc    Get FAQ list with optional filtering
 * @access  Private (Customer only)
 */
router.get('/faq/list', requireCustomer, async (req, res) => {
  try {
    const { categoryId, search, limit = 50, offset = 0 } = req.query;
    const db = getFirestore();
    
    let query = db.collection('faqs')
      .orderBy('order', 'asc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));
    
    if (categoryId) {
      query = query.where('categoryId', '==', categoryId);
    }
    
    const snapshot = await query.get();
    const faqs = [];
    
    snapshot.forEach(doc => {
      const data = doc.data();
      faqs.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });
    
    // Filter by search term if provided
    let filteredFaqs = faqs;
    if (search) {
      const searchLower = search.toLowerCase();
      filteredFaqs = faqs.filter(faq => 
        faq.question.toLowerCase().includes(searchLower) ||
        faq.answer.toLowerCase().includes(searchLower)
      );
    }
    
    res.status(200).json({
      success: true,
      message: 'FAQ list retrieved successfully',
      data: {
        faqs: filteredFaqs,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: filteredFaqs.length
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get FAQ list error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FAQ_LIST_ERROR',
        message: 'Failed to retrieve FAQ list'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/faq/feedback
 * @desc    Submit FAQ feedback
 * @access  Private (Customer only)
 */
router.post('/faq/feedback', [
  requireCustomer,
  body('faqId').notEmpty().withMessage('FAQ ID is required'),
  body('helpful').isBoolean().withMessage('Helpful must be a boolean')
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
    const { faqId, helpful, comment } = req.body;
    const db = getFirestore();
    
    const feedbackData = {
      id: `faq_feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      customerId: uid,
      faqId,
      helpful,
      comment: comment || '',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await db.collection('faqFeedback').doc(feedbackData.id).set(feedbackData);
    
    res.status(201).json({
      success: true,
      message: 'FAQ feedback submitted successfully',
      data: { feedback: feedbackData },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Submit FAQ feedback error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FAQ_FEEDBACK_ERROR',
        message: 'Failed to submit FAQ feedback'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/contact/info
 * @desc    Get contact information
 * @access  Private (Customer only)
 */
router.get('/contact/info', requireCustomer, async (req, res) => {
  try {
    const contactInfo = {
      phone: '+91-9876543210',
      email: 'support@epickup.com',
      address: 'Tirupattur, Tamil Nadu, India',
      businessHours: {
        weekdays: '6:00 AM - 10:00 PM',
        weekends: '7:00 AM - 9:00 PM'
      },
      socialMedia: {
        facebook: 'https://facebook.com/epickup',
        twitter: 'https://twitter.com/epickup',
        instagram: 'https://instagram.com/epickup'
      },
      emergencyContact: '+91-9876543211'
    };
    
    res.status(200).json({
      success: true,
      message: 'Contact information retrieved successfully',
      data: { contactInfo },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get contact info error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CONTACT_INFO_ERROR',
        message: 'Failed to retrieve contact information'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/password/set
 * @desc    Set password for customer account
 * @access  Private (Customer only)
 */
router.post('/password/set', [
  requireCustomer,
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.password) {
      throw new Error('Password confirmation does not match');
    }
    return true;
  })
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
    const { password } = req.body;
    const db = getFirestore();
    
    // Hash password (in production, use bcrypt)
    const hashedPassword = password; // This should be properly hashed
    
    await db.collection('users').doc(uid).update({
      password: hashedPassword,
      hasPassword: true,
      updatedAt: new Date()
    });
    
    res.status(200).json({
      success: true,
      message: 'Password set successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Set password error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SET_PASSWORD_ERROR',
        message: 'Failed to set password'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/customer/password/change
 * @desc    Change customer password
 * @access  Private (Customer only)
 */
router.put('/password/change', [
  requireCustomer,
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
  body('confirmPassword').custom((value, { req }) => {
    if (value !== req.body.newPassword) {
      throw new Error('Password confirmation does not match');
    }
    return true;
  })
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
    const { currentPassword, newPassword } = req.body;
    const db = getFirestore();
    
    // Get user data to verify current password
    const userDoc = await db.collection('users').doc(uid).get();
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
    if (userData.password !== currentPassword) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PASSWORD',
          message: 'Current password is incorrect'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Hash new password (in production, use bcrypt)
    const hashedNewPassword = newPassword; // This should be properly hashed
    
    await db.collection('users').doc(uid).update({
      password: hashedNewPassword,
      updatedAt: new Date()
    });
    
    res.status(200).json({
      success: true,
      message: 'Password changed successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CHANGE_PASSWORD_ERROR',
        message: 'Failed to change password'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/password/forgot
 * @desc    Request password reset
 * @access  Private (Customer only)
 */
router.post('/password/forgot', [
  body('email').isEmail().withMessage('Valid email is required')
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

    const { email } = req.body;
    const db = getFirestore();
    
    // Find user by email
    const userSnapshot = await db.collection('users')
      .where('email', '==', email)
      .where('userType', '==', 'customer')
      .get();
    
    if (userSnapshot.empty) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'No account found with this email'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Generate reset token (in production, use proper token generation)
    const resetToken = `reset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const resetExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    await db.collection('users').doc(userSnapshot.docs[0].id).update({
      resetToken,
      resetExpiry,
      updatedAt: new Date()
    });
    
    // In production, send email with reset link
    // For now, just return success
    
    res.status(200).json({
      success: true,
      message: 'Password reset instructions sent to your email',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FORGOT_PASSWORD_ERROR',
        message: 'Failed to process password reset request'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/sessions
 * @desc    Get user sessions
 * @access  Private (Customer only)
 */
router.get('/sessions', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const snapshot = await db.collection('userSessions')
      .where('userId', '==', uid)
      .orderBy('lastActivity', 'desc')
      .get();
    
    const sessions = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      sessions.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        lastActivity: data.lastActivity?.toDate?.() || data.lastActivity
      });
    });
    
    res.status(200).json({
      success: true,
      message: 'User sessions retrieved successfully',
      data: { sessions },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get user sessions error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'USER_SESSIONS_ERROR',
        message: 'Failed to retrieve user sessions'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/sessions/logout
 * @desc    Logout from specific device
 * @access  Private (Customer only)
 */
router.post('/sessions/logout', [
  requireCustomer,
  body('sessionId').notEmpty().withMessage('Session ID is required')
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
    const { sessionId } = req.body;
    const db = getFirestore();
    
    const sessionRef = db.collection('userSessions').doc(sessionId);
    const sessionDoc = await sessionRef.get();
    
    if (!sessionDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    const sessionData = sessionDoc.data();
    if (sessionData.userId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized to logout this session'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    await sessionRef.update({
      isActive: false,
      loggedOutAt: new Date(),
      updatedAt: new Date()
    });
    
    res.status(200).json({
      success: true,
      message: 'Session logged out successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Logout session error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGOUT_SESSION_ERROR',
        message: 'Failed to logout session'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/sessions/logout-all
 * @desc    Logout from all devices
 * @access  Private (Customer only)
 */
router.post('/sessions/logout-all', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const snapshot = await db.collection('userSessions')
      .where('userId', '==', uid)
      .where('isActive', '==', true)
      .get();
    
    const batch = db.batch();
    snapshot.forEach(doc => {
      batch.update(doc.ref, {
        isActive: false,
        loggedOutAt: new Date(),
        updatedAt: new Date()
      });
    });
    
    await batch.commit();
    
    res.status(200).json({
      success: true,
      message: 'All sessions logged out successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Logout all sessions error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGOUT_ALL_SESSIONS_ERROR',
        message: 'Failed to logout all sessions'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/profile/photo
 * @desc    Get profile photo URL
 * @access  Private (Customer only)
 */
router.get('/profile/photo', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const userDoc = await db.collection('users').doc(uid).get();
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
    
    res.status(200).json({
      success: true,
      message: 'Profile photo retrieved successfully',
      data: {
        profilePhoto: userData.profilePicture || null,
        hasPhoto: !!userData.profilePicture
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get profile photo error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PROFILE_PHOTO_ERROR',
        message: 'Failed to retrieve profile photo'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   DELETE /api/customer/profile/photo
 * @desc    Delete profile photo
 * @access  Private (Customer only)
 */
router.delete('/profile/photo', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    await db.collection('users').doc(uid).update({
      profilePicture: null,
      updatedAt: new Date()
    });
    
    res.status(200).json({
      success: true,
      message: 'Profile photo deleted successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Delete profile photo error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_PROFILE_PHOTO_ERROR',
        message: 'Failed to delete profile photo'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/emergency/history
 * @desc    Get emergency alert history
 * @access  Private (Customer only)
 */
router.get('/emergency/history', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { limit = 20, offset = 0 } = req.query;
    const db = getFirestore();
    
    const snapshot = await db.collection('emergencyAlerts')
      .where('customerId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();
    
    const alerts = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      alerts.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt,
        resolvedAt: data.resolvedAt?.toDate?.() || data.resolvedAt
      });
    });
    
    res.status(200).json({
      success: true,
      message: 'Emergency history retrieved successfully',
      data: {
        alerts,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: alerts.length
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get emergency history error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EMERGENCY_HISTORY_ERROR',
        message: 'Failed to retrieve emergency history'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/support/message
 * @desc    Send support message
 * @access  Private (Customer only)
 */
router.post('/support/message', [
  requireCustomer,
  body('message').notEmpty().withMessage('Message is required'),
  body('category').isIn(['technical', 'billing', 'general', 'complaint']).withMessage('Valid category is required'),
  body('priority').isIn(['low', 'medium', 'high', 'urgent']).withMessage('Valid priority is required')
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
    const { message, category, priority, bookingId } = req.body;
    const db = getFirestore();
    
    const messageData = {
      id: `support_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      customerId: uid,
      message,
      category,
      priority,
      bookingId: bookingId || null,
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
      responses: []
    };
    
    await db.collection('supportMessages').doc(messageData.id).set(messageData);
    
    res.status(201).json({
      success: true,
      message: 'Support message sent successfully',
      data: { message: messageData },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Send support message error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SUPPORT_MESSAGE_ERROR',
        message: 'Failed to send support message'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/customer/profile/update
 * @desc    Update customer profile
 * @access  Private (Customer only)
 */
router.put('/profile/update', [
  requireCustomer,
  body('name').optional().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').optional().isEmail().withMessage('Valid email is required'),
  body('phone').optional().isMobilePhone().withMessage('Valid phone number is required')
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
    const { name, email, phone } = req.body;
    const db = getFirestore();
    
    const updateData = {
      updatedAt: new Date()
    };
    
    if (name) updateData.name = name;
    if (email) updateData.email = email;
    if (phone) updateData.phone = phone;
    
    await db.collection('users').doc(uid).update(updateData);
    
    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_PROFILE_ERROR',
        message: 'Failed to update profile'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/bookings/cancel
 * @desc    Cancel booking with enhanced validation
 * @access  Private (Customer only)
 */
router.post('/bookings/cancel', [
  requireCustomer,
  body('bookingId').notEmpty().withMessage('Booking ID is required'),
  body('reason').notEmpty().withMessage('Cancellation reason is required')
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
    const { bookingId, reason } = req.body;
    const db = getFirestore();
    
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
    if (bookingData.customerId !== uid) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized to cancel this booking'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Check if booking can be cancelled
    const cancellableStatuses = ['pending', 'confirmed', 'driver_assigned'];
    if (!cancellableStatuses.includes(bookingData.status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'BOOKING_NOT_CANCELLABLE',
          message: 'Booking cannot be cancelled at this stage'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    await bookingRef.update({
      status: 'cancelled',
      cancellation: {
        cancelledBy: uid,
        reason,
        cancelledAt: new Date(),
        refundAmount: bookingData.fare?.total || 0
      },
      updatedAt: new Date()
    });
    
    res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: {
        bookingId,
        refundAmount: bookingData.fare?.total || 0
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Cancel booking error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CANCEL_BOOKING_ERROR',
        message: 'Failed to cancel booking'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/email/verify
 * @desc    Send email verification
 * @access  Private (Customer only)
 */
router.post('/email/verify', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    const userDoc = await db.collection('users').doc(uid).get();
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
    if (!userData.email) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_EMAIL',
          message: 'No email address found'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Generate verification token
    const verificationToken = `verify_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    
    await db.collection('users').doc(uid).update({
      emailVerificationToken: verificationToken,
      emailVerificationExpiry: verificationExpiry,
      updatedAt: new Date()
    });
    
    // In production, send email with verification link
    // For now, just return success
    
    res.status(200).json({
      success: true,
      message: 'Email verification sent successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Send email verification error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EMAIL_VERIFICATION_ERROR',
        message: 'Failed to send email verification'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/customer/analytics
 * @desc    Get customer analytics and statistics
 * @access  Private (Customer only)
 */
router.get('/analytics', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const db = getFirestore();
    
    // Get customer data
    const [bookingsSnapshot, feedbackSnapshot, supportTicketsSnapshot] = await Promise.all([
      db.collection('bookings').where('customerId', '==', uid).get(),
      db.collection('feedback').where('customerId', '==', uid).get(),
      db.collection('supportTickets').where('customerId', '==', uid).get()
    ]);
    
    const bookings = [];
    bookingsSnapshot.forEach(doc => {
      const data = doc.data();
      bookings.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      });
    });
    
    const feedback = [];
    feedbackSnapshot.forEach(doc => {
      const data = doc.data();
      feedback.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      });
    });
    
    const supportTickets = [];
    supportTicketsSnapshot.forEach(doc => {
      const data = doc.data();
      supportTickets.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      });
    });
    
    // Calculate analytics
    const totalBookings = bookings.length;
    const completedBookings = bookings.filter(b => b.status === 'delivered').length;
    const cancelledBookings = bookings.filter(b => b.status === 'cancelled').length;
    const totalSpent = bookings
      .filter(b => b.status === 'delivered')
      .reduce((sum, b) => sum + (b.fare?.total || 0), 0);
    
    const averageRating = feedback.length > 0 ? 
      feedback.reduce((sum, f) => sum + (f.rating || 0), 0) / feedback.length : 0;
    
    const openSupportTickets = supportTickets.filter(t => t.status === 'open').length;
    
    // Monthly breakdown
    const monthlyData = {};
    bookings.forEach(booking => {
      const month = booking.createdAt.toISOString().substring(0, 7); // YYYY-MM
      if (!monthlyData[month]) {
        monthlyData[month] = { bookings: 0, spent: 0 };
      }
      monthlyData[month].bookings++;
      if (booking.status === 'delivered') {
        monthlyData[month].spent += booking.fare?.total || 0;
      }
    });
    
    const analytics = {
      overview: {
        totalBookings,
        completedBookings,
        cancelledBookings,
        totalSpent,
        averageRating: Math.round(averageRating * 10) / 10,
        openSupportTickets
      },
      monthlyData,
      recentActivity: {
        lastBooking: bookings.length > 0 ? bookings[0].createdAt : null,
        lastFeedback: feedback.length > 0 ? feedback[0].createdAt : null,
        lastSupportTicket: supportTickets.length > 0 ? supportTickets[0].createdAt : null
      }
    };
    
    res.status(200).json({
      success: true,
      message: 'Customer analytics retrieved successfully',
      data: { analytics },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get customer analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CUSTOMER_ANALYTICS_ERROR',
        message: 'Failed to retrieve customer analytics'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/preferences
 * @desc    Update customer preferences
 * @access  Private (Customer only)
 */
router.post('/preferences', [
  requireCustomer,
  body('preferences').isObject().withMessage('Preferences must be an object')
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
    const { preferences } = req.body;
    const db = getFirestore();
    
    await db.collection('users').doc(uid).update({
      preferences,
      updatedAt: new Date()
    });
    
    res.status(200).json({
      success: true,
      message: 'Preferences updated successfully',
      data: { preferences },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_PREFERENCES_ERROR',
        message: 'Failed to update preferences'
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
