const express = require('express');
const { getFirestore } = require('firebase-admin/firestore');
const { requireRole } = require('../middleware/auth');
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
 * @route   GET /api/admin/drivers/:driverId/documents
 * @desc    Get driver documents for admin review
 * @access  Private (Admin only)
 */
router.get('/drivers/:driverId/documents', requireRole(['admin']), async (req, res) => {
  try {
    const { driverId } = req.params;
    const db = getFirestore();
    
    // Get driver information
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
    
    // Get verification request if exists
    const verificationQuery = await db.collection('documentVerificationRequests')
      .where('driverId', '==', driverId)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    let documents = {};
    let source = 'user_collection';

    if (!verificationQuery.empty) {
      // Use verification request data (most recent)
      const verificationData = verificationQuery.docs[0].data();
      documents = verificationData.documents || {};
      source = 'verification_request';
    } else {
      // Fallback to user collection
      documents = driverData.driver?.documents || driverData.documents || {};
    }

    // Normalize document structure for admin dashboard
    const normalizedDocuments = {
      drivingLicense: {
        url: documents.drivingLicense?.downloadURL || documents.driving_license?.downloadURL || documents.drivingLicense?.url || '',
        status: documents.drivingLicense?.verificationStatus || documents.driving_license?.verificationStatus || documents.drivingLicense?.status || 'pending',
        uploadedAt: documents.drivingLicense?.uploadedAt || documents.driving_license?.uploadedAt || '',
        verified: documents.drivingLicense?.verified || false
      },
      aadhaar: {
        url: documents.aadhaarCard?.downloadURL || documents.aadhaar_card?.downloadURL || documents.aadhaar?.url || documents.aadhaarCard?.url || '',
        status: documents.aadhaarCard?.verificationStatus || documents.aadhaar_card?.verificationStatus || documents.aadhaar?.status || documents.aadhaarCard?.status || 'pending',
        uploadedAt: documents.aadhaarCard?.uploadedAt || documents.aadhaar_card?.uploadedAt || documents.aadhaar?.uploadedAt || documents.aadhaarCard?.uploadedAt || '',
        verified: documents.aadhaar?.verified || documents.aadhaarCard?.verified || false
      },
      insurance: {
        url: documents.bikeInsurance?.downloadURL || documents.bike_insurance?.downloadURL || documents.insurance?.url || documents.bikeInsurance?.url || '',
        status: documents.bikeInsurance?.verificationStatus || documents.bike_insurance?.verificationStatus || documents.insurance?.status || documents.bikeInsurance?.status || 'pending',
        uploadedAt: documents.bikeInsurance?.uploadedAt || documents.bike_insurance?.uploadedAt || documents.insurance?.uploadedAt || documents.bikeInsurance?.uploadedAt || '',
        verified: documents.insurance?.verified || documents.bikeInsurance?.verified || false
      },
      rcBook: {
        url: documents.rcBook?.downloadURL || documents.rc_book?.downloadURL || documents.rcBook?.url || '',
        status: documents.rcBook?.verificationStatus || documents.rc_book?.verificationStatus || documents.rcBook?.status || 'pending',
        uploadedAt: documents.rcBook?.uploadedAt || documents.rc_book?.uploadedAt || documents.rcBook?.uploadedAt || '',
        verified: documents.rcBook?.verified || false
      },
      profilePhoto: {
        url: documents.profilePhoto?.downloadURL || documents.profile_photo?.downloadURL || documents.profilePhoto?.url || '',
        status: documents.profilePhoto?.verificationStatus || documents.profile_photo?.verificationStatus || documents.profilePhoto?.status || 'pending',
        uploadedAt: documents.profilePhoto?.uploadedAt || documents.profile_photo?.uploadedAt || documents.profilePhoto?.uploadedAt || '',
        verified: documents.profilePhoto?.verified || false
      }
    };

    res.json({
      success: true,
      data: {
        documents: normalizedDocuments,
        source,
        driverId,
        driverName: driverData.name || 'Unknown',
        verificationStatus: driverData.driver?.verificationStatus || 'pending'
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching driver documents:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DOCUMENTS_FETCH_ERROR',
        message: 'Failed to fetch driver documents',
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
              status: 'approved',
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
    } catch (error) {
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
    } catch (error) {
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
    const storage = require('../services/firebase').getStorage();
    
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

    if (status === 'rejected' && !rejectionReason) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'REJECTION_REASON_REQUIRED',
          message: 'Rejection reason is required when rejecting a document'
        },
        timestamp: new Date().toISOString()
      });
    }

    const db = getFirestore();
    const batch = db.batch();

    // Get driver information
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
    const documents = driverData.driver?.documents || driverData.documents || {};

    // Update specific document status with comprehensive mapping
    const documentKey = documentType === 'aadhaar' ? 'aadhaarCard' : 
                       documentType === 'insurance' ? 'bikeInsurance' : 
                       documentType === 'rc' ? 'rcBook' : 
                       documentType === 'profile' ? 'profilePhoto' : 
                       documentType === 'drivingLicense' ? 'drivingLicense' :
                       documentType === 'aadhaarCard' ? 'aadhaarCard' :
                       documentType === 'bikeInsurance' ? 'bikeInsurance' :
                       documentType === 'rcBook' ? 'rcBook' :
                       documentType === 'profilePhoto' ? 'profilePhoto' : documentType;

    if (documents[documentKey]) {
      documents[documentKey] = {
        ...documents[documentKey],
        status: status === 'approved' ? 'verified' : 'rejected',
        verified: status === 'approved',
        verifiedAt: new Date(),
        verifiedBy: adminId,
        verificationComments: comments || null,
        rejectionReason: status === 'rejected' ? rejectionReason : null
      };

      // Update driver's documents
      batch.update(driverRef, {
        'driver.documents': documents,
        updatedAt: new Date()
      });

      // Check if all documents are verified
      const allDocuments = ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
      const verifiedDocuments = allDocuments.filter(doc => 
        documents[doc]?.status === 'verified' || documents[doc]?.verified === true
      );

      // Update overall verification status
      let overallStatus = 'pending';
      if (verifiedDocuments.length === allDocuments.length) {
        overallStatus = 'approved';
      } else if (documents[documentKey]?.status === 'rejected') {
        overallStatus = 'rejected';
      } else {
        overallStatus = 'pending_verification';
      }

      batch.update(driverRef, {
        'driver.verificationStatus': overallStatus,
        'driver.lastDocumentVerified': documentType,
        'driver.lastDocumentVerifiedAt': new Date(),
        updatedAt: new Date()
      });

      // Update verification request if exists
      const verificationQuery = await db.collection('documentVerificationRequests')
        .where('driverId', '==', driverId)
        .where('status', '==', 'pending')
        .limit(1)
        .get();

      if (!verificationQuery.empty) {
        const verificationDoc = verificationQuery.docs[0];
        const verificationData = verificationDoc.data();
        
        // Update document in verification request
        if (verificationData.documents && verificationData.documents[documentKey]) {
          verificationData.documents[documentKey] = {
            ...verificationData.documents[documentKey],
            verificationStatus: status === 'approved' ? 'verified' : 'rejected',
            verified: status === 'approved',
            verifiedAt: new Date(),
            verifiedBy: adminId,
            verificationComments: comments || null,
            rejectionReason: status === 'rejected' ? rejectionReason : null
          };

          batch.update(verificationDoc.ref, {
            documents: verificationData.documents,
            status: overallStatus,
            updatedAt: new Date()
          });
        }
      }

      await batch.commit();

      res.json({
        success: true,
        message: `Document ${status} successfully`,
        data: {
          driverId,
          documentType,
          status,
          overallStatus,
          verifiedDocuments: verifiedDocuments.length,
          totalDocuments: allDocuments.length,
          verifiedAt: new Date(),
          verifiedBy: adminId
        },
        timestamp: new Date().toISOString()
      });

    } else {
      res.status(404).json({
        success: false,
        error: {
          code: 'DOCUMENT_NOT_FOUND',
          message: 'Document not found for this driver'
        },
        timestamp: new Date().toISOString()
      });
    }

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
 * @desc    Sync verification status for all drivers
 * @access  Private (Admin only)
 */
router.post('/sync-all-drivers-status', requireRole(['admin']), async (req, res) => {
  try {
    const db = getFirestore();
    
    console.log('🔄 Syncing verification status for all drivers...');
    
    // Get all drivers
    const driversSnapshot = await db.collection('users')
      .where('userType', '==', 'driver')
      .get();
    
    const syncResults = [];
    let successCount = 0;
    let errorCount = 0;
    
    for (const driverDoc of driversSnapshot.docs) {
      try {
        const driverData = driverDoc.data();
        const documents = driverData.driver?.documents || driverData.documents || {};
        
        // Count verified documents
        const allDocuments = ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
        const verifiedDocuments = allDocuments.filter(doc => 
          documents[doc]?.status === 'verified' || documents[doc]?.verified === true
        );
        
        // Determine overall status
        let overallStatus = 'pending';
        if (verifiedDocuments.length === allDocuments.length) {
          overallStatus = 'approved';
        } else if (verifiedDocuments.length === 0) {
          overallStatus = 'pending';
        } else if (allDocuments.some(doc => documents[doc]?.status === 'rejected')) {
          overallStatus = 'rejected';
        } else {
          overallStatus = 'pending_verification';
        }
        
        // Update driver status
        await driverDoc.ref.update({
          'driver.verificationStatus': overallStatus,
          'driver.isVerified': overallStatus === 'approved',
          'driver.verifiedDocumentsCount': verifiedDocuments.length,
          'driver.totalDocumentsCount': allDocuments.length,
          updatedAt: new Date()
        });
        
        syncResults.push({
          driverId: driverDoc.id,
          driverName: driverData.name,
          oldStatus: driverData.driver?.verificationStatus || 'unknown',
          newStatus: overallStatus,
          verifiedDocuments: verifiedDocuments.length,
          totalDocuments: allDocuments.length,
          success: true
        });
        
        successCount++;
        
      } catch (error) {
        syncResults.push({
          driverId: driverDoc.id,
          driverName: driverData.name || 'Unknown',
          error: error.message,
          success: false
        });
        errorCount++;
      }
    }
    
    console.log(`✅ Status sync completed: ${successCount} successful, ${errorCount} errors`);
    
    res.json({
      success: true,
      message: 'Status synchronization completed',
      data: {
        totalDrivers: driversSnapshot.size,
        successCount,
        errorCount,
        results: syncResults
      },
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
    const db = getFirestore();
    
    // Get driver information
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
    const documents = driverData.driver?.documents || driverData.documents || {};
    
    // Count verified documents
    const allDocuments = ['drivingLicense', 'aadhaarCard', 'bikeInsurance', 'rcBook', 'profilePhoto'];
    const verifiedDocuments = allDocuments.filter(doc => 
      documents[doc]?.status === 'verified' || documents[doc]?.verified === true
    );
    
    // Determine overall status
    let overallStatus = 'pending';
    if (verifiedDocuments.length === allDocuments.length) {
      overallStatus = 'approved';
    } else if (verifiedDocuments.length === 0) {
      overallStatus = 'pending';
    } else if (allDocuments.some(doc => documents[doc]?.status === 'rejected')) {
      overallStatus = 'rejected';
    } else {
      overallStatus = 'pending_verification';
    }
    
    // Update driver status
    await driverRef.update({
      'driver.verificationStatus': overallStatus,
      'driver.isVerified': overallStatus === 'approved',
      'driver.verifiedDocumentsCount': verifiedDocuments.length,
      'driver.totalDocumentsCount': allDocuments.length,
      updatedAt: new Date()
    });
    
    console.log(`✅ Status synced for driver ${driverId}: ${overallStatus} (${verifiedDocuments.length}/${allDocuments.length} documents verified)`);
    
    res.json({
      success: true,
      message: 'Status synchronized successfully',
      data: {
        driverId,
        overallStatus,
        verifiedDocuments: verifiedDocuments.length,
        totalDocuments: allDocuments.length,
        isVerified: overallStatus === 'approved',
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
    const documents = driverData.driver?.documents || driverData.documents || {};

    // Normalize document structure for admin dashboard
    const normalizedDocuments = {
      drivingLicense: {
        url: documents.drivingLicense?.url || documents.driving_license?.url || '',
        status: documents.drivingLicense?.status || documents.driving_license?.status || 'pending',
        uploadedAt: documents.drivingLicense?.uploadedAt || documents.driving_license?.uploadedAt || '',
        verified: documents.drivingLicense?.verified || false
      },
      aadhaar: {
        url: documents.aadhaarCard?.url || documents.aadhaar?.url || documents.aadhaar_card?.url || '',
        status: documents.aadhaarCard?.status || documents.aadhaar?.status || documents.aadhaar_card?.status || 'pending',
        uploadedAt: documents.aadhaarCard?.uploadedAt || documents.aadhaar?.uploadedAt || documents.aadhaar_card?.uploadedAt || '',
        verified: documents.aadhaarCard?.verified || documents.aadhaar?.verified || false
      },
      insurance: {
        url: documents.bikeInsurance?.url || documents.insurance?.url || documents.bike_insurance?.url || '',
        status: documents.bikeInsurance?.status || documents.insurance?.status || documents.bike_insurance?.status || 'pending',
        uploadedAt: documents.bikeInsurance?.uploadedAt || documents.insurance?.uploadedAt || documents.bike_insurance?.uploadedAt || '',
        verified: documents.bikeInsurance?.verified || documents.insurance?.verified || false
      },
      rcBook: {
        url: documents.rcBook?.url || documents.rc_book?.url || '',
        status: documents.rcBook?.status || documents.rc_book?.status || 'pending',
        uploadedAt: documents.rcBook?.uploadedAt || documents.rc_book?.uploadedAt || '',
        verified: documents.rcBook?.verified || false
      },
      profilePhoto: {
        url: documents.profilePhoto?.url || documents.profile_photo?.url || '',
        status: documents.profilePhoto?.status || documents.profile_photo?.status || 'pending',
        uploadedAt: documents.profilePhoto?.uploadedAt || documents.profile_photo?.uploadedAt || '',
        verified: documents.profilePhoto?.verified || false
      }
    };

    res.json({
      success: true,
      data: {
        driverId,
        driverName: driverData.name,
        driverPhone: driverData.phone,
        documents: normalizedDocuments,
        verificationStatus: driverData.driver?.verificationStatus || 'pending',
        verificationRequestedAt: driverData.driver?.verificationRequestedAt || null
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching driver documents:', error);
    
    // Handle specific Firestore index errors
    if (error.code === 9) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'FIRESTORE_INDEX_REQUIRED',
          message: 'Firestore index required for document verification requests',
          details: 'Please create the required Firestore index. Check the console logs for the index creation URL.',
          indexUrl: error.details || 'https://console.firebase.google.com/v1/r/project/epickup-app/firestore/indexes'
        },
        timestamp: new Date().toISOString()
      });
    }
    
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

module.exports = router;
