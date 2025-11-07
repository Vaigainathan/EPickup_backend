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
      const userId = socket.userId;
      const userType = socket.userType;
      const userRole = socket.userRole;

      // ✅ CRITICAL FIX: Check if userId is valid
      if (!userId) {
        console.error('❌ No userId found in socket, skipping connection handling');
        socket.emit('error', {
          code: 'AUTHENTICATION_ERROR',
          message: 'User ID not found in socket'
        });
        return;
      }

      console.log(`🔌 User connected: ${userId} (${userType})`);

      // ✅ CRITICAL FIX: Leave all previous rooms to prevent data conflicts
      const currentRooms = Array.from(socket.rooms);
      currentRooms.forEach(room => {
        if (room !== socket.id) { // Don't leave the socket's own room
          socket.leave(room);
        }
      });
      
      // Join user-specific room
      socket.join(`user:${userId}`);
      
      // Join role-based room
      socket.join(`role:${userRole}`);
      
      // Join user type room
      socket.join(`type:${userType}`);
      
      console.log(`✅ [WebSocket] User ${userId} joined rooms: user:${userId}, role:${userRole}, type:${userType}`);

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

      // ✅ CRITICAL FIX: Don't auto-offline drivers on WebSocket disconnect
      // Drivers should only go offline explicitly (user action) or via timeout (inactivity)
      // WebSocket disconnect can happen due to network issues, app force close, etc.
      // Only update lastSeen timestamp, preserve driver.isOnline status
      if (userType === 'driver') {
        console.log(`✅ [WEBSOCKET] Driver disconnected - preserving online status, only updating lastSeen`);
        
        if (this.db) {
          // ✅ CRITICAL FIX: Check if driver has active bookings before any status changes
          // If driver has active booking, they MUST stay online (cannot go offline)
          const activeBookingStatuses = ['driver_assigned', 'accepted', 'driver_enroute', 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff', 'delivered', 'money_collection'];
          const activeBookingQuery = this.db.collection('bookings')
            .where('driverId', '==', userId)
            .where('status', 'in', activeBookingStatuses)
            .limit(1);
          
          const activeBookingSnapshot = await activeBookingQuery.get();
          const hasActiveBooking = !activeBookingSnapshot.empty;
          
          if (hasActiveBooking) {
            const activeBooking = activeBookingSnapshot.docs[0].data();
            console.log(`✅ [WEBSOCKET] Driver ${userId} has active booking - preserving online status (booking: ${activeBookingSnapshot.docs[0].id}, status: ${activeBooking.status})`);
            
            // ✅ CRITICAL: Force driver to stay online if they have active booking
            await this.db.collection('users').doc(userId).set({
              'driver.isOnline': true, // Force online
              'driver.isAvailable': false, // Not available for new bookings while delivering
              'driver.lastSeen': new Date(),
              updatedAt: new Date()
            }, { merge: true });
          } else {
            // ✅ CRITICAL FIX: No active booking - preserve BOTH isOnline AND isAvailable status
            // Just update lastSeen, preserve ALL current driver status (isOnline, isAvailable)
            // This ensures driver status persists correctly after app force-kill
            const userDoc = await this.db.collection('users').doc(userId).get();
            const currentData = userDoc.data();
            
            // Only update lastSeen - preserve isOnline and isAvailable as-is
            await this.db.collection('users').doc(userId).set({
              'driver.lastSeen': new Date(),
              updatedAt: new Date()
              // ✅ CRITICAL: Don't touch isOnline or isAvailable - preserve them exactly as they were
            }, { merge: true });
            
            console.log(`✅ [WEBSOCKET] Driver ${userId} disconnected - preserved status: isOnline=${currentData?.driver?.isOnline}, isAvailable=${currentData?.driver?.isAvailable}`);
          }
          
          // Update cache with lastSeen only (preserve online status in cache)
          await this.firestoreSessionService.setCache(`user_online:${userId}`, {
            lastSeen: new Date(),
            updatedAt: new Date(),
            hasActiveBooking
          }, 300); // 5 minutes expiry
        }
      } else {
        // For non-drivers (customers), update online status normally
        await this.updateUserOnlineStatus(userId, false);
      }

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
      // ✅ CRITICAL FIX: Don't update driver.isOnline via WebSocket
      // Drivers should only update status via explicit API call (PUT /api/driver/status)
      // This prevents WebSocket disconnect from incorrectly setting drivers offline
      
      // Check if user is a driver
      if (this.db) {
        const userDoc = await this.db.collection('users').doc(userId).get();
        if (userDoc.exists) {
          const userData = userDoc.data();
          if (userData.userType === 'driver' || userData.driver) {
            console.log(`✅ [WEBSOCKET] Skipping isOnline update for driver ${userId} - drivers must use explicit status API`);
            // Only update lastSeen for drivers, don't touch driver.isOnline
            await this.db.collection('users').doc(userId).set({
              'driver.lastSeen': new Date(),
              updatedAt: new Date()
            }, { merge: true });
            
            // Update cache with lastSeen only
            await this.firestoreSessionService.setCache(`user_online:${userId}`, {
              lastSeen: new Date(),
              updatedAt: new Date()
            }, 300);
            return; // Exit early - don't update isOnline for drivers
          }
        }
      }

      // For non-drivers (customers), update online status normally
      await this.firestoreSessionService.setCache(`user_online:${userId}`, {
        isOnline,
        updatedAt: new Date()
      }, 300); // 5 minutes expiry

      if (this.db) {
        // Use set with merge to create document if it doesn't exist
        await this.db.collection('users').doc(userId).set({
          isOnline,
          lastSeen: new Date()
        }, { merge: true });
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

      // ✅ CRITICAL FIX: Check if userId is valid
      if (!userId) {
        console.warn('⚠️ No userId provided for sendActiveTrips');
        return;
      }

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

      console.log(`✅ Driver ${userId} accepting booking ${bookingId} via WebSocket`);

      // ✅ CRITICAL FIX: Use BookingLockService for atomic locking
      const BookingLockService = require('./bookingLockService');
      const bookingLockService = new BookingLockService();

      // Acquire exclusive lock for booking acceptance
      try {
        await bookingLockService.acquireBookingLock(bookingId, userId);
      } catch (error) {
        if (error.message === 'BOOKING_LOCKED') {
          // ✅ CRITICAL FIX: Before returning error, verify booking state one more time
          // This handles edge cases where lock exists but booking wasn't actually accepted
          const bookingRef = this.db.collection('bookings').doc(bookingId);
          const freshBookingCheck = await bookingRef.get();
          
          if (freshBookingCheck.exists) {
            const freshBooking = freshBookingCheck.data();
            // ✅ USE VALIDATION UTILITY: Comprehensive check for all driverId edge cases
            const bookingValidation = require('../utils/bookingValidation');
            if (freshBooking.status === 'pending' && bookingValidation.isDriverIdEmpty(freshBooking.driverId)) {
              // Booking is still available - lock is likely stale, log and continue anyway
              console.warn(`⚠️ [WEBSOCKET_ACCEPT] Lock exists but booking ${bookingId} is still pending. Possible stale lock. Attempting to continue...`);
              // Don't return - let the transaction handle the race condition
            } else {
              // Booking is actually assigned
              socket.emit('error', {
                code: 'BOOKING_ALREADY_ASSIGNED',
                message: 'Booking already assigned',
                details: 'This booking has already been assigned to another driver'
              });
              return;
            }
          } else {
            socket.emit('error', {
              code: 'BOOKING_NOT_FOUND',
              message: 'Booking not found'
            });
            return;
          }
        } else if (error.message === 'BOOKING_ALREADY_ASSIGNED') {
          // Booking was already assigned (checked during lock acquisition)
          socket.emit('error', {
            code: 'BOOKING_ALREADY_ASSIGNED',
            message: 'Booking already assigned',
            details: 'This booking has already been assigned to another driver'
          });
          return;
        } else if (error.message === 'BOOKING_NOT_FOUND') {
          socket.emit('error', {
            code: 'BOOKING_NOT_FOUND',
            message: 'Booking not found'
          });
          return;
        }
        throw error;
      }

      try {
        // ✅ CRITICAL FIX: Use atomic Firestore transaction for booking acceptance
        const bookingRef = this.db.collection('bookings').doc(bookingId);
        const driverRef = this.db.collection('users').doc(userId);

        await this.db.runTransaction(async (transaction) => {
          // Get current booking and driver data within transaction
          const [bookingDoc, driverDoc] = await Promise.all([
            transaction.get(bookingRef),
            transaction.get(driverRef)
          ]);

          if (!bookingDoc.exists) {
            throw new Error('BOOKING_NOT_FOUND');
          }

          if (!driverDoc.exists) {
            throw new Error('DRIVER_NOT_FOUND');
          }

          const bookingData = bookingDoc.data();
          const driverData = driverDoc.data();

          // ✅ CRITICAL: Check if booking is still available (atomic check)
          if (bookingData.status !== 'pending') {
            // If already assigned to this driver, allow it (idempotent)
            if (bookingData.driverId === userId && bookingData.status === 'driver_assigned') {
              console.log(`ℹ️ [WEBSOCKET_ACCEPT] Booking already assigned to driver ${userId}`);
              return { success: true, alreadyAssigned: true };
            }
            throw new Error('BOOKING_ALREADY_ASSIGNED');
          }

          // Check if booking already has a driverId set
          // ✅ USE VALIDATION UTILITY: Comprehensive check for all driverId edge cases
          const bookingValidation = require('../utils/bookingValidation');
          if (!bookingValidation.isDriverIdEmpty(bookingData.driverId)) {
            const normalizedDriverId = bookingValidation.normalizeDriverId(bookingData.driverId);
            if (normalizedDriverId !== userId) {
              throw new Error('BOOKING_ALREADY_ASSIGNED');
            }
            // Same driver - allow idempotent accept
          }

          // Check if driver is still available
          if (!driverData.driver?.isAvailable || !driverData.driver?.isOnline) {
            throw new Error('DRIVER_NOT_AVAILABLE');
          }

          // ✅ CRITICAL FIX: Update booking atomically within transaction
          transaction.update(bookingRef, {
            status: 'driver_assigned',
            driverId: userId,
            acceptedAt: new Date(),
            assignedAt: new Date(),
            updatedAt: new Date(),
            // Populate driverInfo for admin panel
            driverInfo: {
              name: driverData.name || 'Driver',
              phone: driverData.phone || '',
              rating: driverData.driver?.rating || 0,
              vehicleNumber: driverData.driver?.vehicleDetails?.vehicleNumber || '',
              vehicleModel: driverData.driver?.vehicleDetails?.vehicleModel || ''
            }
          });

          // Update driver availability
          transaction.update(driverRef, {
            'driver.isAvailable': false,
            'driver.currentBookingId': bookingId,
            updatedAt: new Date()
          });

          return { success: true };
        });

        console.log(`✅ [WEBSOCKET_ACCEPT] Booking ${bookingId} accepted atomically by driver ${userId}`);

        // Get updated booking data for notifications
        const updatedBookingDoc = await bookingRef.get();
        const updatedBookingData = updatedBookingDoc.data();

        // ✅ FIXED: Create booking status update with correct status
        const statusUpdate = {
          bookingId,
          status: 'driver_assigned',
          driverId: userId,
          timestamp: new Date().toISOString(),
          updatedBy: userId
        };

        // Store status update
        await this.db.collection('booking_status_updates').add(statusUpdate);

        // Get driver data for notifications
        const driverDoc = await this.db.collection('users').doc(userId).get();
        const driverData = driverDoc.data();

        // ✅ CRITICAL FIX: Get full updated booking data for customer notification
        const fullBookingDoc = await this.db.collection('bookings').doc(bookingId).get();
        const fullBookingData = fullBookingDoc.data();
        
        // ✅ CRITICAL FIX: Enhanced logging for customer notification
        const customerRoom = `user:${updatedBookingData.customerId}`;
        const driverAssignedEvent = {
          bookingId,
          driverId: userId,
          driver: {
            id: userId,
            name: driverData?.name || 'Driver',
            phone: driverData?.phone || '',
            vehicleNumber: driverData?.driver?.vehicleDetails?.vehicleNumber || '',
            rating: driverData?.driver?.rating || 4.5
          },
          booking: fullBookingData, // ✅ CRITICAL: Include full booking data
          driverInfo: {
            id: userId,
            name: driverData?.name || 'Driver',
            phone: driverData?.phone || '',
            vehicleNumber: driverData?.driver?.vehicleDetails?.vehicleNumber || '',
            vehicleDetails: driverData?.driver?.vehicleDetails || {}
          },
          timestamp: new Date().toISOString()
        };
        
        console.log(`📤 [WEBSOCKET_ACCEPT] Emitting driver_assigned to room: ${customerRoom}`, {
          bookingId,
          driverId: userId,
          driverName: driverData?.name,
          customerId: updatedBookingData.customerId,
          hasBooking: !!fullBookingData,
          hasDriverInfo: !!driverAssignedEvent.driverInfo
        });
        
        // Check if room has listeners
        const room = this.io.sockets.adapter.rooms.get(customerRoom);
        const roomSize = room ? room.size : 0;
        console.log(`📊 [WEBSOCKET_ACCEPT] Room ${customerRoom} has ${roomSize} connected socket(s)`);
        
        // ✅ CRITICAL FIX: Send to multiple rooms to ensure customer receives the event
        // 1. User-specific room: user:${customerId}
        // 2. Booking room: booking:${bookingId}
        // 3. Customer type room: type:customer (for admin monitoring)
        const userRoom = `user:${updatedBookingData.customerId}`;
        const bookingRoom = `booking:${bookingId}`;
        
        console.log(`📤 [WEBSOCKET_ACCEPT] Emitting driver_assigned to multiple rooms:`, {
          userRoom,
          bookingRoom,
          customerRoom,
          bookingId,
          driverId: userId
        });
        
        // ✅ FIXED: Notify customer with correct event name and data structure, including full booking
        this.io.to(userRoom).emit('driver_assigned', driverAssignedEvent);
        this.io.to(bookingRoom).emit('driver_assigned', driverAssignedEvent);
        this.io.to(customerRoom).emit('driver_assigned', driverAssignedEvent); // Keep for backward compatibility

        // ✅ FIXED: Also send booking status update with full booking data
        const statusUpdateEvent = {
          bookingId,
          status: 'driver_assigned',
          booking: fullBookingData, // ✅ CRITICAL: Include full booking data
          driverInfo: {
            id: userId,
            name: driverData?.name || 'Driver',
            phone: driverData?.phone || '',
            vehicleNumber: driverData?.driver?.vehicleDetails?.vehicleNumber || '',
            vehicleDetails: driverData?.driver?.vehicleDetails || {}
          },
          timestamp: new Date().toISOString(),
          updatedBy: userId
        };
        
        console.log(`📤 [WEBSOCKET_ACCEPT] Emitting booking_status_update to multiple rooms`);
        this.io.to(userRoom).emit('booking_status_update', statusUpdateEvent);
        this.io.to(bookingRoom).emit('booking_status_update', statusUpdateEvent);
        this.io.to(customerRoom).emit('booking_status_update', statusUpdateEvent); // Keep for backward compatibility

        // Notify admin
        this.io.to(`type:admin`).emit('booking_status_update', statusUpdate);

        // Confirm acceptance
        socket.emit('booking_accepted_confirmed', {
          success: true,
          message: 'Booking accepted successfully',
          data: { bookingId, driverId: userId }
        });

      } catch (transactionError) {
        // Handle transaction errors
        if (transactionError.message === 'BOOKING_ALREADY_ASSIGNED') {
          socket.emit('error', {
            code: 'BOOKING_ALREADY_ASSIGNED',
            message: 'Booking already assigned',
            details: 'This booking has already been assigned to another driver'
          });
        } else if (transactionError.message === 'DRIVER_NOT_AVAILABLE') {
          socket.emit('error', {
            code: 'DRIVER_NOT_AVAILABLE',
            message: 'Driver not available',
            details: 'Driver must be online and available to accept bookings'
          });
        } else if (transactionError.message === 'BOOKING_NOT_FOUND') {
          socket.emit('error', {
            code: 'BOOKING_NOT_FOUND',
            message: 'Booking not found'
          });
        } else if (transactionError.message === 'DRIVER_NOT_FOUND') {
          socket.emit('error', {
            code: 'DRIVER_NOT_FOUND',
            message: 'Driver not found'
          });
        } else {
          throw transactionError;
        }
      } finally {
        // ✅ CRITICAL: Always release lock
        try {
          await bookingLockService.releaseBookingLock(bookingId, userId);
        } catch (lockError) {
          console.error(`❌ [WEBSOCKET_ACCEPT] Error releasing lock for booking ${bookingId}:`, lockError);
        }
      }

    } catch (error) {
      console.error('❌ [WEBSOCKET_ACCEPT] Error handling booking acceptance:', error);
      socket.emit('error', {
        code: 'BOOKING_ACCEPTANCE_ERROR',
        message: 'Failed to accept booking',
        details: error.message
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
      
      // ✅ CRITICAL FIX: Make booking available again (same as HTTP API)
      await bookingRef.update({
        status: 'pending',
        driverId: null,
        'timing.assignedAt': null,
        'cancellation.cancelledBy': 'driver',
        'cancellation.reason': reason || 'Rejected by driver',
        'cancellation.cancelledAt': new Date(),
        updatedAt: new Date()
      });

      // ✅ CRITICAL FIX: Track rejection to prevent driver from seeing same booking again
      try {
        await this.db.collection('booking_rejections').add({
          bookingId: bookingId,
          driverId: userId,
          reason: reason || 'Rejected by driver',
          rejectedAt: new Date(),
          createdAt: new Date()
        });
        console.log(`✅ [WEBSOCKET_REJECTION] Tracked rejection for driver ${userId} and booking ${bookingId}`);
      } catch (rejectionError) {
        console.error('❌ [WEBSOCKET_REJECTION] Failed to track rejection:', rejectionError);
        // Don't fail the rejection if tracking fails
      }

      // Create booking status update
      const statusUpdate = {
        bookingId,
        status: 'pending', // ✅ FIXED: Status is now pending (available again)
        driverId: null, // ✅ FIXED: No driver assigned
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

      // ✅ CRITICAL FIX: Notify other drivers that booking is available again
      try {
        console.log(`🔔 [WEBSOCKET_REJECTION] Notifying other drivers that booking ${bookingId} is available again`);
        await this.notifyDriversOfNewBooking({
          id: bookingId,
          ...bookingData,
          status: 'pending',
          driverId: null
        });
      } catch (notificationError) {
        console.error('❌ [WEBSOCKET_REJECTION] Failed to notify other drivers:', notificationError);
        // Don't fail the rejection if notification fails
      }

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
   * Send new booking notification to available drivers
   * @param {Object} bookingData - Booking data
   */
  async notifyDriversOfNewBooking(bookingData) {
    try {
      if (!this.io || !this.db) return;

      console.log(`🔔 Notifying drivers of new booking: ${bookingData.id}`);
      
      if (process.env.ENABLE_REAL_TIME_TESTING === 'true') {
        console.log('⚠️ Real-time testing mode enabled - enhanced logging active');
      }

      // ✅ CRITICAL FIX: Get available AND verified drivers in the area
      const driversQuery = this.db.collection('users')
        .where('userType', '==', 'driver')
        .where('driver.isOnline', '==', true)
        .where('driver.isAvailable', '==', true)
        .where('driver.verificationStatus', '==', 'verified'); // ✅ Only verified drivers

      const driversSnapshot = await driversQuery.get();
      
      const notificationData = {
        type: 'new_booking',
        booking: {
          id: bookingData.id,
          pickup: bookingData.pickup,
          dropoff: bookingData.dropoff, // ✅ CRITICAL FIX: Use correct field name
          fare: bookingData.fare,
          distance: bookingData.distance,
          estimatedDuration: bookingData.estimatedDuration,
          createdAt: bookingData.createdAt,
          customer: {
            name: bookingData.customer?.name || 'Customer',
            phone: bookingData.customer?.phone
          }
        },
        timestamp: new Date().toISOString()
      };

      // Send to all available drivers
      driversSnapshot.forEach(doc => {
        const driverData = doc.data();
        if (driverData.driver?.currentLocation) {
          // Calculate distance to pickup location
          const distance = this.calculateDistance(
            driverData.driver.currentLocation.latitude,
            driverData.driver.currentLocation.longitude,
            bookingData.pickup.coordinates.latitude,
            bookingData.pickup.coordinates.longitude
          );

          // ✅ COMPREHENSIVE FIX: Notify drivers within reasonable distance (25km to match API radius)
          const notifyRadius = 25000; // 25km (matches API radius for consistency)
          if (distance <= notifyRadius) {
            // ✅ CRITICAL: Normalize coordinates to plain objects (handle Firestore GeoPoint)
            const normalizeCoords = (coords) => {
              if (!coords) return null;
              // Handle Firestore GeoPoint format
              if (coords._latitude !== undefined && coords._longitude !== undefined) {
                return {
                  latitude: coords._latitude,
                  longitude: coords._longitude
                };
              }
              // Handle plain object format
              if (coords.latitude !== undefined && coords.longitude !== undefined) {
                return {
                  latitude: coords.latitude,
                  longitude: coords.longitude
                };
              }
              return null;
            };
            
            // ✅ CRITICAL: Include full booking data in WebSocket event (so frontend doesn't need API call)
            this.io.to(`user:${doc.id}`).emit('new_booking_available', {
              ...notificationData,
              booking: {
                ...notificationData.booking,
                // Include full booking data for direct UI update (no API call needed)
                id: bookingData.id,
                customer: bookingData.customer || bookingData.customerInfo,
                customerId: bookingData.customerId,
                customerInfo: bookingData.customerInfo || bookingData.customer,
                pricing: bookingData.pricing,
                fare: bookingData.fare,
                package: bookingData.package,
                timing: bookingData.timing,
                estimatedPickupTime: bookingData.estimatedPickupTime,
                createdAt: bookingData.createdAt,
                status: bookingData.status || 'pending',
                // ✅ CRITICAL FIX: Normalize coordinates to ensure frontend compatibility
                pickup: bookingData.pickup ? {
                  ...bookingData.pickup,
                  coordinates: normalizeCoords(bookingData.pickup.coordinates) || bookingData.pickup.coordinates
                } : bookingData.pickup,
                dropoff: bookingData.dropoff ? {
                  ...bookingData.dropoff,
                  coordinates: normalizeCoords(bookingData.dropoff.coordinates) || bookingData.dropoff.coordinates
                } : bookingData.dropoff
              },
              distanceFromDriver: Math.round(distance / 1000 * 100) / 100
            });
          }
        }
      });

      console.log(`✅ New booking notification sent to ${driversSnapshot.size} drivers`);
      
      if (process.env.ENABLE_REAL_TIME_TESTING === 'true') {
        console.log('📊 Real-time testing metrics:', {
          totalDrivers: driversSnapshot.size,
          bookingId: bookingData.id,
          pickupLocation: bookingData.pickup.coordinates,
          timestamp: new Date().toISOString()
        });
      }

    } catch (error) {
      console.error('Error notifying drivers of new booking:', error);
    }
  }

  /**
   * Send driver assignment notification to customer
   * @param {string} customerId - Customer ID
   * @param {Object} assignmentData - Assignment data
   */
  async notifyCustomerOfDriverAssignment(customerId, assignmentData) {
    try {
      if (!this.io || !this.db) return;

      console.log(`🔔 Notifying customer ${customerId} of driver assignment`);

      // ✅ CRITICAL FIX: Get full booking data to include in notification
      let fullBookingData = null;
      try {
        const bookingDoc = await this.db.collection('bookings').doc(assignmentData.bookingId).get();
        if (bookingDoc.exists) {
          fullBookingData = bookingDoc.data();
        }
      } catch (bookingError) {
        console.warn('⚠️ Could not fetch full booking data for notification:', bookingError);
      }

      const notificationData = {
        type: 'driver_assigned',
        bookingId: assignmentData.bookingId,
        driver: {
          id: assignmentData.driverId,
          name: assignmentData.driverName,
          phone: assignmentData.driverPhone,
          vehicleInfo: assignmentData.vehicleInfo,
          vehicleDetails: assignmentData.vehicleDetails || {},
          rating: assignmentData.driverRating || 0
        },
        booking: fullBookingData, // ✅ CRITICAL: Include full booking data
        driverInfo: {
          id: assignmentData.driverId,
          name: assignmentData.driverName,
          phone: assignmentData.driverPhone,
          vehicleInfo: assignmentData.vehicleInfo,
          vehicleDetails: assignmentData.vehicleDetails || {},
          rating: assignmentData.driverRating || 0
        },
        estimatedArrival: assignmentData.estimatedArrival,
        timestamp: new Date().toISOString()
      };

      // ✅ CRITICAL FIX: Send to multiple rooms to ensure customer receives the event
      const userRoom = `user:${customerId}`;
      const bookingRoom = `booking:${assignmentData.bookingId}`;
      
      console.log(`📤 [WEBSOCKET] Emitting driver_assigned to multiple rooms:`, {
        userRoom,
        bookingRoom,
        bookingId: assignmentData.bookingId,
        driverId: assignmentData.driverId
      });
      
      this.io.to(userRoom).emit('driver_assigned', notificationData);
      this.io.to(bookingRoom).emit('driver_assigned', notificationData);
      
      // ✅ CRITICAL FIX: Also emit booking_status_update with full booking
      if (fullBookingData) {
        // ✅ CRITICAL FIX: Ensure booking has driver data populated
        const bookingWithDriver = {
          ...fullBookingData,
          driver: notificationData.driver || notificationData.driverInfo || fullBookingData.driver || null,
          driverId: assignmentData.driverId || fullBookingData.driverId
        };
        
        const statusUpdate = {
          bookingId: assignmentData.bookingId,
          status: fullBookingData.status || 'driver_assigned',
          booking: bookingWithDriver, // ✅ Include booking with driver data
          driver: notificationData.driver || notificationData.driverInfo, // ✅ Include driver for compatibility
          driverInfo: notificationData.driverInfo, // ✅ Keep driverInfo for backward compatibility
          driverId: assignmentData.driverId,
          timestamp: new Date().toISOString()
        };
        
        console.log(`📤 [WEBSOCKET] Emitting booking_status_update with driver data:`, {
          bookingId: assignmentData.bookingId,
          hasDriver: !!statusUpdate.driver,
          hasDriverInfo: !!statusUpdate.driverInfo,
          hasBookingDriver: !!statusUpdate.booking.driver,
          driverId: statusUpdate.driverId
        });
        
        this.io.to(userRoom).emit('booking_status_update', statusUpdate);
        this.io.to(bookingRoom).emit('booking_status_update', statusUpdate);
      }
      
      console.log(`✅ Driver assignment notification sent to customer ${customerId}`);

    } catch (error) {
      console.error('Error notifying customer of driver assignment:', error);
    }
  }

  /**
   * Send booking status update to relevant parties
   * @param {string} bookingId - Booking ID
   * @param {string} status - New status
   * @param {Object} updateData - Additional update data
   */
  async notifyBookingStatusUpdate(bookingId, status, updateData = {}) {
    try {
      if (!this.io || !this.db) return;

      console.log(`🔔 Notifying booking status update: ${bookingId} -> ${status}`);

      // Get booking data
      const bookingDoc = await this.db.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) return;

      const bookingData = bookingDoc.data();

      const notificationData = {
        type: 'booking_status_update',
        bookingId,
        status,
        ...updateData,
        timestamp: new Date().toISOString()
      };

      // Notify customer
      if (bookingData.customerId) {
        this.io.to(`user:${bookingData.customerId}`).emit('booking_status_update', notificationData);
      }

      // Notify driver
      if (bookingData.driverId) {
        this.io.to(`user:${bookingData.driverId}`).emit('booking_status_update', notificationData);
      }

      // Notify admin
      this.io.to(`type:admin`).emit('booking_status_update', notificationData);

      console.log(`✅ Booking status update notification sent`);

    } catch (error) {
      console.error('Error notifying booking status update:', error);
    }
  }

  /**
   * Send driver location update to customer
   * @param {string} customerId - Customer ID
   * @param {string} bookingId - Booking ID
   * @param {Object} locationData - Location data
   */
  async notifyDriverLocationUpdate(customerId, bookingId, locationData) {
    try {
      if (!this.io) return;

      const notificationData = {
        type: 'driver_location_update',
        bookingId,
        location: locationData,
        timestamp: new Date().toISOString()
      };

      this.io.to(`user:${customerId}`).emit('driver_location_update', notificationData);

    } catch (error) {
      console.error('Error notifying driver location update:', error);
    }
  }

  /**
   * Calculate distance between two coordinates
   * @param {number} lat1 - Latitude 1
   * @param {number} lon1 - Longitude 1
   * @param {number} lat2 - Latitude 2
   * @param {number} lon2 - Longitude 2
   * @returns {number} Distance in meters
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Verify user has access to booking
   * @param {string} userId - User ID
   * @param {string} bookingId - Booking ID
   * @returns {boolean} Access verification result
   */
  async verifyBookingAccess(userId, bookingId) {
    try {
      if (!this.db) return false;

      const bookingDoc = await this.db.collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) return false;

      const bookingData = bookingDoc.data();
      return bookingData.customerId === userId || bookingData.driverId === userId;

    } catch (error) {
      console.error('Error verifying booking access:', error);
      return false;
    }
  }

  /**
   * Handle payment events
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Payment data
   */
  async handlePaymentEvent(socket, data) {
    try {
      const { eventType, transactionId, bookingId, amount, status } = data;
      const { userId, userType } = socket;

      console.log(`💳 Payment event: ${eventType} for transaction ${transactionId}`);

      // Update payment status in Firestore
      await this.updatePaymentStatus(transactionId, {
        status,
        updatedAt: new Date(),
        updatedBy: userId
      });

      // Notify relevant users based on event type
      switch (eventType) {
        case 'payment_created':
          await this.notifyPaymentCreated(socket, data);
          break;
        case 'payment_completed':
          await this.notifyPaymentCompleted(socket, data);
          break;
        case 'payment_failed':
          await this.notifyPaymentFailed(socket, data);
          break;
        case 'payment_refunded':
          await this.notifyPaymentRefunded(socket, data);
          break;
        default:
          console.log(`Unknown payment event type: ${eventType}`);
      }

      // Notify admin dashboard
      this.io.to('role:admin').emit('payment_update', {
        eventType,
        transactionId,
        bookingId,
        amount,
        status,
        userId,
        userType,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Error handling payment event:', error);
      socket.emit('error', {
        code: 'PAYMENT_EVENT_ERROR',
        message: 'Failed to process payment event'
      });
    }
  }

  /**
   * Notify payment created
   */
  async notifyPaymentCreated(socket, data) {
    const { transactionId, bookingId, amount } = data;
    
    // Notify customer
    socket.emit('payment_created', {
      success: true,
      message: 'Payment request created successfully',
      data: {
        transactionId,
        bookingId,
        amount,
        status: 'PENDING',
        timestamp: new Date().toISOString()
      }
    });

    // Notify admin dashboard
    this.io.to('role:admin').emit('payment_created', {
      transactionId,
      bookingId,
      amount,
      customerId: socket.userId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notify payment completed
   */
  async notifyPaymentCompleted(socket, data) {
    const { transactionId, bookingId, amount } = data;
    
    // Notify customer
    socket.emit('payment_completed', {
      success: true,
      message: 'Payment completed successfully',
      data: {
        transactionId,
        bookingId,
        amount,
        status: 'COMPLETED',
        timestamp: new Date().toISOString()
      }
    });

    // Notify driver if assigned
    const booking = await this.getBooking(bookingId);
    if (booking && booking.driverId) {
      this.io.to(`user:${booking.driverId}`).emit('payment_completed', {
        transactionId,
        bookingId,
        amount,
        timestamp: new Date().toISOString()
      });
    }

    // Notify admin dashboard
    this.io.to('role:admin').emit('payment_completed', {
      transactionId,
      bookingId,
      amount,
      customerId: socket.userId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notify payment failed
   */
  async notifyPaymentFailed(socket, data) {
    const { transactionId, bookingId, amount, reason } = data;
    
    // Notify customer
    socket.emit('payment_failed', {
      success: false,
      message: 'Payment failed',
      data: {
        transactionId,
        bookingId,
        amount,
        status: 'FAILED',
        reason: reason || 'Payment processing failed',
        timestamp: new Date().toISOString()
      }
    });

    // Notify admin dashboard
    this.io.to('role:admin').emit('payment_failed', {
      transactionId,
      bookingId,
      amount,
      reason,
      customerId: socket.userId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notify payment refunded
   */
  async notifyPaymentRefunded(socket, data) {
    const { transactionId, bookingId, refundAmount, reason } = data;
    
    // Notify customer
    socket.emit('payment_refunded', {
      success: true,
      message: 'Payment refunded successfully',
      data: {
        transactionId,
        bookingId,
        refundAmount,
        reason: reason || 'Refund processed',
        timestamp: new Date().toISOString()
      }
    });

    // Notify admin dashboard
    this.io.to('role:admin').emit('payment_refunded', {
      transactionId,
      bookingId,
      refundAmount,
      reason,
      customerId: socket.userId,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle driver assignment events
   * @param {Socket} socket - Socket instance
   * @param {Object} data - Assignment data
   */
  async handleDriverAssignment(socket, data) {
    try {
      const { bookingId, driverId, assignmentType, status } = data;
      const { userId, userType } = socket;

      console.log(`🚗 Driver assignment: ${assignmentType} for booking ${bookingId}`);

      // Update assignment status in Firestore
      await this.updateDriverAssignment(bookingId, {
        driverId,
        assignmentType,
        status,
        updatedAt: new Date(),
        updatedBy: userId
      });

      // Notify relevant users
      switch (assignmentType) {
        case 'auto_assigned':
          await this.notifyAutoAssignment(socket, data);
          break;
        case 'manual_assigned':
          await this.notifyManualAssignment(socket, data);
          break;
        case 'unassigned':
          await this.notifyDriverUnassigned(socket, data);
          break;
        default:
          console.log(`Unknown assignment type: ${assignmentType}`);
      }

      // Notify admin dashboard
      this.io.to('role:admin').emit('driver_assignment_update', {
        bookingId,
        driverId,
        assignmentType,
        status,
        updatedBy: userId,
        userType,
        timestamp: new Date().toISOString()
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
   * Notify auto assignment
   */
  async notifyAutoAssignment(socket, data) {
    const { bookingId, driverId, driverName, estimatedDistance } = data;
    
    // Notify customer
    socket.emit('driver_auto_assigned', {
      success: true,
      message: 'Driver automatically assigned to your booking',
      data: {
        bookingId,
        driverId,
        driverName,
        estimatedDistance,
        timestamp: new Date().toISOString()
      }
    });

    // Notify driver
    this.io.to(`user:${driverId}`).emit('booking_assigned', {
      bookingId,
      assignmentType: 'auto',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notify manual assignment
   */
  async notifyManualAssignment(socket, data) {
    const { bookingId, driverId, driverName, assignedBy } = data;
    
    // Notify customer
    socket.emit('driver_manually_assigned', {
      success: true,
      message: 'Driver manually assigned to your booking',
      data: {
        bookingId,
        driverId,
        driverName,
        assignedBy,
        timestamp: new Date().toISOString()
      }
    });

    // Notify driver
    this.io.to(`user:${driverId}`).emit('booking_assigned', {
      bookingId,
      assignmentType: 'manual',
      assignedBy,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Notify driver unassigned
   */
  async notifyDriverUnassigned(socket, data) {
    const { bookingId, driverId, unassignedBy, reason } = data;
    
    // Notify customer
    socket.emit('driver_unassigned', {
      success: true,
      message: 'Driver has been unassigned from your booking',
      data: {
        bookingId,
        driverId,
        unassignedBy,
        reason: reason || 'Driver unassigned',
        timestamp: new Date().toISOString()
      }
    });

    // Notify driver
    this.io.to(`user:${driverId}`).emit('booking_unassigned', {
      bookingId,
      unassignedBy,
      reason,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Update payment status in Firestore
   */
  async updatePaymentStatus(transactionId, updateData) {
    try {
      await this.db.collection('payments').doc(transactionId).update(updateData);
    } catch (error) {
      console.error('Error updating payment status:', error);
    }
  }

  /**
   * Update driver assignment in Firestore
   */
  async updateDriverAssignment(bookingId, updateData) {
    try {
      await this.db.collection('driverAssignments').doc(bookingId).update(updateData);
    } catch (error) {
      console.error('Error updating driver assignment:', error);
    }
  }

  /**
   * Get booking from Firestore
   */
  async getBooking(bookingId) {
    try {
      const doc = await this.db.collection('bookings').doc(bookingId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Error getting booking:', error);
      return null;
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

  /**
   * ✅ CRITICAL FIX: Notify driver of admin assignment
   * @param {string} driverId - Driver ID
   * @param {Object} assignmentData - Assignment data
   */
  async notifyDriverOfAssignment(driverId, assignmentData) {
    try {
      if (!this.io) {
        console.log('⚠️ [WEBSOCKET] Socket.IO not available for driver assignment notification');
        return;
      }

      // Find driver's socket connection
      const driverSocket = this.getDriverSocket(driverId);
      if (driverSocket) {
        driverSocket.emit('booking_assigned', {
          type: 'booking_assigned',
          data: {
            bookingId: assignmentData.bookingId,
            customerName: assignmentData.customerName,
            pickupAddress: assignmentData.pickupAddress,
            dropoffAddress: assignmentData.dropoffAddress,
            estimatedFare: assignmentData.estimatedFare,
            assignedBy: assignmentData.assignedBy,
            assignedAt: assignmentData.assignedAt
          },
          timestamp: new Date().toISOString()
        });
        
        console.log(`✅ [WEBSOCKET] Driver ${driverId} notified of booking assignment ${assignmentData.bookingId}`);
      } else {
        console.log(`⚠️ [WEBSOCKET] Driver ${driverId} not connected, assignment notification queued`);
        // TODO: Implement notification queuing for offline drivers
      }
    } catch (error) {
      console.error('❌ [WEBSOCKET] Error notifying driver of assignment:', error);
    }
  }

  /**
   * Get driver socket connection
   * @param {string} driverId - Driver ID
   * @returns {Object|null} Driver socket or null
   */
  getDriverSocket(driverId) {
    if (!this.io) return null;
    
    // Find socket by driver ID in connected sockets
    const connectedSockets = this.io.sockets.sockets;
    for (const [, socket] of connectedSockets) {
      if (socket.driverId === driverId) {
        return socket;
      }
    }
    return null;
  }
}

module.exports = WebSocketEventHandler;
