const express = require('express');
const { getFirestore } = require('firebase-admin/firestore');
const { requireRole } = require('../middleware/auth');
const router = express.Router();

/**
 * @route   GET /api/admin/drivers
 * @desc    Get all drivers with pagination and filters
 * @access  Private (Admin only)
 */
router.get('/drivers', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0, status, verificationStatus } = req.query;

    let query = db.collection('users').where('userType', '==', 'driver');

    // Apply filters
    if (status) {
      query = query.where('isActive', '==', status === 'active');
    }
    if (verificationStatus) {
      query = query.where('isVerified', '==', verificationStatus === 'verified');
    }

    // Apply pagination and ordering
    query = query.orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(parseInt(offset));

    const snapshot = await query.get();
    const drivers = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      drivers.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      });
    });

    res.json({
      success: true,
      data: drivers,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: drivers.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching drivers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_DRIVERS_ERROR',
        message: 'Failed to fetch drivers',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/bookings
 * @desc    Get all bookings with pagination and filters
 * @access  Private (Admin only)
 */
router.get('/bookings', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0, status, dateFrom, dateTo } = req.query;

    let query = db.collection('bookings');

    // Apply filters
    if (status) {
      query = query.where('status', '==', status);
    }
    if (dateFrom) {
      query = query.where('createdAt', '>=', new Date(dateFrom));
    }
    if (dateTo) {
      query = query.where('createdAt', '<=', new Date(dateTo));
    }

    // Apply pagination and ordering
    query = query.orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(parseInt(offset));

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

    res.json({
      success: true,
      data: bookings,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: bookings.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_BOOKINGS_ERROR',
        message: 'Failed to fetch bookings',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/emergency-alerts
 * @desc    Get all emergency alerts with pagination and filters
 * @access  Private (Admin only)
 */
router.get('/emergency-alerts', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0, status, alertType } = req.query;

    let query = db.collection('emergencyAlerts');

    // Apply filters
    if (status) {
      query = query.where('status', '==', status);
    }
    if (alertType) {
      query = query.where('alertType', '==', alertType);
    }

    // Apply pagination and ordering
    query = query.orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(parseInt(offset));

    const snapshot = await query.get();
    const alerts = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      alerts.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });

    res.json({
      success: true,
      data: alerts,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: alerts.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching emergency alerts:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_EMERGENCY_ALERTS_ERROR',
        message: 'Failed to fetch emergency alerts',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/system-health
 * @desc    Get system health metrics
 * @access  Private (Admin only)
 */
router.get('/system-health', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    
    // Get system metrics
    const metrics = {
      totalUsers: 0,
      totalDrivers: 0,
      totalCustomers: 0,
      activeBookings: 0,
      pendingVerifications: 0,
      openSupportTickets: 0,
      activeEmergencyAlerts: 0,
      systemUptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };

    // Count users by type
    const usersSnapshot = await db.collection('users').get();
    usersSnapshot.forEach(doc => {
      const data = doc.data();
      metrics.totalUsers++;
      if (data.userType === 'driver') {
        metrics.totalDrivers++;
      } else if (data.userType === 'customer') {
        metrics.totalCustomers++;
      }
    });

    // Count active bookings
    const activeBookingsSnapshot = await db.collection('bookings')
      .where('status', 'in', ['pending', 'accepted', 'in_progress'])
      .get();
    metrics.activeBookings = activeBookingsSnapshot.size;

    // Count pending verifications
    const pendingVerificationsSnapshot = await db.collection('documentVerificationRequests')
      .where('status', '==', 'pending')
      .get();
    metrics.pendingVerifications = pendingVerificationsSnapshot.size;

    // Count open support tickets
    const openTicketsSnapshot = await db.collection('supportTickets')
      .where('status', 'in', ['open', 'in_progress'])
      .get();
    metrics.openSupportTickets = openTicketsSnapshot.size;

    // Count active emergency alerts
    const activeAlertsSnapshot = await db.collection('emergencyAlerts')
      .where('status', '==', 'active')
      .get();
    metrics.activeEmergencyAlerts = activeAlertsSnapshot.size;

    res.json({
      success: true,
      data: metrics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching system health:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_SYSTEM_HEALTH_ERROR',
        message: 'Failed to fetch system health',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/drivers/pending
 * @desc    Get drivers pending verification
 * @access  Private (Admin only)
 */
router.get('/drivers/pending', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0 } = req.query;

    // Get pending verification requests
    const verificationRequestsRef = db.collection('documentVerificationRequests')
      .where('status', '==', 'pending')
      .orderBy('requestedAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset));

    const snapshot = await verificationRequestsRef.get();
    const pendingDrivers = [];

    for (const doc of snapshot.docs) {
      const requestData = doc.data();
      
      // Get driver details
      const driverDoc = await db.collection('users').doc(requestData.driverId).get();
      if (driverDoc.exists) {
        const driverData = driverDoc.data();
        pendingDrivers.push({
          id: requestData.driverId,
          verificationRequestId: doc.id,
          name: requestData.driverName,
          phone: requestData.driverPhone,
          documents: requestData.documents,
          requestedAt: requestData.requestedAt,
          ...driverData
        });
      }
    }

    res.json({
      success: true,
      data: pendingDrivers,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: pendingDrivers.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching pending drivers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_PENDING_DRIVERS_ERROR',
        message: 'Failed to fetch pending drivers',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/drivers/:driverId/verify
 * @desc    Approve or reject driver verification
 * @access  Private (Admin only)
 */
router.post('/drivers/:driverId/verify', requireRole(['admin']), async (req, res) => {
  try {
    const { driverId } = req.params;
    const { status, reason, comments } = req.body;
    const adminId = req.user.uid;

    if (!status || !['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Status must be either "approved" or "rejected"'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (status === 'rejected' && !reason) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REJECTION_REASON_REQUIRED',
          message: 'Rejection reason is required when rejecting a driver'
        },
        timestamp: new Date().toISOString()
      });
    }

    const db = getFirestore();
    const batch = db.batch();

    // Update driver verification status
    const driverRef = db.collection('users').doc(driverId);
    const driverDoc = await driverRef.get();

    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const driverData = driverDoc.data();
    
    // Update driver status
    batch.update(driverRef, {
      'driver.verificationStatus': status === 'approved' ? 'approved' : 'rejected',
      'driver.verifiedAt': new Date(),
      'driver.verifiedBy': adminId,
      'driver.verificationComments': comments || null,
      'driver.rejectionReason': status === 'rejected' ? reason : null,
      updatedAt: new Date()
    });

    // Update verification request
    const verificationRequestsRef = db.collection('documentVerificationRequests')
      .where('driverId', '==', driverId)
      .where('status', '==', 'pending')
      .limit(1);

    const verificationSnapshot = await verificationRequestsRef.get();
    if (!verificationSnapshot.empty) {
      const verificationDoc = verificationSnapshot.docs[0];
      batch.update(verificationDoc.ref, {
        status: status === 'approved' ? 'approved' : 'rejected',
        reviewedAt: new Date(),
        reviewedBy: adminId,
        reviewNotes: comments || null,
        rejectionReason: status === 'rejected' ? reason : null,
        updatedAt: new Date()
      });
    }

    // If approved, set up initial wallet with ₹500
    if (status === 'approved') {
      batch.update(driverRef, {
        'driver.wallet': {
          balance: 500,
          currency: 'INR',
          transactions: [{
            id: `initial_${Date.now()}`,
            type: 'credit',
            amount: 500,
            description: 'Initial driver bonus',
            timestamp: new Date(),
            status: 'completed'
          }]
        }
      });
    }

    await batch.commit();

    // Send notification to driver (if notification service is available)
    try {
      console.log(`Driver verification ${status} for driver: ${driverData.name} (${driverId})`);
      // This would integrate with your notification service
    } catch (error) {
      console.warn('Failed to send driver notification:', error);
    }

    res.json({
      success: true,
      message: `Driver verification ${status} successfully`,
      data: {
        driverId,
        status,
        verifiedAt: new Date(),
        verifiedBy: adminId,
        initialWallet: status === 'approved' ? 500 : null
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error verifying driver:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_ERROR',
        message: 'Failed to verify driver',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/drivers/:driverId/documents
 * @desc    Get driver documents for review
 * @access  Private (Admin only)
 */
router.get('/drivers/:driverId/documents', requireRole(['admin']), async (req, res) => {
  try {
    const { driverId } = req.params;
    const db = getFirestore();

    const driverDoc = await db.collection('users').doc(driverId).get();
    
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    const driverData = driverDoc.data();
    const documents = driverData.driver?.documents || {};

    res.json({
      success: true,
      data: {
        driverId,
        driverName: driverData.name,
        driverPhone: driverData.phone,
        documents,
        verificationStatus: driverData.driver?.verificationStatus || 'pending',
        verificationRequestedAt: driverData.driver?.verificationRequestedAt || null
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching driver documents:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_DOCUMENTS_ERROR',
        message: 'Failed to fetch driver documents',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/verification/stats
 * @desc    Get verification statistics
 * @access  Private (Admin only)
 */
router.get('/verification/stats', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();

    // Get verification statistics
    const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
      db.collection('documentVerificationRequests').where('status', '==', 'pending').get(),
      db.collection('documentVerificationRequests').where('status', '==', 'approved').get(),
      db.collection('documentVerificationRequests').where('status', '==', 'rejected').get()
    ]);

    const stats = {
      pending: pendingCount.size,
      approved: approvedCount.size,
      rejected: rejectedCount.size,
      total: pendingCount.size + approvedCount.size + rejectedCount.size
    };

    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching verification stats:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_STATS_ERROR',
        message: 'Failed to fetch verification statistics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
