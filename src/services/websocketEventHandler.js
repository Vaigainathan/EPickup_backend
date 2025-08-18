const { getFirestore } = require('./firebase');

/**
 * WebSocket Event Handler Service
 * Manages all Socket.IO events for real-time communication
 */
class WebSocketEventHandler {
  constructor() {
    this.db = null;
    this.redis = null;
    this.realTimeService = null;
    this.io = null;
  }

  /**
   * Initialize the event handler service
   */
  async initialize() {
    try {
      this.db = getFirestore();
      
      // Try to initialize Redis, but don't fail if it's not available
      try {
        const { getRedisClient } = require('./redis');
        this.redis = getRedisClient();
      } catch (redisError) {
        console.log('⚠️  Redis not available for WebSocket handler, continuing without Redis...');
        this.redis = null;
      }
      
      // Try to initialize RealTimeService, but don't fail if it's not available
      try {
        const RealTimeService = require('./realTimeService');
        this.realTimeService = new RealTimeService();
        await this.realTimeService.initialize();
      } catch (realTimeError) {
        console.log('⚠️  RealTimeService not available for WebSocket handler, continuing without it...');
        this.realTimeService = null;
      }
      
      console.log('✅ WebSocket event handler initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize WebSocket event handler:', error);
    }
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
      const { tripId, userId, userType } = data;

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

      // Store subscription in Redis if available
      if (this.redis) {
        await this.redis.sadd(`trip_subscribers:${tripId}`, userId);
        await this.redis.expire(`trip_subscribers:${tripId}`, 3600); // 1 hour expiry
      }

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

      // Remove subscription from Redis if available
      if (this.redis) {
        await this.redis.srem(`trip_subscribers:${tripId}`, userId);
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

      // Store presence in Redis
      if (this.redis) {
        await this.redis.set(
          `presence:${userId}`,
          JSON.stringify(presenceData),
          'EX',
          300 // 5 minutes expiry
        );
      }

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
      if (this.redis) {
        await this.redis.set(
          `user_online:${userId}`,
          isOnline ? '1' : '0',
          'EX',
          300 // 5 minutes expiry
        );
      }

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
          redis: this.redis ? 'connected' : 'disconnected',
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
