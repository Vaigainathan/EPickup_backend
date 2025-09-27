/**
 * Database Connection Pool Service
 * Manages Firestore connections and query optimization
 */

const { getFirestore } = require('./firebase');
const cachingService = require('./cachingService');

class DatabasePoolService {
  constructor() {
    this.db = getFirestore();
    this.queryCache = new Map();
    this.connectionStats = {
      totalQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageQueryTime: 0,
      activeConnections: 0
    };
    this.queryTimeouts = new Map();
  }

  /**
   * Execute a Firestore query with caching and optimization
   * @param {Function} queryFunction - Function that returns a Firestore query
   * @param {Object} options - Query options
   * @returns {Promise<any>} Query result
   */
  async executeQuery(queryFunction, options = {}) {
    const {
      cacheKey = null,
      cacheTTL = 300,
      timeout = 10000,
      retries = 3,
      useCache = true
    } = options;

    const startTime = Date.now();
    this.connectionStats.totalQueries++;

    try {
      // Try cache first
      if (useCache && cacheKey) {
        const cached = await cachingService.get(cacheKey, 'both');
        if (cached) {
          this.connectionStats.cacheHits++;
          console.log(`✅ [DB_POOL] Cache hit for query: ${cacheKey}`);
          return cached;
        }
        this.connectionStats.cacheMisses++;
      }

      // Execute query with timeout
      const queryPromise = queryFunction();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout')), timeout);
      });

      const result = await Promise.race([queryPromise, timeoutPromise]);
      
      // Process result
      const processedResult = this.processQueryResult(result);

      // Cache result
      if (useCache && cacheKey) {
        await cachingService.set(cacheKey, processedResult, cacheTTL, 'both');
      }

      // Update stats
      const queryTime = Date.now() - startTime;
      this.updateQueryStats(queryTime);

      console.log(`✅ [DB_POOL] Query executed in ${queryTime}ms`);
      return processedResult;

    } catch (error) {
      console.error('❌ [DB_POOL] Query error:', error);
      
      // Retry logic
      if (retries > 0 && !error.message.includes('timeout')) {
        console.log(`🔄 [DB_POOL] Retrying query, ${retries} attempts left`);
        await this.sleep(1000); // Wait 1 second before retry
        return this.executeQuery(queryFunction, { ...options, retries: retries - 1 });
      }
      
      throw error;
    }
  }

  /**
   * Process query result for consistency
   * @param {any} result - Query result
   * @returns {any} Processed result
   */
  processQueryResult(result) {
    if (result && typeof result === 'object') {
      // Handle Firestore QuerySnapshot
      if (result.docs && Array.isArray(result.docs)) {
        return {
          docs: result.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          })),
          size: result.size,
          empty: result.empty
        };
      }
      
      // Handle Firestore DocumentSnapshot
      if (result.exists !== undefined) {
        return {
          id: result.id,
          exists: result.exists,
          data: result.exists ? result.data() : null
        };
      }
    }
    
    return result;
  }

  /**
   * Update query statistics
   * @param {number} queryTime - Query execution time in ms
   */
  updateQueryStats(queryTime) {
    const totalTime = this.connectionStats.averageQueryTime * (this.connectionStats.totalQueries - 1);
    this.connectionStats.averageQueryTime = (totalTime + queryTime) / this.connectionStats.totalQueries;
  }

  /**
   * Get user by ID with caching
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Promise<Object|null>} User data
   */
  async getUserById(userId, options = {}) {
    const cacheKey = `user:${userId}`;
    
    return this.executeQuery(
      () => this.db.collection('users').doc(userId).get(),
      {
        cacheKey,
        cacheTTL: 300,
        ...options
      }
    );
  }

  /**
   * Get booking by ID with caching
   * @param {string} bookingId - Booking ID
   * @param {Object} options - Query options
   * @returns {Promise<Object|null>} Booking data
   */
  async getBookingById(bookingId, options = {}) {
    const cacheKey = `booking:${bookingId}`;
    
    return this.executeQuery(
      () => this.db.collection('bookings').doc(bookingId).get(),
      {
        cacheKey,
        cacheTTL: 180,
        ...options
      }
    );
  }

  /**
   * Get bookings with filters and caching
   * @param {Object} filters - Query filters
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Bookings array
   */
  async getBookings(filters = {}, options = {}) {
    const { status, driverId, customerId, startDate, endDate, limit = 50, offset = 0 } = filters;
    const cacheKey = `bookings:${JSON.stringify(filters)}`;
    
    return this.executeQuery(
      () => {
        let query = this.db.collection('bookings');
        
        if (status) query = query.where('status', '==', status);
        if (driverId) query = query.where('driverId', '==', driverId);
        if (customerId) query = query.where('customerId', '==', customerId);
        if (startDate) query = query.where('createdAt', '>=', new Date(startDate));
        if (endDate) query = query.where('createdAt', '<=', new Date(endDate));
        
        query = query.orderBy('createdAt', 'desc');
        query = query.limit(limit).offset(offset);
        
        return query.get();
      },
      {
        cacheKey,
        cacheTTL: 60,
        ...options
      }
    );
  }

  /**
   * Get available drivers with caching
   * @param {Object} filters - Query filters
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Drivers array
   */
  async getAvailableDrivers(filters = {}, options = {}) {
    const { location } = filters;
    const cacheKey = `drivers:available:${location || 'all'}`;
    
    return this.executeQuery(
      () => {
        const query = this.db.collection('users')
          .where('userType', '==', 'driver')
          .where('driver.isOnline', '==', true)
          .where('driver.isAvailable', '==', true);
        
        return query.get();
      },
      {
        cacheKey,
        cacheTTL: 30,
        ...options
      }
    );
  }

  /**
   * Batch write operations
   * @param {Array} operations - Array of write operations
   * @param {Object} options - Batch options
   * @returns {Promise<Object>} Batch result
   */
  async batchWrite(operations, options = {}) {
    const { invalidateCache = true } = options;
    const startTime = Date.now();
    
    try {
      const batch = this.db.batch();
      
      // Add operations to batch
      operations.forEach(op => {
        const { type, ref, data } = op;
        
        switch (type) {
          case 'set':
            batch.set(ref, data);
            break;
          case 'update':
            batch.update(ref, data);
            break;
          case 'delete':
            batch.delete(ref);
            break;
          default:
            throw new Error(`Unknown operation type: ${type}`);
        }
      });
      
      // Execute batch
      await batch.commit();
      
      // Invalidate related cache
      if (invalidateCache) {
        await this.invalidateRelatedCache(operations);
      }
      
      const executionTime = Date.now() - startTime;
      console.log(`✅ [DB_POOL] Batch write completed in ${executionTime}ms`);
      
      return {
        success: true,
        operationsCount: operations.length,
        executionTime
      };
      
    } catch (error) {
      console.error('❌ [DB_POOL] Batch write error:', error);
      throw error;
    }
  }

  /**
   * Invalidate cache for related operations
   * @param {Array} operations - Operations that were executed
   */
  async invalidateRelatedCache(operations) {
    const patterns = new Set();
    
    operations.forEach(op => {
      const { ref } = op;
      if (ref && ref.path) {
        const pathParts = ref.path.split('/');
        if (pathParts[0] === 'users') {
          patterns.add('user:');
        } else if (pathParts[0] === 'bookings') {
          patterns.add('booking:');
        } else if (pathParts[0] === 'drivers') {
          patterns.add('driver:');
        }
      }
    });
    
    // Invalidate cache patterns
    for (const pattern of patterns) {
      await cachingService.invalidatePattern(pattern, 'memory');
    }
  }

  /**
   * Get connection statistics
   * @returns {Object} Connection statistics
   */
  getStats() {
    return {
      ...this.connectionStats,
      cacheHitRate: this.connectionStats.totalQueries > 0 
        ? (this.connectionStats.cacheHits / this.connectionStats.totalQueries) * 100 
        : 0,
      cacheMissRate: this.connectionStats.totalQueries > 0 
        ? (this.connectionStats.cacheMisses / this.connectionStats.totalQueries) * 100 
        : 0
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.connectionStats = {
      totalQueries: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageQueryTime: 0,
      activeConnections: 0
    };
  }

  /**
   * Health check
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const startTime = Date.now();
      await this.db.collection('_health').doc('check').get();
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Sleep utility
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Promise that resolves after delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Optimize query performance
   * @param {Object} query - Firestore query
   * @param {Object} options - Optimization options
   * @returns {Object} Optimized query
   */
  optimizeQuery(query, options = {}) {
    const { useIndexes = true, limitResults = true, maxLimit = 100 } = options;
    
    // Apply limit if not specified
    if (limitResults && !query._queryOptions?.limit) {
      query = query.limit(maxLimit);
    }
    
    // Add query hints for better performance
    if (useIndexes) {
      // This would be implemented based on specific Firestore indexes
      console.log('🔍 [DB_POOL] Query optimization applied');
    }
    
    return query;
  }
}

module.exports = new DatabasePoolService();
