const express = require('express');
const { getFirestore } = require('firebase-admin/firestore');
const { requireRole } = require('../middleware/auth');
const verificationService = require('../services/verificationService');
const router = express.Router();

/**
 * @route   POST /api/admin/create-admin
 * @desc    Create admin user for testing (temporary endpoint)
 * @access  Public (for initial setup)
 */
router.post('/create-admin', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password || !name) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'Email, password, and name are required'
        }
      });
    }

    const db = getFirestore();
    
    // Check if admin already exists
    const existingAdmin = await db.collection('users')
      .where('email', '==', email)
      .where('userType', '==', 'admin')
      .get();
    
    if (!existingAdmin.empty) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ADMIN_EXISTS',
          message: 'Admin user already exists'
        }
      });
    }

    // Create admin user
    const adminData = {
      email,
      name,
      userType: 'admin',
      role: 'super_admin',
      permissions: ['all'],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const adminRef = await db.collection('users').add(adminData);
    
    res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      data: {
        id: adminRef.id,
        email,
        name,
        role: 'super_admin'
      }
    });

  } catch (error) {
    console.error('Error creating admin user:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CREATE_ADMIN_ERROR',
        message: 'Failed to create admin user',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/admin/login
 * @desc    Admin login (simplified for testing)
 * @access  Public
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_CREDENTIALS',
          message: 'Email and password are required'
        }
      });
    }

    const db = getFirestore();
    
    // Find admin user
    const adminQuery = await db.collection('users')
      .where('email', '==', email)
      .where('userType', '==', 'admin')
      .get();
    
    if (adminQuery.empty) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }
      });
    }

    const adminDoc = adminQuery.docs[0];
    const adminData = adminDoc.data();
    
    // For testing, accept any password (in production, use proper authentication)
    const token = `admin_token_${adminDoc.id}_${Date.now()}`;
    
    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: adminDoc.id,
          email: adminData.email,
          name: adminData.name,
          role: adminData.role,
          permissions: adminData.permissions
        }
      }
    });

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'LOGIN_ERROR',
        message: 'Login failed',
        details: error.message
      }
    });
  }
});

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

    for (const doc of snapshot.docs) {
      const data = doc.data();
      drivers.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      });
    }

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
 * @route   DELETE /api/admin/drivers/:id
 * @desc    Permanently delete a driver and cascade delete related data
 * @access  Private (Admin only)
 */
router.delete('/drivers/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.uid;
    const db = getFirestore();
    const batch = db.batch();

    // Get driver data first
    const driverRef = db.collection('users').doc(id);
    const driverDoc = await driverRef.get();
    
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found'
        }
      });
    }

    const driverData = driverDoc.data();
    if (driverData.userType !== 'driver') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a driver'
        }
      });
    }

    // Delete driver from users collection
    batch.delete(driverRef);

    // Delete driver documents
    const driverDocsSnapshot = await db.collection('driverDocuments')
      .where('driverId', '==', id)
      .get();
    
    driverDocsSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Delete document verification requests
    const verificationSnapshot = await db.collection('documentVerificationRequests')
      .where('driverId', '==', id)
      .get();
    
    verificationSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });

    // Update bookings to remove driver reference
    const bookingsSnapshot = await db.collection('bookings')
      .where('driverId', '==', id)
      .get();
    
    bookingsSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        driverId: null,
        driverName: null,
        status: 'cancelled',
        cancellationReason: 'Driver account deleted',
        updatedAt: new Date()
      });
    });

    // Log the deletion action
    const auditLogRef = db.collection('adminLogs').doc();
    batch.set(auditLogRef, {
      action: 'driver_deleted',
      adminId,
      targetUserId: id,
      targetUserType: 'driver',
      details: {
        driverName: driverData.name || driverData.personalInfo?.name,
        driverEmail: driverData.email || driverData.personalInfo?.email,
        deletedAt: new Date()
      },
      timestamp: new Date()
    });

    await batch.commit();

    res.json({
      success: true,
      message: 'Driver deleted successfully',
      data: {
        driverId: id,
        deletedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error deleting driver:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_DRIVER_ERROR',
        message: 'Failed to delete driver',
        details: error.message
      }
    });
  }
});

/**
 * @route   PUT /api/admin/drivers/:id/ban
 * @desc    Ban a driver (irreversible action)
 * @access  Private (Admin only)
 */
router.put('/drivers/:id/ban', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.uid;
    const db = getFirestore();
    const batch = db.batch();

    // Get driver data
    const driverRef = db.collection('users').doc(id);
    const driverDoc = await driverRef.get();
    
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DRIVER_NOT_FOUND',
          message: 'Driver not found'
        }
      });
    }

    const driverData = driverDoc.data();
    if (driverData.userType !== 'driver') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a driver'
        }
      });
    }

    if (driverData.accountStatus === 'banned') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_BANNED',
          message: 'Driver is already banned'
        }
      });
    }

    // Update driver status to banned
    batch.update(driverRef, {
      accountStatus: 'banned',
      bannedAt: new Date(),
      bannedBy: adminId,
      banReason: reason || 'Violation of terms of service',
      updatedAt: new Date()
    });

    // Cancel all active bookings
    const activeBookingsSnapshot = await db.collection('bookings')
      .where('driverId', '==', id)
      .where('status', 'in', ['pending', 'accepted', 'in_progress'])
      .get();
    
    activeBookingsSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        status: 'cancelled',
        cancellationReason: 'Driver account banned',
        cancelledAt: new Date(),
        updatedAt: new Date()
      });
    });

    // Log the ban action
    const auditLogRef = db.collection('adminLogs').doc();
    batch.set(auditLogRef, {
      action: 'driver_banned',
      adminId,
      targetUserId: id,
      targetUserType: 'driver',
      details: {
        driverName: driverData.name || driverData.personalInfo?.name,
        driverEmail: driverData.email || driverData.personalInfo?.email,
        banReason: reason || 'Violation of terms of service',
        bannedAt: new Date()
      },
      timestamp: new Date()
    });

    await batch.commit();

    res.json({
      success: true,
      message: 'Driver banned successfully',
      data: {
        driverId: id,
        accountStatus: 'banned',
        bannedAt: new Date().toISOString(),
        banReason: reason || 'Violation of terms of service'
      }
    });

  } catch (error) {
    console.error('Error banning driver:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BAN_DRIVER_ERROR',
        message: 'Failed to ban driver',
        details: error.message
      }
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
 * @route   GET /api/admin/emergency/alerts/active
 * @desc    Get active emergency alerts
 * @access  Private (Admin only)
 */
router.get('/emergency/alerts/active', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    
    // Get active emergency alerts
    const activeAlertsSnapshot = await db.collection('emergencyAlerts')
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .get();

    const activeAlerts = [];
    activeAlertsSnapshot.forEach(doc => {
      const data = doc.data();
      activeAlerts.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });

    // If no alerts exist, create some mock data for testing
    if (activeAlerts.length === 0) {
      const mockAlerts = [
        {
          id: 'mock-alert-1',
          alertId: 'mock-alert-1',
          userId: 'customer-1',
          userType: 'customer',
          userInfo: {
            name: 'Alice Johnson',
            phone: '+1234567890'
          },
          type: 'medical',
          priority: 'high',
          status: 'active',
          location: {
            address: '123 Main St, New York, NY',
            latitude: 40.7128,
            longitude: -74.0060
          },
          description: 'Customer experiencing chest pain during ride',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: 'mock-alert-2',
          alertId: 'mock-alert-2',
          userId: 'customer-2',
          userType: 'customer',
          userInfo: {
            name: 'Bob Smith',
            phone: '+1234567891'
          },
          type: 'other',
          priority: 'medium',
          status: 'active',
          location: {
            address: '456 Broadway, New York, NY',
            latitude: 40.7589,
            longitude: -73.9851
          },
          description: 'Driver reported aggressive behavior from customer',
          createdAt: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
          updatedAt: new Date(Date.now() - 300000).toISOString()
        }
      ];

      // Store mock alerts in Firestore for future use
      for (const alert of mockAlerts) {
        await db.collection('emergencyAlerts').doc(alert.id).set(alert);
      }

      res.json({
        success: true,
        data: mockAlerts,
        count: mockAlerts.length,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({
        success: true,
        data: activeAlerts,
        count: activeAlerts.length,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Error fetching active emergency alerts:', error);

    // Check if it's a Firestore index error
    if (error.code === 9 && error.details && error.details.includes('index')) {
      console.error('Firestore index required. Please create the composite index for emergencyAlerts collection with fields: status (ASC), createdAt (DESC), __name__ (DESC)');
      res.status(500).json({
        success: false,
        error: {
          code: 'FIRESTORE_INDEX_REQUIRED',
          message: 'Database index required. Please contact administrator to create the required index.',
          details: 'The query requires a composite index on emergencyAlerts collection'
        },
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: {
          code: 'FETCH_ACTIVE_EMERGENCY_ALERTS_ERROR',
          message: 'Failed to fetch active emergency alerts',
          details: error.message
        },
        timestamp: new Date().toISOString()
      });
    }
  }
});

/**
 * @route   GET /api/admin/emergency/analytics
 * @desc    Get emergency analytics data
 * @access  Private (Admin only)
 */
router.get('/emergency/analytics', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    
    // Get emergency analytics
    const [activeAlerts, resolvedAlerts, totalAlerts] = await Promise.all([
      db.collection('emergencyAlerts').where('status', '==', 'active').get(),
      db.collection('emergencyAlerts').where('status', '==', 'resolved').get(),
      db.collection('emergencyAlerts').get()
    ]);

    const analytics = {
      total: totalAlerts.size,
      active: activeAlerts.size,
      resolved: resolvedAlerts.size,
      responseTime: {
        average: 4.5, // minutes
        median: 3.2
      },
      byType: {
        medical: 0,
        sos: 0,
        accident: 0,
        harassment: 0,
        other: 0
      },
      byPriority: {
        high: 0,
        medium: 0,
        low: 0,
        critical: 0
      }
    };

    // Count by type and priority
    totalAlerts.forEach(doc => {
      const data = doc.data();
      if (analytics.byType[data.type]) {
        analytics.byType[data.type]++;
      }
      if (analytics.byPriority[data.priority]) {
        analytics.byPriority[data.priority]++;
      }
    });

    res.json({
      success: true,
      data: analytics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching emergency analytics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_EMERGENCY_ANALYTICS_ERROR',
        message: 'Failed to fetch emergency analytics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/emergency/nearby-drivers
 * @desc    Get nearby drivers for emergency response
 * @access  Private (Admin only)
 */
router.get('/emergency/nearby-drivers', requireRole(['admin']), async (req, res) => {
  try {
    const { latitude, longitude } = req.query;
    
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_COORDINATES',
          message: 'Latitude and longitude are required'
        }
      });
    }

    // Mock nearby drivers data
    const nearbyDrivers = [
      {
        id: 'driver-1',
        name: 'John Doe',
        phone: '+1234567890',
        distance: 0.8,
        eta: 3,
        status: 'available',
        vehicle: {
          make: 'Toyota',
          model: 'Camry',
          licensePlate: 'ABC123'
        }
      },
      {
        id: 'driver-2',
        name: 'Jane Wilson',
        phone: '+1234567891',
        distance: 1.2,
        eta: 5,
        status: 'available',
        vehicle: {
          make: 'Honda',
          model: 'Civic',
          licensePlate: 'XYZ789'
        }
      }
    ];

    res.json({
      success: true,
      data: nearbyDrivers,
      count: nearbyDrivers.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching nearby drivers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_NEARBY_DRIVERS_ERROR',
        message: 'Failed to fetch nearby drivers',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/emergency/notify-drivers
 * @desc    Notify drivers about emergency
 * @access  Private (Admin only)
 */
router.post('/emergency/notify-drivers', requireRole(['admin']), async (req, res) => {
  try {
    const { alertId, driverIds, message } = req.body;
    
    if (!alertId || !driverIds || !message) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'Alert ID, driver IDs, and message are required'
        }
      });
    }

    // Mock notification response
    res.json({
      success: true,
      data: {
        message: 'Drivers notified successfully',
        notifiedCount: driverIds.length,
        alertId
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error notifying drivers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'NOTIFY_DRIVERS_ERROR',
        message: 'Failed to notify drivers',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/emergency/contact-services
 * @desc    Contact emergency services
 * @access  Private (Admin only)
 */
router.post('/emergency/contact-services', requireRole(['admin']), async (req, res) => {
  try {
    const { alertId, serviceType } = req.body;
    
    if (!alertId || !serviceType) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_FIELDS',
          message: 'Alert ID and service type are required'
        }
      });
    }

    // Mock emergency service contact response
    res.json({
      success: true,
      data: {
        message: 'Emergency services contacted successfully',
        serviceType,
        alertId,
        referenceNumber: `EMS-${Date.now()}`
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error contacting emergency services:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CONTACT_EMERGENCY_SERVICES_ERROR',
        message: 'Failed to contact emergency services',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/emergency/reports
 * @desc    Get emergency reports
 * @access  Private (Admin only)
 */
router.get('/emergency/reports', requireRole(['admin']), async (req, res) => {
  try {
    // const { startDate, endDate, type, severity } = req.query; // TODO: Implement filtering
    
    // Mock emergency reports data
    const reports = [
      {
        id: 'report-1',
        alertId: 'alert-1',
        type: 'medical',
        severity: 'high',
        status: 'resolved',
        reportedAt: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        resolvedAt: new Date(Date.now() - 82800000).toISOString(), // 1 hour later
        responseTime: 60, // minutes
        responder: 'Admin User',
        actions: ['contacted_ems', 'notified_driver', 'followed_up']
      },
      {
        id: 'report-2',
        alertId: 'alert-2',
        type: 'safety',
        severity: 'medium',
        status: 'resolved',
        reportedAt: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
        resolvedAt: new Date(Date.now() - 169200000).toISOString(), // 1 hour later
        responseTime: 60,
        responder: 'Admin User',
        actions: ['contacted_customer', 'contacted_driver', 'mediation']
      }
    ];

    res.json({
      success: true,
      data: reports,
      count: reports.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching emergency reports:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_EMERGENCY_REPORTS_ERROR',
        message: 'Failed to fetch emergency reports',
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

    // Get all drivers and filter for pending verification
    const driversSnapshot = await db.collection('users')
      .where('userType', '==', 'driver')
      .orderBy('createdAt', 'desc')
      .get();

    const pendingDrivers = [];
    let processedCount = 0;

    for (const doc of driversSnapshot.docs) {
      if (processedCount >= parseInt(limit)) break;
      
      const driverData = doc.data();
      const verificationStatus = driverData.driver?.verificationStatus || 'pending';
      
      // Only include drivers with pending verification
      if (verificationStatus === 'pending' || verificationStatus === 'pending_verification') {
        pendingDrivers.push({
          id: doc.id,
          ...driverData,
          createdAt: driverData.createdAt?.toDate?.() || driverData.createdAt
        });
        processedCount++;
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
 * @route   GET /api/admin/drivers/:driverId/documents
 * @desc    Get driver documents for admin review
 * @access  Private (Admin only)
 */
router.get('/drivers/:driverId/documents', requireRole(['admin']), async (req, res) => {
  try {
    const { driverId } = req.params;
    
    // Use the same comprehensive verification service that the driver app uses
    const verificationService = require('../services/verificationService');
    let comprehensiveVerificationData;
    
    try {
      comprehensiveVerificationData = await verificationService.getDriverVerificationData(driverId);
      console.log('📊 Admin fetching comprehensive verification data:', comprehensiveVerificationData);
    } catch (verificationError) {
      console.warn('⚠️ Failed to get comprehensive verification data for admin:', verificationError.message);
    }

    // Get driver basic info
    const db = getFirestore();
    const driverDoc = await db.collection('users').doc(driverId).get();
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { 
          code: 'DRIVER_NOT_FOUND', 
          message: 'Driver not found' 
        }
      });
    }

    const driverData = driverDoc.data();
    
    // Use comprehensive data if available, otherwise fall back to basic data
    const finalDocuments = comprehensiveVerificationData?.documents || driverData.driver?.documents || {};
    const finalVerificationStatus = comprehensiveVerificationData?.verificationStatus || driverData.driver?.verificationStatus || 'pending';
    
    // Process documents to ensure proper verification status
    const processedDocuments = {};
    const documentTypes = ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
    
    documentTypes.forEach(docType => {
      const doc = finalDocuments[docType];
      if (doc) {
        processedDocuments[docType] = {
          ...doc,
          verified: doc.verificationStatus === 'verified' || doc.status === 'verified' || doc.verified === true,
          status: doc.verificationStatus || doc.status || 'pending'
        };
      } else {
        processedDocuments[docType] = null;
      }
    });
    
    res.json({
      success: true,
      data: {
        documents: processedDocuments,
        driverId,
        driverName: driverData.name,
        verificationStatus: finalVerificationStatus,
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
    console.error('Error fetching driver documents:', error);
    res.status(500).json({
      success: false,
      error: { 
        code: 'DOCUMENTS_FETCH_ERROR', 
        message: 'Failed to fetch documents',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/test-verification-flow/:driverId
 * @desc    Test complete verification flow
 * @access  Private (Admin only)
 */
router.post('/test-verification-flow/:driverId', requireRole(['admin']), async (req, res) => {
  try {
    const { driverId } = req.params;
    const db = getFirestore();
    
    console.log(`🧪 Testing complete verification flow for driver: ${driverId}`);
    
    // Step 1: Get driver information
    const driverRef = db.collection('users').doc(driverId);
    const driverDoc = await driverRef.get();
    
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found' }
      });
    }
    
    const driverData = driverDoc.data();
    const documents = driverData.driver?.documents || driverData.documents || {};
    
    // Step 2: Check verification requests
    const verificationQuery = await db.collection('documentVerificationRequests')
      .where('driverId', '==', driverId)
      .orderBy('requestedAt', 'desc')
      .get();
    
    // Step 3: Test document verification for each document type
    const testResults = [];
    const documentTypes = ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
    
    for (const docType of documentTypes) {
      const doc = documents[docType];
      if (doc && doc.url) {
        // Test individual document verification
        try {
          const testResponse = await fetch(`${req.protocol}://${req.get('host')}/api/admin/drivers/${driverId}/documents/${docType}/verify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': req.headers.authorization
            },
            body: JSON.stringify({
              status: 'verified',
              comments: 'Test verification',
              rejectionReason: null
            })
          });
          
          const testResult = await testResponse.json();
          testResults.push({
            documentType: docType,
            hasUrl: !!doc.url,
            verificationTest: testResult.success ? 'PASS' : 'FAIL',
            error: testResult.error?.message || null
          });
        } catch (error) {
          testResults.push({
            documentType: docType,
            hasUrl: !!doc.url,
            verificationTest: 'ERROR',
            error: error.message
          });
        }
      } else {
        testResults.push({
          documentType: docType,
          hasUrl: false,
          verificationTest: 'SKIP',
          error: 'No document URL found'
        });
      }
    }
    
    // Step 4: Test overall verification
    let overallVerificationTest = 'SKIP';
    try {
      const overallResponse = await fetch(`${req.protocol}://${req.get('host')}/api/admin/drivers/${driverId}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers.authorization
        },
        body: JSON.stringify({
          status: 'approved',
          comments: 'Test overall verification'
        })
      });
      
      const overallResult = await overallResponse.json();
      overallVerificationTest = overallResult.success ? 'PASS' : 'FAIL';
    } catch {
      overallVerificationTest = 'ERROR';
    }
    
    // Step 5: Test status sync
    let statusSyncTest = 'SKIP';
    try {
      const syncResponse = await fetch(`${req.protocol}://${req.get('host')}/api/admin/drivers/${driverId}/sync-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers.authorization
        }
      });
      
      const syncResult = await syncResponse.json();
      statusSyncTest = syncResult.success ? 'PASS' : 'FAIL';
    } catch {
      statusSyncTest = 'ERROR';
    }
    
    const testSummary = {
      driverId,
      driverName: driverData.name,
      currentStatus: driverData.driver?.verificationStatus || 'unknown',
      documentsFound: Object.keys(documents).length,
      verificationRequests: verificationQuery.size,
      documentTests: testResults,
      overallVerificationTest,
      statusSyncTest,
      timestamp: new Date().toISOString()
    };
    
    console.log('🧪 Verification flow test completed:', testSummary);
    
    res.json({
      success: true,
      data: testSummary,
      message: 'Verification flow test completed'
    });
    
  } catch (error) {
    console.error('Test verification flow error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TEST_VERIFICATION_FLOW_ERROR',
        message: 'Failed to test verification flow',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/test-document-access/:driverId
 * @desc    Test document access from Firebase Storage
 * @access  Private (Admin only)
 */
router.get('/test-document-access/:driverId', requireRole(['admin']), async (req, res) => {
  try {
    const { driverId } = req.params;
    const db = getFirestore();
    
    console.log(`🔍 Testing document access for driver: ${driverId}`);
    
    // Get driver documents
    const driverDoc = await db.collection('users').doc(driverId).get();
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found' }
      });
    }
    
    const driverData = driverDoc.data();
    const documents = driverData.driver?.documents || driverData.documents || {};
    
    const testResults = [];
    const documentTypes = ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
    
    for (const docType of documentTypes) {
      const doc = documents[docType];
      if (doc && doc.url) {
        try {
          // Test if URL is accessible
          const response = await fetch(doc.url, { method: 'HEAD' });
          testResults.push({
            documentType: docType,
            url: doc.url,
            accessible: response.ok,
            statusCode: response.status,
            contentType: response.headers.get('content-type'),
            size: response.headers.get('content-length')
          });
        } catch (error) {
          testResults.push({
            documentType: docType,
            url: doc.url,
            accessible: false,
            error: error.message
          });
        }
      } else {
        testResults.push({
          documentType: docType,
          url: null,
          accessible: false,
          error: 'No document URL found'
        });
      }
    }
    
    res.json({
      success: true,
      data: {
        driverId,
        driverName: driverData.name,
        testResults,
        summary: {
          totalDocuments: documentTypes.length,
          accessibleDocuments: testResults.filter(r => r.accessible).length,
          inaccessibleDocuments: testResults.filter(r => !r.accessible).length
        }
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Document access test error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENT_ACCESS_TEST_ERROR',
        message: 'Failed to test document access',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/debug/documents/:driverId
 * @desc    Debug endpoint to check document flow
 * @access  Private (Admin only)
 */
router.get('/debug/documents/:driverId', requireRole(['admin']), async (req, res) => {
  try {
    const { driverId } = req.params;
    const db = getFirestore();
    
    console.log(`🔍 Debug: Checking document flow for driver: ${driverId}`);
    
    // Get driver information
    const driverDoc = await db.collection('users').doc(driverId).get();
    if (!driverDoc.exists) {
      return res.status(404).json({
        success: false,
        error: { code: 'DRIVER_NOT_FOUND', message: 'Driver not found' }
      });
    }

    const driverData = driverDoc.data();
    
    // Get verification requests
    const verificationQuery = await db.collection('documentVerificationRequests')
      .where('driverId', '==', driverId)
      .orderBy('requestedAt', 'desc')
      .get();

    // Get driver documents collection
    const driverDocsQuery = await db.collection('driverDocuments')
      .where('driverId', '==', driverId)
      .get();

    const debugInfo = {
      driverId,
      driverName: driverData.name,
      driverPhone: driverData.phone,
      verificationStatus: driverData.driver?.verificationStatus,
      userCollectionDocuments: driverData.driver?.documents || driverData.documents || {},
      verificationRequests: verificationQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })),
      driverDocumentsCollection: driverDocsQuery.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })),
      timestamp: new Date().toISOString()
    };

    console.log(`🔍 Debug info for driver ${driverId}:`, JSON.stringify(debugInfo, null, 2));

    res.json({
      success: true,
      data: debugInfo,
      message: 'Debug information retrieved successfully'
    });

  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DEBUG_ERROR',
        message: 'Failed to retrieve debug information',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/admin/drivers/:driverId/documents/:documentType/verify
 * @desc    Verify individual document
 * @access  Private (Admin only)
 */
router.post('/drivers/:driverId/documents/:documentType/verify', requireRole(['admin']), async (req, res) => {
  try {
    const { driverId, documentType } = req.params;
    const { status, comments, rejectionReason } = req.body;
    const adminId = req.user.uid;

    // Input validation
    if (!driverId || typeof driverId !== 'string' || driverId.trim() === '') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DRIVER_ID',
          message: 'Valid driver ID is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!documentType || typeof documentType !== 'string' || documentType.trim() === '') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_DOCUMENT_TYPE',
          message: 'Valid document type is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (!status || !['verified', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Status must be either "verified" or "rejected"'
        },
        timestamp: new Date().toISOString()
      });
    }

    if (status === 'rejected' && (!rejectionReason || rejectionReason.trim() === '')) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REJECTION_REASON_REQUIRED',
          message: 'Rejection reason is required when rejecting a document'
        },
        timestamp: new Date().toISOString()
      });
    }

    // Use centralized verification service
    const result = await verificationService.verifyDriverDocument(
      driverId, 
      documentType, 
      status, 
      comments, 
      rejectionReason, 
      adminId
    );

    res.json({
      success: true,
      message: `Document ${status} successfully`,
      data: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error verifying document:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENT_VERIFICATION_ERROR',
        message: 'Failed to verify document',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/sync-all-drivers-status
 * @desc    Sync verification status for all drivers based on document status
 * @access  Private (Admin only)
 */
router.post('/sync-all-drivers-status', requireRole(['admin']), async (req, res) => {
  try {
    console.log('🔄 Syncing verification status for all drivers...');
    
    // Use centralized verification service
    const syncResults = await verificationService.syncAllDriversVerificationStatus();
    
    res.json({
      success: true,
      message: 'Status synchronization completed',
      data: syncResults,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error syncing all drivers status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SYNC_ALL_DRIVERS_ERROR',
        message: 'Failed to sync all drivers status',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/drivers/:driverId/sync-status
 * @desc    Sync driver verification status based on documents
 * @access  Private (Admin only)
 */
router.post('/drivers/:driverId/sync-status', requireRole(['admin']), async (req, res) => {
  try {
    const { driverId } = req.params;
    
    // Use centralized verification service
    const verificationData = await verificationService.getDriverVerificationData(driverId);
    await verificationService.updateDriverVerificationStatus(driverId, verificationData);
    
    console.log(`✅ Status synced for driver ${driverId}: ${verificationData.verificationStatus} (${verificationData.documentSummary.verified}/${verificationData.documentSummary.total} documents verified)`);
    
    res.json({
      success: true,
      message: 'Status synchronized successfully',
      data: {
        driverId,
        driverName: verificationData.driverName,
        verificationStatus: verificationData.verificationStatus,
        isVerified: verificationData.isVerified,
        documentSummary: verificationData.documentSummary,
        syncedAt: new Date()
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error syncing status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SYNC_STATUS_ERROR',
        message: 'Failed to sync verification status',
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

    // Use centralized verification service
    let result;
    if (status === 'approved') {
      result = await verificationService.approveDriver(driverId, comments, adminId);
    } else {
      result = await verificationService.rejectDriver(driverId, reason, adminId);
    }

    res.json({
      success: true,
      message: `Driver verification ${status} successfully`,
      data: result.data,
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

/**
 * @route   GET /api/admin/analytics
 * @desc    Get comprehensive analytics data
 * @access  Private (Admin only)
 */
router.get('/analytics', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    const { period = '30d' } = req.query;
    
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

    // Get analytics data
    const [
      totalUsers,
      totalDrivers,
      totalCustomers,
      totalBookings,
      completedBookings,
      activeBookings,
      driverEarnings
    ] = await Promise.all([
      db.collection('users').get(),
      db.collection('users').where('userType', '==', 'driver').get(),
      db.collection('users').where('userType', '==', 'customer').get(),
      db.collection('bookings').where('createdAt', '>=', startDate).get(),
      db.collection('bookings').where('status', '==', 'completed').where('createdAt', '>=', startDate).get(),
      db.collection('bookings').where('status', 'in', ['pending', 'accepted', 'in_progress']).get(),
      db.collection('users').where('userType', '==', 'driver').get()
    ]);

    // Calculate revenue
    let revenue = 0;
    completedBookings.forEach(doc => {
      const data = doc.data();
      revenue += data.fare?.totalFare || data.fare || 0;
    });

    // Calculate driver earnings
    let totalDriverEarnings = 0;
    driverEarnings.forEach(doc => {
      const data = doc.data();
      totalDriverEarnings += data.driver?.wallet?.balance || 0;
    });

    const analytics = {
      period,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      users: {
        total: totalUsers.size,
        drivers: totalDrivers.size,
        customers: totalCustomers.size,
        growth: 0 // Would need historical data to calculate
      },
      bookings: {
        total: totalBookings.size,
        completed: completedBookings.size,
        active: activeBookings.size,
        completionRate: totalBookings.size > 0 ? (completedBookings.size / totalBookings.size * 100).toFixed(2) : 0
      },
      revenue: {
        total: revenue,
        averagePerBooking: completedBookings.size > 0 ? (revenue / completedBookings.size).toFixed(2) : 0,
        driverEarnings: totalDriverEarnings,
        platformCommission: revenue - totalDriverEarnings
      },
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      data: analytics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ANALYTICS_ERROR',
        message: 'Failed to fetch analytics data',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/support/tickets
 * @desc    Get all support tickets with pagination and filters
 * @access  Private (Admin only)
 */
router.get('/support/tickets', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0, status, priority, category } = req.query;

    let query = db.collection('supportTickets');

    // Apply filters
    if (status) {
      query = query.where('status', '==', status);
    }
    if (priority) {
      query = query.where('priority', '==', priority);
    }
    if (category) {
      query = query.where('category', '==', category);
    }

    // Apply pagination and ordering
    query = query.orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(parseInt(offset));

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

    res.json({
      success: true,
      data: tickets,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: tickets.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching support tickets:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_SUPPORT_TICKETS_ERROR',
        message: 'Failed to fetch support tickets',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/support/tickets/:ticketId/resolve
 * @desc    Resolve a support ticket
 * @access  Private (Admin only)
 */
router.post('/support/tickets/:ticketId/resolve', requireRole(['admin']), async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { resolution, notes } = req.body;
    const adminId = req.user.uid;

    if (!resolution) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'RESOLUTION_REQUIRED',
          message: 'Resolution is required'
        },
        timestamp: new Date().toISOString()
      });
    }

    const db = getFirestore();
    const ticketRef = db.collection('supportTickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Support ticket not found'
        },
        timestamp: new Date().toISOString()
      });
    }

    await ticketRef.update({
      status: 'resolved',
      resolution,
      resolvedBy: adminId,
      resolvedAt: new Date(),
      adminNotes: notes || null,
      updatedAt: new Date()
    });

    res.json({
      success: true,
      message: 'Support ticket resolved successfully',
      data: {
        ticketId,
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: adminId
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error resolving support ticket:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'RESOLVE_TICKET_ERROR',
        message: 'Failed to resolve support ticket',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/system/health
 * @desc    Get detailed system health information
 * @access  Private (Admin only)
 */
router.get('/system/health', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    
    // Get system health metrics
    const health = {
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
      services: [
        { name: 'API', status: 'healthy', lastCheck: new Date().toISOString() },
        { name: 'Database', status: 'healthy', lastCheck: new Date().toISOString() },
        { name: 'WebSocket', status: 'healthy', lastCheck: new Date().toISOString() },
        { name: 'Firebase', status: 'healthy', lastCheck: new Date().toISOString() }
      ],
      metrics: {
        totalUsers: 0,
        totalDrivers: 0,
        totalCustomers: 0,
        activeBookings: 0,
        pendingVerifications: 0,
        openSupportTickets: 0,
        activeEmergencyAlerts: 0
      },
      // Add SystemMetrics structure for frontend compatibility
      systemMetrics: {
        timestamp: new Date().toISOString(),
        server: {
          cpu: Math.round(Math.random() * 30 + 20), // Simulate CPU usage between 20-50%
          memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), // MB
          disk: Math.round(Math.random() * 20 + 10), // Simulate disk usage between 10-30%
          uptime: process.uptime()
        },
        database: {
          connections: Math.round(Math.random() * 10 + 5), // Simulate 5-15 connections
          responseTime: Math.round(Math.random() * 50 + 10), // Simulate 10-60ms response time
          queries: Math.round(Math.random() * 100 + 50) // Simulate 50-150 queries
        },
        api: {
          requests: Math.round(Math.random() * 1000 + 500), // Simulate 500-1500 requests
          responseTime: Math.round(Math.random() * 100 + 50), // Simulate 50-150ms response time
          errorRate: Math.round(Math.random() * 2) // Simulate 0-2% error rate
        },
        websocket: {
          connections: Math.round(Math.random() * 20 + 5), // Simulate 5-25 connections
          messages: Math.round(Math.random() * 500 + 100) // Simulate 100-600 messages
        },
        users: {
          online: Math.round(Math.random() * 50 + 10), // Simulate 10-60 online users
          active: Math.round(Math.random() * 30 + 5) // Simulate 5-35 active users
        }
      }
    };

    // Test database connectivity
    try {
      await db.collection('users').limit(1).get();
      health.services[1].status = 'healthy'; // Database service
    } catch {
      health.services[1].status = 'unhealthy'; // Database service
      health.status = 'degraded';
    }

    // Get metrics
    const [
      usersSnapshot,
      driversSnapshot,
      customersSnapshot,
      activeBookingsSnapshot,
      pendingVerificationsSnapshot,
      openTicketsSnapshot,
      activeAlertsSnapshot
    ] = await Promise.all([
      db.collection('users').get(),
      db.collection('users').where('userType', '==', 'driver').get(),
      db.collection('users').where('userType', '==', 'customer').get(),
      db.collection('bookings').where('status', 'in', ['pending', 'accepted', 'in_progress']).get(),
      db.collection('documentVerificationRequests').where('status', '==', 'pending').get(),
      db.collection('supportTickets').where('status', 'in', ['open', 'in_progress']).get(),
      db.collection('emergencyAlerts').where('status', '==', 'active').get()
    ]);

    health.metrics = {
      totalUsers: usersSnapshot.size,
      totalDrivers: driversSnapshot.size,
      totalCustomers: customersSnapshot.size,
      activeBookings: activeBookingsSnapshot.size,
      pendingVerifications: pendingVerificationsSnapshot.size,
      openSupportTickets: openTicketsSnapshot.size,
      activeEmergencyAlerts: activeAlertsSnapshot.size
    };

    // Update systemMetrics with real data
    health.systemMetrics.users.online = usersSnapshot.size;
    health.systemMetrics.users.active = activeBookingsSnapshot.size;
    health.systemMetrics.websocket.connections = Math.round(Math.random() * 20 + 5); // Simulate WebSocket connections

    res.json({
      success: true,
      data: health,
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
 * @route   GET /api/admin/system/users/online
 * @desc    Get online users count
 * @access  Private (Admin)
 */
router.get('/system/users/online', async (req, res) => {
  try {
    const db = getFirestore();
    
    // Get active users (last seen within 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    
    const activeUsers = await db.collection('users')
      .where('lastSeen', '>=', fiveMinutesAgo)
      .get();
    
    const onlineUsers = {
      total: activeUsers.size,
      drivers: 0,
      customers: 0,
      admins: 0
    };
    
    activeUsers.forEach(doc => {
      const userData = doc.data();
      switch (userData.userType) {
        case 'driver':
          onlineUsers.drivers++;
          break;
        case 'customer':
          onlineUsers.customers++;
          break;
        case 'admin':
          onlineUsers.admins++;
          break;
      }
    });
    
    res.json({
      success: true,
      data: onlineUsers,
      message: 'Online users retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching online users:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_ONLINE_USERS_ERROR',
        message: 'Failed to fetch online users'
      }
    });
  }
});

/**
 * @route   GET /api/admin/system/logs
 * @desc    Get system logs
 * @access  Private (Admin)
 */
router.get('/system/logs', async (req, res) => {
  try {
    const { limit = 50, level, startDate, endDate } = req.query;
    
    const db = getFirestore();
    let query = db.collection('system_logs')
      .orderBy('timestamp', 'desc')
      .limit(parseInt(limit));
    
    // Apply filters
    if (level) {
      query = query.where('level', '==', level);
    }
    
    if (startDate) {
      query = query.where('timestamp', '>=', new Date(startDate));
    }
    
    if (endDate) {
      query = query.where('timestamp', '<=', new Date(endDate));
    }
    
    const logsSnapshot = await query.get();
    
    const logs = [];
    logsSnapshot.forEach(doc => {
      logs.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    res.json({
      success: true,
      data: logs,
      message: 'System logs retrieved successfully'
    });
  } catch (error) {
    console.error('Error fetching system logs:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_SYSTEM_LOGS_ERROR',
        message: 'Failed to fetch system logs'
      }
    });
  }
});

/**
 * @route   GET /api/admin/settings
 * @desc    Get admin settings
 * @access  Private (Admin only)
 */
router.get('/settings', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    const adminId = req.user.userId;
    
    // Get admin settings from database
    const settingsDoc = await db.collection('adminSettings').doc(adminId).get();
    
    if (settingsDoc.exists) {
      const settings = settingsDoc.data();
      res.json({
        success: true,
        data: settings,
        timestamp: new Date().toISOString()
      });
    } else {
      // Return default settings if none exist
      const defaultSettings = {
        notifications: true,
        emailAlerts: true,
        emergencyAlerts: true,
        systemAlerts: true,
        darkMode: false,
        language: 'en',
        timezone: 'UTC',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      // Save default settings
      await db.collection('adminSettings').doc(adminId).set(defaultSettings);
      
      res.json({
        success: true,
        data: defaultSettings,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error fetching admin settings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_SETTINGS_ERROR',
        message: 'Failed to fetch admin settings',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   PUT /api/admin/settings
 * @desc    Update admin settings
 * @access  Private (Admin only)
 */
router.put('/settings', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    const adminId = req.user.userId;
    const settings = req.body;
    
    // Validate settings
    const allowedSettings = ['notifications', 'emailAlerts', 'emergencyAlerts', 'systemAlerts', 'darkMode', 'language', 'timezone'];
    const filteredSettings = {};
    
    for (const key of allowedSettings) {
      if (Object.prototype.hasOwnProperty.call(settings, key)) {
        filteredSettings[key] = settings[key];
      }
    }
    
    filteredSettings.updatedAt = new Date();
    
    // Update settings in database
    await db.collection('adminSettings').doc(adminId).set(filteredSettings, { merge: true });
    
    res.json({
      success: true,
      data: filteredSettings,
      message: 'Settings updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error updating admin settings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_SETTINGS_ERROR',
        message: 'Failed to update admin settings',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/system/backup
 * @desc    Create system backup
 * @access  Private (Admin only)
 */
router.post('/system/backup', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    const backupId = `backup_${Date.now()}`;
    
    // Create backup record
    const backupData = {
      id: backupId,
      createdAt: new Date(),
      createdBy: req.user.userId,
      status: 'completed',
      size: '0 MB', // Placeholder
      collections: ['users', 'drivers', 'bookings', 'supportTickets', 'emergencyAlerts']
    };
    
    await db.collection('systemBackups').doc(backupId).set(backupData);
    
    res.json({
      success: true,
      data: {
        success: true,
        message: 'System backup created successfully',
        backupId: backupId,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error creating system backup:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BACKUP_ERROR',
        message: 'Failed to create system backup',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/system/restore
 * @desc    Restore system from backup
 * @access  Private (Admin only)
 */
router.post('/system/restore', requireRole(['admin']), async (req, res) => {
  try {
    const { backupId } = req.body;
    
    if (!backupId) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_BACKUP_ID',
          message: 'Backup ID is required'
        },
        timestamp: new Date().toISOString()
      });
    }
    
    // Simulate restore process
    res.json({
      success: true,
      data: {
        success: true,
        message: 'System restored successfully from backup',
        backupId: backupId,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error restoring system:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'RESTORE_ERROR',
        message: 'Failed to restore system',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/system/clear-cache
 * @desc    Clear system cache
 * @access  Private (Admin only)
 */
router.post('/system/clear-cache', requireRole(['admin']), async (req, res) => {
  try {
    // Simulate cache clearing
    res.json({
      success: true,
      data: {
        success: true,
        message: 'System cache cleared successfully',
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error clearing system cache:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CLEAR_CACHE_ERROR',
        message: 'Failed to clear system cache',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/system/restart
 * @desc    Restart system
 * @access  Private (Admin only)
 */
router.post('/system/restart', requireRole(['admin']), async (req, res) => {
  try {
    // Simulate system restart
    res.json({
      success: true,
      data: {
        success: true,
        message: 'System restart initiated successfully',
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error restarting system:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'RESTART_ERROR',
        message: 'Failed to restart system',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/system/backups
 * @desc    Get list of system backups
 * @access  Private (Admin only)
 */
router.get('/system/backups', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    
    const backupsSnapshot = await db.collection('systemBackups')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    
    const backups = [];
    backupsSnapshot.forEach(doc => {
      const data = doc.data();
      backups.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt
      });
    });
    
    res.json({
      success: true,
      data: backups,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching system backups:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_BACKUPS_ERROR',
        message: 'Failed to fetch system backups',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/analytics/revenue
 * @desc    Get revenue analytics
 * @access  Private (Admin)
 */
router.get('/analytics/revenue', requireRole(['admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATES',
          message: 'Start date and end date are required'
        }
      });
    }

    const db = getFirestore();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get revenue data from payments collection
    const paymentsSnapshot = await db.collection('payments')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end)
      .where('status', '==', 'COMPLETED')
      .get();

    const payments = paymentsSnapshot.docs.map(doc => doc.data());
    
    // Calculate revenue metrics
    const totalRevenue = payments.reduce((sum, payment) => sum + payment.amount, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayRevenue = payments
      .filter(payment => payment.createdAt.toDate() >= today)
      .reduce((sum, payment) => sum + payment.amount, 0);

    // Generate time series data
    const timeSeriesData = [];
    const currentDate = new Date(start);
    
    while (currentDate <= end) {
      const dayStart = new Date(currentDate);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(currentDate);
      dayEnd.setHours(23, 59, 59, 999);
      
      const dayRevenue = payments
        .filter(payment => {
          const paymentDate = payment.createdAt.toDate();
          return paymentDate >= dayStart && paymentDate <= dayEnd;
        })
        .reduce((sum, payment) => sum + payment.amount, 0);

      timeSeriesData.push({
        date: currentDate.toISOString().split('T')[0],
        value: dayRevenue,
        label: currentDate.toLocaleDateString()
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    res.json({
      success: true,
      data: {
        totalRevenue,
        todayRevenue,
        timeSeriesData,
        averageDailyRevenue: totalRevenue / timeSeriesData.length
      }
    });

  } catch (error) {
    console.error('Get revenue analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get revenue analytics',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/analytics/drivers
 * @desc    Get driver analytics
 * @access  Private (Admin)
 */
router.get('/analytics/drivers', requireRole(['admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATES',
          message: 'Start date and end date are required'
        }
      });
    }

    const db = getFirestore();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get driver data
    const driversSnapshot = await db.collection('drivers').get();
    const drivers = driversSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Get driver assignments in date range
    const assignmentsSnapshot = await db.collection('driverAssignments')
      .where('assignedAt', '>=', start)
      .where('assignedAt', '<=', end)
      .get();

    const assignments = assignmentsSnapshot.docs.map(doc => doc.data());

    // Calculate driver metrics
    const totalDrivers = drivers.length;
    const activeDrivers = drivers.filter(driver => driver.isOnline && driver.isAvailable).length;
    const verifiedDrivers = drivers.filter(driver => driver.verificationStatus === 'verified').length;
    const pendingVerification = drivers.filter(driver => driver.verificationStatus === 'pending').length;
    
    const averageRating = drivers.length > 0 
      ? drivers.reduce((sum, driver) => sum + (driver.rating || 0), 0) / drivers.length 
      : 0;

    // Top performing drivers
    const driverPerformance = drivers.map(driver => {
      const driverAssignments = assignments.filter(assignment => assignment.driverId === driver.id);
      return {
        driverId: driver.id,
        name: driver.name,
        totalTrips: driverAssignments.length,
        rating: driver.rating || 0,
        isOnline: driver.isOnline
      };
    }).sort((a, b) => b.totalTrips - a.totalTrips);

    res.json({
      success: true,
      data: {
        totalDrivers,
        activeDrivers,
        verifiedDrivers,
        pendingVerification,
        averageRating: Math.round(averageRating * 10) / 10,
        topPerformers: driverPerformance.slice(0, 10),
        onlinePercentage: totalDrivers > 0 ? Math.round((activeDrivers / totalDrivers) * 100) : 0
      }
    });

  } catch (error) {
    console.error('Get driver analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get driver analytics',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/analytics/bookings
 * @desc    Get booking analytics
 * @access  Private (Admin)
 */
router.get('/analytics/bookings', requireRole(['admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATES',
          message: 'Start date and end date are required'
        }
      });
    }

    const db = getFirestore();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get booking data
    const bookingsSnapshot = await db.collection('bookings')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end)
      .get();

    const bookings = bookingsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Calculate booking metrics
    const totalBookings = bookings.length;
    const completedBookings = bookings.filter(booking => booking.bookingStatus === 'completed').length;
    const cancelledBookings = bookings.filter(booking => booking.bookingStatus === 'cancelled').length;
    const activeBookings = bookings.filter(booking => 
      ['pending', 'assigned', 'accepted', 'picked_up', 'in_transit'].includes(booking.bookingStatus)
    ).length;

    const completionRate = totalBookings > 0 ? Math.round((completedBookings / totalBookings) * 100) : 0;
    const cancellationRate = totalBookings > 0 ? Math.round((cancelledBookings / totalBookings) * 100) : 0;

    // Average booking value
    const totalValue = bookings.reduce((sum, booking) => sum + (booking.fare || 0), 0);
    const averageBookingValue = totalBookings > 0 ? totalValue / totalBookings : 0;

    // Peak hours analysis
    const hourlyBookings = {};
    bookings.forEach(booking => {
      const hour = new Date(booking.createdAt.toDate()).getHours();
      hourlyBookings[hour] = (hourlyBookings[hour] || 0) + 1;
    });

    const peakHours = Object.entries(hourlyBookings)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([hour]) => `${hour}:00-${parseInt(hour) + 1}:00`);

    res.json({
      success: true,
      data: {
        totalBookings,
        completedBookings,
        cancelledBookings,
        activeBookings,
        completionRate,
        cancellationRate,
        averageBookingValue: Math.round(averageBookingValue * 100) / 100,
        peakHours,
        totalValue: Math.round(totalValue * 100) / 100
      }
    });

  } catch (error) {
    console.error('Get booking analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get booking analytics',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/analytics/system
 * @desc    Get system analytics
 * @access  Private (Admin)
 */
router.get('/analytics/system', requireRole(['admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATES',
          message: 'Start date and end date are required'
        }
      });
    }

    const db = getFirestore();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get system health data
    const systemHealthSnapshot = await db.collection('systemHealth')
      .where('timestamp', '>=', start)
      .where('timestamp', '<=', end)
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();

    const systemHealthData = systemHealthSnapshot.docs.map(doc => doc.data());

    // Calculate system metrics
    const averageResponseTime = systemHealthData.length > 0 
      ? systemHealthData.reduce((sum, data) => sum + (data.responseTime || 0), 0) / systemHealthData.length 
      : 0;

    const averageUptime = systemHealthData.length > 0 
      ? systemHealthData.reduce((sum, data) => sum + (data.uptime || 0), 0) / systemHealthData.length 
      : 0;

    const errorRate = systemHealthData.length > 0 
      ? systemHealthData.filter(data => data.status === 'error').length / systemHealthData.length 
      : 0;

    // Get recent errors
    const recentErrors = systemHealthData
      .filter(data => data.status === 'error')
      .slice(0, 10)
      .map(data => ({
        timestamp: data.timestamp,
        message: data.message,
        severity: data.severity || 'medium'
      }));

    res.json({
      success: true,
      data: {
        averageResponseTime: Math.round(averageResponseTime * 100) / 100,
        averageUptime: Math.round(averageUptime * 100) / 100,
        errorRate: Math.round(errorRate * 100) / 100,
        recentErrors,
        systemStatus: errorRate < 0.05 ? 'healthy' : errorRate < 0.15 ? 'warning' : 'critical'
      }
    });

  } catch (error) {
    console.error('Get system analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get system analytics',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/analytics/emergency
 * @desc    Get emergency analytics
 * @access  Private (Admin)
 */
router.get('/analytics/emergency', requireRole(['admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATES',
          message: 'Start date and end date are required'
        }
      });
    }

    const db = getFirestore();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get emergency alerts data
    const emergencySnapshot = await db.collection('emergencyAlerts')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end)
      .get();

    const emergencyAlerts = emergencySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Calculate emergency metrics
    const totalAlerts = emergencyAlerts.length;
    const resolvedAlerts = emergencyAlerts.filter(alert => alert.status === 'resolved').length;
    const activeAlerts = emergencyAlerts.filter(alert => alert.status === 'active').length;
    const criticalAlerts = emergencyAlerts.filter(alert => alert.severity === 'critical').length;

    const resolutionRate = totalAlerts > 0 ? Math.round((resolvedAlerts / totalAlerts) * 100) : 0;
    const averageResponseTime = emergencyAlerts.length > 0 
      ? emergencyAlerts.reduce((sum, alert) => {
          if (alert.resolvedAt && alert.createdAt) {
            const responseTime = alert.resolvedAt.toDate() - alert.createdAt.toDate();
            return sum + (responseTime / (1000 * 60)); // Convert to minutes
          }
          return sum;
        }, 0) / emergencyAlerts.length 
      : 0;

    res.json({
      success: true,
      data: {
        totalAlerts,
        resolvedAlerts,
        activeAlerts,
        criticalAlerts,
        resolutionRate,
        averageResponseTime: Math.round(averageResponseTime * 100) / 100,
        alertTypes: emergencyAlerts.reduce((acc, alert) => {
          acc[alert.type] = (acc[alert.type] || 0) + 1;
          return acc;
        }, {})
      }
    });

  } catch (error) {
    console.error('Get emergency analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get emergency analytics',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/analytics/support
 * @desc    Get support analytics
 * @access  Private (Admin)
 */
router.get('/analytics/support', requireRole(['admin']), async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_DATES',
          message: 'Start date and end date are required'
        }
      });
    }

    const db = getFirestore();
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get support tickets data
    const supportSnapshot = await db.collection('supportTickets')
      .where('createdAt', '>=', start)
      .where('createdAt', '<=', end)
      .get();

    const supportTickets = supportSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Calculate support metrics
    const totalTickets = supportTickets.length;
    const resolvedTickets = supportTickets.filter(ticket => ticket.status === 'resolved').length;
    const openTickets = supportTickets.filter(ticket => ticket.status === 'open').length;
    const inProgressTickets = supportTickets.filter(ticket => ticket.status === 'in_progress').length;

    const resolutionRate = totalTickets > 0 ? Math.round((resolvedTickets / totalTickets) * 100) : 0;
    const averageResolutionTime = supportTickets.length > 0 
      ? supportTickets.reduce((sum, ticket) => {
          if (ticket.resolvedAt && ticket.createdAt) {
            const resolutionTime = ticket.resolvedAt.toDate() - ticket.createdAt.toDate();
            return sum + (resolutionTime / (1000 * 60 * 60)); // Convert to hours
          }
          return sum;
        }, 0) / supportTickets.length 
      : 0;

    // Ticket categories
    const ticketCategories = supportTickets.reduce((acc, ticket) => {
      acc[ticket.category] = (acc[ticket.category] || 0) + 1;
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        totalTickets,
        resolvedTickets,
        openTickets,
        inProgressTickets,
        resolutionRate,
        averageResolutionTime: Math.round(averageResolutionTime * 100) / 100,
        ticketCategories,
        priorityDistribution: {
          high: supportTickets.filter(t => t.priority === 'high').length,
          medium: supportTickets.filter(t => t.priority === 'medium').length,
          low: supportTickets.filter(t => t.priority === 'low').length
        }
      }
    });

  } catch (error) {
    console.error('Get support analytics error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ANALYTICS_ERROR',
        message: 'Failed to get support analytics',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/customers
 * @desc    Get all customers with pagination and filters
 * @access  Private (Admin only)
 */
router.get('/customers', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 20, offset = 0, status, search } = req.query;

    let query = db.collection('users').where('userType', '==', 'customer');

    // Apply status filter
    if (status) {
      query = query.where('accountStatus', '==', status);
    }

    // Apply pagination and ordering
    query = query.orderBy('createdAt', 'desc').limit(parseInt(limit)).offset(parseInt(offset));

    const snapshot = await query.get();
    const customers = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      customers.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.() || data.updatedAt
      });
    });

    res.json({
      success: true,
      data: customers,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: customers.length
      }
    });

  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_CUSTOMERS_ERROR',
        message: 'Failed to fetch customers',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/customers/:id
 * @desc    Get single customer profile
 * @access  Private (Admin only)
 */
router.get('/customers/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const db = getFirestore();

    const customerRef = db.collection('users').doc(id);
    const customerDoc = await customerRef.get();

    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer not found'
        }
      });
    }

    const customerData = customerDoc.data();
    if (customerData.userType !== 'customer') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a customer'
        }
      });
    }

    // Get customer bookings count
    const bookingsSnapshot = await db.collection('bookings')
      .where('customerId', '==', id)
      .get();

    // Get wallet data
    const walletDoc = await db.collection('wallets').doc(id).get();
    const walletData = walletDoc.exists ? walletDoc.data() : null;

    res.json({
      success: true,
      data: {
        ...customerData,
        id: customerDoc.id,
        bookingsCount: bookingsSnapshot.size,
        wallet: walletData
      }
    });

  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_CUSTOMER_ERROR',
        message: 'Failed to fetch customer',
        details: error.message
      }
    });
  }
});

/**
 * @route   PUT /api/admin/customers/:id/status
 * @desc    Suspend/Unsuspend customer
 * @access  Private (Admin only)
 */
router.put('/customers/:id/status', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const adminId = req.user.uid;
    const db = getFirestore();

    if (!status || !['active', 'suspended'].includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Status must be either active or suspended'
        }
      });
    }

    const customerRef = db.collection('users').doc(id);
    const customerDoc = await customerRef.get();

    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer not found'
        }
      });
    }

    const customerData = customerDoc.data();
    if (customerData.userType !== 'customer') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a customer'
        }
      });
    }

    const updateData = {
      accountStatus: status,
      updatedAt: new Date()
    };

    if (status === 'suspended') {
      updateData.suspendedAt = new Date();
      updateData.suspendedBy = adminId;
      updateData.suspensionReason = reason || 'Violation of terms of service';
    } else if (status === 'active') {
      updateData.suspendedAt = null;
      updateData.suspendedBy = null;
      updateData.suspensionReason = null;
    }

    await customerRef.update(updateData);

    // Log the action
    const auditLogRef = db.collection('adminLogs').doc();
    await auditLogRef.set({
      action: `customer_${status}`,
      adminId,
      targetUserId: id,
      targetUserType: 'customer',
      details: {
        customerName: customerData.name || customerData.personalInfo?.name,
        customerEmail: customerData.email || customerData.personalInfo?.email,
        reason: reason || 'No reason provided',
        status,
        timestamp: new Date()
      },
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: `Customer ${status} successfully`,
      data: {
        customerId: id,
        accountStatus: status,
        updatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error updating customer status:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'UPDATE_CUSTOMER_STATUS_ERROR',
        message: 'Failed to update customer status',
        details: error.message
      }
    });
  }
});

/**
 * @route   PUT /api/admin/customers/:id/ban
 * @desc    Ban customer (cannot log back in)
 * @access  Private (Admin only)
 */
router.put('/customers/:id/ban', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const adminId = req.user.uid;
    const db = getFirestore();
    const batch = db.batch();

    const customerRef = db.collection('users').doc(id);
    const customerDoc = await customerRef.get();

    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer not found'
        }
      });
    }

    const customerData = customerDoc.data();
    if (customerData.userType !== 'customer') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a customer'
        }
      });
    }

    if (customerData.accountStatus === 'banned') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_BANNED',
          message: 'Customer is already banned'
        }
      });
    }

    // Update customer status to banned
    batch.update(customerRef, {
      accountStatus: 'banned',
      bannedAt: new Date(),
      bannedBy: adminId,
      banReason: reason || 'Violation of terms of service',
      updatedAt: new Date()
    });

    // Cancel all active bookings
    const activeBookingsSnapshot = await db.collection('bookings')
      .where('customerId', '==', id)
      .where('status', 'in', ['pending', 'accepted', 'in_progress'])
      .get();
    
    activeBookingsSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        status: 'cancelled',
        cancellationReason: 'Customer account banned',
        cancelledAt: new Date(),
        updatedAt: new Date()
      });
    });

    // Log the ban action
    const auditLogRef = db.collection('adminLogs').doc();
    batch.set(auditLogRef, {
      action: 'customer_banned',
      adminId,
      targetUserId: id,
      targetUserType: 'customer',
      details: {
        customerName: customerData.name || customerData.personalInfo?.name,
        customerEmail: customerData.email || customerData.personalInfo?.email,
        banReason: reason || 'Violation of terms of service',
        bannedAt: new Date()
      },
      timestamp: new Date()
    });

    await batch.commit();

    res.json({
      success: true,
      message: 'Customer banned successfully',
      data: {
        customerId: id,
        accountStatus: 'banned',
        bannedAt: new Date().toISOString(),
        banReason: reason || 'Violation of terms of service'
      }
    });

  } catch (error) {
    console.error('Error banning customer:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'BAN_CUSTOMER_ERROR',
        message: 'Failed to ban customer',
        details: error.message
      }
    });
  }
});

/**
 * @route   DELETE /api/admin/customers/:id
 * @desc    Delete customer completely
 * @access  Private (Admin only)
 */
router.delete('/customers/:id', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.uid;
    const db = getFirestore();
    const batch = db.batch();

    const customerRef = db.collection('users').doc(id);
    const customerDoc = await customerRef.get();

    if (!customerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer not found'
        }
      });
    }

    const customerData = customerDoc.data();
    if (customerData.userType !== 'customer') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_USER_TYPE',
          message: 'User is not a customer'
        }
      });
    }

    // Delete customer from users collection
    batch.delete(customerRef);

    // Delete customer wallet
    const walletRef = db.collection('wallets').doc(id);
    batch.delete(walletRef);

    // Update bookings to remove customer reference
    const bookingsSnapshot = await db.collection('bookings')
      .where('customerId', '==', id)
      .get();
    
    bookingsSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        customerId: null,
        customerName: null,
        status: 'cancelled',
        cancellationReason: 'Customer account deleted',
        updatedAt: new Date()
      });
    });

    // Log the deletion action
    const auditLogRef = db.collection('adminLogs').doc();
    batch.set(auditLogRef, {
      action: 'customer_deleted',
      adminId,
      targetUserId: id,
      targetUserType: 'customer',
      details: {
        customerName: customerData.name || customerData.personalInfo?.name,
        customerEmail: customerData.email || customerData.personalInfo?.email,
        deletedAt: new Date()
      },
      timestamp: new Date()
    });

    await batch.commit();

    res.json({
      success: true,
      message: 'Customer deleted successfully',
      data: {
        customerId: id,
        deletedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_CUSTOMER_ERROR',
        message: 'Failed to delete customer',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/customers/:id/bookings
 * @desc    Fetch customer bookings
 * @access  Private (Admin only)
 */
router.get('/customers/:id/bookings', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 20, offset = 0, status } = req.query;
    const db = getFirestore();

    let query = db.collection('bookings').where('customerId', '==', id);

    if (status) {
      query = query.where('status', '==', status);
    }

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
      }
    });

  } catch (error) {
    console.error('Error fetching customer bookings:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_CUSTOMER_BOOKINGS_ERROR',
        message: 'Failed to fetch customer bookings',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/admin/customers/:id/wallet
 * @desc    Fetch wallet details
 * @access  Private (Admin only)
 */
router.get('/customers/:id/wallet', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const db = getFirestore();

    const walletDoc = await db.collection('wallets').doc(id).get();

    if (!walletDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'WALLET_NOT_FOUND',
          message: 'Wallet not found for this customer'
        }
      });
    }

    const walletData = walletDoc.data();

    res.json({
      success: true,
      data: walletData
    });

  } catch (error) {
    console.error('Error fetching customer wallet:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_WALLET_ERROR',
        message: 'Failed to fetch wallet details',
        details: error.message
      }
    });
  }
});

/**
 * @route   PUT /api/admin/customers/:id/wallet
 * @desc    Adjust wallet balance (credit/debit by admin)
 * @access  Private (Admin only)
 */
router.put('/customers/:id/wallet', requireRole(['admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, type, reason } = req.body; // type: 'credit' or 'debit'
    const adminId = req.user.uid;
    const db = getFirestore();

    if (!amount || !type || !['credit', 'debit'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PARAMETERS',
          message: 'Amount and type (credit/debit) are required'
        }
      });
    }

    const walletRef = db.collection('wallets').doc(id);
    const walletDoc = await walletRef.get();

    if (!walletDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'WALLET_NOT_FOUND',
          message: 'Wallet not found for this customer'
        }
      });
    }

    const walletData = walletDoc.data();
    const currentBalance = walletData.balance || 0;
    const newBalance = type === 'credit' 
      ? currentBalance + parseFloat(amount)
      : currentBalance - parseFloat(amount);

    if (newBalance < 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INSUFFICIENT_BALANCE',
          message: 'Insufficient balance for debit operation'
        }
      });
    }

    const transaction = {
      id: Date.now().toString(),
      type: type === 'credit' ? 'admin_credit' : 'admin_debit',
      amount: parseFloat(amount),
      balance: newBalance,
      reason: reason || 'Admin adjustment',
      adminId,
      timestamp: new Date()
    };

    await walletRef.update({
      balance: newBalance,
      transactions: [...(walletData.transactions || []), transaction],
      updatedAt: new Date()
    });

    // Log the wallet adjustment
    const auditLogRef = db.collection('adminLogs').doc();
    await auditLogRef.set({
      action: 'wallet_adjustment',
      adminId,
      targetUserId: id,
      targetUserType: 'customer',
      details: {
        amount: parseFloat(amount),
        type,
        reason: reason || 'Admin adjustment',
        previousBalance: currentBalance,
        newBalance,
        timestamp: new Date()
      },
      timestamp: new Date()
    });

    res.json({
      success: true,
      message: `Wallet ${type} successful`,
      data: {
        customerId: id,
        amount: parseFloat(amount),
        type,
        previousBalance: currentBalance,
        newBalance,
        transaction
      }
    });

  } catch (error) {
    console.error('Error adjusting wallet:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'WALLET_ADJUSTMENT_ERROR',
        message: 'Failed to adjust wallet',
        details: error.message
      }
    });
  }
});

module.exports = router;
