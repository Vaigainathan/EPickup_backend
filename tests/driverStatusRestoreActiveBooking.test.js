/**
 * B-FIX-C: PUT /api/driver/status with restoreFromAppRestart + isOnline true.
 * A driver with an active booking skips the restore window, is never made available,
 * and always gets a 200. Drivers without an active booking behave as before.
 */
const express = require('express');
const request = require('supertest');
const { DRIVER_GET_ACTIVE_BOOKING_STATUSES } = require('../src/constants/bookingStatuses');

process.env.FIREBASE_PROJECT_ID = 'unit-test';
process.env.JWT_SECRET = 'unit-test-jwt-secret';

const mockScheduleRestoreValidation = jest.fn();
const state = {
  userData: null,
  activeBooking: null, // { id, status } or null
  lookupThrows: false,
  whereCalls: [],
  txUpdates: [],
  locationSets: []
};

function setNested(obj, dottedKey, value) {
  const parts = dottedKey.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function applyPatch(patch) {
  Object.entries(patch).forEach(([key, value]) => setNested(state.userData, key, value));
}

function buildMockDb() {
  const userRef = {
    id: 'driver-1',
    get: jest.fn(async () => ({ exists: true, data: () => state.userData })),
    update: jest.fn(async (patch) => {
      state.txUpdates.push(patch);
      applyPatch(patch);
    })
  };

  const bookingsQuery = {
    where: jest.fn((...args) => {
      state.whereCalls.push(args);
      return bookingsQuery;
    }),
    limit: jest.fn(() => bookingsQuery),
    get: jest.fn(async () => {
      if (state.lookupThrows) throw new Error('lookup failed');
      if (!state.activeBooking) return { empty: true, docs: [] };
      return {
        empty: false,
        docs: [{ id: state.activeBooking.id, data: () => ({ status: state.activeBooking.status }) }]
      };
    })
  };

  return {
    collection: jest.fn((name) => {
      if (name === 'users') return { doc: jest.fn(() => userRef) };
      if (name === 'bookings') return bookingsQuery;
      if (name === 'driverLocations') {
        return {
          doc: jest.fn(() => ({
            set: jest.fn(async (data) => {
              state.locationSets.push(data);
            })
          }))
        };
      }
      return { doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })), set: jest.fn() })) };
    }),
    runTransaction: jest.fn(async (fn) => {
      const tx = {
        get: jest.fn(async () => ({ exists: true, data: () => state.userData })),
        update: jest.fn((_ref, patch) => {
          state.txUpdates.push(patch);
          applyPatch(patch);
        })
      };
      return fn(tx);
    })
  };
}

function buildApp({ activeBooking = null, lookupThrows = false } = {}) {
  jest.resetModules();
  state.userData = {
    driver: { isOnline: false, isAvailable: false, lastStatusUpdate: new Date() }
  };
  state.activeBooking = activeBooking;
  state.lookupThrows = lookupThrows;
  state.whereCalls.length = 0;
  state.txUpdates.length = 0;
  state.locationSets.length = 0;
  mockScheduleRestoreValidation.mockReset();

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
  jest.doMock('../src/services/bookingStateMachine', () => ({
    transitionBooking: jest.fn()
  }));
  jest.doMock('../src/services/fareCalculationService', () => ({
    calculateFare: jest.fn(() => ({ commission: 1, roundedDistanceKm: 5 }))
  }));
  jest.doMock('../src/services/walletService', () => ({
    getPointsService: () => ({ getPointsBalance: jest.fn() })
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
  jest.doMock('../src/services/restoreValidatorService', () => ({
    scheduleRestoreValidation: (...args) => mockScheduleRestoreValidation(...args)
  }));
  jest.doMock('../src/services/workSlotsService', () => ({
    getDriverSlots: jest.fn(async () => ({ success: true, data: [] }))
  }));
  jest.doMock('firebase-admin', () => ({
    apps: [{ name: '[DEFAULT]' }],
    firestore: { FieldValue: { increment: (n) => ({ __inc: n }) } }
  }));
  jest.doMock('../src/services/firebase', () => ({
    getFirestore: jest.fn(() => buildMockDb()),
    getStorage: jest.fn()
  }));

  const app = express();
  app.use(express.json());
  app.use('/api/driver', require('../src/routes/driver'));
  return app;
}

const hoursAgoIso = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();

function putRestore(app, body = {}) {
  return request(app)
    .put('/api/driver/status')
    .send({ isOnline: true, restoreFromAppRestart: true, ...body });
}

function userPatchWithKey(key) {
  return state.txUpdates.find((patch) => key in patch);
}

describe('PUT /api/driver/status restoreFromAppRestart with active booking (B-FIX-C)', () => {
  const originalFlag = process.env.FEATURE_ENABLE_RESTORE_BYPASS;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalFlag === undefined) delete process.env.FEATURE_ENABLE_RESTORE_BYPASS;
    else process.env.FEATURE_ENABLE_RESTORE_BYPASS = originalFlag;
  });

  test('1. active booking + restore + lastStatusUpdate 3h old -> 200, not RESTORE_WINDOW_EXPIRED', async () => {
    const app = buildApp({ activeBooking: { id: 'b1', status: 'picked_up' } });
    const res = await putRestore(app, { lastStatusUpdate: hoursAgoIso(3) });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isOnline).toBe(true);
    expect(res.body.error).toBeUndefined();
  });

  test('2. active booking + isAvailable true -> driver.isAvailable false written, response and driverLocations false', async () => {
    const app = buildApp({ activeBooking: { id: 'b1', status: 'in_transit' } });
    const res = await putRestore(app, { isAvailable: true, lastStatusUpdate: hoursAgoIso(3) });

    expect(res.status).toBe(200);
    const patch = userPatchWithKey('driver.isOnline');
    expect(patch['driver.isOnline']).toBe(true);
    expect(patch['driver.isAvailable']).toBe(false);
    expect(state.userData.driver.isAvailable).toBe(false);
    expect(res.body.data.isAvailable).toBe(false);
    expect(state.locationSets[0].isAvailable).toBe(false);
  });

  test('3. active booking + FEATURE_ENABLE_RESTORE_BYPASS=false -> still 200, scheduleRestoreValidation not called', async () => {
    process.env.FEATURE_ENABLE_RESTORE_BYPASS = 'false';
    const app = buildApp({ activeBooking: { id: 'b1', status: 'driver_enroute' } });
    const res = await putRestore(app, { lastStatusUpdate: hoursAgoIso(1) });

    expect(res.status).toBe(200);
    expect(mockScheduleRestoreValidation).not.toHaveBeenCalled();
  });

  test('4. active booking lookup uses driverId == uid and status in DRIVER_GET_ACTIVE_BOOKING_STATUSES', async () => {
    const app = buildApp({ activeBooking: { id: 'b1', status: 'accepted' } });
    await putRestore(app, { lastStatusUpdate: hoursAgoIso(1) });

    expect(state.whereCalls).toContainEqual(['driverId', '==', 'driver-1']);
    expect(state.whereCalls).toContainEqual(['status', 'in', DRIVER_GET_ACTIVE_BOOKING_STATUSES]);
  });

  test('5. no active booking + lastStatusUpdate 3h old -> 400 RESTORE_WINDOW_EXPIRED (unchanged)', async () => {
    const app = buildApp({ activeBooking: null });
    const res = await putRestore(app, { lastStatusUpdate: hoursAgoIso(3) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RESTORE_WINDOW_EXPIRED');
    expect(state.txUpdates).toHaveLength(0);
  });

  test('6. no active booking + fresh + isAvailable true -> isAvailable true written, scheduleRestoreValidation called (unchanged)', async () => {
    const app = buildApp({ activeBooking: null });
    const res = await putRestore(app, { isAvailable: true, lastStatusUpdate: hoursAgoIso(0.1) });

    expect(res.status).toBe(200);
    expect(mockScheduleRestoreValidation).toHaveBeenCalledWith('driver-1', { context: 'restoreFromAppRestart' });
    const patch = userPatchWithKey('driver.isOnline');
    expect(patch['driver.isAvailable']).toBe(true);
    expect(res.body.data.isAvailable).toBe(true);
  });

  test('7. (i) active-booking lookup throws -> falls back to today: stale lastStatusUpdate -> 400 RESTORE_WINDOW_EXPIRED', async () => {
    const app = buildApp({ lookupThrows: true });
    const res = await putRestore(app, { lastStatusUpdate: hoursAgoIso(3) });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RESTORE_WINDOW_EXPIRED');
    expect(state.txUpdates).toHaveLength(0);
  });

  test('8. (ii) photo_captured active booking + fresh lastStatusUpdate + isAvailable true -> 200 and isAvailable false written', async () => {
    const app = buildApp({ activeBooking: { id: 'b-photo', status: 'photo_captured' } });
    const res = await putRestore(app, { isAvailable: true, lastStatusUpdate: hoursAgoIso(0.1) });

    expect(res.status).toBe(200);
    const patch = userPatchWithKey('driver.isOnline');
    expect(patch['driver.isAvailable']).toBe(false);
    expect(res.body.data.isAvailable).toBe(false);
    expect(mockScheduleRestoreValidation).not.toHaveBeenCalled();
  });
});
