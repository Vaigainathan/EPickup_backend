const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const WebSocketEventHandler = require('./websocketEventHandler');

let io = null;
let eventHandler = null;

/**
 * Initialize Socket.IO service
 */
const initializeSocketIO = async (server) => {
  try {
    io = new Server(server, {
      cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || [
          'http://localhost:3000',
          'http://localhost:3001',
          'https://epickup-app.web.app'
        ],
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      allowEIO3: true,
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e6, // 1MB
      connectTimeout: 45000
    });

    // Initialize event handler
    eventHandler = new WebSocketEventHandler();
    await eventHandler.initialize();

    // Authentication middleware
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || 
                     socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify JWT token
        const secret = process.env.JWT_SECRET || 'your-secret-key';
        const decodedToken = jwt.verify(token, secret);
        
        // Add user info to socket
        socket.userId = decodedToken.userId;
        socket.userType = decodedToken.userType || 'customer';
        socket.userRole = decodedToken.role || 'customer';
        socket.userRooms = new Set();
        
        next();
      } catch (error) {
        console.error('Socket authentication error:', error.message);
        next(new Error('Invalid authentication token'));
      }
    });

    // Connection handler
    io.on('connection', (socket) => {
      console.log(`🔌 User connected: ${socket.userId} (${socket.userType})`);
      
      // Handle connection with event handler
      eventHandler.handleConnection(socket);

      // Handle tracking subscription
      socket.on('subscribe_tracking', (data) => {
        eventHandler.handleTrackingSubscription(socket, data);
      });

      // Handle tracking unsubscription
      socket.on('unsubscribe_tracking', (data) => {
        eventHandler.handleTrackingUnsubscription(socket, data);
      });

      // Handle location updates
      socket.on('update_location', (data) => {
        eventHandler.handleLocationUpdate(socket, data);
      });

      // Handle chat messages
      socket.on('send_message', (data) => {
        eventHandler.handleChatMessage(socket, data);
      });

      // Handle typing indicators
      socket.on('typing_start', (data) => {
        eventHandler.handleTypingIndicator(socket, data, true);
      });

      socket.on('typing_stop', (data) => {
        eventHandler.handleTypingIndicator(socket, data, false);
      });

      // Handle presence updates
      socket.on('presence_update', (data) => {
        eventHandler.handlePresenceUpdate(socket, data);
      });

      // Handle emergency alerts
      socket.on('emergency_alert', (data) => {
        eventHandler.handleEmergencyAlert(socket, data);
      });

      // Handle trip status updates
      socket.on('trip_status_update', (data) => {
        eventHandler.handleTripStatusUpdate(socket, data);
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        console.log(`🔌 User disconnected: ${socket.userId} (${socket.userType}) - Reason: ${reason}`);
        
        // Handle disconnection with event handler
        eventHandler.handleDisconnection(socket);
        
        // Leave all rooms
        socket.rooms.forEach(room => {
          if (room !== socket.id) {
            socket.leave(room);
          }
        });
      });

      // Handle errors
      socket.on('error', (error) => {
        console.error(`Socket error for user ${socket.userId}:`, error);
      });
    });

    console.log('✅ Socket.IO service initialized successfully');
    return io;
    
  } catch (error) {
    console.error('❌ Failed to initialize Socket.IO:', error);
    return null;
  }
};

/**
 * Get Socket.IO instance
 */
const getSocketIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized. Call initializeSocketIO() first.');
  }
  return io;
};

/**
 * Get WebSocket event handler
 */
const getEventHandler = () => {
  if (!eventHandler) {
    throw new Error('WebSocket event handler not initialized.');
  }
  return eventHandler;
};

/**
 * Send message to specific user
 */
const sendToUser = (userId, event, data) => {
  try {
    if (!io) return false;
    
    io.to(`user:${userId}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Socket sendToUser error:', error);
    return false;
  }
};

/**
 * Send message to multiple users
 */
const sendToUsers = (userIds, event, data) => {
  try {
    if (!io) return false;
    
    userIds.forEach(userId => {
      io.to(`user:${userId}`).emit(event, {
        ...data,
        timestamp: new Date().toISOString()
      });
    });
    
    return true;
  } catch (error) {
    console.error('Socket sendToUsers error:', error);
    return false;
  }
};

/**
 * Send message to all connected clients
 */
const broadcastToAll = (event, data) => {
  try {
    if (!io) return false;
    
    io.emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Socket broadcastToAll error:', error);
    return false;
  }
};

/**
 * Send message to specific role
 */
const broadcastToRole = (role, event, data) => {
  try {
    if (!io) return false;
    
    io.to(`role:${role}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Socket broadcastToRole error:', error);
    return false;
  }
};

/**
 * Send message to trip subscribers
 */
const sendToTrip = (tripId, event, data) => {
  try {
    if (!io) return false;
    
    io.to(`trip:${tripId}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Socket sendToTrip error:', error);
    return false;
  }
};

/**
 * Send message to users by type
 */
const sendToUserType = (userType, event, data) => {
  try {
    if (!io) return false;
    
    io.to(`type:${userType}`).emit(event, {
      ...data,
      timestamp: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Socket sendToUserType error:', error);
    return false;
  }
};

/**
 * Get connection statistics
 */
const getConnectionStats = () => {
  try {
    if (!io) return null;
    
    const sockets = io.sockets.sockets;
    const connectedUsers = new Set();
    const userTypes = {};
    const rooms = {};
    
    sockets.forEach(socket => {
      connectedUsers.add(socket.userId);
      
      // Count user types
      const userType = socket.userType || 'unknown';
      userTypes[userType] = (userTypes[userType] || 0) + 1;
      
      // Count rooms
      socket.rooms.forEach(room => {
        if (room !== socket.id) {
          rooms[room] = (rooms[room] || 0) + 1;
        }
      });
    });
    
    return {
      totalConnections: connectedUsers.size,
      userTypes,
      rooms,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Socket getConnectionStats error:', error);
    return null;
  }
};

/**
 * Get user connection info
 */
const getUserConnectionInfo = (userId) => {
  try {
    if (!io) return null;
    
    const sockets = io.sockets.sockets;
    const userSockets = [];
    
    sockets.forEach(socket => {
      if (socket.userId === userId) {
        userSockets.push({
          socketId: socket.id,
          userType: socket.userType,
          userRole: socket.userRole,
          rooms: Array.from(socket.rooms),
          connectedAt: socket.handshake.time
        });
      }
    });
    
    return {
      userId,
      activeConnections: userSockets.length,
      sockets: userSockets,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('Socket getUserConnectionInfo error:', error);
    return null;
  }
};

/**
 * Force disconnect user
 */
const forceDisconnectUser = (userId, reason = 'Admin disconnect') => {
  try {
    if (!io) return false;
    
    const sockets = io.sockets.sockets;
    let disconnectedCount = 0;
    
    sockets.forEach(socket => {
      if (socket.userId === userId) {
        socket.emit('force_disconnect', {
          reason,
          timestamp: new Date().toISOString()
        });
        socket.disconnect(true);
        disconnectedCount++;
      }
    });
    
    console.log(`🔌 Force disconnected ${disconnectedCount} connections for user ${userId}`);
    return disconnectedCount > 0;
    
  } catch (error) {
    console.error('Socket forceDisconnectUser error:', error);
    return false;
  }
};

/**
 * Cleanup expired connections
 */
const cleanupExpiredConnections = (maxAge = 24 * 60 * 60 * 1000) => {
  try {
    if (!io) return 0;
    
    const now = Date.now();
    const sockets = io.sockets.sockets;
    let cleanedCount = 0;
    
    sockets.forEach(socket => {
      const connectionAge = now - socket.handshake.time;
      
      if (connectionAge > maxAge) {
        socket.emit('connection_expired', {
          reason: 'Connection expired',
          timestamp: new Date().toISOString()
        });
        socket.disconnect(true);
        cleanedCount++;
      }
    });
    
    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired connections`);
    }
    
    return cleanedCount;
    
  } catch (error) {
    console.error('Socket cleanupExpiredConnections error:', error);
    return 0;
  }
};

/**
 * Health check
 */
const healthCheck = async () => {
  try {
    if (!io) return { status: 'disconnected', message: 'Socket.IO not initialized' };
    
    const stats = getConnectionStats();
    let eventHandlerStatus = { status: 'unknown' };
    
    if (eventHandler) {
      eventHandlerStatus = await eventHandler.healthCheck();
    }
    
    if (stats) {
      return { 
        status: 'connected', 
        message: 'Socket.IO is healthy',
        stats,
        eventHandler: eventHandlerStatus
      };
    } else {
      return { status: 'error', message: 'Failed to get connection stats' };
    }
  } catch (error) {
    return { status: 'error', message: error.message };
  }
};

module.exports = {
  initializeSocketIO,
  getSocketIO,
  getEventHandler,
  sendToUser,
  sendToUsers,
  broadcastToAll,
  broadcastToRole,
  sendToTrip,
  sendToUserType,
  getConnectionStats,
  getUserConnectionInfo,
  forceDisconnectUser,
  cleanupExpiredConnections,
  healthCheck
};
