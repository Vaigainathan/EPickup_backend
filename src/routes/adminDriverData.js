const express = require('express');
const { body } = require('express-validator');
const { getFirestore } = require('../services/firebase');
const { sanitizeInput, checkValidation } = require('../middleware/validation');

const router = express.Router();

// Apply input sanitization to all admin driver data routes
router.use(sanitizeInput);

/**
 * @route   GET /api/admin/driver-data/pending
 * @desc    Get all pending driver data entries for admin review
 * @access  Private (Admin only)
 */
router.get('/pending', async (req, res) => {
  try {
    const db = getFirestore();
    const { limit = 50, offset = 0, status = 'pending_verification' } = req.query;

    console.log(`🔍 Getting pending driver data entries (limit: ${limit}, offset: ${offset})`);

    // Get pending driver data entries
    const driverDataQuery = await db.collection('driverDataEntries')
      .where('status', '==', status)
      .orderBy('submittedAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();

    const driverDataEntries = [];
    
    for (const doc of driverDataQuery.docs) {
      const data = doc.data();
      
      // Get driver profile information
      const driverDoc = await db.collection('users').doc(data.driverId).get();
      const driverData = driverDoc.exists ? driverDoc.data() : null;
      
      // Get document verification status
      const verificationService = require('../services/verificationService');
      let verificationData = null;
      try {
        verificationData = await verificationService.getDriverVerificationData(data.driverId);
      } catch (error) {
        console.warn(`⚠️ Could not get verification data for driver ${data.driverId}:`, error.message);
      }

      driverDataEntries.push({
        id: doc.id,
        driverId: data.driverId,
        driverInfo: driverData ? {
          name: driverData.name,
          email: driverData.email,
          phone: driverData.phone
        } : null,
        vehicleDetails: data.vehicleDetails,
        status: data.status,
        submittedAt: data.submittedAt,
        reviewedAt: data.reviewedAt,
        reviewComments: data.reviewComments,
        rejectionReason: data.rejectionReason,
        reviewHistory: data.reviewHistory || [],
        documentVerification: verificationData
      });
    }

    // Get total count for pagination
    const totalQuery = await db.collection('driverDataEntries')
      .where('status', '==', status)
      .get();

    res.status(200).json({
      success: true,
      message: 'Pending driver data entries retrieved successfully',
      data: {
        entries: driverDataEntries,
        pagination: {
          total: totalQuery.size,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: driverDataEntries.length === parseInt(limit)
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting pending driver data entries:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'PENDING_ENTRIES_ERROR',
        message: 'Failed to get pending driver data entries',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/driver-data/:entryId
 * @desc    Get specific driver data entry details
 * @access  Private (Admin only)
 */
router.get('/:entryId', async (req, res) => {
  try {
    const { entryId } = req.params;
    const db = getFirestore();

    console.log(`🔍 Getting driver data entry: ${entryId}`);

    const entryDoc = await db.collection('driverDataEntries').doc(entryId).get();
    
    if (!entryDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ENTRY_NOT_FOUND',
          message: 'Driver data entry not found',
          details: 'The specified entry does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const entryData = entryDoc.data();
    
    // Get driver profile information
    const driverDoc = await db.collection('users').doc(entryData.driverId).get();
    const driverData = driverDoc.exists ? driverDoc.data() : null;
    
    // Get document verification status
    const verificationService = require('../services/verificationService');
    let verificationData = null;
    try {
      verificationData = await verificationService.getDriverVerificationData(entryData.driverId);
    } catch (error) {
      console.warn(`⚠️ Could not get verification data for driver ${entryData.driverId}:`, error.message);
    }

    res.status(200).json({
      success: true,
      message: 'Driver data entry retrieved successfully',
      data: {
        id: entryDoc.id,
        driverId: entryData.driverId,
        driverInfo: driverData ? {
          name: driverData.name,
          email: driverData.email,
          phone: driverData.phone,
          profilePicture: driverData.profilePicture
        } : null,
        vehicleDetails: entryData.vehicleDetails,
        status: entryData.status,
        submittedAt: entryData.submittedAt,
        reviewedAt: entryData.reviewedAt,
        reviewComments: entryData.reviewComments,
        rejectionReason: entryData.rejectionReason,
        reviewHistory: entryData.reviewHistory || [],
        documentVerification: verificationData
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting driver data entry:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ENTRY_GET_ERROR',
        message: 'Failed to get driver data entry',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/driver-data/:entryId/approve
 * @desc    Approve driver data entry
 * @access  Private (Admin only)
 */
router.post('/:entryId/approve', [
  body('reviewComments').optional().isString().withMessage('Review comments must be a string'),
  checkValidation
], async (req, res) => {
  try {
    const { entryId } = req.params;
    const { reviewComments } = req.body;
    const adminId = req.user.uid || req.user.userId;
    const db = getFirestore();

    console.log(`✅ Approving driver data entry: ${entryId} by admin: ${adminId}`);

    const entryDoc = await db.collection('driverDataEntries').doc(entryId).get();
    
    if (!entryDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ENTRY_NOT_FOUND',
          message: 'Driver data entry not found',
          details: 'The specified entry does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const entryData = entryDoc.data();
    
    if (entryData.status !== 'pending_verification') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Entry cannot be approved',
          details: `Entry status is ${entryData.status}, only pending_verification entries can be approved`
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update entry status
    await entryDoc.ref.update({
      status: 'approved',
      reviewedAt: new Date(),
      reviewedBy: adminId,
      reviewComments: reviewComments || null,
      updatedAt: new Date(),
      reviewHistory: [
        ...(entryData.reviewHistory || []),
        {
          action: 'approved',
          timestamp: new Date(),
          reviewedBy: adminId,
          comments: reviewComments
        }
      ]
    });

    // Update driver profile verification status
    const userRef = db.collection('users').doc(entryData.driverId);
    await userRef.update({
      'driver.verificationStatus': 'approved',
      'driver.isVerified': true,
      'isVerified': true,
      'driver.approvedAt': new Date(),
      'driver.approvedBy': adminId,
      'driver.adminNotes': reviewComments || null,
      updatedAt: new Date()
    });

    // Update verification status collection
    const verificationStatusRef = db.collection('driverVerificationStatus').doc(entryData.driverId);
    await verificationStatusRef.set({
      driverId: entryData.driverId,
      verificationStatus: 'approved',
      isVerified: true,
      dataEntryStatus: 'approved',
      lastUpdated: new Date(),
      canStartWorking: true,
      approvedBy: adminId,
      approvedAt: new Date()
    }, { merge: true });

    console.log(`✅ Driver data entry approved: ${entryId}`);

    res.status(200).json({
      success: true,
      message: 'Driver data entry approved successfully',
      data: {
        entryId: entryId,
        driverId: entryData.driverId,
        status: 'approved',
        reviewedAt: new Date(),
        reviewedBy: adminId
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error approving driver data entry:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'APPROVE_ERROR',
        message: 'Failed to approve driver data entry',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   POST /api/admin/driver-data/:entryId/reject
 * @desc    Reject driver data entry
 * @access  Private (Admin only)
 */
router.post('/:entryId/reject', [
  body('rejectionReason').isString().isLength({ min: 1 }).withMessage('Rejection reason is required'),
  body('reviewComments').optional().isString().withMessage('Review comments must be a string'),
  checkValidation
], async (req, res) => {
  try {
    const { entryId } = req.params;
    const { rejectionReason, reviewComments } = req.body;
    const adminId = req.user.uid || req.user.userId;
    const db = getFirestore();

    console.log(`❌ Rejecting driver data entry: ${entryId} by admin: ${adminId}`);

    const entryDoc = await db.collection('driverDataEntries').doc(entryId).get();
    
    if (!entryDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'ENTRY_NOT_FOUND',
          message: 'Driver data entry not found',
          details: 'The specified entry does not exist'
        },
        timestamp: new Date().toISOString()
      });
    }

    const entryData = entryDoc.data();
    
    if (entryData.status !== 'pending_verification') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'Entry cannot be rejected',
          details: `Entry status is ${entryData.status}, only pending_verification entries can be rejected`
        },
        timestamp: new Date().toISOString()
      });
    }

    // Update entry status
    await entryDoc.ref.update({
      status: 'rejected',
      reviewedAt: new Date(),
      reviewedBy: adminId,
      rejectionReason: rejectionReason,
      reviewComments: reviewComments || null,
      updatedAt: new Date(),
      reviewHistory: [
        ...(entryData.reviewHistory || []),
        {
          action: 'rejected',
          timestamp: new Date(),
          reviewedBy: adminId,
          rejectionReason: rejectionReason,
          comments: reviewComments
        }
      ]
    });

    // Update driver profile verification status
    const userRef = db.collection('users').doc(entryData.driverId);
    await userRef.update({
      'driver.verificationStatus': 'rejected',
      'driver.isVerified': false,
      'isVerified': false,
      'driver.rejectedAt': new Date(),
      'driver.rejectedBy': adminId,
      'driver.rejectionReason': rejectionReason,
      'driver.adminNotes': reviewComments || null,
      updatedAt: new Date()
    });

    // Update verification status collection
    const verificationStatusRef = db.collection('driverVerificationStatus').doc(entryData.driverId);
    await verificationStatusRef.set({
      driverId: entryData.driverId,
      verificationStatus: 'rejected',
      isVerified: false,
      dataEntryStatus: 'rejected',
      lastUpdated: new Date(),
      canStartWorking: false,
      rejectedBy: adminId,
      rejectedAt: new Date(),
      rejectionReason: rejectionReason
    }, { merge: true });

    // Send notification to driver about rejection
    try {
      const { sendToUser } = require('../services/socket');
      if (sendToUser) {
        sendToUser(entryData.driverId, 'data_entry_rejected', {
          type: 'data_entry_rejection',
          rejectionReason: rejectionReason,
          message: `Your vehicle details were rejected. Reason: ${rejectionReason}`,
          title: 'Vehicle Details Rejected',
          priority: 'high',
          actionRequired: true,
          nextSteps: [
            'Review the rejection reason',
            'Update your vehicle details',
            'Resubmit for verification'
          ],
          timestamp: new Date().toISOString()
        });
      }
    } catch (notificationError) {
      console.warn('⚠️ Failed to send rejection notification:', notificationError);
    }

    console.log(`❌ Driver data entry rejected: ${entryId}`);

    res.status(200).json({
      success: true,
      message: 'Driver data entry rejected successfully',
      data: {
        entryId: entryId,
        driverId: entryData.driverId,
        status: 'rejected',
        rejectedAt: new Date(),
        rejectedBy: adminId,
        rejectionReason: rejectionReason
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error rejecting driver data entry:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'REJECT_ERROR',
        message: 'Failed to reject driver data entry',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @route   GET /api/admin/driver-data/stats
 * @desc    Get driver data entry statistics
 * @access  Private (Admin only)
 */
router.get('/stats', async (req, res) => {
  try {
    const db = getFirestore();

    console.log('📊 Getting driver data entry statistics');

    // Get counts for each status
    const pendingQuery = await db.collection('driverDataEntries')
      .where('status', '==', 'pending_verification')
      .get();
    
    const approvedQuery = await db.collection('driverDataEntries')
      .where('status', '==', 'approved')
      .get();
    
    const rejectedQuery = await db.collection('driverDataEntries')
      .where('status', '==', 'rejected')
      .get();

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentQuery = await db.collection('driverDataEntries')
      .where('submittedAt', '>=', sevenDaysAgo)
      .get();

    const stats = {
      total: pendingQuery.size + approvedQuery.size + rejectedQuery.size,
      pending: pendingQuery.size,
      approved: approvedQuery.size,
      rejected: rejectedQuery.size,
      recent: recentQuery.size,
      approvalRate: approvedQuery.size + rejectedQuery.size > 0 
        ? Math.round((approvedQuery.size / (approvedQuery.size + rejectedQuery.size)) * 100) 
        : 0
    };

    res.status(200).json({
      success: true,
      message: 'Driver data entry statistics retrieved successfully',
      data: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting driver data entry statistics:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'STATS_ERROR',
        message: 'Failed to get driver data entry statistics',
        details: error.message
      },
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
