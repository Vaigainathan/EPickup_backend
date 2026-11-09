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

jest.mock('../src/middleware/rateLimiter', () => ({
  documentStatusRateLimit: (_req, _res, next) => next()
}));

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

const { getFirestore } = require('../src/services/firebase');
const driverRouter = require('../src/routes/driver');

describe('GET /api/driver/bookings/:id/photo-status', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use('/api/driver', driverRouter);
    getFirestore.mockReset();
  });

  test('returns 403 when driver does not own booking', async () => {
    getFirestore.mockReturnValue({
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ driverId: 'other-driver' })
          })
        }))
      }))
    });

    const res = await request(app).get('/api/driver/bookings/b1/photo-status');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCESS_DENIED');
    expect(res.headers['cache-control']).toMatch(/no-store/);
  });

  test('returns latest delivery photo payload', async () => {
    const photoDoc = {
      id: 'photo-9',
      data: () => ({
        photoUrl: 'https://cdn.example/photo.jpg',
        status: 'pending_confirmation',
        uploadedAt: { toMillis: () => 1000 }
      })
    };

    getFirestore.mockReturnValue({
      collection: jest.fn((name) => {
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
              where: jest.fn(() => ({
                orderBy: jest.fn(() => ({
                  limit: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({ empty: false, docs: [photoDoc] })
                  }))
                }))
              }))
            }))
          };
        }
        return { doc: jest.fn() };
      })
    });

    const res = await request(app).get('/api/driver/bookings/b1/photo-status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        photoUploaded: true,
        photoUrl: 'https://cdn.example/photo.jpg',
        photoId: 'photo-9',
        status: 'pending_confirmation'
      },
      timestamp: expect.any(String)
    });
  });
});
