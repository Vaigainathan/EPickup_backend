const jwt = require('jsonwebtoken');
const monitoringService = require('../services/monitoringService');

/**
 * WebSocket Security Middleware
 * Provides authentication, authorization, and rate limiting for WebSocket connections
 */
class WebSocketSecurity {
  constructor() {
    this.jwtSecret = process.env.JWT_SECRET;
    this.connectionLimits = new Map();
    this.maxConnectionsPerUser = 3;
    this.connectionTimeout = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Authenticate WebSocket connection
   * @param {Object} socket - Socket instance
   * @param {Function} next - Next middleware function
   */
  async authenticate(socket, next) {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, this.jwtSecret);
      
      // Attach user info to socket
      socket.user = {
        uid: decoded.uid,
        userType: decoded.userType,
        phone: decoded.phone,
        name: decoded.name
      };

      // Check connection limits
      if (!(await this.checkConnectionLimits(socket.user.uid))) {
        return next(new Error('Too many connections'));
      }

      // Log successful authentication
      await monitoringService.logWebSocketEvent('connection_authenticated', {
        userId: socket.user.uid,
        userType: socket.user.userType
      }, socket.user.uid);

      next();
    } catch (error) {
      console.error('WebSocket authentication error:', error);
      
      await monitoringService.logError(error, {
        socketId: socket.id,
        handshake: socket.handshake
      }, 'websocket_security');

      next(new Error('Authentication failed'));
    }
  }

  /**
   * Authorize WebSocket events
   * @param {Object} socket - Socket instance
   * @param {Function} next - Next middleware function
   */
  authorize(socket, next) {
    // Check if user is authenticated
    if (!socket.user) {
      return next(new Error('User not authenticated'));
    }

    // Rate limiting for events
    const rateLimitKey = `ws_${socket.user.uid}`;
    const now = Date.now();
    const userEvents = this.connectionLimits.get(rateLimitKey) || { events: [], lastEvent: 0 };
    
    // Clean old events (older than 1 minute)
    userEvents.events = userEvents.events.filter(timestamp => now - timestamp < 60000);
    
    // Check rate limit (max 60 events per minute)
    if (userEvents.events.length >= 60) {
      return next(new Error('Rate limit exceeded'));
    }

    // Record this event
    userEvents.events.push(now);
    userEvents.lastEvent = now;
    this.connectionLimits.set(rateLimitKey, userEvents);

    next();
  }

  /**
   * Check connection limits per user
   * @param {string} userId - User ID
   * @returns {boolean} Whether connection is allowed
   */
  async checkConnectionLimits(userId) {
    const userConnections = Array.from(this.connectionLimits.entries())
      .filter(([key]) => key.startsWith(`ws_${userId}`))
      .length;

    return userConnections < this.maxConnectionsPerUser;
  }

  /**
   * Validate event data
   * @param {string} event - Event name
   * @param {Object} eventData - Event data
   * @returns {Object} Validation result
   */
  validateEventData(event, eventData) {
    const validators = {
      'location_update': this.validateLocationUpdate,
      'booking_status_update': this.validateBookingStatusUpdate,
      'driver_assignment': this.validateDriverAssignment,
      'new_booking_available': this.validateNewBookingAvailable
    };

    const validator = validators[event];
    if (!validator) {
      return { isValid: true }; // Allow unknown events
    }

    return validator(eventData);
  }

  /**
   * Validate location update data
   * @param {Object} data - Location data
   * @returns {Object} Validation result
   */
  validateLocationUpdate(data) {
    const errors = [];

    if (!data.latitude || typeof data.latitude !== 'number') {
      errors.push('Invalid latitude');
    }
    if (!data.longitude || typeof data.longitude !== 'number') {
      errors.push('Invalid longitude');
    }
    if (data.latitude < -90 || data.latitude > 90) {
      errors.push('Latitude out of range');
    }
    if (data.longitude < -180 || data.longitude > 180) {
      errors.push('Longitude out of range');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate booking status update data
   * @param {Object} data - Booking data
   * @returns {Object} Validation result
   */
  validateBookingStatusUpdate(data) {
    const errors = [];
    const validStatuses = ['pending', 'driver_assigned', 'accepted', 'driver_enroute', 
                          'driver_arrived', 'picked_up', 'in_transit', 'delivered', 
                          'completed', 'cancelled', 'rejected'];

    if (!data.bookingId || typeof data.bookingId !== 'string') {
      errors.push('Invalid booking ID');
    }
    if (!data.status || !validStatuses.includes(data.status)) {
      errors.push('Invalid booking status');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate driver assignment data
   * @param {Object} data - Assignment data
   * @returns {Object} Validation result
   */
  validateDriverAssignment(data) {
    const errors = [];

    if (!data.bookingId || typeof data.bookingId !== 'string') {
      errors.push('Invalid booking ID');
    }
    if (!data.driverId || typeof data.driverId !== 'string') {
      errors.push('Invalid driver ID');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate new booking available data
   * @param {Object} data - Booking data
   * @returns {Object} Validation result
   */
  validateNewBookingAvailable(data) {
    const errors = [];

    if (!data.booking || typeof data.booking !== 'object') {
      errors.push('Invalid booking data');
    }
    if (!data.booking.id || typeof data.booking.id !== 'string') {
      errors.push('Invalid booking ID');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Handle WebSocket errors
   * @param {Object} socket - Socket instance
   * @param {Error} error - Error object
   */
  async handleError(socket, error) {
    console.error('WebSocket error:', error);
    
    await monitoringService.logError(error, {
      socketId: socket.id,
      userId: socket.user?.uid,
      userType: socket.user?.userType
    }, 'websocket_security');

    // Send error to client
    socket.emit('error', {
      code: 'WEBSOCKET_ERROR',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Clean up expired connections
   */
  cleanupExpiredConnections() {
    const now = Date.now();
    
    for (const [key, data] of this.connectionLimits.entries()) {
      if (now - data.lastEvent > this.connectionTimeout) {
        this.connectionLimits.delete(key);
      }
    }
  }

  /**
   * Get connection statistics
   * @returns {Object} Connection stats
   */
  getConnectionStats() {
    const totalConnections = this.connectionLimits.size;
    const userTypes = {};
    
    for (const [key] of this.connectionLimits.entries()) {
      const userId = key.replace('ws_', '');
      // This is a simplified version - in production, you'd want to track user types
      userTypes[userId] = userTypes[userId] || 0;
      userTypes[userId]++;
    }

    return {
      totalConnections,
      userTypes,
      timestamp: new Date()
    };
  }

  /**
   * Middleware for event validation
   * @param {string} event - Event name
   * @returns {Function} Middleware function
   */
  eventValidation(event) {
    return (socket, eventData, next) => {
      const validation = this.validateEventData(event, eventData);
      
      if (!validation.isValid) {
        return next(new Error(`Invalid event data: ${validation.errors.join(', ')}`));
      }

      next();
    };
  }

  /**
   * Middleware for user type authorization
   * @param {Array} allowedTypes - Allowed user types
   * @returns {Function} Middleware function
   */
  requireUserType(allowedTypes) {
    return (socket, next) => {
      if (!socket.user) {
        return next(new Error('User not authenticated'));
      }

      if (!allowedTypes.includes(socket.user.userType)) {
        return next(new Error('Insufficient permissions'));
      }

      next();
    };
  }
}

module.exports = new WebSocketSecurity();
