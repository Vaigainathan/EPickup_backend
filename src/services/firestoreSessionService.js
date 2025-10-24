const { getFirestore } = require('./firebase');

/**
 * Firestore-based Session Management Service
 * Replaces Redis for session storage with Firestore
 */
class FirestoreSessionService {
  constructor() {
    this.db = null; // Initialize lazily
    this.sessionCollection = 'user_sessions';
    this.rateLimitCollection = 'rate_limits';
    this.cacheCollection = 'cache_data';
  }

  /**
   * Get Firestore instance (lazy initialization)
   */
  getDb() {
    if (!this.db) {
      try {
        this.db = getFirestore();
      } catch (error) {
        console.error('❌ [FirestoreSessionService] Failed to get Firestore:', error);
        throw new Error('Firebase not initialized. Please ensure Firebase is initialized before using FirestoreSessionService.');
      }
    }
    return this.db;
  }

  /**
   * Store user session
   * @param {string} sessionId - Session ID
   * @param {Object} sessionData - Session data
   * @param {number} ttl - Time to live in seconds
   */
  async setSession(sessionId, sessionData, ttl = 3600) {
    try {
      // ✅ CRITICAL FIX: Ensure database is initialized
      const db = this.getDb();
      
      const expiresAt = new Date(Date.now() + (ttl * 1000));
      
      await db.collection(this.sessionCollection).doc(sessionId).set({
        ...sessionData,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // Set up automatic cleanup
      setTimeout(() => {
        this.cleanupExpiredSession(sessionId);
      }, ttl * 1000);

      return { success: true };
    } catch (error) {
      console.error('Set session error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get user session
   * @param {string} sessionId - Session ID
   */
  async getSession(sessionId) {
    try {
      // ✅ CRITICAL FIX: Ensure database is initialized
      const db = this.getDb();
      const doc = await db.collection(this.sessionCollection).doc(sessionId).get();
      
      if (!doc.exists) {
        return { success: false, data: null };
      }

      const data = doc.data();
      
      // Check if session is expired
      if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
        await this.deleteSession(sessionId);
        return { success: false, data: null };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Get session error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete user session
   * @param {string} sessionId - Session ID
   */
  async deleteSession(sessionId) {
    try {
      // ✅ CRITICAL FIX: Ensure database is initialized
      const db = this.getDb();
      await db.collection(this.sessionCollection).doc(sessionId).delete();
      return { success: true };
    } catch (error) {
      console.error('Delete session error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update session data
   * @param {string} sessionId - Session ID
   * @param {Object} updateData - Data to update
   */
  async updateSession(sessionId, updateData) {
    try {
      await this.db.collection(this.sessionCollection).doc(sessionId).update({
        ...updateData,
        updatedAt: new Date()
      });
      return { success: true };
    } catch (error) {
      console.error('Update session error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clean up expired session
   * @param {string} sessionId - Session ID
   */
  async cleanupExpiredSession(sessionId) {
    try {
      await this.db.collection(this.sessionCollection).doc(sessionId).delete();
    } catch (error) {
      console.error('Cleanup session error:', error);
    }
  }

  /**
   * Clean up all expired sessions
   */
  async cleanupExpiredSessions() {
    try {
      const now = new Date();
      const expiredSessions = await this.db.collection(this.sessionCollection)
        .where('expiresAt', '<=', now)
        .get();

      const batch = this.db.batch();
      expiredSessions.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      return { success: true, cleaned: expiredSessions.size };
    } catch (error) {
      console.error('Cleanup expired sessions error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Rate limiting with Firestore
   * @param {string} key - Rate limit key (e.g., userId:endpoint)
   * @param {number} limit - Request limit
   * @param {number} window - Time window in seconds
   */
  async checkRateLimit(key, limit = 100, window = 3600) {
    try {
      const now = new Date();
      const windowStart = new Date(now.getTime() - (window * 1000));
      
      // Get current rate limit data
      const doc = await this.db.collection(this.rateLimitCollection).doc(key).get();
      
      if (!doc.exists) {
        // First request
        await this.db.collection(this.rateLimitCollection).doc(key).set({
          count: 1,
          windowStart: now,
          lastRequest: now,
          createdAt: now
        });
        return { success: true, allowed: true, remaining: limit - 1 };
      }

      const data = doc.data();
      
      // Check if window has expired
      if (data.windowStart.toDate() < windowStart) {
        // Reset window
        await this.db.collection(this.rateLimitCollection).doc(key).update({
          count: 1,
          windowStart: now,
          lastRequest: now,
          updatedAt: now
        });
        return { success: true, allowed: true, remaining: limit - 1 };
      }

      // Check if limit exceeded
      if (data.count >= limit) {
        return { 
          success: true, 
          allowed: false, 
          remaining: 0,
          resetTime: new Date(data.windowStart.toDate().getTime() + (window * 1000))
        };
      }

      // Increment count
      await this.db.collection(this.rateLimitCollection).doc(key).update({
        count: data.count + 1,
        lastRequest: now,
        updatedAt: now
      });

      return { 
        success: true, 
        allowed: true, 
        remaining: limit - (data.count + 1) 
      };
    } catch (error) {
      console.error('Rate limit check error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cache data in Firestore
   * @param {string} key - Cache key
   * @param {Object} data - Data to cache
   * @param {number} ttl - Time to live in seconds
   */
  async setCache(key, data, ttl = 300) {
    try {
      // ✅ CRITICAL FIX: Ensure database is initialized
      const db = this.getDb();
      
      const expiresAt = new Date(Date.now() + (ttl * 1000));
      
      await db.collection(this.cacheCollection).doc(key).set({
        data,
        expiresAt,
        createdAt: new Date()
      });

      return { success: true };
    } catch (error) {
      console.error('Set cache error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get cached data
   * @param {string} key - Cache key
   */
  async getCache(key) {
    try {
      const doc = await this.db.collection(this.cacheCollection).doc(key).get();
      
      if (!doc.exists) {
        return { success: false, data: null };
      }

      const data = doc.data();
      
      // Check if cache is expired
      if (data.expiresAt && data.expiresAt.toDate() < new Date()) {
        await this.deleteCache(key);
        return { success: false, data: null };
      }

      return { success: true, data: data.data };
    } catch (error) {
      console.error('Get cache error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete cached data
   * @param {string} key - Cache key
   */
  async deleteCache(key) {
    try {
      await this.db.collection(this.cacheCollection).doc(key).delete();
      return { success: true };
    } catch (error) {
      console.error('Delete cache error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Store WebSocket connection info
   * @param {string} userId - User ID
   * @param {string} socketId - Socket ID
   * @param {Object} connectionData - Connection data
   */
  async setWebSocketConnection(userId, socketId, connectionData) {
    try {
      // ✅ CRITICAL FIX: Ensure database is initialized
      const db = this.getDb();
      await db.collection('websocket_connections').doc(socketId).set({
        userId,
        socketId,
        ...connectionData,
        connectedAt: new Date(),
        lastSeen: new Date()
      });

      return { success: true };
    } catch (error) {
      console.error('Set WebSocket connection error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get WebSocket connection info
   * @param {string} socketId - Socket ID
   */
  async getWebSocketConnection(socketId) {
    try {
      const doc = await this.db.collection('websocket_connections').doc(socketId).get();
      
      if (!doc.exists) {
        return { success: false, data: null };
      }

      return { success: true, data: doc.data() };
    } catch (error) {
      console.error('Get WebSocket connection error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete WebSocket connection
   * @param {string} socketId - Socket ID
   */
  async deleteWebSocketConnection(socketId) {
    try {
      // ✅ CRITICAL FIX: Ensure database is initialized
      const db = this.getDb();
      await db.collection('websocket_connections').doc(socketId).delete();
      return { success: true };
    } catch (error) {
      console.error('Delete WebSocket connection error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all WebSocket connections for a user
   * @param {string} userId - User ID
   */
  async getUserWebSocketConnections(userId) {
    try {
      const snapshot = await this.db.collection('websocket_connections')
        .where('userId', '==', userId)
        .get();

      const connections = [];
      snapshot.docs.forEach(doc => {
        connections.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return { success: true, data: connections };
    } catch (error) {
      console.error('Get user WebSocket connections error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpiredCache() {
    try {
      const now = new Date();
      const expiredCache = await this.db.collection(this.cacheCollection)
        .where('expiresAt', '<=', now)
        .get();

      const batch = this.db.batch();
      expiredCache.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      return { success: true, cleaned: expiredCache.size };
    } catch (error) {
      console.error('Cleanup expired cache error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get service health status
   */
  async getHealthStatus() {
    try {
      const sessionCount = await this.db.collection(this.sessionCollection).get();
      const cacheCount = await this.db.collection(this.cacheCollection).get();
      const rateLimitCount = await this.db.collection(this.rateLimitCollection).get();
      const wsConnectionCount = await this.db.collection('websocket_connections').get();

      return {
        success: true,
        data: {
          sessions: sessionCount.size,
          cache: cacheCount.size,
          rateLimits: rateLimitCount.size,
          websocketConnections: wsConnectionCount.size,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Create singleton instance
const firestoreSessionService = new FirestoreSessionService();

module.exports = firestoreSessionService;
