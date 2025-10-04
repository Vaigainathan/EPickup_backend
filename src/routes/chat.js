const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../middleware/auth');
const { getFirestore } = require('../services/firebase');

const router = express.Router();

/**
 * @route POST /api/chat/send
 * @desc Send message to driver/customer
 * @access Private (Customer, Driver)
 */
router.post('/send', [
  authMiddleware,
  body('bookingId').isString().notEmpty().withMessage('Booking ID is required'),
  body('driverId').optional().isString().withMessage('Driver ID must be a string'),
  body('message').isLength({ min: 1, max: 500 }).withMessage('Message must be between 1 and 500 characters'),
  body('senderType').isIn(['customer', 'driver']).withMessage('Sender type must be customer or driver'),
  body('timestamp').optional().isISO8601().withMessage('Timestamp must be valid ISO8601 format')
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

    const { bookingId, message, senderType, timestamp } = req.body;
    const userId = req.user.uid;
    const userType = req.user.userType || 'customer';
    const db = getFirestore();

    console.log(`💬 Chat message from ${userType} ${userId} for booking ${bookingId}`);

    // Verify booking exists and user has access
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    const bookingData = bookingDoc.data();
    
    // Check access permissions
    if (bookingData.customerId !== userId && bookingData.driverId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied - you can only send messages for your own bookings'
      });
    }

    // Create message document
    const messageData = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      bookingId,
      senderId: userId,
      senderType: senderType || userType,
      message: message.trim(),
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      createdAt: new Date(),
      read: false
    };

    // Save message to chat_messages collection
    await db.collection('chat_messages').add(messageData);

    // Update booking with last message info
    await db.collection('bookings').doc(bookingId).update({
      lastMessage: {
        senderId: userId,
        senderType: senderType || userType,
        message: message.trim(),
        timestamp: messageData.timestamp
      },
      updatedAt: new Date()
    });

    console.log(`✅ Chat message sent: ${messageData.id}`);

    res.json({
      success: true,
      message: 'Message sent successfully',
      data: {
        messageId: messageData.id,
        timestamp: messageData.timestamp
      }
    });

  } catch (error) {
    console.error('❌ Error sending chat message:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send message',
      details: error.message
    });
  }
});

/**
 * @route GET /api/chat/:bookingId
 * @desc Get chat messages for a booking
 * @access Private (Customer, Driver)
 */
router.get('/:bookingId', [
  authMiddleware
], async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.uid;
    const db = getFirestore();

    // Verify booking exists and user has access
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    const bookingData = bookingDoc.data();
    
    // Check access permissions
    if (bookingData.customerId !== userId && bookingData.driverId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied - you can only view messages for your own bookings'
      });
    }

    // Get chat messages
    const messagesSnapshot = await db.collection('chat_messages')
      .where('bookingId', '==', bookingId)
      .orderBy('timestamp', 'asc')
      .get();

    const messages = [];
    messagesSnapshot.forEach(doc => {
      const messageData = doc.data();
      messages.push({
        id: doc.id,
        ...messageData,
        timestamp: messageData.timestamp?.toDate?.() || messageData.timestamp
      });
    });

    res.json({
      success: true,
      data: {
        bookingId,
        messages
      }
    });

  } catch (error) {
    console.error('❌ Error getting chat messages:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get messages',
      details: error.message
    });
  }
});

module.exports = router;
