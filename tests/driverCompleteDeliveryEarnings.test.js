/**
 * B-FIX-B: POST /api/driver/complete-delivery must not pre-complete / pre-pay the booking.
 * Commission, driver_earnings, adminRevenue and pointsTransactions stay with confirm-payment.
 */
const express = require('express');
const request = require('supertest');

process.env.FIREBASE_PROJECT_ID = 'unit-test';
process.env.JWT_SECRET = 'unit-test-jwt-secret';

const mockCompleteDelivery = jest.fn();
const writes = {
  bookingUpdates: [],
  userUpdates: [],
  payments: [],
  driverEarnings: [],
  txBookingUpdates: [],
  txUserUpdates: []
};

function resetWrites() {
  Object.values(writes).forEach((list) => {
    list.length = 0;
  });
}

function makeDeliveredBooking(overrides = {}) {
  return {
    driverId: 'driver-1',
    customerId: 'customer-1',
    sourceType: 'marketplace',
    status: 'delivered',
    pricing: { totalFare: 10 },
    fare: { totalFare: 10 },
    distance: { total: 5 },
    ...overrides
  };
}

function buildMockDb(bookingData) {
  const bookingRef = {
    id: 'booking-1',
    get: jest.fn(async () => ({ exists: true, data: () => bookingData })),
    update: jest.fn(async (patch) => {
      writes.bookingUpdates.push(patch);
    })
  };
  const driverRef = {
    __driver: true,
    get: jest.fn(async () => ({
      exists: true,
      data: () => ({ driver: { isAvailable: false }, totalEarnings: 500 })
    })),
    update: jest.fn(async (patch) => {
      writes.userUpdates.push(patch);
    })
  };
  const walletRef = {
    get: jest.fn(async () => ({
      exists: true,
      data: () => ({ pointsBalance: 500, totalPointsSpent: 0 })
    }))
  };
  const setDoc = (list) => ({
    id: 'doc-1',
    set: jest.fn(async (data) => {
      if (list) list.push(data);
    }),
    get: jest.fn(async () => ({ exists: false })),
    update: jest.fn(async () => {})
  });

  return {
    collection: jest.fn((name) => {
      if (name === 'bookings') return { doc: jest.fn(() => bookingRef) };
      if (name === 'users') return { doc: jest.fn(() => driverRef) };
      if (name === 'driverPointsWallets') return { doc: jest.fn(() => walletRef) };
      if (name === 'payments') {
        return { doc: jest.fn(() => ({ __payments: true, ...setDoc(writes.payments) })) };
      }
      if (name === 'driver_earnings') {
        return { doc: jest.fn(() => ({ __earnings: true, ...setDoc(writes.driverEarnings) })) };
      }
      if (name === 'paymentIdempotency') {
        return { doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })) };
      }
      return { doc: jest.fn(() => setDoc(null)) };
    }),
    runTransaction: jest.fn(async (fn) => {
      const tx = {
        get: jest.fn(async (ref) => {
          if (ref === bookingRef) return { exists: true, data: () => bookingData };
          if (ref === driverRef) return driverRef.get();
          if (ref === walletRef) return walletRef.get();
          return { exists: false };
        }),
        update: jest.fn((ref, patch) => {
          if (ref === bookingRef) writes.txBookingUpdates.push(patch);
          if (ref === driverRef) writes.txUserUpdates.push(patch);
        }),
        set: jest.fn((ref, data) => {
          if (ref && ref.__payments) writes.payments.push(data);
          if (ref && ref.__earnings) writes.driverEarnings.push(data);
        })
      };
      await fn(tx);
    })
  };
}

function buildApp(bookingData) {
  jest.resetModules();
  resetWrites();

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
  jest.doMock('../src/services/driverStatusWorkflowService', () => {
    class DriverStatusError extends Error {
      constructor(statusCode, code, message, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
      }
    }
    return {
      DriverStatusError,
      driverStatusWorkflowService: {
        completeDelivery: (...args) => mockCompleteDelivery(...args)
      }
    };
  });
  jest.doMock('../src/services/bookingStateMachine', () => ({
    transitionBooking: jest.fn().mockResolvedValue(undefined)
  }));
  jest.doMock('../src/services/fareCalculationService', () => ({
    calculateFare: jest.fn(() => ({ commission: 1, roundedDistanceKm: 5 }))
  }));
  jest.doMock('../src/services/walletService', () => ({
    getPointsService: () => ({
      getPointsBalance: jest.fn(async () => ({
        success: true,
        wallet: { pointsBalance: 500 }
      }))
    })
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
  const FieldValue = { increment: (n) => ({ __inc: n }) };
  jest.doMock('firebase-admin', () => ({
    apps: [{ name: '[DEFAULT]' }],
    firestore: { FieldValue }
  }));
  jest.doMock('firebase-admin/firestore', () => ({
    FieldValue,
    getFirestore: jest.fn()
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

function completeDelivery(app) {
  return request(app)
    .post('/api/driver/complete-delivery')
    .send({
      bookingId: 'booking-1',
      location: { latitude: 12.9, longitude: 80.2 }
    });
}

function mockWorkflowResult(booking) {
  mockCompleteDelivery.mockResolvedValue({
    status: 'delivered',
    booking,
    eventTimestamp: new Date('2026-11-12T00:00:00Z'),
    sequence: 1,
    broadcastPayload: {}
  });
}

describe('POST /api/driver/complete-delivery earnings write (B-FIX-B)', () => {
  beforeEach(() => {
    mockCompleteDelivery.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('(a) grossOrderAmount 10: booking update has no status completed, paymentConfirmed or paymentStatus paid', async () => {
    const booking = makeDeliveredBooking();
    mockWorkflowResult(booking);
    const app = buildApp(booking);
    const res = await completeDelivery(app);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('delivered');
    expect(writes.bookingUpdates).toHaveLength(1);
    const patch = writes.bookingUpdates[0];
    expect(patch.status).not.toBe('completed');
    expect(patch).not.toHaveProperty('status');
    expect(patch).not.toHaveProperty('completedAt');
    expect(patch).not.toHaveProperty('paymentStatus');
    expect(patch).not.toHaveProperty('paymentConfirmed');
    expect(patch).not.toHaveProperty('paymentConfirmedAt');
  });

  test('(b) grossOrderAmount 10: booking update still has driverEarnings and earnings, users.totalEarnings incremented', async () => {
    const booking = makeDeliveredBooking();
    mockWorkflowResult(booking);
    const app = buildApp(booking);
    await completeDelivery(app);

    const patch = writes.bookingUpdates[0];
    expect(patch.driverEarnings).toBe(10);
    expect(patch.totalEarnings).toBe(10);
    expect(patch.earnings).toMatchObject({ grossFare: 10, netEarnings: 10, totalCollected: 10 });
    expect(patch.updatedAt).toBeInstanceOf(Date);
    expect(writes.userUpdates).toHaveLength(1);
    expect(writes.userUpdates[0].totalEarnings).toEqual({ __inc: 10 });
  });

  test('(c) grossOrderAmount 0: else branch unchanged (status delivered, timing.deliveredAt, no earnings, no users write)', async () => {
    const booking = makeDeliveredBooking({ pricing: {}, fare: {} });
    mockWorkflowResult(booking);
    const app = buildApp(booking);
    const res = await completeDelivery(app);

    expect(res.status).toBe(200);
    expect(writes.bookingUpdates).toHaveLength(1);
    const patch = writes.bookingUpdates[0];
    expect(patch.status).toBe('delivered');
    expect(patch['timing.deliveredAt']).toBeInstanceOf(Date);
    expect(patch.updatedAt).toBeInstanceOf(Date);
    expect(patch).not.toHaveProperty('driverEarnings');
    expect(patch).not.toHaveProperty('earnings');
    expect(writes.userUpdates).toHaveLength(0);
  });
});

describe('POST /api/driver/bookings/:id/confirm-payment on a delivered booking (B-FIX-B)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('(d) delivered + driverEarnings 10 + no paymentConfirmed: not idempotent, writes driver_earnings, completes, skips users.totalEarnings', async () => {
    const booking = makeDeliveredBooking({
      driverEarnings: 10,
      totalEarnings: 10,
      earnings: { grossFare: 10, netEarnings: 10, totalCollected: 10 }
    });
    const app = buildApp(booking);
    const res = await request(app)
      .post('/api/driver/bookings/booking-1/confirm-payment')
      .send({ amount: 10, paymentMethod: 'cash', transactionId: 'txn-delivered-1' });

    expect(res.status).toBe(200);
    expect(res.body.data.message).not.toBe('Payment already confirmed for this booking');
    expect(writes.driverEarnings).toHaveLength(1);
    expect(writes.driverEarnings[0].amount).toBe(10);
    expect(writes.txBookingUpdates).toHaveLength(1);
    expect(writes.txBookingUpdates[0].status).toBe('completed');
    expect(writes.txBookingUpdates[0].paymentConfirmed).toBe(true);
    expect(writes.txUserUpdates.some((p) => 'totalEarnings' in p)).toBe(false);
  });
});
