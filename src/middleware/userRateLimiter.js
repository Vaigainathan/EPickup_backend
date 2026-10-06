const buckets = new Map();
const SWEEP_MS = 60 * 1000;

function sweepExpired(now = Date.now()) {
  buckets.forEach((bucket, key) => {
    if (bucket.resetTime <= now) {
      buckets.delete(key);
    }
  });
}

const sweepTimer = setInterval(() => {
  sweepExpired();
}, SWEEP_MS);
if (typeof sweepTimer.unref === 'function') {
  sweepTimer.unref();
}

function userRateLimiter({ windowMs, max, name }) {
  return (req, res, next) => {
    const identity = req.user && req.user.uid ? req.user.uid : req.ip;
    const key = `${name}:${identity}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetTime) {
      bucket = { count: 0, resetTime: now + windowMs };
    }

    if (bucket.count >= max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetTime - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: 'Too many requests',
        code: 'RATE_LIMITED',
        retryAfter
      });
    }

    bucket.count += 1;
    buckets.set(key, bucket);
    return next();
  };
}

function activeKeyCount() {
  return buckets.size;
}

module.exports = {
  userRateLimiter,
  activeKeyCount,
  sweepExpired
};
