/**
 * Caching Middleware
 * Provides in-memory caching for frequently accessed data
 */

const NodeCache = require('node-cache');

// Create cache instances for different data types
const userCache = new NodeCache({ 
  stdTTL: 300, // 5 minutes
  checkperiod: 60, // Check for expired keys every minute
  useClones: false // Don't clone objects for better performance
});

const adminCache = new NodeCache({ 
  stdTTL: 600, // 10 minutes
  checkperiod: 120,
  useClones: false
});

const statsCache = new NodeCache({ 
  stdTTL: 60, // 1 minute
  checkperiod: 30,
  useClones: false
});

/**
 * Cache middleware for user data
 */
const cacheUserData = (req, res, next) => {
  const cacheKey = `user_${req.params.userId || req.user?.uid}`;
  
  // Check cache first
  const cachedData = userCache.get(cacheKey);
  if (cachedData) {
    return res.json(cachedData);
  }
  
  // Store original res.json
  const originalJson = res.json;
  
  // Override res.json to cache the response
  res.json = function(data) {
    // Only cache successful responses
    if (data.success) {
      userCache.set(cacheKey, data);
    }
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Cache middleware for admin data
 */
const cacheAdminData = (req, res, next) => {
  const cacheKey = `admin_${req.route?.path}_${JSON.stringify(req.query)}`;
  
  // Check cache first
  const cachedData = adminCache.get(cacheKey);
  if (cachedData) {
    return res.json(cachedData);
  }
  
  // Store original res.json
  const originalJson = res.json;
  
  // Override res.json to cache the response
  res.json = function(data) {
    // Only cache successful responses
    if (data.success) {
      adminCache.set(cacheKey, data);
    }
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Cache middleware for statistics
 */
const cacheStats = (req, res, next) => {
  const cacheKey = `stats_${req.route?.path}`;
  
  // Check cache first
  const cachedData = statsCache.get(cacheKey);
  if (cachedData) {
    return res.json(cachedData);
  }
  
  // Store original res.json
  const originalJson = res.json;
  
  // Override res.json to cache the response
  res.json = function(data) {
    // Only cache successful responses
    if (data.success) {
      statsCache.set(cacheKey, data);
    }
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Clear cache for specific user
 */
const clearUserCache = (userId) => {
  userCache.del(`user_${userId}`);
};

/**
 * Clear all caches
 */
const clearAllCaches = () => {
  userCache.flushAll();
  adminCache.flushAll();
  statsCache.flushAll();
};

/**
 * Cache middleware for document status
 */
const documentStatusCache = (req, res, next) => {
  const cacheKey = `document_status_${req.user?.uid}`;
  
  // Check cache first
  const cachedData = userCache.get(cacheKey);
  if (cachedData) {
    return res.json(cachedData);
  }
  
  // Store original res.json
  const originalJson = res.json;
  
  // Override res.json to cache the response
  res.json = function(data) {
    // Only cache successful responses
    if (data.success) {
      userCache.set(cacheKey, data);
    }
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Invalidate user cache
 */
const invalidateUserCache = (userId) => {
  userCache.del(`user_${userId}`);
  userCache.del(`document_status_${userId}`);
};

/**
 * Get cache statistics
 */
const getCacheStats = () => {
  return {
    userCache: userCache.getStats(),
    adminCache: adminCache.getStats(),
    statsCache: statsCache.getStats()
  };
};

module.exports = {
  cacheUserData,
  cacheAdminData,
  cacheStats,
  documentStatusCache,
  invalidateUserCache,
  clearUserCache,
  clearAllCaches,
  getCacheStats
};