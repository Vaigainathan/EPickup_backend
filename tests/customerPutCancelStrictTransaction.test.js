const express = require('express');
const request = require('supertest');

process.env.JWT_SECRET = 'unit-test-jwt-secret';

const { wrapStrictTransaction } = require('./helpers/strictFirestoreTransaction');
const { setTestUid } = require('./helpers/mockCustomerAuth');

const bookingId = 'book-cancel-1';
const customerId = 'customer-test';
const driverId = 'driver-1';

const bookingRef = { path: `bookings/${bookingId}`, id: bookingId };
const driverRef = { path: `users/${driverId}`, id: driverId };

let bookingStore = {};
let driverStore = {};
let runTransactionImpl;

jest.mock('firebase-admin', () => ({
  apps: [{ name: '[DEFAULT]' }],
  initializeApp: jest.fn(),
  messaging: jest.fn(() => ({})),
  firestore: {
    Timestamp: {
      now: () => ({ toDate: () => new Date() })
    },
    FieldValue: { serverTimestamp: () => new Date() }
  }
}));

jest.mock('../src/middleware/auth', () => ({
  ...require('./helpers/mockCustomerAuth'),
  userRateLimit: () => (_req, _res, next) => next()
}));

jest.mock('../src/routes/customerMarketplaceOrders', () => require('express').Router());
jest.mock('../src/routes/customerMarketplace', () => require('express').Router());

jest.mock('../src/services/socket', () => ({
  getSocketIO: jest.fn(() => null)
}));

jest.mock('../src/services/marketplace/marketplaceLinkedBookingCancel', () => ({
  notifyAssignedDriverBookingCancelled: jest.fn(async () => {})
}));

const mockGetFirestore = jest.fn();

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: (...args) => mockGetFirestore(...args),
  Timestamp: {
    now: () => ({ toDate: () => new Date() }),
    fromDate: (d) => d
  },
  FieldValue: { serverTimestamp: () => new Date() }
}));

function makeSnap(data, exists = true) {
  return {
    exists,
    data: () => (exists ? { ...data } : undefined)
  };
}

function buildDb() {
  return {
    collection: jest.fn((name) => {
      if (name === 'bookings') {
        return {
          doc: jest.fn(() => ({
            ...bookingRef,
            get: jest.fn(async () => makeSnap(bookingStore)),
            path: bookingRef.path
          }))
        };
      }
      if (name === 'users') {
        return {
          doc: jest.fn((id) => ({
            path: `users/${id}`,
            id,
            get: jest.fn(async () =>
              makeSnap(driverStore, id === driverId && Object.keys(driverStore).length > 0)
            )
          }))
        };
      }
      return { doc: jest.fn(() => ({ path: 'x/y' })) };
    }),
    runTransaction: jest.fn(async (fn) => {
      const inner = {
        get: jest.fn(async (ref) => {
          const path = ref.path || '';
          if (path.startsWith('bookings/')) {
            return makeSnap(bookingStore);
          }
          if (path.startsWith('users/')) {
            return makeSnap(
              driverStore,
              path === driverRef.path && Object.keys(driverStore).length > 0
            );
          }
          return makeSnap(null, false);
        }),
        update: jest.fn((ref, patch) => {
          const path = ref.path || '';
          if (path.startsWith('bookings/')) {
            bookingStore = { ...bookingStore, ...patch };
          }
          if (path.startsWith('users/')) {
            const nextDriver = { ...(driverStore.driver || {}) };
            Object.entries(patch).forEach(([key, val]) => {
              if (key.startsWith('driver.')) {
                nextDriver[key.slice('driver.'.length)] = val;
              }
            });
            driverStore = { ...driverStore, driver: nextDriver };
          }
        })
      };
      const tx = wrapStrictTransaction(inner);
      return fn(tx);
    })
  };
}

describe('PUT /api/customer/bookings/:bookingId/cancel strict transaction', () => {
  let app;

  beforeEach(() => {
    setTestUid(customerId);
    bookingStore = {
      customerId,
      status: 'driver_assigned',
      driverId,
      sourceType: 'parcel'
    };
    driverStore = {
      driver: { currentBookingId: bookingId, isOnline: true, isAvailable: false }
    };
    const db = buildDb();
    runTransactionImpl = db.runTransaction;
    mockGetFirestore.mockReturnValue(db);
    jest.resetModules();
    app = express();
    app.use(express.json());
    app.use('/api/customer', require('../src/routes/customer'));
  });

  test('with driver: txn reads before writes', async () => {
    const res = await request(app)
      .put(`/api/customer/bookings/${bookingId}/cancel`)
      .send({ reason: 'changed mind' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(runTransactionImpl).toHaveBeenCalled();
    expect(bookingStore.status).toBe('cancelled');
  });

  test('without driver: only booking get then update', async () => {
    bookingStore = {
      customerId,
      status: 'pending',
      driverId: null,
      sourceType: 'parcel'
    };

    const res = await request(app)
      .put(`/api/customer/bookings/${bookingId}/cancel`)
      .send({ reason: 'changed mind' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('driver already released: no driver update after booking cancel', async () => {
    driverStore = {
      driver: { currentBookingId: 'other-booking', isOnline: true }
    };

    const res = await request(app)
      .put(`/api/customer/bookings/${bookingId}/cancel`)
      .send({ reason: 'changed mind' });

    expect(res.status).toBe(200);
    expect(bookingStore.status).toBe('cancelled');
  });
});
