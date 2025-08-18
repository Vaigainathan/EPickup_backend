const express = require('express');
const { body, validationResult } = require('express-validator');
const { getFirestore } = require('../services/firebase');
const { requireCustomer } = require('../middleware/auth');
const { userRateLimit } = require('../middleware/auth');

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
        'customer.savedAddresses': admin.firestore.FieldValue.arrayUnion(newAddress),
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
 * @desc    Get customer order history
 * @access  Private (Customer only)
 */
router.get('/orders', requireCustomer, async (req, res) => {
  try {
    const { uid } = req.user;
    const { status, limit = 20, offset = 0 } = req.query;
    const db = getFirestore();
    
    let query = db.collection('bookings').where('customerId', '==', uid);
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
    // Only get completed orders for order history
    query = query.where('status', 'in', ['delivered', 'cancelled']);
    query = query.orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(parseInt(offset));
    
    const snapshot = await query.get();
    const orders = [];
    
    snapshot.forEach(doc => {
      orders.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.status(200).json({
      success: true,
      message: 'Orders retrieved successfully',
      data: {
        orders,
        pagination: {
          limit: parseInt(limit),
          offset: parseInt(offset),
          total: orders.length
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
        details: 'An error occurred while retrieving orders'
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

    res.status(200).json({
      success: true,
      message: 'Order retrieved successfully',
      data: {
        order: {
          id: orderDoc.id,
          ...orderData
        }
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

module.exports = router;
