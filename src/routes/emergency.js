const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const { getFirestore } = require('../services/firebase');
const notificationService = require('../services/notificationService');

const db = getFirestore();

/**
 * @route   POST /api/emergency/alert
 * @desc    Send emergency alert
 * @access  Private
 */
router.post('/alert', [
  requireRole(['customer', 'driver']),
  body('alertType').isIn(['sos', 'accident', 'harassment', 'medical']).withMessage('Valid alert type required'),
  body('bookingId').optional().isString(),
  body('location.latitude').isFloat().withMessage('Valid latitude required'),
  body('location.longitude').isFloat().withMessage('Valid longitude required'),
  body('message').optional().isString()
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

    const { alertType, bookingId, location, message } = req.body;
    const userId = req.user.uid;

    // Create emergency alert record
    const alertRef = await db.collection('emergency_alerts').add({
      userId,
      bookingId,
      alertType,
      location,
      message,
      status: 'active',
      createdAt: new Date()
    });

    // Get user's emergency contacts
    const contactsSnapshot = await db.collection('emergency_contacts')
      .where('userId', '==', userId)
      .get();

    const contacts = contactsSnapshot.docs.map(doc => doc.data());

    // Send notifications to emergency contacts
    for (const contact of contacts) {
      await notificationService.sendToUser(contact.userId, {
        type: 'emergency',
        title: 'Emergency Alert',
        body: `Emergency alert from ${req.user.name}: ${alertType}`,
        data: {
          alertId: alertRef.id,
          alertType,
          location,
          message
        }
      });
    }

    // Send notification to admin
    await notificationService.sendToTopic('admin', {
      type: 'emergency',
      title: 'Emergency Alert',
      body: `Emergency alert from ${req.user.name}: ${alertType}`,
      data: {
        alertId: alertRef.id,
        alertType,
        location,
        message
      }
    });

    res.status(201).json({
      success: true,
      data: {
        alertId: alertRef.id,
        message: 'Emergency alert sent successfully'
      }
    });
  } catch (error) {
    console.error('Emergency alert error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EMERGENCY_ALERT_ERROR',
        message: 'Failed to send emergency alert'
      }
    });
  }
});

/**
 * @route   GET /api/emergency/contacts
 * @desc    Get user's emergency contacts
 * @access  Private
 */
router.get('/contacts', [
  requireRole(['customer', 'driver'])
], async (req, res) => {
  try {
    const userId = req.user.uid;

    const contactsSnapshot = await db.collection('emergency_contacts')
      .where('userId', '==', userId)
      .get();

    const contacts = contactsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.status(200).json({
      success: true,
      data: contacts
    });
  } catch (error) {
    console.error('Get emergency contacts error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'GET_CONTACTS_ERROR',
        message: 'Failed to get emergency contacts'
      }
    });
  }
});

/**
 * @route   POST /api/emergency/contacts
 * @desc    Add emergency contact
 * @access  Private
 */
router.post('/contacts', [
  requireRole(['customer', 'driver']),
  body('name').isString().notEmpty().withMessage('Name is required'),
  body('phone').isString().notEmpty().withMessage('Phone is required'),
  body('relationship').optional().isString(),
  body('isDefault').optional().isBoolean()
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

    const { name, phone, relationship, isDefault } = req.body;
    const userId = req.user.uid;

    // If this is the first contact, make it default
    const existingContacts = await db.collection('emergency_contacts')
      .where('userId', '==', userId)
      .get();

    const shouldBeDefault = isDefault || existingContacts.empty;

    // If making this contact default, unset other defaults
    if (shouldBeDefault) {
      const batch = db.batch();
      existingContacts.docs.forEach(doc => {
        batch.update(doc.ref, { isDefault: false });
      });
      await batch.commit();
    }

    // Add new contact
    const contactRef = await db.collection('emergency_contacts').add({
      userId,
      name,
      phone,
      relationship,
      isDefault: shouldBeDefault,
      createdAt: new Date()
    });

    res.status(201).json({
      success: true,
      data: {
        id: contactRef.id,
        name,
        phone,
        relationship,
        isDefault: shouldBeDefault
      }
    });
  } catch (error) {
    console.error('Add emergency contact error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'ADD_CONTACT_ERROR',
        message: 'Failed to add emergency contact'
      }
    });
  }
});

/**
 * @route   DELETE /api/emergency/contacts/:contactId
 * @desc    Delete emergency contact
 * @access  Private
 */
router.delete('/contacts/:contactId', [
  requireRole(['customer', 'driver'])
], async (req, res) => {
  try {
    const { contactId } = req.params;
    const userId = req.user.uid;

    // Verify contact belongs to user
    const contactDoc = await db.collection('emergency_contacts').doc(contactId).get();
    
    if (!contactDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'CONTACT_NOT_FOUND',
          message: 'Emergency contact not found'
        }
      });
    }

    const contactData = contactDoc.data();
    if (contactData.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Not authorized to delete this contact'
        }
      });
    }

    // Delete contact
    await db.collection('emergency_contacts').doc(contactId).delete();

    res.status(200).json({
      success: true,
      message: 'Emergency contact deleted successfully'
    });
  } catch (error) {
    console.error('Delete emergency contact error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'DELETE_CONTACT_ERROR',
        message: 'Failed to delete emergency contact'
      }
    });
  }
});

/**
 * @route   GET /api/emergency/history
 * @desc    Get emergency alert history for user
 * @access  Private
 */
router.get('/history', requireRole(['customer', 'driver']), async (req, res) => {
  try {
    const userId = req.user.uid;
    const { limit = 20, offset = 0 } = req.query;

    // Get emergency alerts for user
    const alertsSnapshot = await db.collection('emergency_alerts')
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();

    const alerts = [];
    alertsSnapshot.forEach(doc => {
      alerts.push({
        id: doc.id,
        ...doc.data()
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
      }
    });

  } catch (error) {
    console.error('Error getting emergency history:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'EMERGENCY_HISTORY_ERROR',
        message: 'Failed to retrieve emergency history',
        details: 'An error occurred while retrieving emergency history'
      }
    });
  }
});

module.exports = router;
