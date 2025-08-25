const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

/**
 * WebSocket Service for EPickup real-time communication
 * Handles real-time updates for tracking, notifications, and live chat
 */
class WebSocketService {
  constructor(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || ["http://localhost:3000"],
        methods: ["GET", "POST"]
      },
      transports: ['websocket', 'polling']
    });

    this.connectedUsers = new Map(); // userId -> socket
    this.userRooms = new Map(); // userId -> room names
    this.trackingSubscriptions = new Map(); // tripId -> Set of userIds

    this.initialize();
  }

  /**
   * Initialize WebSocket service
   */
  initialize() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization;
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Remove 'Bearer ' prefix if present
        const cleanToken = token.replace('Bearer ', '');
        
        // Verify JWT token
        const secret = process.env.JWT_SECRET || 'your-secret-key';
        const decodedToken = jwt.verify(cleanToken, secret);
        
        if (!decodedToken) {
          return next(new Error('Invalid authentication token'));
        }

        // Add user info to socket
        socket.userId = decodedToken.userId;
        socket.userType = decodedToken.userType || 'customer';
        
        next();
      } catch (error) {
        console.error('WebSocket authentication error:', error.message);
        next(new Error('Authentication failed'));
      }
    });

    // Connection handler
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    console.log('🚀 WebSocket service initialized');
  }

  /**
   * Handle new WebSocket connection
   * @param {Socket} socket - Socket instance
   */
  handleConnection(socket) {
    try {
      const { userId, userType } = socket;

      console.log(`🔌 User connected: ${userId} (${userType})`);

      // Store user connection
      this.connectedUsers.set(userId, socket);
      this.userRooms.set(userId, new Set());

      // Join user-specific room
      socket.join(`user:${userId}`);

      // Join role-based room
      socket.join(`role:${userType}`);

      // Send connection confirmation
      socket.emit('connected', {
        success: true,
        message: 'Connected to EPickup real-time service',
        data: {
          userId,
          userType,
          timestamp: new Date().toISOString()
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        this.handleDisconnection(socket);
      });

      // Handle tracking subscriptions
      socket.on('subscribe_tracking', (data) => {
        this.handleTrackingSubscription(socket, data);
      });

      socket.on('unsubscribe_tracking', (data) => {
        this.handleTrackingUnsubscription(socket, data);
      });

      // Handle location updates from driver app
      socket.on('update_location', (data) => {
        this.handleLocationUpdate(socket, data);
      });

      // Handle chat messages
      socket.on('send_message', (data) => {
        this.handleChatMessage(socket, data);
      });

      // Handle typing indicators
      socket.on('typing_start', (data) => {
        this.handleTypingIndicator(socket, data, true);
      });

      socket.on('typing_stop', (data) => {
        this.handleTypingIndicator(socket, data, false);
      });

      // Handle presence updates
      socket.on('update_presence', (data) => {
        this.handlePresenceUpdate(socket, data);
      });

      // Handle booking status updates
      socket.on('update_booking_status', (data) => {
        this.handleBookingStatusUpdate(socket, data);
      });

      // Handle driver assignments
      socket.on('assign_driver', (data) => {
        this.handleDriverAssignment(socket, data);
      });

      // Handle ETA updates
      socket.on('update_eta', (data) => {
        this.handleETAUpdate(socket, data);
      });

      // Handle error
      socket.on('error', (error) => {
        console.error(`WebSocket error for user ${userId}:`, error);
      });

    } catch (error) {
      console.error('Error handling WebSocket connection:', error);
      socket.disconnect();
    }
  }

  /**
   * Handle WebSocket disconnection
   * @param {Socket} socket - Socket instance
   */
  handleDisconnection(socket) {
    try {
      const { userId } = socket;

      console.log(`🔌 User disconnected: ${userId}`);

      // Remove user from tracking subscriptions
      if (this.trackingSubscriptions.has(userId)) {
        for (const [tripId, userIds] of this.trackingSubscriptions.entries()) {
          userIds.delete(userId);
          if (userIds.size === 0) {
            this.trackingSubscriptions.delete(tripId);
          }
        }
      }

      // Remove user from connected users
      this.connectedUsers.delete(userId);
      this.userRooms.delete(userId);

      // Notify other users about disconnection
      socket.broadcast.to(`role:${socket.userType}`).emit('user_disconnected', {
        userId,
        userType: socket.userType,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error handling WebSocket disconnection:', error);
    }
  }

  /**
   * Handle tracking subscription
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Subscription data
   */
  handleTrackingSubscription(socket, data) {
    try {
      const { tripId } = data;
      const { userId } = socket;

      if (!tripId) {
        socket.emit('error', {
          code: 'INVALID_SUBSCRIPTION',
          message: 'Trip ID is required for tracking subscription'
        });
        return;
      }

      // Join trip tracking room
      socket.join(`trip:${tripId}`);
      
      // Add to user rooms
      const userRooms = this.userRooms.get(userId) || new Set();
      userRooms.add(`trip:${tripId}`);
      this.userRooms.set(userId, userRooms);

      // Add to tracking subscriptions
      if (!this.trackingSubscriptions.has(tripId)) {
        this.trackingSubscriptions.set(tripId, new Set());
      }
      this.trackingSubscriptions.get(tripId).add(userId);

      console.log(`📍 User ${userId} subscribed to trip tracking: ${tripId}`);

      // Confirm subscription
      socket.emit('tracking_subscribed', {
        success: true,
        message: 'Subscribed to trip tracking',
        data: {
          tripId,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error handling tracking subscription:', error);
      socket.emit('error', {
        code: 'SUBSCRIPTION_ERROR',
        message: 'Failed to subscribe to tracking'
      });
    }
  }

  /**
   * Handle tracking unsubscription
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Unsubscription data
   */
  handleTrackingUnsubscription(socket, data) {
    try {
      const { tripId } = data;
      const { userId } = socket;

      if (!tripId) {
        socket.emit('error', {
          code: 'INVALID_UNSUBSCRIPTION',
          message: 'Trip ID is required for tracking unsubscription'
        });
        return;
      }

      // Leave trip tracking room
      socket.leave(`trip:${tripId}`);
      
      // Remove from user rooms
      const userRooms = this.userRooms.get(userId);
      if (userRooms) {
        userRooms.delete(`trip:${tripId}`);
      }

      // Remove from tracking subscriptions
      if (this.trackingSubscriptions.has(tripId)) {
        this.trackingSubscriptions.get(tripId).delete(userId);
        if (this.trackingSubscriptions.get(tripId).size === 0) {
          this.trackingSubscriptions.delete(tripId);
        }
      }

      console.log(`📍 User ${userId} unsubscribed from trip tracking: ${tripId}`);

      // Confirm unsubscription
      socket.emit('tracking_unsubscribed', {
        success: true,
        message: 'Unsubscribed from trip tracking',
        data: {
          tripId,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error handling tracking unsubscription:', error);
      socket.emit('error', {
        code: 'UNSUBSCRIPTION_ERROR',
        message: 'Failed to unsubscribe from tracking'
      });
    }
  }

  /**
   * Handle location update from driver app
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Location data
   */
  handleLocationUpdate(socket, data) {
    try {
      const { tripId, location } = data;
      const { userId } = socket;

      if (!tripId || !location) {
        socket.emit('error', {
          code: 'INVALID_LOCATION_DATA',
          message: 'Trip ID and location data are required'
        });
        return;
      }

      // Validate location data
      if (typeof location.latitude !== 'number' || typeof location.longitude !== 'number') {
        socket.emit('error', {
          code: 'INVALID_LOCATION_COORDINATES',
          message: 'Valid latitude and longitude are required'
        });
        return;
      }

      console.log(`📍 Location update from driver ${userId} for trip ${tripId}`);

      // Broadcast location update to all users tracking this trip
      this.io.to(`trip:${tripId}`).emit('location_updated', {
        tripId,
        driverId: userId,
        location: {
          ...location,
          timestamp: new Date().toISOString()
        }
      });

      // Confirm location update
      socket.emit('location_update_confirmed', {
        success: true,
        message: 'Location update sent successfully',
        data: {
          tripId,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error handling location update:', error);
      socket.emit('error', {
        code: 'LOCATION_UPDATE_ERROR',
        message: 'Failed to process location update'
      });
    }
  }

  /**
   * Handle chat message
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Message data
   */
  handleChatMessage(socket, data) {
    try {
      const { tripId, message, recipientId } = data;
      const { userId, userType } = socket;

      if (!tripId || !message || !recipientId) {
        socket.emit('error', {
          code: 'INVALID_MESSAGE_DATA',
          message: 'Trip ID, message, and recipient ID are required'
        });
        return;
      }

      const messageData = {
        id: `msg_${Date.now()}_${userId}`,
        tripId,
        senderId: userId,
        senderType: userType,
        recipientId,
        message: message.trim(),
        timestamp: new Date().toISOString()
      };

      console.log(`💬 Chat message from ${userId} to ${recipientId} for trip ${tripId}`);

      // Send message to recipient
      this.io.to(`user:${recipientId}`).emit('chat_message', messageData);

      // Send message to trip room for other participants
      this.io.to(`trip:${tripId}`).emit('chat_message', messageData);

      // Confirm message sent
      socket.emit('message_sent', {
        success: true,
        message: 'Message sent successfully',
        data: {
          messageId: messageData.id,
          timestamp: messageData.timestamp
        }
      });

    } catch (error) {
      console.error('Error handling chat message:', error);
      socket.emit('error', {
        code: 'CHAT_MESSAGE_ERROR',
        message: 'Failed to send message'
      });
    }
  }

  /**
   * Handle typing indicator
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Typing data
   * @param {boolean} isTyping - Whether user is typing
   */
  handleTypingIndicator(socket, data, isTyping) {
    try {
      const { tripId, recipientId } = data;
      const { userId } = socket;

      if (!tripId || !recipientId) {
        return;
      }

      const typingData = {
        tripId,
        userId,
        isTyping,
        timestamp: new Date().toISOString()
      };

      // Send typing indicator to recipient
      this.io.to(`user:${recipientId}`).emit('typing_indicator', typingData);

      // Send typing indicator to trip room
      this.io.to(`trip:${tripId}`).emit('typing_indicator', typingData);

    } catch (error) {
      console.error('Error handling typing indicator:', error);
    }
  }

  /**
   * Handle presence update
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Presence data
   */
  handlePresenceUpdate(socket, data) {
    try {
      const { status, location, tripId } = data;
      const { userId, userType } = socket;

      const presenceData = {
        userId,
        userType,
        status: status || 'online',
        location,
        tripId,
        timestamp: new Date().toISOString()
      };

      // Broadcast presence update to role-based room
      socket.broadcast.to(`role:${userType}`).emit('presence_updated', presenceData);

      // If user is on a trip, notify trip participants
      if (tripId) {
        this.io.to(`trip:${tripId}`).emit('presence_updated', presenceData);
      }

    } catch (error) {
      console.error('Error handling presence update:', error);
    }
  }

  /**
   * Handle booking status update
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Status update data
   */
  handleBookingStatusUpdate(socket, data) {
    try {
      const { bookingId, status, driverInfo, estimatedTime } = data;
      const { userId, userType } = socket;

      if (!bookingId || !status) {
        socket.emit('error', {
          code: 'INVALID_STATUS_DATA',
          message: 'Booking ID and status are required'
        });
        return;
      }

      console.log(`📊 Booking status update: ${bookingId} -> ${status}`);

      // Get booking details to find participants
      this.getBookingParticipants(bookingId).then(participants => {
        const statusUpdateData = {
          bookingId,
          status,
          driverInfo,
          estimatedTime,
          timestamp: new Date().toISOString(),
          updatedBy: userId
        };

        // Broadcast to all booking participants
        participants.forEach(participantId => {
          this.io.to(`user:${participantId}`).emit('booking_status_updated', statusUpdateData);
        });

        // Also broadcast to trip room
        this.io.to(`trip:${bookingId}`).emit('booking_status_updated', statusUpdateData);

        // Send specific notifications based on status
        this.handleStatusSpecificNotifications(bookingId, status, driverInfo, participants);

        // Confirm status update
        socket.emit('status_update_confirmed', {
          success: true,
          message: 'Status update sent successfully',
          data: {
            bookingId,
            status,
            timestamp: new Date().toISOString()
          }
        });
      }).catch(error => {
        console.error('Error getting booking participants:', error);
        socket.emit('error', {
          code: 'STATUS_UPDATE_ERROR',
          message: 'Failed to process status update'
        });
      });

    } catch (error) {
      console.error('Error handling booking status update:', error);
      socket.emit('error', {
        code: 'STATUS_UPDATE_ERROR',
        message: 'Failed to process status update'
      });
    }
  }

  /**
   * Handle driver assignment notification
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Driver assignment data
   */
  handleDriverAssignment(socket, data) {
    try {
      const { bookingId, driverInfo, estimatedArrival } = data;
      const { userId } = socket;

      if (!bookingId || !driverInfo) {
        socket.emit('error', {
          code: 'INVALID_ASSIGNMENT_DATA',
          message: 'Booking ID and driver info are required'
        });
        return;
      }

      console.log(`🚗 Driver assigned to booking: ${bookingId}`);

      const assignmentData = {
        bookingId,
        driver: {
          id: driverInfo.id,
          name: driverInfo.name,
          phone: driverInfo.phone,
          vehicleNumber: driverInfo.vehicleNumber,
          rating: driverInfo.rating,
          currentLocation: driverInfo.currentLocation,
          estimatedArrival
        },
        timestamp: new Date().toISOString()
      };

      // Get booking participants
      this.getBookingParticipants(bookingId).then(participants => {
        // Notify customer about driver assignment
        participants.forEach(participantId => {
          this.io.to(`user:${participantId}`).emit('driver_assigned', assignmentData);
        });

        // Notify driver about new assignment
        this.io.to(`user:${driverInfo.id}`).emit('new_booking_assigned', {
          bookingId,
          customerInfo: participants.find(p => p !== driverInfo.id),
          timestamp: new Date().toISOString()
        });

        // Broadcast to trip room
        this.io.to(`trip:${bookingId}`).emit('driver_assigned', assignmentData);
      });

      // Confirm assignment
      socket.emit('assignment_confirmed', {
        success: true,
        message: 'Driver assignment notification sent',
        data: {
          bookingId,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error handling driver assignment:', error);
      socket.emit('error', {
        code: 'ASSIGNMENT_ERROR',
        message: 'Failed to process driver assignment'
      });
    }
  }

  /**
   * Handle ETA update
   * @param {Socket} socket - Socket instance
   * @param {Object} data - ETA update data
   */
  handleETAUpdate(socket, data) {
    try {
      const { bookingId, etaType, estimatedTime, currentLocation } = data;
      const { userId } = socket;

      if (!bookingId || !etaType || !estimatedTime) {
        socket.emit('error', {
          code: 'INVALID_ETA_DATA',
          message: 'Booking ID, ETA type, and estimated time are required'
        });
        return;
      }

      console.log(`⏰ ETA update for booking ${bookingId}: ${etaType} -> ${estimatedTime}`);

      const etaData = {
        bookingId,
        etaType, // 'pickup' | 'delivery'
        estimatedTime,
        currentLocation,
        timestamp: new Date().toISOString(),
        updatedBy: userId
      };

      // Get booking participants
      this.getBookingParticipants(bookingId).then(participants => {
        // Notify all participants
        participants.forEach(participantId => {
          this.io.to(`user:${participantId}`).emit('eta_updated', etaData);
        });

        // Broadcast to trip room
        this.io.to(`trip:${bookingId}`).emit('eta_updated', etaData);
      });

      // Confirm ETA update
      socket.emit('eta_update_confirmed', {
        success: true,
        message: 'ETA update sent successfully',
        data: {
          bookingId,
          etaType,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error handling ETA update:', error);
      socket.emit('error', {
        code: 'ETA_UPDATE_ERROR',
        message: 'Failed to process ETA update'
      });
    }
  }

  /**
   * Get booking participants (customer and driver)
   * @param {string} bookingId - Booking ID
   * @returns {Promise<Array>} Array of participant user IDs
   */
  async getBookingParticipants(bookingId) {
    try {
      const { getFirestore } = require('./firebase');
      const db = getFirestore();
      
      const bookingDoc = await db.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) {
        return [];
      }

      const bookingData = bookingDoc.data();
      const participants = [bookingData.customerId];

      if (bookingData.driverId) {
        participants.push(bookingData.driverId);
      }

      return participants;
    } catch (error) {
      console.error('Error getting booking participants:', error);
      return [];
    }
  }

  /**
   * Handle status-specific notifications
   * @param {string} bookingId - Booking ID
   * @param {string} status - New status
   * @param {Object} driverInfo - Driver information
   * @param {Array} participants - Booking participants
   */
  handleStatusSpecificNotifications(bookingId, status, driverInfo, participants) {
    try {
      const notificationData = {
        bookingId,
        status,
        timestamp: new Date().toISOString()
      };

      switch (status) {
        case 'driver_assigned':
          // Notify customer about driver assignment
          participants.forEach(participantId => {
            if (participantId !== driverInfo?.id) {
              this.io.to(`user:${participantId}`).emit('driver_assigned_notification', {
                ...notificationData,
                driver: driverInfo
              });
            }
          });
          break;

        case 'driver_enroute':
          // Notify customer that driver is on the way
          participants.forEach(participantId => {
            if (participantId !== driverInfo?.id) {
              this.io.to(`user:${participantId}`).emit('driver_enroute_notification', notificationData);
            }
          });
          break;

        case 'driver_arrived':
          // Notify customer that driver has arrived
          participants.forEach(participantId => {
            if (participantId !== driverInfo?.id) {
              this.io.to(`user:${participantId}`).emit('driver_arrived_notification', notificationData);
            }
          });
          break;

        case 'picked_up':
          // Notify customer that package has been picked up
          participants.forEach(participantId => {
            if (participantId !== driverInfo?.id) {
              this.io.to(`user:${participantId}`).emit('package_picked_up_notification', notificationData);
            }
          });
          break;

        case 'delivered':
          // Notify customer that package has been delivered
          participants.forEach(participantId => {
            if (participantId !== driverInfo?.id) {
              this.io.to(`user:${participantId}`).emit('package_delivered_notification', notificationData);
            }
          });
          break;

        case 'cancelled':
          // Notify all participants about cancellation
          participants.forEach(participantId => {
            this.io.to(`user:${participantId}`).emit('booking_cancelled_notification', notificationData);
          });
          break;
      }
    } catch (error) {
      console.error('Error handling status-specific notifications:', error);
    }
  }

  /**
   * Broadcast tracking event to all subscribers
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  broadcastTrackingEvent(event, data) {
    try {
      const { tripId } = data;
      
      if (!tripId) {
        console.warn('⚠️ No trip ID provided for tracking event broadcast');
        return;
      }

      // Broadcast to trip room
      this.io.to(`trip:${tripId}`).emit(event, data);

      // Also broadcast to specific users if needed
      if (this.trackingSubscriptions.has(tripId)) {
        const userIds = this.trackingSubscriptions.get(tripId);
        for (const userId of userIds) {
          const userSocket = this.connectedUsers.get(userId);
          if (userSocket) {
            userSocket.emit(event, data);
          }
        }
      }

      console.log(`📡 Broadcasted ${event} for trip ${tripId} to ${this.io.sockets.adapter.rooms.get(`trip:${tripId}`)?.size || 0} subscribers`);

    } catch (error) {
      console.error('Error broadcasting tracking event:', error);
    }
  }

  /**
   * Send notification to specific user
   * @param {string} userId - Target user ID
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  sendToUser(userId, event, data) {
    try {
      const userSocket = this.connectedUsers.get(userId);
      if (userSocket) {
        userSocket.emit(event, data);
        console.log(`📤 Sent ${event} to user ${userId}`);
      } else {
        console.log(`⚠️ User ${userId} not connected, cannot send ${event}`);
      }
    } catch (error) {
      console.error(`Error sending ${event} to user ${userId}:`, error);
    }
  }

  /**
   * Send notification to multiple users
   * @param {Array<string>} userIds - Array of user IDs
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  sendToUsers(userIds, event, data) {
    try {
      userIds.forEach(userId => {
        this.sendToUser(userId, event, data);
      });
    } catch (error) {
      console.error(`Error sending ${event} to multiple users:`, error);
    }
  }

  /**
   * Broadcast to all connected users
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  broadcastToAll(event, data) {
    try {
      this.io.emit(event, data);
      console.log(`📡 Broadcasted ${event} to all connected users`);
    } catch (error) {
      console.error(`Error broadcasting ${event} to all users:`, error);
    }
  }

  /**
   * Broadcast to users by role
   * @param {string} role - User role
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  broadcastToRole(role, event, data) {
    try {
      this.io.to(`role:${role}`).emit(event, data);
      console.log(`📡 Broadcasted ${event} to all ${role}s`);
    } catch (error) {
      console.error(`Error broadcasting ${event} to ${role}s:`, error);
    }
  }

  /**
   * Get connection statistics
   * @returns {Object} Connection statistics
   */
  getConnectionStats() {
    try {
      const totalConnections = this.io.engine.clientsCount;
      const totalUsers = this.connectedUsers.size;
      const totalRooms = this.io.sockets.adapter.rooms.size;
      const trackingSubscriptions = this.trackingSubscriptions.size;

      return {
        totalConnections,
        totalUsers,
        totalRooms,
        trackingSubscriptions,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error getting connection stats:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get user connection info
   * @param {string} userId - User ID
   * @returns {Object|null} User connection info
   */
  getUserConnectionInfo(userId) {
    try {
      const socket = this.connectedUsers.get(userId);
      if (!socket) return null;

      const userRooms = this.userRooms.get(userId) || new Set();
      
      return {
        userId,
        userType: socket.userType,
        connected: true,
        connectedAt: socket.handshake.time,
        rooms: Array.from(userRooms),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error(`Error getting connection info for user ${userId}:`, error);
      return null;
    }
  }

  /**
   * Force disconnect user
   * @param {string} userId - User ID to disconnect
   * @param {string} reason - Reason for disconnection
   */
  forceDisconnectUser(userId, reason = 'Admin disconnect') {
    try {
      const socket = this.connectedUsers.get(userId);
      if (socket) {
        socket.emit('force_disconnect', {
          reason,
          timestamp: new Date().toISOString()
        });
        
        setTimeout(() => {
          socket.disconnect(true);
        }, 1000);

        console.log(`🔌 Force disconnected user ${userId}: ${reason}`);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error force disconnecting user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Clean up expired connections
   * @param {number} maxAge - Maximum age in milliseconds
   */
  cleanupExpiredConnections(maxAge = 24 * 60 * 60 * 1000) { // 24 hours
    try {
      const now = Date.now();
      const expiredUsers = [];

      for (const [userId, socket] of this.connectedUsers.entries()) {
        if (now - socket.handshake.time > maxAge) {
          expiredUsers.push(userId);
        }
      }

      expiredUsers.forEach(userId => {
        this.forceDisconnectUser(userId, 'Connection expired');
      });

      if (expiredUsers.length > 0) {
        console.log(`🧹 Cleaned up ${expiredUsers.length} expired connections`);
      }

    } catch (error) {
      console.error('Error cleaning up expired connections:', error);
    }
  }
}

module.exports = WebSocketService;
