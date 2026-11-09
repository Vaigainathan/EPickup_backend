/**
 * Driver confirm-payment — server fare authority (B-BUILD-3 item 2).
 */
const express = require('express');
const request = require('supertest');
const { resolveGrossOrderAmount } = require('../src/utils/resolveGrossOrderAmount');

process.env.FIREBASE_PROJECT_ID = 'unit-test';
process.env.JWT_SECRET = 'unit-test-jwt-secret';

const mockTransitionBooking = jest.fn().mockResolvedValue(undefined);
const transactionWrites = { payments: [], driverEarnings: [], bookingUpdates: [] };

function makeBookingDoc(overrides = {}) {
  return {
    driverId: 'driver-1',
    customerId: 'customer-1',
    status: 'money_collection',
    pricing: { totalAmount: 150 },
    distance: { total: 5 },
    ...overrides
  };
}

function buildMockDb(bookingData) {
  const bookingRef = {
    id: 'booking-1',
    get: jest.fn(async () => ({ exists: true, data: () => bookingData })),
    update: jest.fn(async (patch) => {
      transactionWrites.bookingUpdates.push(patch);
      Object.assign(bookingData, patch);
    })
  };

  const driverRef = {
    get: jest.fn(async () => ({
      exists: true,
      data: () => ({ driver: { isAvailable: false }, totalEarnings: 500 })
    }))
  };

  const walletRef = {
    get: jest.fn(async () => ({
      exists: true,
      data: () => ({ pointsBalance: 500, totalPointsSpent: 0 })
    }))
  };

  const collection = jest.fn((name) => {
    if (name === 'bookings') {
      return { doc: jest.fn(() => bookingRef) };
    }
    if (name === 'users') {
      return { doc: jest.fn(() => driverRef) };
    }
    if (name === 'driverPointsWallets') {
      return { doc: jest.fn(() => walletRef) };
    }
    if (name === 'payments') {
      return {
        doc: jest.fn(() => ({
          __payments: true,
          set: jest.fn(async (data) => transactionWrites.payments.push(data))
        }))
      };
    }
    if (name === 'driver_earnings') {
      return {
        doc: jest.fn(() => ({
          __earnings: true,
          set: jest.fn(async (data) => transactionWrites.driverEarnings.push(data))
        }))
      };
    }
    if (name === 'adminRevenue') {
      return { doc: jest.fn(() => ({ set: jest.fn(async () => {}) })) };
    }
    if (name === 'pointsTransactions') {
      return { doc: jest.fn(() => ({ set: jest.fn(async () => {}) })) };
    }
    if (name === 'paymentIdempotency') {
      return { doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })) };
    }
    return { doc: jest.fn(() => ({ get: jest.fn(), set: jest.fn(), update: jest.fn() })) };
  });

  return {
    collection,
  runTransaction: jest.fn(async (fn) => {
      const tx = {
        get: jest.fn(async (ref) => {
          if (ref === bookingRef) return { exists: true, data: () => bookingData };
          if (ref === driverRef) return driverRef.get();
          if (ref === walletRef) return walletRef.get();
          return { exists: false };
        }),
        update: jest.fn(),
        set: jest.fn((ref, data) => {
          if (ref.__payments) transactionWrites.payments.push(data);
          if (ref.__earnings) transactionWrites.driverEarnings.push(data);
        })
      };
      await fn(tx);
    })
  };
}

function buildApp(bookingData) {
  jest.resetModules();
  transactionWrites.payments.length = 0;
  transactionWrites.driverEarnings.length = 0;
  transactionWrites.bookingUpdates.length = 0;

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
    transitionBooking: (...args) => mockTransitionBooking(...args)
  }));
  jest.doMock('../src/services/walletService', () => ({
    getPointsService: () => ({
      getPointsBalance: jest.fn(async () => ({
        success: true,
        wallet: { pointsBalance: 500 }
      }))
    })
  }));
  jest.doMock('../src/services/fareCalculationService', () => ({
    calculateFare: jest.fn(() => ({ commission: 10, roundedDistanceKm: 5 }))
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

describe('resolveGrossOrderAmount field priority', () => {
  test('marketplace delivery-only booking uses pricing.totalFare', () => {
    const amount = resolveGrossOrderAmount({
      sourceType: 'marketplace',
      pricing: { totalFare: 85, baseFare: 40, distanceFare: 45 },
      fare: { totalFare: 85 }
    });
    expect(amount).toBe(85);
  });
});

describe('POST /api/driver/bookings/:id/confirm-payment fare authority', () => {
  beforeEach(() => {
    mockTransitionBooking.mockClear();
  });

  test('parcel: client 150 matches server 150 — payment uses 150 everywhere', async () => {
    const booking = makeBookingDoc();
    const app = buildApp(booking);
    const res = await request(app)
      .post('/api/driver/bookings/booking-1/confirm-payment')
      .send({
        amount: 150,
        paymentMethod: 'cash',
        transactionId: 'txn-parcel-1'
      });

    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(150);
    expect(transactionWrites.payments[0].amount).toBe(150);
    expect(transactionWrites.payments[0].fareMismatch).toBeFalsy();
    expect(transactionWrites.payments[0].fareSource).toBe('server');
    expect(transactionWrites.driverEarnings[0].totalFare).toBe(150);
    expect(transactionWrites.driverEarnings[0].amount).toBe(150);
  });

  test('server fare 0 with client 150 — client_fallback, fareMismatch, error log', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const booking = makeBookingDoc();
    delete booking.pricing;
    booking.fare = {};
    booking.payment = {};
    const app = buildApp(booking);
    const res = await request(app)
      .post('/api/driver/bookings/booking-1/confirm-payment')
      .send({
        amount: 150,
        paymentMethod: 'cash',
        transactionId: 'txn-fallback'
      });

    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(150);
    expect(transactionWrites.payments[0].amount).toBe(150);
    expect(transactionWrites.payments[0].fareSource).toBe('client_fallback');
    expect(transactionWrites.payments[0].fareMismatch).toBe(true);
    expect(
      errorSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('PAYMENT_FARE_CLIENT_FALLBACK')
      )
    ).toBe(true);
    errorSpy.mockRestore();
  });

  test('mismatch: client 152 vs server 150 (|delta|>1) — still 200, fareMismatch on payment record', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const booking = makeBookingDoc();
    const app = buildApp(booking);
    const res = await request(app)
      .post('/api/driver/bookings/booking-1/confirm-payment')
      .send({
        amount: 152,
        paymentMethod: 'cash',
        transactionId: 'txn-mismatch'
      });

    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(150);
    expect(transactionWrites.payments[0].amount).toBe(150);
    expect(transactionWrites.payments[0].clientReportedAmount).toBe(152);
    expect(transactionWrites.payments[0].fareMismatch).toBe(true);
    expect(
      warnSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' && call[0].includes('PAYMENT_FARE_MISMATCH')
      )
    ).toBe(true);
    warnSpy.mockRestore();
  });

  test('marketplace: only delivery charge (pricing.totalFare) is authoritative', async () => {
    const booking = makeBookingDoc({
      sourceType: 'marketplace',
      pricing: { totalFare: 85, baseFare: 40, distanceFare: 45 },
      fare: { totalFare: 85 }
    });
    delete booking.pricing.totalAmount;
    const app = buildApp(booking);
    const res = await request(app)
      .post('/api/driver/bookings/booking-1/confirm-payment')
      .send({
        amount: 200,
        paymentMethod: 'cash',
        transactionId: 'txn-mkt'
      });

    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(85);
    expect(transactionWrites.payments[0].amount).toBe(85);
    expect(transactionWrites.payments[0].fareMismatch).toBe(true);
    expect(resolveGrossOrderAmount(booking)).toBe(85);
  });
});
