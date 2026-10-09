jest.mock('../src/middleware/auth', () => require('./helpers/mockCustomerAuth'));

jest.mock('../src/middleware/userRateLimiter', () => ({
  userRateLimiter: () => (req, res, next) => next()
}));

const express = require('express');
const request = require('supertest');

const mockDocs = new Map();
let mockEventSeq = 0;

function mockClone(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (typeof value.toMillis === 'function' || value instanceof Date) {
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
    collection(name) {
      return {
        doc(subId) {
          const child = subId || `auto-${mockEventSeq += 1}`;
          return mockRef(`${docPath}/${name}/${child}`);
        },
        listDocs() {
          const prefix = `${docPath}/${name}/`;
          const docs = [];
          mockDocs.forEach((data, path) => {
            if (!path.startsWith(prefix)) {
              return;
            }
            const rest = path.slice(prefix.length);
            if (!rest || rest.includes('/')) {
              return;
            }
            docs.push({
              id: rest,
              ref: mockRef(path),
              data: () => mockClone(data)
            });
          });
          return { docs, empty: docs.length === 0, size: docs.length };
        }
      };
    },
    async get() {
      const data = mockDocs.get(docPath);
      return {
        exists: data !== undefined,
        id,
        ref,
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
          const docId = id === undefined ? `auto-${mockEventSeq += 1}` : id;
          return mockRef(`${name}/${docId}`);
        },
        where(field, op, value) {
          return mockQuery(name, [{ field, op, value }]);
        }
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(target) {
          if (target && typeof target.get === 'function') {
            return target.get();
          }
          return target.get();
        },
        set(ref, data) {
          mockDocs.set(ref.path, mockClone(data));
        },
        update(ref, patch) {
          const current = mockClone(mockDocs.get(ref.path) || {});
          mockDocs.set(ref.path, mockApplyPatch(current, patch));
        },
        delete(ref) {
          mockDocs.delete(ref.path);
        }
      };
      return fn(tx);
    }
  };
}

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => mockBuildDb()
}));

const customerMarketplaceOrderRoutes = require('../src/routes/customerMarketplaceOrders');
const { submitOrderRating } = require('../src/services/marketplace/submitOrderRating');

const ORDER_ID = 'order-1';
const CUSTOMER_ID = 'customer-test';
const SHOP_ID = 'shop-1';
const BOOKING_ID = 'booking-1';
const DRIVER_ID = 'drv-1';

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/customer', customerMarketplaceOrderRoutes);
  return server;
}

function resetStore() {
  mockDocs.clear();
  mockEventSeq = 0;
}

function seedCompletedOrder(overrides = {}) {
  mockDocs.set(`marketplaceOrders/${ORDER_ID}`, {
    customerId: CUSTOMER_ID,
    shopId: SHOP_ID,
    orderStatus: 'completed',
    linkedBookingId: BOOKING_ID,
    displayId: 1001,
    items: [{ name: 'Item' }],
    ...overrides
  });
  mockDocs.set(`shops/${SHOP_ID}`, {
    rating: { sum: 8, count: 2, average: 4 }
  });
}

function seedBooking(driverId = DRIVER_ID) {
  const booking = {};
  if (driverId) {
    booking.driverId = driverId;
  }
  mockDocs.set(`bookings/${BOOKING_ID}`, booking);
  mockDocs.set(`users/${DRIVER_ID}`, {
    driver: { averageRating: 4, totalRatings: 1 }
  });
}

function postRating(body, orderId = ORDER_ID) {
  return request(app())
    .post(`/api/customer/marketplace-orders/${orderId}/rating`)
    .send(body);
}

function shopDoc() {
  return mockDocs.get(`shops/${SHOP_ID}`);
}

function orderDoc() {
  return mockDocs.get(`marketplaceOrders/${ORDER_ID}`);
}

describe('marketplace order rating', () => {
  beforeEach(() => {
    resetStore();
    require('./helpers/mockCustomerAuth').resetTestUid();
  });

  test('another customer gets 404 ORDER_NOT_FOUND', async () => {
    seedCompletedOrder({ customerId: 'other' });
    const response = await postRating({ shop: { stars: 4, tags: ['Well packed'] } });
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  test('non-completed order returns 409 INVALID_STATE', async () => {
    seedCompletedOrder({ orderStatus: 'handed_over' });
    const response = await postRating({ shop: { stars: 4, tags: ['Well packed'] } });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE');
  });

  test('empty body returns 400 VALIDATION', async () => {
    seedCompletedOrder();
    const response = await postRating({});
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
  });

  test('invalid stars, tag, duplicate tag, and long comment return 400 VALIDATION', async () => {
    seedCompletedOrder();
    const badStars = await postRating({ shop: { stars: 6, tags: [] } });
    expect(badStars.status).toBe(400);
    const badTag = await postRating({ shop: { stars: 4, tags: ['Not a tag'] } });
    expect(badTag.status).toBe(400);
    const dup = await postRating({ shop: { stars: 4, tags: ['Well packed', 'Well packed'] } });
    expect(dup.status).toBe(400);
    const longComment = await postRating({
      shop: { stars: 4, tags: ['Well packed'], comment: 'x'.repeat(501) }
    });
    expect(longComment.status).toBe(400);
  });

  test('shop-only success updates shop counters and order rating', async () => {
    seedCompletedOrder();
    const response = await postRating({
      shop: { stars: 4, tags: ['Well packed'], comment: 'Nice' }
    });
    expect(response.status).toBe(200);
    expect(response.body.data.order.rating).toEqual({
      shopStars: 4,
      driverStars: null,
      ratedAt: expect.any(String)
    });
    const shopRating = mockDocs.get(`shopRatings/${ORDER_ID}`);
    expect(shopRating.stars).toBe(4);
    expect(shopRating.tags).toEqual(['Well packed']);
    expect(shopDoc().rating).toEqual({ sum: 12, count: 3, average: 4 });
    let ratingsCount = 0;
    mockDocs.forEach((_, path) => {
      if (path.startsWith('ratings/')) {
        ratingsCount += 1;
      }
    });
    expect(ratingsCount).toBe(0);
  });

  test('shop and driver success writes ratings and updates driver aggregate', async () => {
    seedCompletedOrder();
    seedBooking();
    mockDocs.set('ratings/existing', {
      bookingId: 'other-booking',
      customerId: CUSTOMER_ID,
      driverId: DRIVER_ID,
      rating: 5
    });
    const response = await postRating({
      shop: { stars: 5, tags: ['Good quality'] },
      driver: { stars: 3, tags: ['On time', 'Polite'] }
    });
    expect(response.status).toBe(200);
    const driverRating = [...mockDocs.entries()].find(([path]) => path.startsWith('ratings/') && path !== 'ratings/existing');
    expect(driverRating).toBeDefined();
    expect(driverRating[1].bookingId).toBe(BOOKING_ID);
    expect(driverRating[1].categories).toEqual({ tags: ['On time', 'Polite'] });
    const driverUser = mockDocs.get(`users/${DRIVER_ID}`);
    expect(driverUser.driver.totalRatings).toBe(2);
    expect(driverUser.driver.averageRating).toBe(4);
  });

  test('second rating call returns 409 ALREADY_RATED', async () => {
    seedCompletedOrder();
    const first = await postRating({ shop: { stars: 4, tags: ['Well packed'] } });
    expect(first.status).toBe(200);
    const second = await postRating({ shop: { stars: 5, tags: ['Good value'] } });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_RATED');
  });

  test('driver rating without driverId returns 409 and writes nothing', async () => {
    seedCompletedOrder();
    seedBooking('');
    const beforeShop = shopDoc();
    const response = await postRating({ driver: { stars: 5, tags: ['On time'] } });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE');
    expect(mockDocs.has(`shopRatings/${ORDER_ID}`)).toBe(false);
    expect(orderDoc().rating).toBeUndefined();
    expect(shopDoc()).toEqual(beforeShop);
  });

  test('driver with shop when no driverId rejects whole request', async () => {
    seedCompletedOrder();
    mockDocs.set(`bookings/${BOOKING_ID}`, {});
    const response = await postRating({
      shop: { stars: 4, tags: ['Well packed'] },
      driver: { stars: 5, tags: ['On time'] }
    });
    expect(response.status).toBe(409);
    expect(mockDocs.has(`shopRatings/${ORDER_ID}`)).toBe(false);
    expect(orderDoc().rating).toBeUndefined();
  });

  test('rated event touches the order signal', async () => {
    seedCompletedOrder();
    await postRating({ shop: { stars: 4, tags: ['Well packed'] } });
    const signal = mockDocs.get(`marketplaceOrders/${ORDER_ID}/signal/latest`);
    expect(signal).toBeDefined();
    expect(signal.customerId).toBe(CUSTOMER_ID);
    expect(signal.type).toBe('rated');
  });

  test('submitOrderRating service path matches route for shop-only', async () => {
    seedCompletedOrder();
    const result = await submitOrderRating({
      customerId: CUSTOMER_ID,
      orderId: ORDER_ID,
      body: { shop: { stars: 3, tags: ['Good value'] } }
    });
    expect(result.status).toBe(200);
    expect(result.body.data.order.rating.shopStars).toBe(3);
  });
});
