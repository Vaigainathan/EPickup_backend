const express = require('express');
const request = require('supertest');

jest.mock('../src/middleware/auth', () => ({
  requireDriver: (req, _res, next) => {
    req.user = { uid: 'driver-test-1' };
    next();
  }
}));

const logSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

const driverRouter = require('../src/routes/driver');

describe('deprecated driver HTTP routes return 410', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/driver', driverRouter);
  });

  afterAll(() => {
    logSpy.mockRestore();
  });

  const cases = [
    {
      name: 'POST /bookings/:id/complete-delivery',
      method: 'post',
      path: '/api/driver/bookings/b1/complete-delivery',
      body: { driverEarnings: 1, commission: 0.1 }
    },
    {
      name: 'PUT /:id/status',
      method: 'put',
      path: '/api/driver/b1/status',
      body: { status: 'driver_enroute' }
    },
    {
      name: 'POST /bookings/:id/payment',
      method: 'post',
      path: '/api/driver/bookings/b1/payment',
      body: { amount: 100, paymentMethod: 'cash', collectedAt: new Date().toISOString() }
    }
  ];

  test.each(cases)('$name → 410 DEPRECATED_FEATURE', async ({ method, path, body }) => {
    const res = await request(app)[method](path)
      .set('x-app-version', '4.0.1')
      .send(body);

    expect(res.status).toBe(410);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('DEPRECATED_FEATURE');
    expect(res.body.error.replacement).toBeTruthy();
  });
});
