const express = require('express');
const { body, validationResult, query } = require('express-validator');
const { requireRole } = require('../middleware/auth');
const { getFirestore } = require('../services/firebase');
const socketService = require('../services/socketService');

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
 * @desc    Get frequently asked questions with real-time updates
 * @access  Public
 */
router.get('/faq', [
  query('category').optional().isString().withMessage('Category must be a string'),
  query('search').optional().isString().withMessage('Search term must be a string'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be a positive integer')
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

    const { category, search, limit = 50, offset = 0 } = req.query;

    // Build query
    let query = getDb().collection('faqs').where('isActive', '==', true);
    
    if (category) {
      query = query.where('category', '==', category);
    }

    // Get FAQs
    const snapshot = await query
      .orderBy('order')
      .orderBy('lastUpdated', 'desc')
      .limit(parseInt(limit))
      .offset(parseInt(offset))
      .get();

    let faqs = [];
    snapshot.forEach(doc => {
      const faqData = doc.data();
      faqs.push({
        id: doc.id,
        ...faqData,
        lastUpdated: faqData.lastUpdated?.toDate?.() || faqData.lastUpdated
      });
    });

    // Apply search filter if provided
    if (search) {
      const searchLower = search.toLowerCase();
      faqs = faqs.filter(faq => 
        faq.question.toLowerCase().includes(searchLower) ||
        faq.answer.toLowerCase().includes(searchLower) ||
        faq.tags?.some(tag => tag.toLowerCase().includes(searchLower))
      );
    }

    // Get total count for pagination
    const totalSnapshot = await query.count().get();
    const total = totalSnapshot.data().count;

    // Get FAQ categories for filtering
    const categoriesSnapshot = await getDb().collection('faqCategories')
      .where('isActive', '==', true)
      .orderBy('order')
      .get();

    const categories = [];
    categoriesSnapshot.forEach(doc => {
      categories.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      data: {
        faqs,
        categories,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: total > parseInt(offset) + faqs.length
        },
        lastUpdated: new Date().toISOString()
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
 * @route   GET /api/support/faq/categories
 * @desc    Get FAQ categories
 * @access  Public
 */
router.get('/faq/categories', async (req, res) => {
  try {
    const snapshot = await getDb().collection('faqCategories')
      .where('isActive', '==', true)
      .orderBy('order')
      .get();

    const categories = [];
    snapshot.forEach(doc => {
      categories.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.json({
      success: true,
      data: {
        categories
      }
    });

  } catch (error) {
    console.error('Get FAQ categories error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FAQ_CATEGORIES_ERROR',
        message: 'Failed to retrieve FAQ categories',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/support/faq
 * @desc    Create new FAQ (Admin only)
 * @access  Private (Admin)
 */
router.post('/faq', [
  requireRole(['admin']),
  body('question').isLength({ min: 10, max: 200 }).withMessage('Question must be between 10 and 200 characters'),
  body('answer').isLength({ min: 20, max: 2000 }).withMessage('Answer must be between 20 and 2000 characters'),
  body('category').isString().withMessage('Category is required'),
  body('order').optional().isInt({ min: 0 }).withMessage('Order must be a positive integer'),
  body('tags').optional().isArray().withMessage('Tags must be an array'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean')
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

    const { question, answer, category, order = 0, tags = [], isActive = true } = req.body;
    const adminId = req.user.uid;

    // Create FAQ
    const faqData = {
      question,
      answer,
      category,
      order,
      tags,
      isActive,
      createdBy: adminId,
      createdAt: new Date(),
      lastUpdated: new Date(),
      viewCount: 0,
      helpfulCount: 0,
      notHelpfulCount: 0
    };

    // Save to database
    const faqRef = await getDb().collection('faqs').add(faqData);
    const faqId = faqRef.id;

    // Broadcast real-time update
    try {
      sendToTopic('faq_updates', {
        type: 'faq_created',
        faqId,
        category,
        timestamp: new Date().toISOString()
      });
    } catch (broadcastError) {
      console.warn('Failed to broadcast FAQ update:', broadcastError.message);
    }

    res.status(201).json({
      success: true,
      message: 'FAQ created successfully',
      data: {
        faqId,
        question: faqData.question,
        category: faqData.category
      }
    });

  } catch (error) {
    console.error('Create FAQ error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FAQ_CREATION_ERROR',
        message: 'Failed to create FAQ',
        details: error.message
      }
    });
  }
});

/**
 * @route   PUT /api/support/faq/:faqId
 * @desc    Update FAQ (Admin only)
 * @access  Private (Admin)
 */
router.put('/faq/:faqId', [
  requireRole(['admin']),
  body('question').optional().isLength({ min: 10, max: 200 }).withMessage('Question must be between 10 and 200 characters'),
  body('answer').optional().isLength({ min: 20, max: 2000 }).withMessage('Answer must be between 20 and 2000 characters'),
  body('category').optional().isString().withMessage('Category must be a string'),
  body('order').optional().isInt({ min: 0 }).withMessage('Order must be a positive integer'),
  body('tags').optional().isArray().withMessage('Tags must be an array'),
  body('isActive').optional().isBoolean().withMessage('isActive must be a boolean')
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

    const { faqId } = req.params;
    const updateData = req.body;
    const adminId = req.user.uid;

    // Get existing FAQ
    const faqRef = getDb().collection('faqs').doc(faqId);
    const faqDoc = await faqRef.get();
    
    if (!faqDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FAQ_NOT_FOUND',
          message: 'FAQ not found'
        }
      });
    }

    // Update FAQ
    const updatePayload = {
      ...updateData,
      lastUpdated: new Date(),
      updatedBy: adminId
    };

    await faqRef.update(updatePayload);

    // Broadcast real-time update
    try {
      sendToTopic('faq_updates', {
        type: 'faq_updated',
        faqId,
        category: updateData.category || faqDoc.data().category,
        timestamp: new Date().toISOString()
      });
    } catch (broadcastError) {
      console.warn('Failed to broadcast FAQ update:', broadcastError.message);
    }

    res.json({
      success: true,
      message: 'FAQ updated successfully',
      data: {
        faqId,
        lastUpdated: updatePayload.lastUpdated
      }
    });

  } catch (error) {
    console.error('Update FAQ error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FAQ_UPDATE_ERROR',
        message: 'Failed to update FAQ',
        details: error.message
      }
    });
  }
});

/**
 * @route   DELETE /api/support/faq/:faqId
 * @desc    Delete FAQ (Admin only)
 * @access  Private (Admin)
 */
router.delete('/faq/:faqId', [
  requireRole(['admin'])
], async (req, res) => {
  try {
    const { faqId } = req.params;

    // Get existing FAQ
    const faqRef = getDb().collection('faqs').doc(faqId);
    const faqDoc = await faqRef.get();
    
    if (!faqDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FAQ_NOT_FOUND',
          message: 'FAQ not found'
        }
      });
    }

    // Soft delete by setting isActive to false
    await faqRef.update({
      isActive: false,
      deletedAt: new Date(),
      deletedBy: req.user.uid
    });

    // Broadcast real-time update
    try {
      sendToTopic('faq_updates', {
        type: 'faq_deleted',
        faqId,
        category: faqDoc.data().category,
        timestamp: new Date().toISOString()
      });
    } catch (broadcastError) {
      console.warn('Failed to broadcast FAQ update:', broadcastError.message);
    }

    res.json({
      success: true,
      message: 'FAQ deleted successfully',
      data: {
        faqId
      }
    });

  } catch (error) {
    console.error('Delete FAQ error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FAQ_DELETION_ERROR',
        message: 'Failed to delete FAQ',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/support/faq/:faqId/feedback
 * @desc    Submit FAQ feedback (helpful/not helpful)
 * @access  Public
 */
router.post('/faq/:faqId/feedback', [
  body('helpful').isBoolean().withMessage('Helpful must be a boolean')
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

    const { faqId } = req.params;
    const { helpful } = req.body;
    const userId = req.user?.uid || 'anonymous';

    // Get FAQ
    const faqRef = getDb().collection('faqs').doc(faqId);
    const faqDoc = await faqRef.get();
    
    if (!faqDoc.exists) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'FAQ_NOT_FOUND',
          message: 'FAQ not found'
        }
      });
    }

    const faqData = faqDoc.data();

    // Update feedback counts
    const updateData = {
      lastUpdated: new Date()
    };

    if (helpful) {
      updateData.helpfulCount = (faqData.helpfulCount || 0) + 1;
    } else {
      updateData.notHelpfulCount = (faqData.notHelpfulCount || 0) + 1;
    }

    await faqRef.update(updateData);

    // Save feedback record
    const feedbackData = {
      faqId,
      userId,
      helpful,
      timestamp: new Date(),
      userAgent: req.headers['user-agent'] || null,
      ipAddress: req.ip || null
    };

    await getDb().collection('faqFeedback').add(feedbackData);

    res.json({
      success: true,
      message: 'Feedback submitted successfully',
      data: {
        faqId,
        helpful
      }
    });

  } catch (error) {
    console.error('FAQ feedback error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'FAQ_FEEDBACK_ERROR',
        message: 'Failed to submit feedback',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/support/contact
 * @desc    Get contact information with dynamic updates
 * @access  Public
 */
router.get('/contact', async (req, res) => {
  try {
    // Try to get contact info from database first
    const contactDoc = await getDb().collection('appSettings').doc('contactInfo').get();
    
    let contactInfo;
    
    if (contactDoc.exists) {
      contactInfo = contactDoc.data();
    } else {
      // Fallback to static data
      contactInfo = {
        phone: '+91-1800-123-4567',
        email: 'support@epickup.com',
        whatsapp: '+91-98765-43210',
        address: 'EPickup Support, Bangalore, Karnataka, India',
        workingHours: '24/7',
        emergency: '+91-98765-43211',
        socialMedia: {
          facebook: 'https://facebook.com/epickup',
          twitter: 'https://twitter.com/epickup',
          instagram: 'https://instagram.com/epickup'
        },
        departments: {
          general: {
            phone: '+91-1800-123-4567',
            email: 'support@epickup.com',
            hours: '6:00 AM - 10:00 PM'
          },
          technical: {
            phone: '+91-1800-123-4568',
            email: 'tech@epickup.com',
            hours: '8:00 AM - 8:00 PM'
          },
          billing: {
            phone: '+91-1800-123-4569',
            email: 'billing@epickup.com',
            hours: '9:00 AM - 6:00 PM'
          },
          emergency: {
            phone: '+91-98765-43211',
            email: 'emergency@epickup.com',
            hours: '24/7'
          }
        },
        lastUpdated: new Date().toISOString()
      };

      // Save to database for future use
      await getDb().collection('appSettings').doc('contactInfo').set(contactInfo);
    }

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
 * @route   PUT /api/support/contact
 * @desc    Update contact information (Admin only)
 * @access  Private (Admin)
 */
router.put('/contact', [
  requireRole(['admin']),
  body('phone').optional().isString().withMessage('Phone must be a string'),
  body('email').optional().isEmail().withMessage('Email must be valid'),
  body('whatsapp').optional().isString().withMessage('WhatsApp must be a string'),
  body('address').optional().isString().withMessage('Address must be a string'),
  body('workingHours').optional().isString().withMessage('Working hours must be a string'),
  body('emergency').optional().isString().withMessage('Emergency number must be a string')
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

    const updateData = {
      ...req.body,
      lastUpdated: new Date(),
      updatedBy: req.user.uid
    };

    // Update contact info
    await getDb().collection('appSettings').doc('contactInfo').update(updateData);

    // Broadcast real-time update
    try {
      sendToTopic('contact_updates', {
        type: 'contact_updated',
        timestamp: new Date().toISOString()
      });
    } catch (broadcastError) {
      console.warn('Failed to broadcast contact update:', broadcastError.message);
    }

    res.json({
      success: true,
      message: 'Contact information updated successfully',
      data: {
        lastUpdated: updateData.lastUpdated
      }
    });

  } catch (error) {
    console.error('Update contact error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'CONTACT_UPDATE_ERROR',
        message: 'Failed to update contact information',
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
