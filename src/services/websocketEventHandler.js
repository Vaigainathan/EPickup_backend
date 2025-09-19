const { getFirestore } = require('./firebase');
const firestoreSessionService = require('./firestoreSessionService');

/**
 * WebSocket Event Handler Service
 * Manages all Socket.IO events for real-time communication
 */
class WebSocketEventHandler {
  constructor() {
    this.db = null;
    this.firestoreSessionService = firestoreSessionService;
    this.realTimeService = null;
    this.io = null;
  }

  /**
   * Initialize the event handler service
   */
  async initialize() {
    try {
      this.db = getFirestore();
      
      // Firestore Session Service is already initialized
      console.log('✅ Firestore Session Service connected for WebSocket handler');
      
      // Try to initialize RealTimeService, but don't fail if it's not available
      try {
        const RealTimeService = require('./realTimeService');
        this.realTimeService = new RealTimeService();
        await this.realTimeService.initialize();
        console.log('✅ RealTimeService initialized for WebSocket handler');
      } catch {
        console.log('⚠️  RealTimeService not available for WebSocket handler, continuing without it...');
        this.realTimeService = null;
      }
      
      console.log('✅ WebSocket event handler initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize WebSocket event handler:', error);
      throw error;
    }
  }

  /**
   * Set the Socket.IO instance
   * @param {Object} io - Socket.IO instance
   */
  setIO(io) {
    this.io = io;
    console.log('✅ Socket.IO instance set in WebSocket event handler');
  }

  /**
   * Handle user connection
   * @param {Socket} socket - Socket instance
   */
  async handleConnection(socket) {
    try {
      const { userId, userType, userRole } = socket;

      console.log(`🔌 User connected: ${userId} (${userType})`);

      // Join user-specific room
      socket.join(`user:${userId}`);
      
      // Join role-based room
      socket.join(`role:${userRole}`);
      
      // Join user type room
      socket.join(`type:${userType}`);

      // Send connection confirmation
      socket.emit('connected', {
        success: true,
        message: 'Connected to EPickup real-time service',
        data: {
          userId,
          userType,
          userRole,
          timestamp: new Date().toISOString()
        }
      });

      // Send authentication status update
      socket.emit('auth_status_update', {
        isAuthenticated: true,
        user: {
          id: userId,
          userType: userType,
          role: userRole
        },
        timestamp: new Date().toISOString()
      });

      // Update user online status
      await this.updateUserOnlineStatus(userId, true);

      // Send user's active trips if any
      await this.sendActiveTrips(socket, userId);

      console.log(`✅ User ${userId} connection handled successfully`);

    } catch (error) {
      console.error('Error handling connection:', error);
      socket.emit('error', {
        code: 'CONNECTION_ERROR',
        message: 'Failed to establish connection'
      });
    }
  }

  /**
   * Handle user disconnection
   * @param {Socket} socket - Socket instance
   */
  async handleDisconnection(socket) {
    try {
      const { userId, userType } = socket;

      console.log(`🔌 User disconnected: ${userId} (${userType})`);

      // Update user online status
      await this.updateUserOnlineStatus(userId, false);

      // Leave all rooms
      socket.rooms.forEach(room => {
        if (room !== socket.id) {
          socket.leave(room);
        }
      });

      // Notify other users about disconnection
      socket.broadcast.to(`type:${userType}`).emit('user_disconnected', {
        userId,
        userType,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ User ${userId} disconnection handled successfully`);

    } catch (error) {
      console.error('Error handling disconnection:', error);
    }
  }

  /**
   * Handle tracking subscription
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Subscription data
   */
  async handleTrackingSubscription(socket, data) {
    try {
      const { tripId, userId, userType } = data; // eslint-disable-line no-unused-vars

      if (!tripId || !userId) {
        socket.emit('error', {
          code: 'INVALID_DATA',
          message: 'Trip ID and User ID are required'
        });
        return;
      }

      // Verify user has access to this trip
      const hasAccess = await this.verifyTripAccess(userId, tripId);
      if (!hasAccess) {
        socket.emit('error', {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to this trip'
        });
        return;
      }

      // Join trip-specific room
      socket.join(`trip:${tripId}`);

      // Store subscription in Firestore
      await this.firestoreSessionService.setCache(`trip_subscribers:${tripId}`, {
        subscribers: [userId],
        tripId,
        subscribedAt: new Date()
      }, 3600); // 1 hour expiry

      // Send current trip status
      await this.sendCurrentTripStatus(socket, tripId);

      console.log(`✅ User ${userId} subscribed to trip ${tripId}`);

      socket.emit('tracking_subscribed', {
        success: true,
        message: 'Successfully subscribed to trip tracking',
        data: { tripId, userId }
      });

    } catch (error) {
      console.error('Error handling tracking subscription:', error);
      socket.emit('error', {
        code: 'SUBSCRIPTION_ERROR',
        message: 'Failed to subscribe to trip tracking'
      });
    }
  }

  /**
   * Handle tracking unsubscription
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Unsubscription data
   */
  async handleTrackingUnsubscription(socket, data) {
    try {
      const { tripId, userId } = data;

      if (!tripId || !userId) {
        socket.emit('error', {
          code: 'INVALID_DATA',
          message: 'Trip ID and User ID are required'
        });
        return;
      }

      // Leave trip-specific room
      socket.leave(`trip:${tripId}`);

      // Remove subscription from Firestore
      const cacheData = await this.firestoreSessionService.getCache(`trip_subscribers:${tripId}`);
      if (cacheData.success && cacheData.data) {
        const updatedSubscribers = cacheData.data.subscribers.filter(id => id !== userId);
        if (updatedSubscribers.length > 0) {
          await this.firestoreSessionService.setCache(`trip_subscribers:${tripId}`, {
            ...cacheData.data,
            subscribers: updatedSubscribers
          }, 3600);
        } else {
          await this.firestoreSessionService.deleteCache(`trip_subscribers:${tripId}`);
        }
      }

      console.log(`✅ User ${userId} unsubscribed from trip ${tripId}`);

      socket.emit('tracking_unsubscribed', {
        success: true,
        message: 'Successfully unsubscribed from trip tracking',
        data: { tripId, userId }
      });

    } catch (error) {
      console.error('Error handling tracking unsubscription:', error);
      socket.emit('error', {
        code: 'UNSUBSCRIPTION_ERROR',
        message: 'Failed to unsubscribe from trip tracking'
      });
    }
  }

  /**
   * Handle location update from driver app
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Location data
   */
  async handleLocationUpdate(socket, data) {
    try {
      const { tripId, location } = data;
      const { userId, userType } = socket;

      if (!tripId || !location) {
        socket.emit('error', {
          code: 'INVALID_LOCATION_DATA',
          message: 'Trip ID and location data are required'
        });
        return;
      }

      // Verify user is a driver and has access to this trip
      if (userType !== 'driver') {
        socket.emit('error', {
          code: 'ACCESS_DENIED',
          message: 'Only drivers can update location'
        });
        return;
      }

      const hasAccess = await this.verifyTripAccess(userId, tripId);
      if (!hasAccess) {
        socket.emit('error', {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to update location for this trip'
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

      // Send location update via real-time service
      await this.realTimeService.sendLocationUpdate(tripId, userId, location);

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
  async handleChatMessage(socket, data) {
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

      // Verify user has access to this trip
      const hasAccess = await this.verifyTripAccess(userId, tripId);
      if (!hasAccess) {
        socket.emit('error', {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to send messages for this trip'
        });
        return;
      }

      // Validate message length
      if (message.trim().length === 0 || message.length > 500) {
        socket.emit('error', {
          code: 'INVALID_MESSAGE',
          message: 'Message must be between 1 and 500 characters'
        });
        return;
      }

      console.log(`💬 Chat message from ${userId} to ${recipientId} for trip ${tripId}`);

      // Send chat message via real-time service
      const messageId = await this.realTimeService.sendChatMessage(
        tripId, 
        userId, 
        userType, 
        message, 
        { recipientId }
      );

      if (messageId) {
        // Confirm message sent
        socket.emit('message_sent', {
          success: true,
          message: 'Message sent successfully',
          data: {
            messageId,
            timestamp: new Date().toISOString()
          }
        });
      } else {
        throw new Error('Failed to send message');
      }

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
  async handleTypingIndicator(socket, data, isTyping) {
    try {
      const { tripId, recipientId } = data;
      const { userId, userType } = socket;

      if (!tripId || !recipientId) {
        return;
      }

      // Verify user has access to this trip
      const hasAccess = await this.verifyTripAccess(userId, tripId);
      if (!hasAccess) {
        return;
      }

      // Send typing indicator via real-time service
      await this.realTimeService.sendTypingIndicator(tripId, userId, userType, isTyping);

    } catch (error) {
      console.error('Error handling typing indicator:', error);
    }
  }

  /**
   * Handle presence update
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Presence data
   */
  async handlePresenceUpdate(socket, data) {
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

      // Store presence in Firestore
      await this.firestoreSessionService.setCache(`presence:${userId}`, presenceData, 300); // 5 minutes expiry

      // Broadcast presence update to role-based room
      socket.broadcast.to(`type:${userType}`).emit('presence_updated', presenceData);

      // If user is on a trip, notify trip participants
      if (tripId) {
        socket.to(`trip:${tripId}`).emit('presence_updated', presenceData);
      }

    } catch (error) {
      console.error('Error handling presence update:', error);
    }
  }

  /**
   * Handle emergency alert
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Emergency data
   */
  async handleEmergencyAlert(socket, data) {
    try {
      const { tripId, alertType, alertData } = data;
      const { userId, userType } = socket;

      if (!tripId || !alertType) {
        socket.emit('error', {
          code: 'INVALID_EMERGENCY_DATA',
          message: 'Trip ID and alert type are required'
        });
        return;
      }

      // Verify user has access to this trip
      const hasAccess = await this.verifyTripAccess(userId, tripId);
      if (!hasAccess) {
        socket.emit('error', {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to send emergency alerts for this trip'
        });
        return;
      }

      console.log(`🚨 Emergency alert from ${userId} for trip ${tripId}: ${alertType}`);

      // Send emergency alert via real-time service
      await this.realTimeService.sendEmergencyAlert(tripId, alertType, {
        ...alertData,
        reportedBy: userId,
        userType
      });

      // Confirm emergency alert
      socket.emit('emergency_alert_sent', {
        success: true,
        message: 'Emergency alert sent successfully',
        data: {
          tripId,
          alertType,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error handling emergency alert:', error);
      socket.emit('error', {
        code: 'EMERGENCY_ALERT_ERROR',
        message: 'Failed to send emergency alert'
      });
    }
  }

  /**
   * Handle trip status update request
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Status update data
   */
  async handleTripStatusUpdate(socket, data) {
    try {
      const { tripId, status, additionalData } = data;
      const { userId, userType } = socket;

      if (!tripId || !status) {
        socket.emit('error', {
          code: 'INVALID_STATUS_DATA',
          message: 'Trip ID and status are required'
        });
        return;
      }

      // Verify user has access to this trip
      const hasAccess = await this.verifyTripAccess(userId, tripId);
      if (!hasAccess) {
        socket.emit('error', {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to update status for this trip'
        });
        return;
      }

      console.log(`🔄 Trip status update request from ${userId} for trip ${tripId}: ${status}`);

      // Send trip status update via real-time service
      await this.realTimeService.sendTripStatusUpdate(tripId, status, {
        ...additionalData,
        updatedBy: userId,
        userType
      });

      // Confirm status update
      socket.emit('trip_status_update_confirmed', {
        success: true,
        message: 'Trip status update sent successfully',
        data: {
          tripId,
          status,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Error handling trip status update:', error);
      socket.emit('error', {
        code: 'STATUS_UPDATE_ERROR',
        message: 'Failed to update trip status'
      });
    }
  }

  /**
   * Update user online status
   * @param {string} userId - User ID
   * @param {boolean} isOnline - Online status
   */
  async updateUserOnlineStatus(userId, isOnline) {
    try {
      // Store online status in Firestore
      await this.firestoreSessionService.setCache(`user_online:${userId}`, {
        isOnline,
        updatedAt: new Date()
      }, 300); // 5 minutes expiry

      if (this.db) {
        await this.db.collection('users').doc(userId).update({
          isOnline,
          lastSeen: new Date()
        });
      }

    } catch (error) {
      console.error('Error updating user online status:', error);
    }
  }

  /**
   * Send user's active trips
   * @param {Socket} socket - Socket instance
   * @param {string} userId - User ID
   */
  async sendActiveTrips(socket, userId) {
    try {
      if (!this.db) return;

      // Get user's active trips
      const tripsQuery = await this.db.collection('bookings')
        .where('status', 'in', ['driver_assigned', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit'])
        .where('customerId', '==', userId)
        .get();

      const driverTripsQuery = await this.db.collection('bookings')
        .where('status', 'in', ['driver_assigned', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit'])
        .where('driverId', '==', userId)
        .get();

      const activeTrips = [];

      // Add customer trips
      tripsQuery.forEach(doc => {
        activeTrips.push({
          id: doc.id,
          role: 'customer',
          ...doc.data()
        });
      });

      // Add driver trips
      driverTripsQuery.forEach(doc => {
        activeTrips.push({
          id: doc.id,
          role: 'driver',
          ...doc.data()
        });
      });

      if (activeTrips.length > 0) {
        socket.emit('active_trips', {
          success: true,
          data: {
            trips: activeTrips,
            timestamp: new Date().toISOString()
          }
        });
      }

    } catch (error) {
      console.error('Error sending active trips:', error);
    }
  }

  /**
   * Send current trip status
   * @param {Socket} socket - Socket instance
   * @param {string} tripId - Trip ID
   */
  async sendCurrentTripStatus(socket, tripId) {
    try {
      const tripData = await this.realTimeService.getRealTimeTripData(tripId);
      if (tripData) {
        socket.emit('current_trip_status', {
          success: true,
          data: {
            tripId,
            status: tripData,
            timestamp: new Date().toISOString()
          }
        });
      }
    } catch (error) {
      console.error('Error sending current trip status:', error);
    }
  }

  /**
   * Verify user has access to trip
   * @param {string} userId - User ID
   * @param {string} tripId - Trip ID
   * @returns {boolean} Access verification result
   */
  async verifyTripAccess(userId, tripId) {
    try {
      if (!this.db) return false;

      const tripDoc = await this.db.collection('bookings').doc(tripId).get();
      if (!tripDoc.exists) return false;

      const tripData = tripDoc.data();
      return tripData.customerId === userId || tripData.driverId === userId;

    } catch (error) {
      console.error('Error verifying trip access:', error);
      return false;
    }
  }

  /**
   * Handle room join request
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Room join data
   */
  async handleRoomJoin(socket, data) {
    try {
      const { room } = data;
      const { userId, userType, userRole } = socket;

      if (!room) {
        socket.emit('error', {
          code: 'INVALID_ROOM',
          message: 'Room name is required'
        });
        return;
      }

      // Check if user has permission to join this room
      const hasPermission = this.checkRoomPermission(userType, userRole, room);
      if (!hasPermission) {
        socket.emit('error', {
          code: 'ROOM_ACCESS_DENIED',
          message: 'You do not have permission to join this room'
        });
        return;
      }

      // Join the room
      socket.join(room);
      socket.userRooms.add(room);

      console.log(`🚪 User ${userId} joined room: ${room}`);

      // Send confirmation
      socket.emit('room_joined', {
        success: true,
        room: room,
        message: `Successfully joined room: ${room}`
      });

    } catch (error) {
      console.error('Error handling room join:', error);
      socket.emit('error', {
        code: 'ROOM_JOIN_ERROR',
        message: 'Failed to join room'
      });
    }
  }

  /**
   * Handle room leave request
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Room leave data
   */
  async handleRoomLeave(socket, data) {
    try {
      const { room } = data;
      const { userId } = socket;

      if (!room) {
        socket.emit('error', {
          code: 'INVALID_ROOM',
          message: 'Room name is required'
        });
        return;
      }

      // Leave the room
      socket.leave(room);
      socket.userRooms.delete(room);

      console.log(`🚪 User ${userId} left room: ${room}`);

      // Send confirmation
      socket.emit('room_left', {
        success: true,
        room: room,
        message: `Successfully left room: ${room}`
      });

    } catch (error) {
      console.error('Error handling room leave:', error);
      socket.emit('error', {
        code: 'ROOM_LEAVE_ERROR',
        message: 'Failed to leave room'
      });
    }
  }

  /**
   * Handle leave all rooms request
   * @param {Socket} socket - Socket instance
   */
  async handleLeaveAllRooms(socket) {
    try {
      const { userId } = socket;

      // Leave all rooms except the default socket room
      socket.rooms.forEach(room => {
        if (room !== socket.id) {
          socket.leave(room);
        }
      });

      // Clear user rooms set
      socket.userRooms.clear();

      console.log(`🚪 User ${userId} left all rooms`);

      // Send confirmation
      socket.emit('all_rooms_left', {
        success: true,
        message: 'Successfully left all rooms'
      });

    } catch (error) {
      console.error('Error handling leave all rooms:', error);
      socket.emit('error', {
        code: 'LEAVE_ALL_ROOMS_ERROR',
        message: 'Failed to leave all rooms'
      });
    }
  }

  /**
   * Check if user has permission to join a room
   * @param {string} userType - User type
   * @param {string} userRole - User role
   * @param {string} room - Room name
   * @returns {boolean} Permission result
   */
  checkRoomPermission(userType, userRole, room) {
    // Admin can join any room
    if (userType === 'admin' || userRole === 'admin') {
      return true;
    }

    // Customer can join customer-specific rooms
    if (userType === 'customer') {
      return room.startsWith('customer_') || room.startsWith('user_') || room.startsWith('booking_');
    }

    // Driver can join driver-specific rooms
    if (userType === 'driver') {
      return room.startsWith('driver_') || room.startsWith('user_') || room.startsWith('booking_') || room.startsWith('location_');
    }

    return false;
  }

  /**
   * Get user's FCM token
   * @param {string} userId - User ID
   * @returns {string|null} FCM token
   */
  async getUserFCMToken(userId) {
    try {
      if (!this.db) return null;

      const userDoc = await this.db.collection('users').doc(userId).get();
      if (!userDoc.exists) return null;

      const userData = userDoc.data();
      return userData.fcmToken || null;

    } catch (error) {
      console.error('Error getting user FCM token:', error);
      return null;
    }
  }

  /**
   * Handle session expiration
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Session data
   */
  async handleSessionExpiration(socket, data) {
    try {
      const { userId, reason = 'Session expired' } = data;

      console.log(`🔐 Session expired for user: ${userId}`);

      // Notify user about session expiration
      socket.emit('session_expired', {
        reason,
        timestamp: new Date().toISOString()
      });

      // Disconnect user after a short delay
      setTimeout(() => {
        socket.disconnect(true);
      }, 1000);

    } catch (error) {
      console.error('Error handling session expiration:', error);
    }
  }

  /**
   * Handle token refresh
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Token data
   */
  async handleTokenRefresh(socket, data) {
    try {
      const { userId, newToken } = data;

      console.log(`🔄 Token refreshed for user: ${userId}`);

      // Notify user about token refresh
      socket.emit('token_refresh', {
        success: true,
        newToken,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error handling token refresh:', error);
      socket.emit('token_refresh', {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Handle force logout
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Logout data
   */
  async handleForceLogout(socket, data) {
    try {
      const { userId, reason = 'Admin logout' } = data;

      console.log(`🔐 Force logout for user: ${userId}`);

      // Notify user about force logout
      socket.emit('force_logout', {
        reason,
        timestamp: new Date().toISOString()
      });

      // Disconnect user after a short delay
      setTimeout(() => {
        socket.disconnect(true);
      }, 1000);

    } catch (error) {
      console.error('Error handling force logout:', error);
    }
  }

  /**
   * Send authentication status update to user
   * @param {string} userId - User ID
   * @param {Object} authData - Authentication data
   */
  async sendAuthStatusUpdate(userId, authData) {
    try {
      const { getSocketIO } = require('./socket');
      const io = getSocketIO();

      io.to(`user:${userId}`).emit('auth_status_update', {
        isAuthenticated: authData.isAuthenticated,
        user: authData.user,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Auth status update sent to user: ${userId}`);

    } catch (error) {
      console.error('Error sending auth status update:', error);
    }
  }

  /**
   * Handle booking acceptance
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Booking acceptance data
   */
  async handleBookingAcceptance(socket, data) {
    try {
      const { bookingId } = data;
      const { userId, userType } = socket;

      if (userType !== 'driver') {
        socket.emit('error', {
          code: 'ACCESS_DENIED',
          message: 'Only drivers can accept bookings'
        });
        return;
      }

      if (!bookingId) {
        socket.emit('error', {
          code: 'INVALID_BOOKING_ID',
          message: 'Booking ID is required'
        });
        return;
      }

      console.log(`✅ Driver ${userId} accepting booking ${bookingId}`);

      // Update booking status in Firestore
      const bookingRef = this.db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();

      if (!bookingDoc.exists) {
        socket.emit('error', {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found'
        });
        return;
      }

      const bookingData = bookingDoc.data();
      
      // Check if booking is still available
      if (bookingData.status !== 'pending') {
        socket.emit('error', {
          code: 'BOOKING_NOT_AVAILABLE',
          message: 'Booking is no longer available'
        });
        return;
      }

      // Update booking with driver assignment
      await bookingRef.update({
        status: 'accepted',
        driverId: userId,
        acceptedAt: new Date(),
        updatedAt: new Date()
      });

      // Create booking status update
      const statusUpdate = {
        bookingId,
        status: 'accepted',
        driverId: userId,
        timestamp: new Date().toISOString(),
        updatedBy: userId
      };

      // Store status update
      await this.db.collection('booking_status_updates').add(statusUpdate);

      // Notify customer
      this.io.to(`user:${bookingData.customerId}`).emit('booking_accepted', {
        bookingId,
        driverId: userId,
        timestamp: new Date().toISOString()
      });

      // Notify admin
      this.io.to(`type:admin`).emit('booking_status_update', statusUpdate);

      // Confirm acceptance
      socket.emit('booking_accepted_confirmed', {
        success: true,
        message: 'Booking accepted successfully',
        data: { bookingId, driverId: userId }
      });

    } catch (error) {
      console.error('Error handling booking acceptance:', error);
      socket.emit('error', {
        code: 'BOOKING_ACCEPTANCE_ERROR',
        message: 'Failed to accept booking'
      });
    }
  }

  /**
   * Handle booking rejection
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Booking rejection data
   */
  async handleBookingRejection(socket, data) {
    try {
      const { bookingId, reason } = data;
      const { userId, userType } = socket;

      if (userType !== 'driver') {
        socket.emit('error', {
          code: 'ACCESS_DENIED',
          message: 'Only drivers can reject bookings'
        });
        return;
      }

      if (!bookingId) {
        socket.emit('error', {
          code: 'INVALID_BOOKING_ID',
          message: 'Booking ID is required'
        });
        return;
      }

      console.log(`❌ Driver ${userId} rejecting booking ${bookingId}: ${reason || 'No reason provided'}`);

      // Update booking status in Firestore
      const bookingRef = this.db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();

      if (!bookingDoc.exists) {
        socket.emit('error', {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found'
        });
        return;
      }

      const bookingData = bookingDoc.data();
      
      // Update booking with rejection
      await bookingRef.update({
        status: 'rejected',
        rejectedBy: userId,
        rejectionReason: reason || 'No reason provided',
        rejectedAt: new Date(),
        updatedAt: new Date()
      });

      // Create booking status update
      const statusUpdate = {
        bookingId,
        status: 'rejected',
        driverId: userId,
        reason: reason || 'No reason provided',
        timestamp: new Date().toISOString(),
        updatedBy: userId
      };

      // Store status update
      await this.db.collection('booking_status_updates').add(statusUpdate);

      // Notify customer
      this.io.to(`user:${bookingData.customerId}`).emit('booking_rejected', {
        bookingId,
        driverId: userId,
        reason: reason || 'No reason provided',
        timestamp: new Date().toISOString()
      });

      // Notify admin
      this.io.to(`type:admin`).emit('booking_status_update', statusUpdate);

      // Confirm rejection
      socket.emit('booking_rejected_confirmed', {
        success: true,
        message: 'Booking rejected successfully',
        data: { bookingId, driverId: userId }
      });

    } catch (error) {
      console.error('Error handling booking rejection:', error);
      socket.emit('error', {
        code: 'BOOKING_REJECTION_ERROR',
        message: 'Failed to reject booking'
      });
    }
  }

  /**
   * Handle driver status update
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Driver status data
   */
  async handleDriverStatusUpdate(socket, data) {
    try {
      const { isOnline, isAvailable, currentLocation } = data;
      const { userId, userType } = socket;

      if (userType !== 'driver') {
        socket.emit('error', {
          code: 'ACCESS_DENIED',
          message: 'Only drivers can update status'
        });
        return;
      }

      const statusData = {
        driverId: userId,
        isOnline: Boolean(isOnline),
        isAvailable: Boolean(isAvailable),
        currentLocation: currentLocation || null,
        lastSeen: new Date(),
        timestamp: new Date().toISOString()
      };

      console.log(`👤 Driver status update from ${userId}:`, statusData);

      // Update driver status in Firestore
      await this.db.collection('driver_status').doc(userId).set(statusData, { merge: true });

      // Update driver location if provided
      if (currentLocation) {
        await this.db.collection('driver_locations').doc(userId).set({
          driverId: userId,
          location: currentLocation,
          timestamp: new Date().toISOString()
        }, { merge: true });
      }

      // Broadcast status update to relevant users
      this.io.to(`type:admin`).emit('driver_status_update', statusData);

      // Confirm status update
      socket.emit('driver_status_confirmed', {
        success: true,
        message: 'Driver status updated successfully',
        data: statusData
      });

    } catch (error) {
      console.error('Error handling driver status update:', error);
      socket.emit('error', {
        code: 'DRIVER_STATUS_ERROR',
        message: 'Failed to update driver status'
      });
    }
  }

  /**
   * Handle booking status update
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Booking status data
   */
  async handleBookingStatusUpdate(socket, data) {
    try {
      const { bookingId, status, message } = data;
      const { userId, userType } = socket;

      if (!bookingId || !status) {
        socket.emit('error', {
          code: 'INVALID_BOOKING_DATA',
          message: 'Booking ID and status are required'
        });
        return;
      }

      // Verify user has access to this booking
      const hasAccess = await this.verifyBookingAccess(userId, bookingId);
      if (!hasAccess) {
        socket.emit('error', {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to this booking'
        });
        return;
      }

      console.log(`📊 Booking status update from ${userType} ${userId} for booking ${bookingId}: ${status}`);

      // Update booking status in Firestore
      const bookingRef = this.db.collection('bookings').doc(bookingId);
      await bookingRef.update({
        status,
        updatedAt: new Date(),
        lastUpdatedBy: userId
      });

      // Create status update record
      const statusUpdate = {
        bookingId,
        status,
        message: message || null,
        updatedBy: userId,
        userType,
        timestamp: new Date().toISOString()
      };

      await this.db.collection('booking_status_updates').add(statusUpdate);

      // Get booking data for notifications
      const bookingDoc = await bookingRef.get();
      const bookingData = bookingDoc.data();

      // Notify relevant parties
      if (bookingData.customerId) {
        this.io.to(`user:${bookingData.customerId}`).emit('booking_status_update', statusUpdate);
      }

      if (bookingData.driverId) {
        this.io.to(`user:${bookingData.driverId}`).emit('booking_status_update', statusUpdate);
      }

      // Notify admin
      this.io.to(`type:admin`).emit('booking_status_update', statusUpdate);

      // Confirm status update
      socket.emit('booking_status_confirmed', {
        success: true,
        message: 'Booking status updated successfully',
        data: statusUpdate
      });

    } catch (error) {
      console.error('Error handling booking status update:', error);
      socket.emit('error', {
        code: 'BOOKING_STATUS_ERROR',
        message: 'Failed to update booking status'
      });
    }
  }

  /**
   * Handle ETA update
   * @param {Socket} socket - Socket instance
   * @param {Object} data - ETA data
   */
  async handleETAUpdate(socket, data) {
    try {
      const { bookingId, eta } = data;
      const { userId, userType } = socket;

      if (!bookingId || typeof eta !== 'number') {
        socket.emit('error', {
          code: 'INVALID_ETA_DATA',
          message: 'Booking ID and valid ETA are required'
        });
        return;
      }

      // Verify user has access to this booking
      const hasAccess = await this.verifyBookingAccess(userId, bookingId);
      if (!hasAccess) {
        socket.emit('error', {
          code: 'ACCESS_DENIED',
          message: 'You do not have access to this booking'
        });
        return;
      }

      console.log(`⏰ ETA update from ${userType} ${userId} for booking ${bookingId}: ${eta} minutes`);

      // Update booking ETA in Firestore
      const bookingRef = this.db.collection('bookings').doc(bookingId);
      await bookingRef.update({
        estimatedArrival: eta,
        etaUpdatedAt: new Date(),
        etaUpdatedBy: userId
      });

      // Create ETA update record
      const etaUpdate = {
        bookingId,
        eta,
        updatedBy: userId,
        userType,
        timestamp: new Date().toISOString()
      };

      await this.db.collection('eta_updates').add(etaUpdate);

      // Get booking data for notifications
      const bookingDoc = await bookingRef.get();
      const bookingData = bookingDoc.data();

      // Notify relevant parties
      if (bookingData.customerId) {
        this.io.to(`user:${bookingData.customerId}`).emit('eta_updated', etaUpdate);
      }

      if (bookingData.driverId && bookingData.driverId !== userId) {
        this.io.to(`user:${bookingData.driverId}`).emit('eta_updated', etaUpdate);
      }

      // Notify admin
      this.io.to(`type:admin`).emit('eta_updated', etaUpdate);

      // Confirm ETA update
      socket.emit('eta_updated_confirmed', {
        success: true,
        message: 'ETA updated successfully',
        data: etaUpdate
      });

    } catch (error) {
      console.error('Error handling ETA update:', error);
      socket.emit('error', {
        code: 'ETA_UPDATE_ERROR',
        message: 'Failed to update ETA'
      });
    }
  }

  /**
   * Health check
   * @returns {Object} Health status
   */
  async healthCheck() {
    try {
      const status = {
        service: 'WebSocketEventHandler',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        components: {
          firestore: this.db ? 'connected' : 'disconnected',
          firestoreSession: this.firestoreSessionService ? 'connected' : 'disconnected',
          realTimeService: this.realTimeService ? 'connected' : 'disconnected'
        }
      };

      return status;

    } catch (error) {
      return {
        service: 'WebSocketEventHandler',
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

module.exports = WebSocketEventHandler;
