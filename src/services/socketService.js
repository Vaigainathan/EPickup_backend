const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { getFirestore } = require('./firebase');

/**
 * WebSocket Service for EPickup real-time features
 * Handles real-time communication for booking updates, driver tracking, and notifications
 */
class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socketId
    this.bookingRooms = new Map(); // bookingId -> Set of socketIds
    this.driverLocations = new Map(); // driverId -> location data
    this.db = getFirestore();
  }

  /**
   * Initialize Socket.IO server
   * @param {Object} server - HTTP server instance
   */
  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || [
          'http://localhost:3000',  // Admin dashboard
          'http://localhost:3001',  // Customer app
          'http://localhost:8081',  // Driver app (Expo)
          'https://epickup-app.web.app'
        ],
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    // Authentication middleware
    this.io.use(this.authenticateSocket);

    // Connection handling
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    console.log('WebSocket server initialized');
  }

  /**
   * Authenticate socket connection using JWT
   * @param {Object} socket - Socket instance
   * @param {Function} next - Next function
   */
  async authenticateSocket(socket, next) {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.uid;
      socket.userType = decoded.userType;
      socket.userData = decoded;
      
      next();
    } catch (error) {
      console.error('Socket authentication error:', error);
      next(new Error('Authentication failed'));
    }
  }

  /**
   * Handle new socket connection
   * @param {Object} socket - Socket instance
   */
  handleConnection(socket) {
    const { userId, userType } = socket;
    
    console.log(`User connected: ${userId} (${userType})`);
    
    // Store user connection
    this.connectedUsers.set(userId, socket.id);
    
    // Join user-specific room
    socket.join(`user:${userId}`);
    
    // Join role-specific room
    socket.join(`role:${userType}`);

    // Handle booking room joins
    socket.on('join-booking', (bookingId) => {
      this.joinBookingRoom(socket, bookingId);
    });

    // Handle booking room leaves
    socket.on('leave-booking', (bookingId) => {
      this.leaveBookingRoom(socket, bookingId);
    });

    // Handle driver location updates
    socket.on('update-location', (data) => {
      this.handleDriverLocationUpdate(socket, data);
    });

    // Handle booking status updates
    socket.on('update-booking-status', (data) => {
      this.handleBookingStatusUpdate(socket, data);
    });

    // Handle payment status updates
    socket.on('update-payment-status', (data) => {
      this.handlePaymentStatusUpdate(socket, data);
    });

    // Handle driver assignment
    socket.on('assign-driver', (data) => {
      this.handleDriverAssignment(socket, data);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnection(socket);
    });

    // Send initial connection confirmation
    socket.emit('connected', {
      userId,
      userType,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Join booking-specific room
   * @param {Object} socket - Socket instance
   * @param {string} bookingId - Booking ID
   */
  joinBookingRoom(socket, bookingId) {
    socket.join(`booking:${bookingId}`);
    
    if (!this.bookingRooms.has(bookingId)) {
      this.bookingRooms.set(bookingId, new Set());
    }
    this.bookingRooms.get(bookingId).add(socket.id);
    
    console.log(`User ${socket.userId} joined booking room: ${bookingId}`);
    
    // Send current booking status
    this.sendBookingStatus(bookingId);
  }

  /**
   * Leave booking-specific room
   * @param {Object} socket - Socket instance
   * @param {string} bookingId - Booking ID
   */
  leaveBookingRoom(socket, bookingId) {
    socket.leave(`booking:${bookingId}`);
    
    if (this.bookingRooms.has(bookingId)) {
      this.bookingRooms.get(bookingId).delete(socket.id);
      if (this.bookingRooms.get(bookingId).size === 0) {
        this.bookingRooms.delete(bookingId);
      }
    }
    
    console.log(`User ${socket.userId} left booking room: ${bookingId}`);
  }

  /**
   * Handle driver location updates
   * @param {Object} socket - Socket instance
   * @param {Object} data - Location data
   */
  async handleDriverLocationUpdate(socket, data) {
    try {
      const { bookingId, location, estimatedArrival } = data;
      const driverId = socket.userId;

      // Validate location data
      if (!location || !location.lat || !location.lng) {
        socket.emit('error', { message: 'Invalid location data' });
        return;
      }

      // Store driver location
      this.driverLocations.set(driverId, {
        location,
        estimatedArrival,
        timestamp: new Date(),
        bookingId
      });

      // Update database
      await this.updateDriverLocationInDB(driverId, location, bookingId);

      // Broadcast to booking room
      this.io.to(`booking:${bookingId}`).emit('driver-location-update', {
        driverId,
        location,
        estimatedArrival,
        timestamp: new Date().toISOString()
      });

      console.log(`Driver ${driverId} location updated for booking ${bookingId}`);
    } catch (error) {
      console.error('Driver location update error:', error);
      socket.emit('error', { message: 'Failed to update location' });
    }
  }

  /**
   * Handle booking status updates
   * @param {Object} socket - Socket instance
   * @param {Object} data - Status update data
   */
  async handleBookingStatusUpdate(socket, data) {
    try {
      const { bookingId, status, message } = data;
      const userId = socket.userId;

      // Validate booking ownership or driver assignment
      const booking = await this.getBooking(bookingId);
      if (!booking) {
        socket.emit('error', { message: 'Booking not found' });
        return;
      }

      if (booking.customerId !== userId && booking.driverId !== userId) {
        socket.emit('error', { message: 'Access denied' });
        return;
      }

      // Update booking status in database
      await this.updateBookingStatus(bookingId, status, userId);

      // Broadcast to booking room
      this.io.to(`booking:${bookingId}`).emit('booking-status-update', {
        bookingId,
        status,
        message,
        updatedBy: userId,
        timestamp: new Date().toISOString()
      });

      // Send notification to relevant users
      this.sendBookingNotification(bookingId, status, message);

      console.log(`Booking ${bookingId} status updated to ${status}`);
    } catch (error) {
      console.error('Booking status update error:', error);
      socket.emit('error', { message: 'Failed to update booking status' });
    }
  }

  /**
   * Handle payment status updates
   * @param {Object} socket - Socket instance
   * @param {Object} data - Payment update data
   */
  async handlePaymentStatusUpdate(socket, data) {
    try {
      const { paymentId, status, message } = data;
      const userId = socket.userId;

      // Get payment record
      const payment = await this.getPayment(paymentId);
      if (!payment) {
        socket.emit('error', { message: 'Payment not found' });
        return;
      }

      // Update payment status in database
      await this.updatePaymentStatus(paymentId, status, userId);

      // Broadcast to booking room
      this.io.to(`booking:${payment.bookingId}`).emit('payment-status-update', {
        paymentId,
        bookingId: payment.bookingId,
        status,
        message,
        updatedBy: userId,
        timestamp: new Date().toISOString()
      });

      console.log(`Payment ${paymentId} status updated to ${status}`);
    } catch (error) {
      console.error('Payment status update error:', error);
      socket.emit('error', { message: 'Failed to update payment status' });
    }
  }

  /**
   * Handle driver assignment
   * @param {Object} socket - Socket instance
   * @param {Object} data - Assignment data
   */
  async handleDriverAssignment(socket, data) {
    try {
      const { bookingId, driverId } = data;
      const userId = socket.userId;

      // Validate assignment (only customer or admin can assign)
      const booking = await this.getBooking(bookingId);
      if (!booking || booking.customerId !== userId) {
        socket.emit('error', { message: 'Access denied' });
        return;
      }

      // Update booking with driver assignment
      await this.assignDriverToBooking(bookingId, driverId);

      // Broadcast to booking room
      this.io.to(`booking:${bookingId}`).emit('driver-assigned', {
        bookingId,
        driverId,
        assignedBy: userId,
        timestamp: new Date().toISOString()
      });

      // Notify driver
      this.io.to(`user:${driverId}`).emit('new-booking-assigned', {
        bookingId,
        booking: booking,
        timestamp: new Date().toISOString()
      });

      console.log(`Driver ${driverId} assigned to booking ${bookingId}`);
    } catch (error) {
      console.error('Driver assignment error:', error);
      socket.emit('error', { message: 'Failed to assign driver' });
    }
  }

  /**
   * Handle socket disconnection
   * @param {Object} socket - Socket instance
   */
  handleDisconnection(socket) {
    const { userId, userType } = socket;
    
    console.log(`User disconnected: ${userId} (${userType})`);
    
    // Remove from connected users
    this.connectedUsers.delete(userId);
    
    // Remove from booking rooms
    this.bookingRooms.forEach((socketIds, bookingId) => {
      if (socketIds.has(socket.id)) {
        socketIds.delete(socket.id);
        if (socketIds.size === 0) {
          this.bookingRooms.delete(bookingId);
        }
      }
    });
    
    // Remove driver location if driver
    if (userType === 'driver') {
      this.driverLocations.delete(userId);
    }
  }

  /**
   * Send booking status to room
   * @param {string} bookingId - Booking ID
   */
  async sendBookingStatus(bookingId) {
    try {
      const booking = await this.getBooking(bookingId);
      if (booking) {
        this.io.to(`booking:${bookingId}`).emit('booking-status', {
          bookingId,
          status: booking.bookingStatus,
          data: booking,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('Send booking status error:', error);
    }
  }

  /**
   * Send notification to users
   * @param {string} bookingId - Booking ID
   * @param {string} status - Booking status
   * @param {string} message - Notification message
   */
  async sendBookingNotification(bookingId, status, message) {
    try {
      const booking = await this.getBooking(bookingId);
      if (!booking) return;

      const notification = {
        bookingId,
        status,
        message,
        timestamp: new Date().toISOString()
      };

      // Notify customer
      this.io.to(`user:${booking.customerId}`).emit('booking-notification', notification);

      // Notify driver if assigned
      if (booking.driverId) {
        this.io.to(`user:${booking.driverId}`).emit('booking-notification', notification);
      }
    } catch (error) {
      console.error('Send notification error:', error);
    }
  }

  /**
   * Broadcast to all connected users
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  broadcastToAll(event, data) {
    if (this.io) {
      this.io.emit(event, data);
    }
  }

  /**
   * Send to specific user
   * @param {string} userId - User ID
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  sendToUser(userId, event, data) {
    if (this.io) {
      this.io.to(`user:${userId}`).emit(event, data);
    }
  }

  /**
   * Send to booking room
   * @param {string} bookingId - Booking ID
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  sendToBooking(bookingId, event, data) {
    if (this.io) {
      this.io.to(`booking:${bookingId}`).emit(event, data);
    }
  }

  /**
   * Send to role-specific room
   * @param {string} role - User role
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  sendToRole(role, event, data) {
    if (this.io) {
      this.io.to(`role:${role}`).emit(event, data);
    }
  }

  /**
   * Send to topic/room
   * @param {string} topic - Topic/room name
   * @param {Object} data - Event data
   */
  sendToTopic(topic, data) {
    if (this.io) {
      this.io.to(`topic:${topic}`).emit('notification', data);
    }
  }

  /**
   * Get Socket.IO instance
   * @returns {Object|null} Socket.IO instance
   */
  getSocketIO() {
    return this.io;
  }

  // Database helper methods

  /**
   * Get booking from database
   * @param {string} bookingId - Booking ID
   * @returns {Object|null} Booking data
   */
  async getBooking(bookingId) {
    try {
      const doc = await this.db.collection('bookings').doc(bookingId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Get booking error:', error);
      return null;
    }
  }

  /**
   * Get payment from database
   * @param {string} paymentId - Payment ID
   * @returns {Object|null} Payment data
   */
  async getPayment(paymentId) {
    try {
      const doc = await this.db.collection('payments').doc(paymentId).get();
      return doc.exists ? { id: doc.id, ...doc.data() } : null;
    } catch (error) {
      console.error('Get payment error:', error);
      return null;
    }
  }

  /**
   * Update driver location in database
   * @param {string} driverId - Driver ID
   * @param {Object} location - Location data
   * @param {string} bookingId - Booking ID
   */
  async updateDriverLocationInDB(driverId, location, bookingId) {
    try {
      await this.db.collection('drivers').doc(driverId).update({
        currentLocation: {
          lat: location.lat,
          lng: location.lng,
          updatedAt: new Date()
        }
      });

      // Add to tracking collection
      await this.db.collection('tracking').add({
        bookingId,
        driverId,
        location: {
          lat: location.lat,
          lng: location.lng,
          accuracy: location.accuracy || null,
          speed: location.speed || null
        },
        status: 'tracking',
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Update driver location in DB error:', error);
    }
  }

  /**
   * Update booking status in database
   * @param {string} bookingId - Booking ID
   * @param {string} status - New status
   * @param {string} updatedBy - User who updated
   */
  async updateBookingStatus(bookingId, status, updatedBy) {
    try {
      await this.db.collection('bookings').doc(bookingId).update({
        bookingStatus: status,
        updatedAt: new Date(),
        lastUpdatedBy: updatedBy
      });
    } catch (error) {
      console.error('Update booking status error:', error);
      throw error;
    }
  }

  /**
   * Update payment status in database
   * @param {string} paymentId - Payment ID
   * @param {string} status - New status
   * @param {string} updatedBy - User who updated
   */
  async updatePaymentStatus(paymentId, status, updatedBy) {
    try {
      await this.db.collection('payments').doc(paymentId).update({
        paymentStatus: status,
        updatedAt: new Date(),
        lastUpdatedBy: updatedBy
      });
    } catch (error) {
      console.error('Update payment status error:', error);
      throw error;
    }
  }

  /**
   * Assign driver to booking
   * @param {string} bookingId - Booking ID
   * @param {string} driverId - Driver ID
   */
  async assignDriverToBooking(bookingId, driverId) {
    try {
      await this.db.collection('bookings').doc(bookingId).update({
        driverId,
        bookingStatus: 'assigned',
        assignedAt: new Date(),
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Assign driver error:', error);
      throw error;
    }
  }

  /**
   * Get connected users count
   * @returns {number} Number of connected users
   */
  getConnectedUsersCount() {
    return this.connectedUsers.size;
  }

  /**
   * Get active booking rooms count
   * @returns {number} Number of active booking rooms
   */
  getActiveBookingRoomsCount() {
    return this.bookingRooms.size;
  }

  /**
   * Get driver locations
   * @returns {Map} Driver locations map
   */
  getDriverLocations() {
    return this.driverLocations;
  }
}

module.exports = new SocketService();
