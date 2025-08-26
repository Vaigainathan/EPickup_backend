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

/**
 * @route   GET /api/customer/wallet
 * @desc    Get customer wallet balance
 * @access  Private (Customer only)
 */
router.get('/wallet', requireCustomer, async (req, res) => {
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
    const wallet = userData.customer?.wallet || { balance: 0, currency: 'INR' };

    res.status(200).json({
      success: true,
      message: 'Wallet balance retrieved successfully',
      data: {
        wallet
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting customer wallet:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'WALLET_RETRIEVAL_ERROR',
        message: 'Failed to retrieve wallet',
        details: 'An error occurred while retrieving wallet'
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/customer/wallet/add-money
 * @desc    Add money to customer wallet
 * @access  Private (Customer only)
 */
router.post('/wallet/add-money', [
  requireCustomer,
  body('amount')
    .isFloat({ min: 1 })
    .withMessage('Amount must be at least 1'),
  body('paymentMethod')
    .isIn(['online', 'card', 'upi', 'netbanking'])
    .withMessage('Payment method must be online, card, upi, or netbanking')
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
    const { amount, paymentMethod } = req.body;
    const db = getFirestore();
    
    // In a real implementation, you would process the payment here
    // For now, we'll simulate successful payment
    
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
    const currentBalance = userData.customer?.wallet?.balance || 0;
    const newBalance = currentBalance + amount;

    // Update wallet balance
    await userRef.update({
      'customer.wallet.balance': newBalance,
      updatedAt: new Date()
    });

    // Create wallet transaction record
    const transactionRef = db.collection('walletTransactions').doc();
    await transactionRef.set({
      id: transactionRef.id,
      userId: uid,
      type: 'credit',
      amount,
      previousBalance: currentBalance,
      newBalance,
      paymentMethod,
      status: 'completed',
      createdAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Money added to wallet successfully',
      data: {
        previousBalance: currentBalance,
        addedAmount: amount,
        newBalance,
        transactionId: transactionRef.id
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

module.exports = router;
