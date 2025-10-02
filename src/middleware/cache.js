/**
 * Caching Middleware
 * Provides in-memory caching for frequently accessed data
 */

// Redundant NodeCache instances removed - using CachingService instead
// Keep only documentStatusCache for critical driver document status endpoint
const documentStatusMemoryCache = new Map();

// Redundant middleware functions removed - using CachingService instead

/**
 * Clear document status cache for specific user
 */
const clearUserCache = (userId) => {
  documentStatusMemoryCache.delete(`document_status_${userId}`);
};

/**
 * Clear all document status caches
 */
const clearAllCaches = () => {
  documentStatusMemoryCache.clear();
};

/**
 * Cache middleware for document status - CRITICAL for driver app
 */
const documentStatusCache = (req, res, next) => {
  const cacheKey = `document_status_${req.user?.uid}`;
  
  // Check cache first
  const cachedData = documentStatusMemoryCache.get(cacheKey);
  if (cachedData) {
    return res.json(cachedData);
  }
  
  // Store original res.json
  const originalJson = res.json;
  
  // Override res.json to cache the response
  res.json = function(data) {
    // Only cache successful responses
    if (data.success) {
      documentStatusMemoryCache.set(cacheKey, data);
      // Auto-cleanup after 5 minutes
      setTimeout(() => {
        documentStatusMemoryCache.delete(cacheKey);
      }, 5 * 60 * 1000);
    }
    return originalJson.call(this, data);
  };
  
  next();
};

/**
 * Invalidate user cache
 */
const invalidateUserCache = (userId) => {
  documentStatusMemoryCache.delete(`document_status_${userId}`);
};

/**
 * Get cache statistics
 */
const getCacheStats = () => {
  return {
    documentStatusCache: {
      size: documentStatusMemoryCache.size,
      keys: Array.from(documentStatusMemoryCache.keys())
    }
  };
};

module.exports = {
  documentStatusCache,
  invalidateUserCache,
  clearUserCache,
  clearAllCaches,
  getCacheStats
};