const express = require('express');
const request = require('supertest');

process.env.FIREBASE_PROJECT_ID = 'unit-test';
process.env.JWT_SECRET = 'unit-test-jwt-secret';

jest.mock('firebase-admin', () => ({
  apps: [{ name: '[DEFAULT]' }],
  initializeApp: jest.fn(),
  messaging: jest.fn(() => ({})),
  firestore: { FieldValue: { increment: (n) => n } }
}));

jest.mock('../src/middleware/auth', () => ({
  requireDriver: (req, _res, next) => {
    req.user = { uid: 'driver-1' };
    next();
  }
}));

jest.mock('../src/middleware/rateLimit', () => ({
  speedLimiter: (_req, _res, next) => next(),
  bookingStatusLimiter: (_req, _res, next) => next()
}));

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

const { getFirestore } = require('../src/services/firebase');
const driverRouter = require('../src/routes/driver');

describe('POST validate-location ownership', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/driver', driverRouter);
    getFirestore.mockReset();
  });

  test('403 when booking assigned to another driver', async () => {
    getFirestore.mockReturnValue({
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              driverId: 'other',
              pickupLocation: { latitude: 1, longitude: 1 }
            })
          }),
          update: jest.fn()
        }))
      }))
    });

    const res = await request(app)
      .post('/api/driver/bookings/b1/validate-location')
      .send({ locationType: 'pickup', latitude: 1, longitude: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCESS_DENIED');
  });
});
