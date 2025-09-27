/**
 * Caching Service for Performance Optimization
 * Provides Redis-like caching functionality using memory and Firestore
 */

const { getFirestore } = require('./firebase');

class CachingService {
  constructor() {
    this.memoryCache = new Map();
    this.cacheConfig = {
      defaultTTL: 300, // 5 minutes
      maxMemorySize: 1000, // Maximum number of items in memory cache
      cleanupInterval: 60000 // 1 minute
    };
    this.db = getFirestore();
    this.startCleanupInterval();
  }

  /**
   * Set a value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds
   * @param {string} type - Cache type ('memory', 'firestore', 'both')
   */
  async set(key, value, ttl = this.cacheConfig.defaultTTL, type = 'memory') {
    try {
      const cacheData = {
        value,
        expiresAt: Date.now() + (ttl * 1000),
        createdAt: Date.now(),
        type: typeof value
      };

      // Memory cache
      if (type === 'memory' || type === 'both') {
        this.memoryCache.set(key, cacheData);
        
        // Cleanup if cache is too large
        if (this.memoryCache.size > this.cacheConfig.maxMemorySize) {
          this.cleanupMemoryCache();
        }
      }

      // Firestore cache
      if (type === 'firestore' || type === 'both') {
        await this.db.collection('cache').doc(key).set({
          ...cacheData,
          key,
          updatedAt: new Date()
        });
      }

      console.log(`✅ [CACHE] Set cache for key: ${key}, TTL: ${ttl}s, Type: ${type}`);
      return true;

    } catch (error) {
      console.error('❌ [CACHE] Error setting cache:', error);
      return false;
    }
  }

  /**
   * Get a value from cache
   * @param {string} key - Cache key
   * @param {string} type - Cache type ('memory', 'firestore', 'both')
   * @returns {any} Cached value or null
   */
  async get(key, type = 'memory') {
    try {
      // Try memory cache first
      if (type === 'memory' || type === 'both') {
        const memoryData = this.memoryCache.get(key);
        if (memoryData && memoryData.expiresAt > Date.now()) {
          console.log(`✅ [CACHE] Memory cache hit for key: ${key}`);
          return memoryData.value;
        } else if (memoryData) {
          // Expired, remove from memory
          this.memoryCache.delete(key);
        }
      }

      // Try Firestore cache
      if (type === 'firestore' || type === 'both') {
        const doc = await this.db.collection('cache').doc(key).get();
        if (doc.exists) {
          const data = doc.data();
          if (data.expiresAt > Date.now()) {
            console.log(`✅ [CACHE] Firestore cache hit for key: ${key}`);
            
            // Store in memory cache for faster access
            if (type === 'both') {
              this.memoryCache.set(key, data);
            }
            
            return data.value;
          } else {
            // Expired, remove from Firestore
            await this.db.collection('cache').doc(key).delete();
          }
        }
      }

      console.log(`❌ [CACHE] Cache miss for key: ${key}`);
      return null;

    } catch (error) {
      console.error('❌ [CACHE] Error getting cache:', error);
      return null;
    }
  }

  /**
   * Delete a value from cache
   * @param {string} key - Cache key
   * @param {string} type - Cache type ('memory', 'firestore', 'both')
   */
  async delete(key, type = 'both') {
    try {
      if (type === 'memory' || type === 'both') {
        this.memoryCache.delete(key);
      }

      if (type === 'firestore' || type === 'both') {
        await this.db.collection('cache').doc(key).delete();
      }

      console.log(`✅ [CACHE] Deleted cache for key: ${key}`);
      return true;

    } catch (error) {
      console.error('❌ [CACHE] Error deleting cache:', error);
      return false;
    }
  }

  /**
   * Check if a key exists in cache
   * @param {string} key - Cache key
   * @param {string} type - Cache type
   * @returns {boolean} True if exists and not expired
   */
  async exists(key, type = 'memory') {
    const value = await this.get(key, type);
    return value !== null;
  }

  /**
   * Get or set a value (cache-aside pattern)
   * @param {string} key - Cache key
   * @param {Function} fetchFunction - Function to fetch value if not in cache
   * @param {number} ttl - Time to live in seconds
   * @param {string} type - Cache type
   * @returns {any} Cached or fetched value
   */
  async getOrSet(key, fetchFunction, ttl = this.cacheConfig.defaultTTL, type = 'memory') {
    try {
      // Try to get from cache first
      let value = await this.get(key, type);
      
      if (value !== null) {
        return value;
      }

      // Not in cache, fetch the value
      console.log(`🔄 [CACHE] Fetching value for key: ${key}`);
      value = await fetchFunction();
      
      // Store in cache
      await this.set(key, value, ttl, type);
      
      return value;

    } catch (error) {
      console.error('❌ [CACHE] Error in getOrSet:', error);
      // If cache fails, still try to fetch the value
      return await fetchFunction();
    }
  }

  /**
   * Cache user data
   * @param {string} userId - User ID
   * @param {Object} userData - User data
   * @param {number} ttl - Time to live in seconds
   */
  async cacheUser(userId, userData, ttl = 300) {
    const key = `user:${userId}`;
    return await this.set(key, userData, ttl, 'both');
  }

  /**
   * Get cached user data
   * @param {string} userId - User ID
   * @returns {Object|null} Cached user data
   */
  async getCachedUser(userId) {
    const key = `user:${userId}`;
    return await this.get(key, 'both');
  }

  /**
   * Cache booking data
   * @param {string} bookingId - Booking ID
   * @param {Object} bookingData - Booking data
   * @param {number} ttl - Time to live in seconds
   */
  async cacheBooking(bookingId, bookingData, ttl = 180) {
    const key = `booking:${bookingId}`;
    return await this.set(key, bookingData, ttl, 'both');
  }

  /**
   * Get cached booking data
   * @param {string} bookingId - Booking ID
   * @returns {Object|null} Cached booking data
   */
  async getCachedBooking(bookingId) {
    const key = `booking:${bookingId}`;
    return await this.get(key, 'both');
  }

  /**
   * Cache driver location data
   * @param {string} driverId - Driver ID
   * @param {Object} locationData - Location data
   * @param {number} ttl - Time to live in seconds
   */
  async cacheDriverLocation(driverId, locationData, ttl = 30) {
    const key = `driver_location:${driverId}`;
    return await this.set(key, locationData, ttl, 'memory');
  }

  /**
   * Get cached driver location
   * @param {string} driverId - Driver ID
   * @returns {Object|null} Cached location data
   */
  async getCachedDriverLocation(driverId) {
    const key = `driver_location:${driverId}`;
    return await this.get(key, 'memory');
  }

  /**
   * Cache available drivers list
   * @param {string} location - Location key
   * @param {Array} drivers - Drivers list
   * @param {number} ttl - Time to live in seconds
   */
  async cacheAvailableDrivers(location, drivers, ttl = 60) {
    const key = `available_drivers:${location}`;
    return await this.set(key, drivers, ttl, 'both');
  }

  /**
   * Get cached available drivers
   * @param {string} location - Location key
   * @returns {Array|null} Cached drivers list
   */
  async getCachedAvailableDrivers(location) {
    const key = `available_drivers:${location}`;
    return await this.get(key, 'both');
  }

  /**
   * Cache API response
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Request parameters
   * @param {any} response - API response
   * @param {number} ttl - Time to live in seconds
   */
  async cacheApiResponse(endpoint, params, response, ttl = 300) {
    const key = `api:${endpoint}:${JSON.stringify(params)}`;
    return await this.set(key, response, ttl, 'both');
  }

  /**
   * Get cached API response
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Request parameters
   * @returns {any|null} Cached API response
   */
  async getCachedApiResponse(endpoint, params) {
    const key = `api:${endpoint}:${JSON.stringify(params)}`;
    return await this.get(key, 'both');
  }

  /**
   * Invalidate cache by pattern
   * @param {string} pattern - Pattern to match keys
   * @param {string} type - Cache type
   */
  async invalidatePattern(pattern, type = 'both') {
    try {
      if (type === 'memory' || type === 'both') {
        const keysToDelete = [];
        for (const key of this.memoryCache.keys()) {
          if (key.includes(pattern)) {
            keysToDelete.push(key);
          }
        }
        keysToDelete.forEach(key => this.memoryCache.delete(key));
      }

      if (type === 'firestore' || type === 'both') {
        // Note: Firestore doesn't support pattern matching in queries
        // This would need to be implemented with a more sophisticated approach
        console.warn('⚠️ [CACHE] Pattern invalidation not fully supported for Firestore');
      }

      console.log(`✅ [CACHE] Invalidated cache pattern: ${pattern}`);
      return true;

    } catch (error) {
      console.error('❌ [CACHE] Error invalidating pattern:', error);
      return false;
    }
  }

  /**
   * Clear all cache
   * @param {string} type - Cache type
   */
  async clearAll(type = 'both') {
    try {
      if (type === 'memory' || type === 'both') {
        this.memoryCache.clear();
      }

      if (type === 'firestore' || type === 'both') {
        // Note: This would be expensive for large datasets
        console.warn('⚠️ [CACHE] Clear all not implemented for Firestore');
      }

      console.log('✅ [CACHE] Cleared all cache');
      return true;

    } catch (error) {
      console.error('❌ [CACHE] Error clearing cache:', error);
      return false;
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    const memoryStats = {
      size: this.memoryCache.size,
      maxSize: this.cacheConfig.maxMemorySize,
      utilization: (this.memoryCache.size / this.cacheConfig.maxMemorySize) * 100
    };

    return {
      memory: memoryStats,
      config: this.cacheConfig
    };
  }

  /**
   * Cleanup expired entries from memory cache
   */
  cleanupMemoryCache() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, data] of this.memoryCache.entries()) {
      if (data.expiresAt <= now) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.memoryCache.delete(key));
    
    if (keysToDelete.length > 0) {
      console.log(`🧹 [CACHE] Cleaned up ${keysToDelete.length} expired entries`);
    }
  }

  /**
   * Start cleanup interval
   */
  startCleanupInterval() {
    setInterval(() => {
      this.cleanupMemoryCache();
    }, this.cacheConfig.cleanupInterval);
  }

  /**
   * Cache middleware for Express routes
   * @param {number} ttl - Time to live in seconds
   * @param {string} keyGenerator - Function to generate cache key
   * @returns {Function} Express middleware
   */
  middleware(ttl = 300, keyGenerator = null) {
    return async (req, res, next) => {
      try {
        const key = keyGenerator ? keyGenerator(req) : `route:${req.method}:${req.originalUrl}`;
        
        // Try to get from cache
        const cached = await this.get(key, 'both');
        if (cached) {
          console.log(`✅ [CACHE] Route cache hit: ${key}`);
          return res.json(cached);
        }

        // Store original res.json
        const originalJson = res.json.bind(res);
        
        // Override res.json to cache the response
        res.json = (data) => {
          this.set(key, data, ttl, 'both');
          return originalJson(data);
        };

        next();
      } catch (error) {
        console.error('❌ [CACHE] Middleware error:', error);
        next();
      }
    };
  }
}

module.exports = new CachingService();
