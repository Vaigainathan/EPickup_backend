jest.mock('../src/middleware/auth', () => ({
  ...require('./helpers/mockCustomerAuth'),
  userRateLimit: () => (req, res, next) => next()
}));

const express = require('express');
const request = require('supertest');

const mockDocs = new Map();
let mockEventSeq = 0;
const mockEmit = jest.fn();

function mockClone(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(mockClone);
  }
  const copy = {};
  Object.keys(value).forEach((key) => {
    copy[key] = mockClone(value[key]);
  });
  return copy;
}

function mockApplyPatch(target, patch) {
  Object.keys(patch).forEach((key) => {
    if (!key.includes('.')) {
      target[key] = patch[key];
      return;
    }
    const parts = key.split('.');
    let cursor = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (!cursor[parts[index]] || typeof cursor[parts[index]] !== 'object') {
        cursor[parts[index]] = {};
      }
      cursor = cursor[parts[index]];
    }
    cursor[parts[parts.length - 1]] = patch[key];
  });
  return target;
}

function mockRef(docPath) {
  const id = docPath.split('/').pop();
  const ref = {
    id,
    path: docPath,
    async get() {
      const data = mockDocs.get(docPath);
      return {
        exists: data !== undefined,
        id,
        data: () => (data === undefined ? undefined : mockClone(data))
      };
    },
    async update(patch) {
      const current = mockClone(mockDocs.get(docPath) || {});
      mockDocs.set(docPath, mockApplyPatch(current, patch));
    }
  };
  return ref;
}

function mockQuery(collectionName, filters) {
  const query = {
    where(field, op, value) {
      return mockQuery(collectionName, filters.concat([{ field, op, value }]));
    },
    limit() {
      return query;
    },
    async get() {
      const docs = [];
      mockDocs.forEach((data, docPath) => {
        const prefix = `${collectionName}/`;
        if (!docPath.startsWith(prefix) || docPath.slice(prefix.length).includes('/')) {
          return;
        }
        const row = data || {};
        const match = filters.every((filter) => filter.op === '==' && row[filter.field] === filter.value);
        if (!match) {
          return;
        }
        docs.push({
          id: docPath.slice(prefix.length),
          ref: mockRef(docPath),
          data: () => mockClone(row)
        });
      });
      return { docs, size: docs.length, empty: docs.length === 0 };
    }
  };
  return query;
}

function mockBuildDb() {
  return {
    collection(name) {
      return {
        doc(id) {
          return mockRef(`${name}/${id}`);
        },
        async add(data) {
          const docId = `rating-${mockEventSeq += 1}`;
          mockDocs.set(`${name}/${docId}`, mockClone(data));
          return { id: docId };
        },
        where(field, op, value) {
          return mockQuery(name, [{ field, op, value }]);
        }
      };
    }
  };
}

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mockBuildDb(),
  Timestamp: {
    now: () => ({ toDate: () => new Date() }),
    fromMillis: (ms) => ({ toMillis: () => ms, toDate: () => new Date(ms) })
  }
}));

jest.mock('../src/services/socket', () => ({
  getIO: () => ({
    to: () => ({
      emit: (...args) => mockEmit(...args)
    })
  })
}));

const bookingDriverRating = require('../src/services/bookingDriverRating');
const customerRoutes = require('../src/routes/customer');

const BOOKING_ID = 'booking-parcel-1';
const DRIVER_ID = 'driver-parcel-1';
const CUSTOMER_ID = 'customer-test';

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/customer', customerRoutes);
  return server;
}

function resetStore() {
  mockDocs.clear();
  mockEventSeq = 0;
  mockEmit.mockClear();
}

function seedParcelBooking(overrides = {}) {
  mockDocs.set(`bookings/${BOOKING_ID}`, {
    customerId: CUSTOMER_ID,
    driverId: DRIVER_ID,
    status: 'delivered',
    sourceType: 'parcel',
    ...overrides
  });
  mockDocs.set(`users/${DRIVER_ID}`, {
    driver: { averageRating: 5, totalRatings: 1 }
  });
}

function ratingRows() {
  const rows = [];
  mockDocs.forEach((data, path) => {
    if (path.startsWith('ratings/')) {
      rows.push({ id: path.split('/')[1], data });
    }
  });
  return rows;
}

function postRate(body = { rating: 4, feedback: 'Great', categories: { speed: true } }) {
  return request(app())
    .post(`/api/customer/bookings/${BOOKING_ID}/rate`)
    .send(body);
}

describe('POST /api/customer/bookings/:id/rate', () => {
  let recomputeSpy;

  beforeEach(() => {
    resetStore();
    require('./helpers/mockCustomerAuth').resetTestUid();
    delete process.env.FEATURE_PARCEL_SOURCE_FILTER;
    recomputeSpy = jest.spyOn(bookingDriverRating, 'recomputeDriverRating');
  });

  afterEach(() => {
    recomputeSpy.mockRestore();
  });

  test('success writes one ratings doc, recomputes driver average, and emits admin socket event', async () => {
    seedParcelBooking();
    mockDocs.set('ratings/existing-other', {
      bookingId: 'other-booking',
      customerId: CUSTOMER_ID,
      driverId: DRIVER_ID,
      rating: 5
    });

    const response = await postRate();
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.rating).toBe(4);
    expect(response.body.data.averageRating).toBe(4.5);

    const rows = ratingRows().filter((row) => row.data.bookingId === BOOKING_ID);
    expect(rows).toHaveLength(1);
    const saved = rows[0].data;
    expect(saved.bookingId).toBe(BOOKING_ID);
    expect(saved.customerId).toBe(CUSTOMER_ID);
    expect(saved.driverId).toBe(DRIVER_ID);
    expect(saved.rating).toBe(4);
    expect(saved.feedback).toBe('Great');
    expect(saved.categories).toEqual({ speed: true });
    expect(saved.createdAt).toBeInstanceOf(Date);
    expect(saved.updatedAt).toBeInstanceOf(Date);

    expect(recomputeSpy).toHaveBeenCalledTimes(1);
    expect(recomputeSpy.mock.calls[0][1]).toBe(DRIVER_ID);

    const driverUser = mockDocs.get(`users/${DRIVER_ID}`);
    expect(driverUser.driver.totalRatings).toBe(2);
    expect(driverUser.driver.averageRating).toBe(4.5);

    expect(mockEmit).toHaveBeenCalledWith('driver_rating_updated', expect.objectContaining({
      driverId: DRIVER_ID,
      bookingId: BOOKING_ID,
      action: 'added',
      rating: 4,
      newAverageRating: 4.5,
      totalRatings: 2
    }));
  });

  test('second rating by the same customer returns 400 with the same message as before', async () => {
    seedParcelBooking();
    mockDocs.set(`ratings/existing-${BOOKING_ID}`, {
      bookingId: BOOKING_ID,
      customerId: CUSTOMER_ID,
      driverId: DRIVER_ID,
      rating: 3
    });

    const response = await postRate({ rating: 5 });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: 'Rating already submitted for this booking'
    });
    expect(ratingRows()).toHaveLength(1);
    expect(recomputeSpy).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  test('marketplace booking is rejected when parcel source filter is enabled', async () => {
    process.env.FEATURE_PARCEL_SOURCE_FILTER = 'true';
    seedParcelBooking({ sourceType: 'marketplace' });

    const response = await postRate({ rating: 4 });
    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      error: 'Not a parcel booking',
      code: 'MARKETPLACE_BOOKING'
    });
    expect(ratingRows()).toHaveLength(0);
    expect(recomputeSpy).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
