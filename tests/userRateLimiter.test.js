jest.useFakeTimers();

const { userRateLimiter, activeKeyCount, sweepExpired } = require('../src/middleware/userRateLimiter');

function run(middleware, req) {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    set(header, value) {
      this.headers[header] = value;
      return this;
    }
  };
  let passed = false;
  middleware(req, res, () => {
    passed = true;
  });
  return { res, passed };
}

const limiter = userRateLimiter({ windowMs: 60 * 1000, max: 30, name: 'driver-location' });

afterAll(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('userRateLimiter', () => {
  test('allows requests up to the limit', () => {
    const req = { user: { uid: 'user-a' }, ip: '10.0.0.1' };
    for (let i = 0; i < 30; i += 1) {
      expect(run(limiter, req).passed).toBe(true);
    }
  });

  test('returns 429 with retryAfter and Retry-After on the next request', () => {
    const req = { user: { uid: 'user-a' }, ip: '10.0.0.1' };
    const { res, passed } = run(limiter, req);
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.body).toEqual({
      success: false,
      error: 'Too many requests',
      code: 'RATE_LIMITED',
      retryAfter: 60
    });
    expect(res.headers['Retry-After']).toBe('60');
  });

  test('allows again after the window resets', () => {
    jest.advanceTimersByTime(60 * 1000);
    const { passed } = run(limiter, { user: { uid: 'user-a' }, ip: '10.0.0.1' });
    expect(passed).toBe(true);
  });

  test('counts two users separately', () => {
    const other = userRateLimiter({ windowMs: 60 * 1000, max: 1, name: 'separate-users' });
    expect(run(other, { user: { uid: 'user-1' }, ip: '10.0.0.1' }).passed).toBe(true);
    expect(run(other, { user: { uid: 'user-1' }, ip: '10.0.0.1' }).passed).toBe(false);
    expect(run(other, { user: { uid: 'user-2' }, ip: '10.0.0.1' }).passed).toBe(true);
  });

  test('falls back to the IP when there is no user', () => {
    const byIp = userRateLimiter({ windowMs: 60 * 1000, max: 1, name: 'ip-fallback' });
    expect(run(byIp, { ip: '10.0.0.8' }).passed).toBe(true);
    expect(run(byIp, { ip: '10.0.0.8' }).passed).toBe(false);
    expect(run(byIp, { ip: '10.0.0.9' }).passed).toBe(true);
  });

  test('cleanup removes expired keys', () => {
    const before = activeKeyCount();
    run(userRateLimiter({ windowMs: 60 * 1000, max: 5, name: 'cleanup' }), {
      user: { uid: 'cleanup-user' },
      ip: '10.1.1.1'
    });
    expect(activeKeyCount()).toBe(before + 1);
    jest.advanceTimersByTime(60 * 1000);
    sweepExpired(Date.now());
    expect(activeKeyCount()).toBe(0);
  });
});
