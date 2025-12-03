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
    
    // ✅ CRITICAL FIX: Validate userType from middleware - don't default to customer
    // If middleware worked correctly, userType should always be set
    if (!req.user.userType) {
      console.error('❌ [CHAT] Missing userType in request user:', userId);
      return res.status(500).json({
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: 'User type could not be determined. Please login again.'
        }
      });
    }
    
    const userType = req.user.userType;
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

    // ✅ CRITICAL FIX: Emit chat message via WebSocket to booking room
    try {
      const socketService = require('../services/socket');
      const io = socketService.getSocketIO();
      
      if (io) {
        const bookingRoom = `booking:${bookingId}`;
        const userRoom = `user:${bookingData.customerId}`;
        const driverRoom = bookingData.driverId ? `user:${bookingData.driverId}` : null;
        
        // ✅ CRITICAL FIX: Emit to booking room and user rooms
        const chatMessageEvent = {
          id: messageData.id,
          bookingId: bookingId,
          tripId: bookingId, // For backward compatibility
          senderId: userId,
          senderType: senderType || userType,
          message: message.trim(),
          timestamp: messageData.timestamp.toISOString(),
          messageType: 'text'
        };
        
        io.to(bookingRoom).emit('chat_message', chatMessageEvent);
        io.to(userRoom).emit('chat_message', chatMessageEvent);
        if (driverRoom) {
          io.to(driverRoom).emit('chat_message', chatMessageEvent);
        }
        
        console.log(`✅ [CHAT] Chat message emitted to rooms: ${bookingRoom}, ${userRoom}${driverRoom ? `, ${driverRoom}` : ''}`);
      }
    } catch (wsError) {
      console.error('❌ [CHAT] Error emitting chat message via WebSocket:', wsError);
      // Continue - message is saved to DB even if WebSocket fails
    }

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
    
    // ✅ CRITICAL FIX: Enhanced error handling with specific error codes
    let statusCode = 500;
    let errorMessage = 'Failed to send message';
    let errorCode = 'MESSAGE_SEND_ERROR';
    
    if (error.code === 'permission-denied') {
      statusCode = 403;
      errorMessage = 'Access denied - you can only send messages for your own bookings';
      errorCode = 'ACCESS_DENIED';
    } else if (error.code === 'not-found' || error.message?.includes('not found')) {
      statusCode = 404;
      errorMessage = 'Booking not found';
      errorCode = 'BOOKING_NOT_FOUND';
    } else if (error.message?.includes('validation') || error.message?.includes('required')) {
      statusCode = 400;
      errorMessage = error.message || 'Invalid message data';
      errorCode = 'VALIDATION_ERROR';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      code: errorCode,
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

    // ✅ CRITICAL FIX: Get chat messages without orderBy to avoid composite index requirement
    // Sort in memory instead
    const messagesSnapshot = await db.collection('chat_messages')
      .where('bookingId', '==', bookingId)
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

    // ✅ CRITICAL FIX: Sort messages by timestamp in memory (ascending - oldest first)
    messages.sort((a, b) => {
      const at = a.timestamp?.toMillis?.() || new Date(a.timestamp || 0).getTime() || 0;
      const bt = b.timestamp?.toMillis?.() || new Date(b.timestamp || 0).getTime() || 0;
      return at - bt;
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
    
    // ✅ CRITICAL FIX: Enhanced error handling with specific error codes
    let statusCode = 500;
    let errorMessage = 'Failed to get messages';
    let errorCode = 'MESSAGES_FETCH_ERROR';
    
    if (error.code === 'permission-denied') {
      statusCode = 403;
      errorMessage = 'Access denied - you can only view messages for your own bookings';
      errorCode = 'ACCESS_DENIED';
    } else if (error.code === 'not-found' || error.message?.includes('not found')) {
      statusCode = 404;
      errorMessage = 'Booking not found';
      errorCode = 'BOOKING_NOT_FOUND';
    } else if (error.code === 'failed-precondition') {
      statusCode = 503;
      errorMessage = 'Database index required. Please contact support.';
      errorCode = 'INDEX_REQUIRED';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      code: errorCode,
      details: error.message
    });
  }
});

/**
 * @route GET /api/chat/:bookingId/instructions
 * @desc Get customer instructions for driver
 * @access Private (Driver only)
 */
router.get('/:bookingId/instructions', [
  authMiddleware
], async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.uid;
    const db = getFirestore();

    console.log(`📋 Getting instructions for driver ${userId} for booking ${bookingId}`);

    // Verify booking exists and user is the driver
    const bookingDoc = await db.collection('bookings').doc(bookingId).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Booking not found'
      });
    }

    const bookingData = bookingDoc.data();
    
    // Check if user is the driver for this booking
    if (bookingData.driverId !== userId) {
      return res.status(403).json({
        success: false,
        error: 'Access denied - only the assigned driver can view instructions'
      });
    }

    // ✅ CRITICAL FIX: Get customer instructions from two sources:
    // 1. Special instructions from booking creation (package.specialInstructions)
    // 2. Chat messages sent by customer during the booking
    
    const instructions = [];
    
    // ✅ SOURCE 1: Get specialInstructions from booking document (if exists)
    if (bookingData.package && bookingData.package.specialInstructions && bookingData.package.specialInstructions.trim()) {
      instructions.push({
        id: `booking_${bookingId}_special_instructions`, // Unique ID for booking-level instructions
        message: bookingData.package.specialInstructions.trim(),
        timestamp: bookingData.createdAt || new Date(), // Use booking creation time
        createdAt: bookingData.createdAt || new Date(),
        read: false, // Mark as unread so driver sees it
        source: 'booking_creation' // Indicate this came from booking creation
      });
      const instructionsText = bookingData.package.specialInstructions.trim();
      console.log(`📋 Found special instructions in booking document: ${instructionsText.substring(0, Math.min(50, instructionsText.length))}...`);
    }
    
    // ✅ SOURCE 2: Get customer messages (instructions) from chat_messages collection
    // Remove orderBy to avoid composite index requirement; sort in memory
    const messagesSnapshot = await db.collection('chat_messages')
      .where('bookingId', '==', bookingId)
      .where('senderType', '==', 'customer')
      .get();

    messagesSnapshot.forEach(doc => {
      const messageData = doc.data();
      
      // ✅ CRITICAL FIX: Validate message data exists and has required fields
      if (!messageData || !messageData.message) {
        console.warn(`⚠️ Skipping invalid chat message ${doc.id}: missing message field`);
        return; // Skip invalid messages
      }
      
      instructions.push({
        id: doc.id, // use document id for updates
        message: messageData.message || '', // Ensure message is always a string
        timestamp: messageData.timestamp,
        createdAt: messageData.createdAt,
        read: messageData.read || false,
        source: 'chat_message' // Indicate this came from chat
      });
    });

    // Sort by timestamp ascending in memory
    instructions.sort((a, b) => {
      const at = a.timestamp?.toMillis?.() || new Date(a.timestamp || 0).getTime() || 0;
      const bt = b.timestamp?.toMillis?.() || new Date(b.timestamp || 0).getTime() || 0;
      return at - bt;
    });

    // ✅ CRITICAL FIX: Mark chat message instructions as read (skip booking-level instructions)
    // Only mark chat messages as read, not booking-level specialInstructions
    if (instructions.length > 0) {
      const batch = db.batch();
      let hasWrites = false; // Track writes manually instead of using internal _writes property
      
      instructions.forEach(instruction => {
        // Only mark chat messages as read, not booking-level instructions
        if (instruction.source === 'chat_message' && instruction.id && !instruction.id.startsWith('booking_')) {
          const messageRef = db.collection('chat_messages').doc(instruction.id);
          batch.set(messageRef, { read: true, readAt: new Date() }, { merge: true });
          hasWrites = true; // Mark that we have writes to commit
        }
      });
      
      // ✅ CRITICAL FIX: Only commit if we actually have writes (fixes "Cannot read properties of undefined (reading 'length')" error)
      if (hasWrites) {
        await batch.commit();
      }
    }

    console.log(`✅ Retrieved ${instructions.length} instructions for driver ${userId}`);

    res.json({
      success: true,
      data: {
        instructions,
        count: instructions.length,
        bookingId
      }
    });

  } catch (error) {
    console.error('❌ Error fetching driver instructions:', error);
    
    // ✅ CRITICAL FIX: Enhanced error handling with specific error codes
    let statusCode = 500;
    let errorMessage = 'Failed to fetch instructions';
    let errorCode = 'INSTRUCTIONS_FETCH_ERROR';
    
    if (error.code === 'permission-denied') {
      statusCode = 403;
      errorMessage = 'Access denied - only the assigned driver can view instructions';
      errorCode = 'ACCESS_DENIED';
    } else if (error.code === 'not-found' || error.message?.includes('not found')) {
      statusCode = 404;
      errorMessage = 'Booking not found';
      errorCode = 'BOOKING_NOT_FOUND';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      code: errorCode,
      details: error.message
    });
  }
});

module.exports = router;
