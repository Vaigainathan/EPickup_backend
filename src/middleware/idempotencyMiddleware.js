/**
 * Idempotency Middleware - Prevents duplicate request processing
 * 
 * ✅ PATTERN: Idempotency-Key header for safe retries
 * - Client generates unique ID for each logical operation
 * - If same ID received again, return cached response
 * - Works across network retries without side effects
 * 
 * USAGE:
 *   POST /api/driver/bookings/:id/accept
 *   Headers: { 'Idempotency-Key': 'unique-uuid-for-this-click' }
 */

// In-memory cache for idempotency responses (production should use Redis)
// Key: Idempotency-Key value, Value: { response, timestamp }
const idempotencyCache = new Map();

// TTL for cached responses (24 hours)
const IDEMPOTENCY_TTL = 24 * 60 * 60 * 1000;

// Max cache size (prevent unbounded memory growth)
const MAX_CACHE_SIZE = 10000;

/**
 * Clean up expired cached responses
 */
function cleanupExpiredCache() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, value] of idempotencyCache.entries()) {
    if (now - value.timestamp > IDEMPOTENCY_TTL) {
      idempotencyCache.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 [IDEMPOTENCY] Cleaned up ${cleaned} expired cache entries`);
  }
}

/**
 * Idempotency middleware
 */
const idempotencyKeyMiddleware = async (req, res, next) => {
  // Only apply to POST/PUT/DELETE methods (safe methods don't need it)
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return next();
  }

  const idempotencyKey = req.headers['idempotency-key'];
  
  // Idempotency key is required for critical operations
  if (!idempotencyKey) {
    // For optional idempotency (not required but recommended)
    // Generate one if not provided
    req.idempotencyKey = `auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`⚠️ [IDEMPOTENCY] No key provided, generated: ${req.idempotencyKey}`);
    return next();
  }

  // Validate idempotency key format (UUID or similar)
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 255) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Invalid idempotency key format',
        details: 'Key must be string between 8 and 255 characters'
      }
    });
  }

  req.idempotencyKey = idempotencyKey;

  // ✅ CHECK CACHE for duplicate request
  const cachedResponse = idempotencyCache.get(idempotencyKey);
  
  if (cachedResponse) {
    const age = Date.now() - cachedResponse.timestamp;
    console.log(`♻️ [IDEMPOTENCY] Cache HIT for key: ${idempotencyKey} (age: ${age}ms)`);
    
    // Return cached response
    return res.status(cachedResponse.statusCode).json(cachedResponse.body);
  }

  console.log(`✅ [IDEMPOTENCY] Processing request with key: ${idempotencyKey}`);

  // Intercept res.json() to cache the response
  const originalJson = res.json.bind(res);
  
  res.json = function(body) {
    // ✅ LIMIT cache size to prevent memory explosion
    if (idempotencyCache.size >= MAX_CACHE_SIZE) {
      // Remove oldest entries (FIFO)
      const firstKey = idempotencyCache.keys().next().value;
      if (firstKey) {
        idempotencyCache.delete(firstKey);
        console.log(`🗑️ [IDEMPOTENCY] Cache full, removed oldest entry`);
      }
    }

    // Cache the response with metadata
    const cachedEntry = {
      body: body,
      statusCode: res.statusCode,
      timestamp: Date.now(),
      endpoint: req.originalUrl,
      method: req.method
    };

    idempotencyCache.set(idempotencyKey, cachedEntry);
    
    console.log(`💾 [IDEMPOTENCY] Cached response for key: ${idempotencyKey} (TTL: ${IDEMPOTENCY_TTL}ms)`);

    // Call original json method
    return originalJson(body);
  };

  // Cleanup expired cache periodically (every 100 requests)
  if (Math.random() < 0.01) {
    cleanupExpiredCache();
  }

  next();
};

/**
 * Check if a request was already processed (for logging/auditing)
 */
const wasRequestProcessed = (idempotencyKey) => {
  return idempotencyCache.has(idempotencyKey);
};

/**
 * Get cached response if exists
 */
const getCachedResponse = (idempotencyKey) => {
  const cached = idempotencyCache.get(idempotencyKey);
  return cached ? cached.body : null;
};

/**
 * Clear idempotency cache (for testing)
 */
const clearIdempotencyCache = () => {
  idempotencyCache.clear();
  console.log('🧹 [IDEMPOTENCY] Cache cleared');
};

/**
 * Get cache stats (for monitoring)
 */
const getIdempotencyCacheStats = () => {
  return {
    size: idempotencyCache.size,
    maxSize: MAX_CACHE_SIZE,
    ttl: IDEMPOTENCY_TTL,
    isFull: idempotencyCache.size >= MAX_CACHE_SIZE
  };
};

module.exports = {
  idempotencyKeyMiddleware,
  wasRequestProcessed,
  getCachedResponse,
  clearIdempotencyCache,
  getIdempotencyCacheStats
};
