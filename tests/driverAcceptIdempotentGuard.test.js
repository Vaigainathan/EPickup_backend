/**
 * POST /api/driver/bookings/:id/accept - idempotent re-accept guard (B-FIX-A).
 * Same driver + active accepted status -> 200 'Booking already accepted' (no writes).
 * Everything else keeps the previous behaviour.
 */
const express = require('express');
const request = require('supertest');
const { wrapStrictTransaction } = require('./helpers/strictFirestoreTransaction');

process.env.FIREBASE_PROJECT_ID = 'unit-test';
process.env.JWT_SECRET = 'unit-test-jwt-secret';

const DRIVER_ID = 'driver-1';
const OTHER_DRIVER_ID = 'driver-2';

const lockMock = {
  acquireBookingLock: jest.fn(),
  releaseBookingLock: jest.fn()
};
const writes = { bookingUpdates: [], sets: [], transactions: 0 };

function makeBooking(overrides = {}) {
  return {
    customerId: 'customer-1',
    status: 'driver_assigned',
    driverId: DRIVER_ID,
    ...overrides
  };
}

function buildMockDb(bookingData) {
  const bookingRef = {
    id: 'booking-1',
    path: 'bookings/booking-1',
    get: jest.fn(async () => ({ exists: true, data: () => bookingData })),
    update: jest.fn(async (patch) => {
      writes.bookingUpdates.push(patch);
    })
  };
  const driverRef = {
    id: DRIVER_ID,
    path: `users/${DRIVER_ID}`,
    get: jest.fn(async () => ({
      exists: true,
      data: () => ({
        name: 'Test Driver',
        phone: '+910000000000',
        isActive: true,
        driver: {
          isOnline: true,
          isAvailable: true,
          isVerified: true,
          verificationStatus: 'approved'
        }
      })
    })),
    update: jest.fn(async (patch) => {
      writes.bookingUpdates.push(patch);
    })
  };

  return {
    collection: jest.fn((name) => {
      if (name === 'bookings') {
        return { doc: jest.fn(() => bookingRef), where: jest.fn() };
      }
      if (name === 'users') {
        return { doc: jest.fn(() => driverRef) };
      }
      return {
        doc: jest.fn(() => ({
          get: jest.fn(async () => ({ exists: false })),
          set: jest.fn(async (data) => writes.sets.push(data)),
          update: jest.fn(async (data) => writes.sets.push(data))
        }))
      };
    }),
    runTransaction: jest.fn(async (fn) => {
      writes.transactions += 1;
      const inner = {
        get: jest.fn(async (ref) => {
          if (ref === bookingRef) return { exists: true, data: () => bookingData };
          if (ref === driverRef) return driverRef.get();
          return { exists: false, empty: true, data: () => ({}) };
        }),
        update: jest.fn(),
        set: jest.fn()
      };
      return fn(wrapStrictTransaction(inner));
    })
  };
}

function buildApp(bookingData) {
  jest.resetModules();
  writes.bookingUpdates.length = 0;
  writes.sets.length = 0;
  writes.transactions = 0;
  lockMock.acquireBookingLock.mockReset();
  lockMock.releaseBookingLock.mockReset();
  lockMock.releaseBookingLock.mockResolvedValue(undefined);

  jest.doMock('../src/middleware/auth', () => ({
    requireDriver: (req, _res, next) => {
      req.user = { uid: 'driver-1', userType: 'driver' };
      next();
    }
  }));
  jest.doMock('../src/middleware/rateLimit', () => ({
    speedLimiter: (_req, _res, next) => next(),
    bookingStatusLimiter: (_req, _res, next) => next()
  }));
  jest.doMock('../src/middleware/rateLimiter', () => ({
    documentStatusRateLimit: (_req, _res, next) => next()
  }));
  jest.doMock('../src/middleware/cache', () => ({
    documentStatusCache: (_req, _res, next) => next(),
    invalidateUserCache: jest.fn()
  }));
  jest.doMock('../src/middleware/idempotencyMiddleware', () => ({
    idempotencyKeyMiddleware: (_req, _res, next) => next()
  }));
  jest.doMock('../src/services/socket', () => ({
    getSocketIO: jest.fn(() => null)
  }));
  jest.doMock('../src/services/bookingLockService', () => function MockBookingLockService() {
    return lockMock;
  });
  jest.doMock('../src/services/bookingStateMachine', () => ({
    transitionBooking: jest.fn()
  }));
  jest.doMock('../src/services/fareCalculationService', () => ({
    calculateFare: jest.fn(() => ({ commission: 10, roundedDistanceKm: 5 }))
  }));
  jest.doMock('../src/services/walletService', () => ({
    getPointsService: () => ({}),
    createOrGetPointsWallet: jest.fn()
  }));
  jest.doMock('../src/services/marketplace/driverMarketplaceAssignment', () => ({
    loadAssignedMarketplaceContext: jest.fn(),
    attachMarketplaceToDriverBooking: jest.fn()
  }));
  jest.doMock('../src/services/driverKycDocumentUrlService', () => ({
    listLatestDriverKycDocumentsFromStorage: jest.fn(),
    resolveDriverKycReadUrl: jest.fn(),
    presentDriverKycDocumentMap: jest.fn(),
    signDriverKycPath: jest.fn()
  }));
  jest.doMock('firebase-admin', () => ({
    apps: [{ name: '[DEFAULT]' }],
    firestore: {
      FieldValue: { increment: (n) => ({ __inc: n }) }
    }
  }));
  jest.doMock('../src/services/firebase', () => ({
    getFirestore: jest.fn(() => buildMockDb(bookingData)),
    getStorage: jest.fn()
  }));

  const app = express();
  app.use(express.json());
  app.use('/api/driver', require('../src/routes/driver'));
  return app;
}

function accept(app) {
  return request(app).post('/api/driver/bookings/booking-1/accept').send({});
}

describe('POST /api/driver/bookings/:id/accept idempotent re-accept guard', () => {
  test('(a) same driver + driver_assigned -> 200 already accepted, no writes, no lock', async () => {
    const app = buildApp(makeBooking({ status: 'driver_assigned', driverId: DRIVER_ID }));
    const res = await accept(app);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Booking already accepted');
    expect(res.body.data).toEqual({ bookingId: 'booking-1', status: 'driver_assigned' });
    expect(typeof res.body.timestamp).toBe('string');
    expect(lockMock.acquireBookingLock).not.toHaveBeenCalled();
    expect(writes.transactions).toBe(0);
    expect(writes.bookingUpdates).toHaveLength(0);
    expect(writes.sets).toHaveLength(0);
  });

  test('(b) same driver + driver_enroute -> 200 already accepted with current status', async () => {
    const app = buildApp(makeBooking({ status: 'driver_enroute', driverId: DRIVER_ID }));
    const res = await accept(app);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Booking already accepted');
    expect(res.body.data).toEqual({ bookingId: 'booking-1', status: 'driver_enroute' });
    expect(lockMock.acquireBookingLock).not.toHaveBeenCalled();
    expect(writes.transactions).toBe(0);
  });

  test('(c) DIFFERENT driver + driver_assigned -> still 400 BOOKING_NOT_AVAILABLE', async () => {
    const app = buildApp(makeBooking({ status: 'driver_assigned', driverId: OTHER_DRIVER_ID }));
    const res = await accept(app);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BOOKING_NOT_AVAILABLE');
    expect(lockMock.acquireBookingLock).not.toHaveBeenCalled();
  });

  test('(d) same driver + completed -> still 400 BOOKING_NOT_AVAILABLE', async () => {
    const app = buildApp(makeBooking({ status: 'completed', driverId: DRIVER_ID }));
    const res = await accept(app);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BOOKING_NOT_AVAILABLE');
    expect(lockMock.acquireBookingLock).not.toHaveBeenCalled();
  });

  test('(e) pending booking -> guard does not answer, normal path reaches the lock service', async () => {
    const app = buildApp(makeBooking({ status: 'pending', driverId: null }));
    lockMock.acquireBookingLock.mockRejectedValue(new Error('BOOKING_ALREADY_ASSIGNED'));
    const res = await accept(app);

    expect(lockMock.acquireBookingLock).toHaveBeenCalledWith('booking-1', DRIVER_ID);
    expect(res.body.message).not.toBe('Booking already accepted');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_ALREADY_ASSIGNED');
  });
});
