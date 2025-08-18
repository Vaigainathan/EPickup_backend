const redis = require('redis');
const { env } = require('../config');

let redisClient = null;

/**
 * Initialize Redis connection
 */
const initializeRedis = async () => {
  try {
    // Get Redis configuration from environment config
    const redisConfig = env.get('redis');
    
    // Check if Redis is enabled
    if (!redisConfig.enabled) {
      console.log('⚠️  Redis is disabled in configuration');
      return null;
    }

    const redisUrl = redisConfig.url || `redis://${redisConfig.host}:${redisConfig.port}`;
    
    redisClient = redis.createClient({
      url: redisUrl,
      username: redisConfig.username,
      password: redisConfig.password,
      database: redisConfig.db,
      socket: {
        connectTimeout: 10000,
        lazyConnect: true,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            console.error('Redis max reconnection attempts reached');
            return false;
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    // Handle Redis events
    redisClient.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });

    redisClient.on('ready', () => {
      console.log('✅ Redis ready to accept commands');
    });

    redisClient.on('error', (err) => {
      console.error('❌ Redis error:', err);
    });

    redisClient.on('reconnecting', () => {
      console.log('🔄 Redis reconnecting...');
    });

    redisClient.on('end', () => {
      console.log('🔌 Redis connection ended');
    });

    // Connect to Redis
    await redisClient.connect();
    
    // Test connection
    await redisClient.ping();
    console.log('✅ Redis ping successful');
    
    return redisClient;
    
  } catch (error) {
    console.error('❌ Failed to initialize Redis:', error);
    console.log('⚠️  Continuing without Redis (some features may be limited)');
    return null;
  }
};

/**
 * Get Redis client instance
 */
const getRedisClient = () => {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call initializeRedis() first.');
  }
  return redisClient;
};

/**
 * Set key-value pair with optional expiration
 */
const set = async (key, value, expirationSeconds = null) => {
  try {
    if (!redisClient) return false;
    
    const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
    
    if (expirationSeconds) {
      await redisClient.setEx(key, expirationSeconds, serializedValue);
    } else {
      await redisClient.set(key, serializedValue);
    }
    
    return true;
  } catch (error) {
    console.error('Redis set error:', error);
    return false;
  }
};

/**
 * Get value by key
 */
const get = async (key) => {
  try {
    if (!redisClient) return null;
    
    const value = await redisClient.get(key);
    
    if (!value) return null;
    
    // Try to parse as JSON, fallback to string
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    console.error('Redis get error:', error);
    return null;
  }
};

/**
 * Delete key
 */
const del = async (key) => {
  try {
    if (!redisClient) return false;
    
    const result = await redisClient.del(key);
    return result > 0;
  } catch (error) {
    console.error('Redis delete error:', error);
    return false;
  }
};

/**
 * Check if key exists
 */
const exists = async (key) => {
  try {
    if (!redisClient) return false;
    
    const result = await redisClient.exists(key);
    return result > 0;
  } catch (error) {
    console.error('Redis exists error:', error);
    return false;
  }
};

/**
 * Set key expiration
 */
const expire = async (key, seconds) => {
  try {
    if (!redisClient) return false;
    
    const result = await redisClient.expire(key, seconds);
    return result > 0;
  } catch (error) {
    console.error('Redis expire error:', error);
    return false;
  }
};

/**
 * Get key time to live
 */
const ttl = async (key) => {
  try {
    if (!redisClient) return -1;
    
    return await redisClient.ttl(key);
  } catch (error) {
    console.error('Redis TTL error:', error);
    return -1;
  }
};

/**
 * Increment counter
 */
const incr = async (key) => {
  try {
    if (!redisClient) return null;
    
    return await redisClient.incr(key);
  } catch (error) {
    console.error('Redis increment error:', error);
    return null;
  }
};

/**
 * Decrement counter
 */
const decr = async (key) => {
  try {
    if (!redisClient) return null;
    
    return await redisClient.decr(key);
  } catch (error) {
    console.error('Redis decrement error:', error);
    return null;
  }
};

/**
 * Add to set
 */
const sadd = async (key, ...members) => {
  try {
    if (!redisClient) return 0;
    
    return await redisClient.sAdd(key, members);
  } catch (error) {
    console.error('Redis SADD error:', error);
    return 0;
  }
};

/**
 * Remove from set
 */
const srem = async (key, ...members) => {
  try {
    if (!redisClient) return 0;
    
    return await redisClient.sRem(key, members);
  } catch (error) {
    console.error('Redis SREM error:', error);
    return 0;
  }
};

/**
 * Check if member exists in set
 */
const sismember = async (key, member) => {
  try {
    if (!redisClient) return false;
    
    const result = await redisClient.sIsMember(key, member);
    return result;
  } catch (error) {
    console.error('Redis SISMEMBER error:', error);
    return false;
  }
};

/**
 * Get set members
 */
const smembers = async (key) => {
  try {
    if (!redisClient) return [];
    
    return await redisClient.sMembers(key);
  } catch (error) {
    console.error('Redis SMEMBERS error:', error);
    return [];
  }
};

/**
 * Add to sorted set with score
 */
const zadd = async (key, score, member) => {
  try {
    if (!redisClient) return 0;
    
    return await redisClient.zAdd(key, [{ score, value: member }]);
  } catch (error) {
    console.error('Redis ZADD error:', error);
    return 0;
  }
};

/**
 * Get sorted set members with scores
 */
const zrange = async (key, start, stop, withScores = false) => {
  try {
    if (!redisClient) return [];
    
    if (withScores) {
      return await redisClient.zRangeWithScores(key, start, stop);
    } else {
      return await redisClient.zRange(key, start, stop);
    }
  } catch (error) {
    console.error('Redis ZRANGE error:', error);
    return [];
  }
};

/**
 * Get sorted set member score
 */
const zscore = async (key, member) => {
  try {
    if (!redisClient) return null;
    
    return await redisClient.zScore(key, member);
  } catch (error) {
    console.error('Redis ZSCORE error:', error);
    return null;
  }
};

/**
 * Hash operations
 */
const hset = async (key, field, value) => {
  try {
    if (!redisClient) return false;
    
    const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
    const result = await redisClient.hSet(key, field, serializedValue);
    return result > 0;
  } catch (error) {
    console.error('Redis HSET error:', error);
    return false;
  }
};

const hget = async (key, field) => {
  try {
    if (!redisClient) return null;
    
    const value = await redisClient.hGet(key, field);
    
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    console.error('Redis HGET error:', error);
    return null;
  }
};

const hgetall = async (key) => {
  try {
    if (!redisClient) return {};
    
    const hash = await redisClient.hGetAll(key);
    const result = {};
    
    for (const [field, value] of Object.entries(hash)) {
      try {
        result[field] = JSON.parse(value);
      } catch {
        result[field] = value;
      }
    }
    
    return result;
  } catch (error) {
    console.error('Redis HGETALL error:', error);
    return {};
  }
};

/**
 * List operations
 */
const lpush = async (key, ...values) => {
  try {
    if (!redisClient) return 0;
    
    const serializedValues = values.map(v => 
      typeof v === 'object' ? JSON.stringify(v) : v
    );
    
    return await redisClient.lPush(key, serializedValues);
  } catch (error) {
    console.error('Redis LPUSH error:', error);
    return 0;
  }
};

const rpush = async (key, ...values) => {
  try {
    if (!redisClient) return 0;
    
    const serializedValues = values.map(v => 
      typeof v === 'object' ? JSON.stringify(v) : v
    );
    
    return await redisClient.rPush(key, serializedValues);
  } catch (error) {
    console.error('Redis RPUSH error:', error);
    return 0;
  }
};

const lpop = async (key) => {
  try {
    if (!redisClient) return null;
    
    const value = await redisClient.lPop(key);
    
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    console.error('Redis LPOP error:', error);
    return null;
  }
};

const rpop = async (key) => {
  try {
    if (!redisClient) return null;
    
    const value = await redisClient.rPop(key);
    
    if (!value) return null;
    
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    console.error('Redis RPOP error:', error);
    return null;
  }
};

const lrange = async (key, start, stop) => {
  try {
    if (!redisClient) return [];
    
    const values = await redisClient.lRange(key, start, stop);
    
    return values.map(value => {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    });
  } catch (error) {
    console.error('Redis LRANGE error:', error);
    return [];
  }
};

/**
 * Close Redis connection
 */
const closeRedis = async () => {
  try {
    if (redisClient) {
      await redisClient.quit();
      console.log('✅ Redis connection closed');
    }
  } catch (error) {
    console.error('❌ Error closing Redis connection:', error);
  }
};

/**
 * Health check
 */
const healthCheck = async () => {
  try {
    if (!redisClient) return { status: 'disconnected', message: 'Redis not initialized' };
    
    await redisClient.ping();
    return { status: 'connected', message: 'Redis is healthy' };
  } catch (error) {
    return { status: 'error', message: error.message };
  }
};

module.exports = {
  initializeRedis,
  getRedisClient,
  set,
  get,
  del,
  exists,
  expire,
  ttl,
  incr,
  decr,
  sadd,
  srem,
  sismember,
  smembers,
  zadd,
  zrange,
  zscore,
  hset,
  hget,
  hgetall,
  lpush,
  rpush,
  lpop,
  rpop,
  lrange,
  closeRedis,
  healthCheck
};
