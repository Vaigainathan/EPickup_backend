const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireRole: () => (_req, _res, next) => next()
}));

jest.mock('../src/services/socket', () => ({
  sendToBooking: jest.fn()
}));

const socketService = require('../src/services/socket');

describe('realtime test simulate env gate', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevSimulate = process.env.ENABLE_REALTIME_TEST_SIMULATE;

  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.ENABLE_REALTIME_TEST_SIMULATE = prevSimulate;
    jest.clearAllMocks();
  });

  test('returns 404 in production when flag is not true', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_REALTIME_TEST_SIMULATE;

    jest.resetModules();
    const realtimeRouter = require('../src/routes/realtime');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { uid: 'admin-1', userType: 'admin', role: 'admin' };
      next();
    });
    app.use('/api/realtime', realtimeRouter);

    const res = await request(app)
      .post('/api/realtime/test/simulate')
      .send({ bookingId: 'b1', event: 'booking_status_update' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SIMULATE_DISABLED');
    expect(socketService.sendToBooking).not.toHaveBeenCalled();
  });
});
