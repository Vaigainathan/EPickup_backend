/**
 * Caching Middleware
 * 
 * Provides in-memory caching for frequently accessed data
 * to reduce database load and improve response times.
 */

class CacheManager {
  constructor() {
    this.cache = new Map();
    this.ttl = new Map(); // Time-to-live tracking
    this.maxSize = 1000; // Maximum number of cached items
    this.defaultTTL = 5 * 60 * 1000; // 5 minutes default TTL
    
    // Cleanup expired entries every minute
    setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  /**
   * Set a cache entry with TTL
   */
  set(key, value, ttl = this.defaultTTL) {
    // Remove oldest entries if cache is full
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.delete(oldestKey);
    }

    this.cache.set(key, value);
    this.ttl.set(key, Date.now() + ttl);
    
    console.log(`💾 [CACHE] Set cache entry: ${key} (TTL: ${ttl}ms)`);
  }

  /**
   * Get a cache entry
   */
  get(key) {
    const ttl = this.ttl.get(key);
    
    if (!ttl || Date.now() > ttl) {
      // Entry expired or doesn't exist
      this.delete(key);
      return null;
    }

    console.log(`💾 [CACHE] Cache hit: ${key}`);
    return this.cache.get(key);
  }

  /**
   * Delete a cache entry
   */
  delete(key) {
    this.cache.delete(key);
    this.ttl.delete(key);
    console.log(`💾 [CACHE] Deleted cache entry: ${key}`);
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key) {
    const ttl = this.ttl.get(key);
    return ttl && Date.now() <= ttl;
  }

  /**
   * Clear all cache entries
   */
  clear() {
    this.cache.clear();
    this.ttl.clear();
    console.log('💾 [CACHE] Cleared all cache entries');
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      entries: Array.from(this.cache.keys())
    };
  }

  /**
   * Cleanup expired entries
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, ttl] of this.ttl.entries()) {
      if (now > ttl) {
        this.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 [CACHE] Cleaned up ${cleanedCount} expired entries`);
    }
  }

  /**
   * Generate cache key for user-specific data
   */
  generateUserKey(userId, endpoint) {
    return `user:${userId}:${endpoint}`;
  }

  /**
   * Generate cache key for general data
   */
  generateKey(endpoint, params = {}) {
    const paramString = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');
    
    return paramString ? `${endpoint}:${paramString}` : endpoint;
  }
}

// Create singleton instance
const cacheManager = new CacheManager();

/**
 * Cache middleware factory
 */
function createCacheMiddleware(options = {}) {
  const {
    ttl = 5 * 60 * 1000, // 5 minutes default
    keyGenerator = (req) => {
      // Default key generator uses user ID and endpoint
      const userId = req.user?.uid || 'anonymous';
      const endpoint = req.path;
      return cacheManager.generateUserKey(userId, endpoint);
    },
    skip = () => false, // Don't skip by default
    skipOnError = true // Skip caching on errors
  } = options;

  return (req, res, next) => {
    // Skip caching if specified
    if (skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const cachedResponse = cacheManager.get(key);

    if (cachedResponse) {
      console.log(`💾 [CACHE] Returning cached response for ${req.path}`);
      return res.json(cachedResponse);
    }

    // Store original res.json
    const originalJson = res.json.bind(res);

    // Override res.json to cache successful responses
    res.json = function(data) {
      // Only cache successful responses
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cacheManager.set(key, data, ttl);
        console.log(`💾 [CACHE] Cached response for ${req.path}`);
      } else if (skipOnError) {
        console.log(`💾 [CACHE] Skipping cache for error response: ${res.statusCode}`);
      }

      return originalJson(data);
    };

    next();
  };
}

/**
 * Document status specific cache middleware
 * Caches for 30 seconds to allow frequent polling
 */
const documentStatusCache = createCacheMiddleware({
  ttl: 30 * 1000, // 30 seconds
  keyGenerator: (req) => {
    const userId = req.user?.uid;
    return cacheManager.generateUserKey(userId, 'documents/status');
  },
  skip: (req) => {
    // Skip caching for admin requests or if user is not authenticated
    return !req.user?.uid || req.user?.role === 'admin';
  }
});

/**
 * Profile cache middleware
 * Caches for 2 minutes
 */
const profileCache = createCacheMiddleware({
  ttl: 2 * 60 * 1000, // 2 minutes
  keyGenerator: (req) => {
    const userId = req.user?.uid;
    return cacheManager.generateUserKey(userId, 'profile');
  }
});

/**
 * Wallet cache middleware
 * Caches for 1 minute
 */
const walletCache = createCacheMiddleware({
  ttl: 1 * 60 * 1000, // 1 minute
  keyGenerator: (req) => {
    const userId = req.user?.uid;
    return cacheManager.generateUserKey(userId, 'wallet');
  }
});

/**
 * Invalidate cache for a specific user
 */
function invalidateUserCache(userId) {
  const keysToDelete = [];
  
  for (const key of cacheManager.cache.keys()) {
    if (key.includes(`user:${userId}:`)) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach(key => cacheManager.delete(key));
  
  console.log(`💾 [CACHE] Invalidated ${keysToDelete.length} cache entries for user ${userId}`);
}

/**
 * Invalidate cache for a specific endpoint
 */
function invalidateEndpointCache(endpoint) {
  const keysToDelete = [];
  
  for (const key of cacheManager.cache.keys()) {
    if (key.includes(endpoint)) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach(key => cacheManager.delete(key));
  
  console.log(`💾 [CACHE] Invalidated ${keysToDelete.length} cache entries for endpoint ${endpoint}`);
}

module.exports = {
  cacheManager,
  createCacheMiddleware,
  documentStatusCache,
  profileCache,
  walletCache,
  invalidateUserCache,
  invalidateEndpointCache
};
