const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { requireRole } = require('../middleware/auth');
const { getFirestore } = require('../services/firebase');

const router = express.Router();

// Lazy database initialization
const getDb = () => getFirestore();

/**
 * @route   POST /api/support/ticket
 * @desc    Create a new support ticket
 * @access  Private (Customer, Driver)
 */
router.post('/ticket', [
  body('subject').isLength({ min: 5, max: 100 }).withMessage('Subject must be between 5 and 100 characters'),
  body('description').isLength({ min: 10, max: 1000 }).withMessage('Description must be between 10 and 1000 characters'),
  body('category').isIn(['technical', 'billing', 'delivery', 'account', 'other']).withMessage('Invalid category'),
  body('priority').isIn(['low', 'medium', 'high', 'urgent']).withMessage('Invalid priority')
], async (req, res) => {
  try {
    // Check validation errors
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

    const { subject, description, category, priority } = req.body;
    const userId = req.user.uid;
    const userType = req.user.userType || 'customer';

    // Create ticket
    const ticketData = {
      id: `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      userType,
      subject,
      description,
      category,
      priority,
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [{
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        senderId: userId,
        senderType: userType,
        message: description,
        timestamp: new Date()
      }]
    };

    // Save to database
    await getDb().collection('supportTickets').doc(ticketData.id).set(ticketData);

    res.status(201).json({
      success: true,
      message: 'Support ticket created successfully',
      data: {
        ticketId: ticketData.id,
        status: ticketData.status,
        createdAt: ticketData.createdAt
      }
    });

  } catch (error) {
    console.error('Create ticket error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TICKET_CREATION_ERROR',
        message: 'Failed to create support ticket',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/support/tickets
 * @desc    Get user's support tickets
 * @access  Private (Customer, Driver)
 */
router.get('/tickets', [
  query('status').optional().isIn(['open', 'in_progress', 'resolved', 'closed']),
  query('category').optional().isIn(['technical', 'billing', 'delivery', 'account', 'other']),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('offset').optional().isInt({ min: 0 })
], async (req, res) => {
  try {
    // Check validation errors
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

    const { status, category, limit = 20, offset = 0 } = req.query;
    const userId = req.user.uid;

    // Build query
    let query = getDb().collection('supportTickets').where('userId', '==', userId);
    
    if (status) {
      query = query.where('status', '==', status);
    }
    
    if (category) {
      query = query.where('category', '==', category);
    }

    // Get tickets
    const snapshot = await query
      .orderBy('createdAt', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();

    const tickets = [];
    snapshot.forEach(doc => {
      tickets.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Get total count
    const totalSnapshot = await query.count().get();
    const total = totalSnapshot.data().count;

    res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: total > parseInt(offset) + tickets.length
        }
      }
    });

  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TICKETS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve support tickets',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/support/ticket/:ticketId
 * @desc    Get specific support ticket details
 * @access  Private (Customer, Driver, Admin)
 */
router.get('/ticket/:ticketId', [
], async (req, res) => {
  try {
    const { ticketId } = req.params;
    const userId = req.user.uid;
    const userRole = req.user.userType;

    // Get ticket
    const ticketDoc = await getDb().collection('supportTickets').doc(ticketId).get();
    
    if (!ticketDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Support ticket not found'
        }
      });
    }

    const ticket = ticketDoc.data();

    // Check access permissions
    if (userRole !== 'admin' && ticket.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You can only access your own tickets'
        }
      });
    }

    res.json({
      success: true,
      data: {
        ticket
      }
    });

  } catch (error) {
    console.error('Get ticket error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'TICKET_RETRIEVAL_ERROR',
        message: 'Failed to retrieve support ticket',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/support/ticket/:ticketId/message
 * @desc    Add message to support ticket
 * @access  Private (Customer, Driver, Admin)
 */
router.post('/ticket/:ticketId/message', [
  body('message').isLength({ min: 1, max: 1000 }).withMessage('Message must be between 1 and 1000 characters')
], async (req, res) => {
  try {
    // Check validation errors
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

    const { ticketId } = req.params;
    const { message } = req.body;
    const userId = req.user.uid;
    const userType = req.user.userType || 'customer';

    // Get ticket
    const ticketRef = getDb().collection('supportTickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();
    
    if (!ticketDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Support ticket not found'
        }
      });
    }

    const ticket = ticketDoc.data();

    // Check access permissions
    if (ticket.userId !== userId && userType !== 'admin') {
      return res.status(403).json({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: 'You can only add messages to your own tickets'
        }
      });
    }

    // Check if ticket is closed
    if (ticket.status === 'closed') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'TICKET_CLOSED',
          message: 'Cannot add message to closed ticket'
        }
      });
    }

    // Create message
    const newMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      senderId: userId,
      senderType: userType,
      message,
      timestamp: new Date()
    };

    // Add message to ticket
    await ticketRef.update({
      messages: [...ticket.messages, newMessage],
      updatedAt: new Date(),
      status: userType === 'admin' ? 'in_progress' : ticket.status
    });

    res.json({
      success: true,
      message: 'Message added successfully',
      data: {
        messageId: newMessage.id,
        timestamp: newMessage.timestamp
      }
    });

  } catch (error) {
    console.error('Add message error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'MESSAGE_ADDITION_ERROR',
        message: 'Failed to add message to ticket',
        details: error.message
      }
    });
  }
});

/**
 * @route   PUT /api/support/ticket/:ticketId/status
 * @desc    Update ticket status (Admin only)
 * @access  Private (Admin)
 */
router.put('/ticket/:ticketId/status', [
  requireRole(['admin']),
  body('status').isIn(['open', 'in_progress', 'resolved', 'closed']).withMessage('Invalid status'),
  body('adminNotes').optional().isLength({ max: 500 }).withMessage('Admin notes must be less than 500 characters')
], async (req, res) => {
  try {
    // Check validation errors
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

    const { ticketId } = req.params;
    const { status, adminNotes } = req.body;
    const adminId = req.user.uid;

    // Get ticket
    const ticketRef = getDb().collection('supportTickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();
    
    if (!ticketDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'TICKET_NOT_FOUND',
          message: 'Support ticket not found'
        }
      });
    }

    // Update status
    const updateData = {
      status,
      updatedAt: new Date(),
      adminNotes: adminNotes || null,
      lastUpdatedBy: adminId
    };

    await ticketRef.update(updateData);

    res.json({
      success: true,
      message: 'Ticket status updated successfully',
      data: {
        ticketId,
        status,
        updatedAt: updateData.updatedAt
      }
    });

  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'STATUS_UPDATE_ERROR',
        message: 'Failed to update ticket status',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/support/faq
 * @desc    Get frequently asked questions
 * @access  Public
 */
router.get('/faq', async (req, res) => {
  try {
    const { category } = req.query;

    // Build query
    let query = getDb().collection('faqs');
    
    if (category) {
      query = query.where('category', '==', category);
    }

    // Get FAQs
    const snapshot = await query
      .where('isActive', '==', true)
      .orderBy('order')
      .get();

    const faqs = [];
    snapshot.forEach(doc => {
      faqs.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      data: {
        faqs
      }
    });

  } catch (error) {
    console.error('Get FAQ error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FAQ_RETRIEVAL_ERROR',
        message: 'Failed to retrieve FAQs',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/support/contact
 * @desc    Get contact information
 * @access  Public
 */
router.get('/contact', async (req, res) => {
  try {
    // Get contact info from database or return static data
    const contactInfo = {
      phone: '+91-1800-123-4567',
      email: 'support@epickup.com',
      whatsapp: '+91-98765-43210',
      address: 'EPickup Support, Bangalore, Karnataka, India',
      workingHours: '24/7',
      emergency: '+91-98765-43211'
    };

    res.json({
      success: true,
      data: {
        contactInfo
      }
    });

  } catch (error) {
    console.error('Get contact error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CONTACT_RETRIEVAL_ERROR',
        message: 'Failed to retrieve contact information',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/support/feedback
 * @desc    Submit feedback
 * @access  Private (Customer, Driver)
 */
router.post('/feedback', [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').optional().isLength({ max: 500 }).withMessage('Comment must be less than 500 characters'),
  body('category').isIn(['app', 'service', 'delivery', 'payment', 'other']).withMessage('Invalid category')
], async (req, res) => {
  try {
    // Check validation errors
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

    const { rating, comment, category } = req.body;
    const userId = req.user.uid;
    const userType = req.user.userType || 'customer';

    // Create feedback
    const feedbackData = {
      id: `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId,
      userType,
      rating,
      comment: comment || null,
      category,
      createdAt: new Date()
    };

    // Save to database
    await getDb().collection('feedback').doc(feedbackData.id).set(feedbackData);

    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      data: {
        feedbackId: feedbackData.id,
        rating: feedbackData.rating
      }
    });

  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FEEDBACK_SUBMISSION_ERROR',
        message: 'Failed to submit feedback',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/support/health
 * @desc    Support service health check
 * @access  Public
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Support service is healthy',
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'EPickup Support Service',
      version: '1.0.0'
    }
  });
});

module.exports = router;
