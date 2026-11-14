const express = require('express');
const request = require('supertest');

process.env.FIREBASE_PROJECT_ID = 'unit-test';
process.env.JWT_SECRET = 'unit-test-jwt-secret';

jest.mock('firebase-admin', () => ({
  apps: [{ name: '[DEFAULT]' }],
  initializeApp: jest.fn(),
  messaging: jest.fn(() => ({})),
  firestore: { FieldValue: { increment: n => n } }
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

jest.mock('../src/middleware/rateLimiter', () => ({
  documentStatusRateLimit: (_req, _res, next) => next()
}));

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

const { getFirestore } = require('../src/services/firebase');
const driverRouter = require('../src/routes/driver');

describe('GET /api/driver/bookings/:id/photo-verifications', () => {
  let app;
  let photoOrderBy;

  beforeEach(() => {
    app = express();
    app.use('/api/driver', driverRouter);
    getFirestore.mockReset();
    photoOrderBy = jest.fn();
  });

  test('sorts timestamp variants newest first without Firestore orderBy', async () => {
    const photos = [
      {
        id: 'timestamp-photo',
        data: () => ({ uploadedAt: { toMillis: () => 1000 } })
      },
      {
        id: 'iso-photo',
        data: () => ({ uploadedAt: '1970-01-01T00:00:02.000Z' })
      },
      {
        id: 'created-at-fallback',
        data: () => ({ createdAt: new Date(3000) })
      },
      {
        id: 'no-timestamp',
        data: () => ({ photoType: 'pickup' })
      }
    ];
    const photoGet = jest.fn().mockResolvedValue({
      forEach: callback => photos.forEach(callback)
    });

    getFirestore.mockReturnValue({
      collection: jest.fn(name => {
        if (name === 'bookings') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({ driverId: 'driver-1' })
              })
            }))
          };
        }
        if (name === 'photoVerifications') {
          return {
            where: jest.fn(() => ({
              get: photoGet,
              orderBy: photoOrderBy
            }))
          };
        }
        return { doc: jest.fn() };
      })
    });

    const res = await request(app)
      .get('/api/driver/bookings/b1/photo-verifications');

    expect(res.status).toBe(200);
    expect(photoOrderBy).not.toHaveBeenCalled();
    expect(photoGet).toHaveBeenCalledTimes(1);
    expect(res.body.data.photoVerifications.map(photo => photo.id)).toEqual([
      'created-at-fallback',
      'iso-photo',
      'timestamp-photo',
      'no-timestamp'
    ]);
  });
});
