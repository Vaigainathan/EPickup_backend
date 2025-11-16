const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const WebSocketEventHandler = require('./websocketEventHandler');

/**
 * Sanitize message data to prevent XSS and other attacks
 */
function sanitizeMessageData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const sanitized = { ...data };

  // Remove potentially dangerous properties
  delete sanitized.__proto__;
  delete sanitized.constructor;
  delete sanitized.prototype;

  // Sanitize string values
  for (const key in sanitized) {
    if (typeof sanitized[key] === 'string') {
      // Remove potential XSS vectors
      sanitized[key] = sanitized[key]
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    } else if (typeof sanitized[key] === 'object' && sanitized[key] !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeMessageData(sanitized[key]);
    }
  }

  return sanitized;
}

let io = null;
let eventHandler = null;

/**
 * Initialize Socket.IO service
 */
const initializeSocketIO = async (server) => {
  try {
    // ✅ REMOVED: Redis adapter - using in-memory adapter (single instance)
    // In-memory adapter is perfect for single-instance deployments
    // No external dependencies, faster, and simpler
    // Multiple concurrent bookings are fully supported - each booking has its own isolated room
    console.log('✅ [SOCKET] Using in-memory adapter (single instance mode)');
    console.log('✅ [SOCKET] Each booking gets isolated room (booking:${bookingId}) - no capacity limits');
    
    const serverOptions = {
      cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || [
          'http://localhost:3000',  // Admin dashboard
          'http://localhost:3001',  // Customer app
          'http://localhost:8081',  // Driver app (Expo)
          'https://epickup-app.web.app'
        ],
        methods: ['GET', 'POST'],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      allowEIO3: true,
      // ✅ RAILWAY-SPECIFIC FIX: Enhanced timeout configuration for Railway infrastructure
      pingTimeout: 90000,         // Railway proxy timeout (90s)
      pingInterval: 25000,        // Railway ping interval (25s)
      connectTimeout: 45000,      // Railway connection timeout (45s)
      maxHttpBufferSize: 1e6,    // 1MB
      // ✅ CRITICAL FIX: Enhanced connection options
      upgradeTimeout: 30000,      // 30s for transport upgrade
      allowUpgrades: true,
      perMessageDeflate: {
        threshold: 1024,
        concurrencyLimit: 10,
        memLevel: 7
      },
      // ✅ CRITICAL FIX: Better error handling
      serveClient: false,
      cookie: false,
      // ✅ RAILWAY-SPECIFIC FIX: Connection pooling and limits for Railway
      maxConnections: 500,        // Railway has lower connection limits
      connectionStateRecovery: {
        maxDisconnectionDuration: 60 * 1000, // 1 minute (Railway specific)
        skipMiddlewares: true
      }
    };
    
    // ✅ REMOVED: Redis adapter - using default in-memory adapter
    // No adapter needed for single-instance deployments
    
    io = new Server(server, serverOptions);

    // Initialize event handler
    eventHandler = new WebSocketEventHandler();
    await eventHandler.initialize();
    
    // Set the io instance in the event handler
    eventHandler.setIO(io);

    // Rate limiting for WebSocket connections
    const connectionCounts = new Map();
    const maxConnectionsPerIP = 10;
    const connectionWindow = 60000; // 1 minute

    io.use((socket, next) => {
      const clientIP = socket.handshake.address || socket.conn.remoteAddress;
      const now = Date.now();
      
      // Clean up old entries
      for (const [ip, data] of connectionCounts.entries()) {
        if (now - data.timestamp > connectionWindow) {
          connectionCounts.delete(ip);
        }
      }
      
      // Check current connection count
      const currentData = connectionCounts.get(clientIP);
      if (currentData && currentData.count >= maxConnectionsPerIP) {
        console.log(`🚫 Rate limit exceeded for IP: ${clientIP}`);
        return next(new Error('Too many connections from this IP'));
      }
      
      // Update connection count
      connectionCounts.set(clientIP, {
        count: (currentData?.count || 0) + 1,
        timestamp: now
      });
      
      next();
    });

    // Authentication middleware with improved error handling
    io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || 
                     socket.handshake.headers.authorization?.replace('Bearer ', '');
        
        if (!token || token.length < 10) {
          console.log('🔐 Socket authentication failed: No token provided or token too short');
          // Allow connection but mark as unauthenticated
          socket.isAuthenticated = false;
          socket.userType = 'guest';
          return next();
        }

        // Validate token format
        if (token.length < 10) {
          console.log('🔐 Socket authentication failed: Invalid token format');
          return next(new Error('Invalid token format'));
        }

        // Debug token format (only log on error)
        const tokenInfo = {
          tokenLength: token.length,
          tokenPreview: token.substring(0, 20) + '...',
          hasAuthToken: !!socket.handshake.auth.token,
          hasAuthHeader: !!socket.handshake.headers.authorization
        };

        // Verify JWT token
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          console.error('JWT_SECRET environment variable is required for WebSocket authentication');
          return next(new Error('Server configuration error'));
        }
        let decodedToken;
        
        try {
          // Use JWT service for proper verification
          const jwtService = require('./jwtService');
          decodedToken = jwtService.verifyToken(token);
          
          // Set user info for successful authentication
          socket.userId = decodedToken.userId;
          
          // ✅ CRITICAL FIX: Validate userType from token - don't default to customer
          // If userType is missing, this is an error condition
          if (!decodedToken.userType) {
            console.error('❌ [SOCKET] Missing userType in token for user:', decodedToken.userId);
            throw new Error('Invalid token: userType is required');
          }
          
          socket.userType = decodedToken.userType;
          socket.userRole = decodedToken.role || decodedToken.userType; // Use userType as fallback for role
          socket.userRooms = new Set();
          
          console.log(`✅ Socket authentication successful for ${socket.userType}: ${socket.userId}`);
          return next();
        } catch (jwtError) {
          if (jwtError.message === 'Token expired') {
            // Token expired - allow connection but mark for token refresh
            console.log('Socket token expired, allowing connection for refresh');
            socket.needsTokenRefresh = true;
            socket.originalToken = token;
            
            // Try to decode without verification to get user info
            try {
              decodedToken = jwt.decode(token);
              if (decodedToken && decodedToken.userId) {
                socket.userId = decodedToken.userId;
                
                // ✅ CRITICAL FIX: Even for expired tokens, validate userType exists
                // If missing, this indicates token was generated incorrectly
                if (!decodedToken.userType) {
                  console.error('❌ [SOCKET] Missing userType in expired token for user:', decodedToken.userId);
                  return next(new Error('Invalid token: userType is required'));
                }
                
                socket.userType = decodedToken.userType;
                socket.userRole = decodedToken.role || decodedToken.userType; // Use userType as fallback for role
                socket.userRooms = new Set();
                return next();
              }
            } catch (decodeError) {
              console.error('Failed to decode expired token:', decodeError.message);
            }
          } else if (jwtError.message === 'Invalid token' || jwtError.message.includes('malformed')) {
            // Malformed or invalid token - reject connection
            console.error('Socket authentication error: Invalid or malformed token', tokenInfo);
            return next(new Error('Invalid authentication token'));
          }
          
          console.error('Socket authentication error:', jwtError.message, tokenInfo);
          return next(new Error('Invalid authentication token'));
        }
      } catch (error) {
        console.error('Socket authentication error:', error.message);
        next(new Error('Invalid authentication token'));
      }
    });

    // Connection handler
    io.on('connection', (socket) => {
      console.log(`🔌 User connected: ${socket.userId} (${socket.userType})`);
      
      // Message validation middleware
      socket.use((packet, next) => {
        const [event, data] = packet;
        
        // Validate event name
        if (!event || typeof event !== 'string' || event.length === 0) {
          console.log(`❌ Invalid event name from ${socket.id}: ${event}`);
          return next(new Error('Invalid event name'));
        }
        
        // Validate data size
        if (data && JSON.stringify(data).length > 1024 * 1024) { // 1MB limit
          console.log(`❌ Message too large from ${socket.id}`);
          return next(new Error('Message too large'));
        }
        
        // Sanitize data
        if (data && typeof data === 'object') {
          packet[1] = sanitizeMessageData(data);
        }
        
        next();
      });
      
      // Check if token needs refresh
      if (socket.needsTokenRefresh) {
        socket.emit('token_refresh_required', {
          message: 'Token expired, please refresh',
          timestamp: new Date().toISOString()
        });
      }
      
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

      // Handle payment events
      socket.on('payment_event', (data) => {
        eventHandler.handlePaymentEvent(socket, data);
      });

      // Handle driver assignment events
      socket.on('driver_assignment', (data) => {
        eventHandler.handleDriverAssignment(socket, data);
      });

      // Handle booking status updates
      socket.on('booking_status_update', (data) => {
        eventHandler.handleBookingStatusUpdate(socket, data);
      });

      // Handle authentication events
      socket.on('session_expired', (data) => {
        eventHandler.handleSessionExpiration(socket, data);
      });

      socket.on('token_refresh', (data) => {
        eventHandler.handleTokenRefresh(socket, data);
      });

      // Handle token refresh with new token
      socket.on('refresh_token', async (data) => {
        try {
          const { newToken } = data;
          if (!newToken) {
            socket.emit('token_refresh_failed', {
              message: 'No new token provided',
              timestamp: new Date().toISOString()
            });
            return;
          }

          // Verify the new token
          const secret = process.env.JWT_SECRET;
          if (!secret) {
            socket.emit('token_refresh_failed', {
              message: 'Server configuration error',
              timestamp: new Date().toISOString()
            });
            return;
          }
          const decodedToken = jwt.verify(newToken, secret);
          
          // Update socket with new token info
          socket.userId = decodedToken.userId;
          
          // ✅ CRITICAL FIX: Validate userType from refreshed token
          if (!decodedToken.userType) {
            console.error('❌ [SOCKET] Missing userType in refreshed token for user:', decodedToken.userId);
            socket.emit('token_refresh_failed', {
              message: 'Invalid token: userType is required',
              timestamp: new Date().toISOString()
            });
            return;
          }
          
          socket.userType = decodedToken.userType;
          socket.userRole = decodedToken.role || decodedToken.userType; // Use userType as fallback for role
          socket.needsTokenRefresh = false;
          
          socket.emit('token_refresh_success', {
            message: 'Token refreshed successfully',
            timestamp: new Date().toISOString()
          });
          
          console.log(`✅ Token refreshed for user: ${socket.userId}`);
        } catch (error) {
          console.error('Token refresh failed:', error.message);
          socket.emit('token_refresh_failed', {
            message: 'Invalid new token',
            timestamp: new Date().toISOString()
          });
        }
      });

      socket.on('force_logout', (data) => {
        eventHandler.handleForceLogout(socket, data);
      });

      // Handle driver-specific events
      socket.on('accept_booking', (data) => {
        eventHandler.handleBookingAcceptance(socket, data);
      });

      socket.on('reject_booking', (data) => {
        eventHandler.handleBookingRejection(socket, data);
      });

      socket.on('update_driver_status', (data) => {
        eventHandler.handleDriverStatusUpdate(socket, data);
      });

      socket.on('update_booking_status', (data) => {
        eventHandler.handleBookingStatusUpdate(socket, data);
      });

      socket.on('update_eta', (data) => {
        eventHandler.handleETAUpdate(socket, data);
      });

      socket.on('send_message', (data) => {
        eventHandler.handleChatMessage(socket, data);
      });

      socket.on('typing_start', (data) => {
        eventHandler.handleTypingIndicator(socket, data, true);
      });

      socket.on('typing_stop', (data) => {
        eventHandler.handleTypingIndicator(socket, data, false);
      });

      // ✅ CRITICAL FIX: Handle booking room join/leave with permission validation
      socket.on('join-booking', async (bookingId) => {
        try {
        if (!bookingId) {
          socket.emit('error', {
            code: 'INVALID_BOOKING_ID',
            message: 'Booking ID is required'
          });
          return;
        }

          const userId = socket.userId;
          const userType = socket.userType;

          if (!userId || !userType) {
            socket.emit('error', {
              code: 'AUTHENTICATION_ERROR',
              message: 'User authentication required'
            });
            return;
          }

          // ✅ CRITICAL FIX: Validate user has permission to join this booking room
          const { getFirestore } = require('../services/firebase');
          const db = getFirestore();
          const bookingRef = db.collection('bookings').doc(bookingId);
          const bookingDoc = await bookingRef.get();

          if (!bookingDoc.exists) {
            socket.emit('error', {
              code: 'BOOKING_NOT_FOUND',
              message: 'Booking not found'
            });
            return;
          }

          const booking = bookingDoc.data();

          // ✅ CRITICAL FIX: Check if user is customer or driver of this booking
          if (userType === 'customer' && booking.customerId !== userId) {
            socket.emit('error', {
              code: 'PERMISSION_DENIED',
              message: 'You do not have permission to join this booking room'
            });
            console.warn(`⚠️ [SOCKET] Permission denied: Customer ${userId} tried to join booking ${bookingId} (owner: ${booking.customerId})`);
            return;
          }

          if (userType === 'driver' && booking.driverId !== userId) {
            socket.emit('error', {
              code: 'PERMISSION_DENIED',
              message: 'You do not have permission to join this booking room'
            });
            console.warn(`⚠️ [SOCKET] Permission denied: Driver ${userId} tried to join booking ${bookingId} (assigned driver: ${booking.driverId})`);
            return;
          }

          // ✅ CRITICAL FIX: Only allow join if booking is active
          const activeStatuses = ['pending', 'driver_assigned', 'accepted', 'driver_enroute', 
                                 'driver_arrived', 'picked_up', 'in_transit', 'at_dropoff'];
          if (!activeStatuses.includes(booking.status)) {
            socket.emit('error', {
              code: 'BOOKING_NOT_ACTIVE',
              message: 'Booking is not active'
            });
            console.warn(`⚠️ [SOCKET] Booking ${bookingId} is not active (status: ${booking.status})`);
            return;
          }

          // ✅ CRITICAL FIX: Persist room membership in database for recovery
          const roomMembershipRef = db.collection('websocket_rooms').doc(`${bookingId}:${userId}`);
          await roomMembershipRef.set({
            bookingId,
            userId,
            userType,
            room: `booking:${bookingId}`,
            joinedAt: new Date(),
            lastSeen: new Date(),
            socketId: socket.id
          }, { merge: true });
        
        // Join booking room
        socket.join(`booking:${bookingId}`);
          console.log(`✅ [SOCKET] User ${userId} (${userType}) joined booking room: booking:${bookingId}`);
        
        socket.emit('booking-room-joined', {
          success: true,
          bookingId: bookingId,
          room: `booking:${bookingId}`
        });
        } catch (error) {
          console.error('❌ [SOCKET] Error joining booking room:', error);
          socket.emit('error', {
            code: 'ROOM_JOIN_ERROR',
            message: 'Failed to join booking room',
            details: error.message
          });
        }
      });

      socket.on('leave-booking', async (bookingId) => {
        try {
        if (bookingId) {
            const userId = socket.userId;
            
            // ✅ CRITICAL FIX: Remove room membership from database
            if (userId) {
              const { getFirestore } = require('../services/firebase');
              const db = getFirestore();
              const roomMembershipRef = db.collection('websocket_rooms').doc(`${bookingId}:${userId}`);
              await roomMembershipRef.delete();
            }
            
          socket.leave(`booking:${bookingId}`);
          if (socket.userId) {
          console.log(`✅ [SOCKET] User ${socket.userId} left booking room: booking:${bookingId}`);
          }
          }
        } catch (error) {
          console.error('❌ [SOCKET] Error leaving booking room:', error);
          // Don't emit error - leaving room is best-effort
        }
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        if (!socket.userId) {
          // Avoid noisy logs and invalid Firestore writes
          return;
        }
        console.log(`🔌 User disconnected: ${socket.userId} (${socket.userType}) - Reason: ${reason}`);
        
        // Handle disconnection with event handler
        eventHandler.handleDisconnection(socket);
      });

      // Handle errors
      socket.on('error', (error) => {
        console.error(`❌ Socket error for ${socket.userId}:`, error);
        
        // Send error response to client
        socket.emit('error', {
          message: 'An error occurred',
          timestamp: new Date().toISOString()
        });
      });

      // Handle connection timeout
      socket.on('timeout', () => {
        console.log(`⏰ Socket timeout for ${socket.userId}`);
        socket.disconnect(true);
      });

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        if (!socket.userId) {
          return;
        }
        console.log(`🔌 User disconnected: ${socket.userId} (${socket.userType}) - Reason: ${reason}`);
        
        // Handle disconnection with event handler
        eventHandler.handleDisconnection(socket);
        
        // Leave all rooms
        socket.rooms.forEach(room => {
          if (room !== socket.id) {
            socket.leave(room);
          }
        });

        // Clean up socket properties to prevent memory leaks
        socket.userId = null;
        socket.userType = null;
        socket.userRole = null;
        socket.userRooms = null;
        socket.needsTokenRefresh = null;
        socket.originalToken = null;
        
        // Remove all event listeners to prevent memory leaks
        socket.removeAllListeners();
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      });

      // Handle admin-specific events
      socket.on('join_room', (data) => {
        eventHandler.handleRoomJoin(socket, data);
      });

      socket.on('leave_room', (data) => {
        eventHandler.handleRoomLeave(socket, data);
      });

      socket.on('leave_all_rooms', () => {
        eventHandler.handleLeaveAllRooms(socket);
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
    if (!io) {
      console.error('❌ Socket.IO not initialized');
      return false;
    }
    
    const room = `user:${userId}`;
    const payload = {
      ...data,
      timestamp: new Date().toISOString()
    };
    
    console.log(`📡 Sending ${event} to user ${userId} in room ${room}`);
    console.log(`📡 Payload:`, JSON.stringify(payload, null, 2));
    
    io.to(room).emit(event, payload);
    
    // Check if user is in the room
    const roomSockets = io.sockets.adapter.rooms.get(room);
    if (!roomSockets || roomSockets.size === 0) {
      console.log(`📡 User ${userId} offline (not in room ${room})`);
      return false;
    }
    
    console.log(`✅ Message sent to ${roomSockets.size} socket(s) in room ${room}`);
    return true;
  } catch (error) {
    console.error('❌ Socket sendToUser error:', error);
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

// Additional methods required by realtime.js
const getConnectedUsersCount = () => {
  if (!io) return 0;
  return io.sockets.sockets.size;
};

const getActiveBookingRoomsCount = () => {
  if (!io) return 0;
  const rooms = io.sockets.adapter.rooms;
  let bookingRooms = 0;
  for (const [roomName] of rooms) {
    // ✅ CRITICAL FIX: Use correct room naming format (booking: not booking_)
    if (roomName.startsWith('booking:')) {
      bookingRooms++;
    }
  }
  return bookingRooms;
};

/**
 * ✅ UTILITY: Get comprehensive room statistics for monitoring multiple concurrent bookings
 * @returns {Object} Detailed room statistics
 */
const getRoomStatistics = () => {
  try {
    if (!io) {
      return { error: 'Socket.IO not initialized' };
    }
    
    const rooms = io.sockets.adapter.rooms;
    const bookingRooms = new Map();
    const userRooms = new Map();
    let totalSockets = 0;
    let totalBookingRooms = 0;
    let totalUserRooms = 0;
    
    // Count booking rooms and user rooms
    rooms.forEach((sockets, roomName) => {
      // ✅ CRITICAL FIX: Use correct room naming format (booking: not booking_)
      if (roomName.startsWith('booking:')) {
        const bookingId = roomName.replace('booking:', '');
        bookingRooms.set(bookingId, sockets.size);
        totalBookingRooms++;
        totalSockets += sockets.size;
      } else if (roomName.startsWith('user:')) {
        const userId = roomName.replace('user:', '');
        userRooms.set(userId, sockets.size);
        totalUserRooms++;
        totalSockets += sockets.size;
      }
    });
    
    return {
      success: true,
      totalRooms: totalBookingRooms + totalUserRooms,
      totalSockets,
      bookingRooms: {
        count: totalBookingRooms,
        details: Array.from(bookingRooms.entries()).map(([bookingId, socketCount]) => ({
          bookingId,
          socketCount,
          room: `booking:${bookingId}`
        }))
      },
      userRooms: {
        count: totalUserRooms,
        details: Array.from(userRooms.entries()).slice(0, 10).map(([userId, socketCount]) => ({
          userId,
          socketCount,
          room: `user:${userId}`
        }))
      },
      capacity: {
        estimatedMaxBookings: 10000, // No hard limit
        currentUsage: totalBookingRooms,
        usagePercent: ((totalBookingRooms / 10000) * 100).toFixed(2) + '%'
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Error getting room statistics:', error);
    return { error: error.message };
  }
};

const getDriverLocations = () => {
  // Return a Map of driver locations (placeholder implementation)
  return new Map();
};

const updateDriverLocationInDB = async (driverId, location, bookingId) => {
  // Placeholder implementation - should update driver location in database
  console.log(`Updating driver ${driverId} location for booking ${bookingId}:`, location);
  return true;
};

const sendToBooking = (bookingId, event, data) => {
  if (!io) return false;
  // ✅ CRITICAL FIX: Use consistent room naming (booking:${bookingId})
  const roomName = `booking:${bookingId}`;
  io.to(roomName).emit(event, data);
  console.log(`📤 [SOCKET] Sent ${event} to booking room: ${roomName}`);
  return true;
};

const updateBookingStatus = async (bookingId, status, updatedBy) => {
  // Placeholder implementation - should update booking status in database
  console.log(`Updating booking ${bookingId} status to ${status} by ${updatedBy}`);
  return true;
};

const updatePaymentStatus = async (paymentId, status, updatedBy) => {
  // Placeholder implementation - should update payment status in database
  console.log(`Updating payment ${paymentId} status to ${status} by ${updatedBy}`);
  return true;
};

const getPayment = async (paymentId) => {
  // Placeholder implementation - should get payment from database
  console.log(`Getting payment ${paymentId}`);
  return { bookingId: 'placeholder_booking_id', customerId: 'placeholder_customer_id' };
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
  healthCheck,
  // Additional methods for realtime.js
  getConnectedUsersCount,
  getActiveBookingRoomsCount,
  getRoomStatistics, // ✅ UTILITY: Get comprehensive room statistics for monitoring
  getDriverLocations,
  updateDriverLocationInDB,
  sendToBooking,
  updateBookingStatus,
  updatePaymentStatus,
  getPayment
};
