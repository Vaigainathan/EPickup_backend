const mockAuth = require('./helpers/mockCustomerAuth');
jest.mock('../src/middleware/auth', () => mockAuth);
jest.mock('../src/middleware/userRateLimiter', () => ({
  userRateLimiter: () => (req, res, next) => next()
}));

const express = require('express');
const request = require('supertest');

const mockDocs = new Map();

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

function mockRef(docPath) {
  const id = docPath.split('/').pop();
  const ref = {
    id,
    path: docPath,
    collection(name) {
      return {
        doc(subId) {
          return mockRef(`${docPath}/${name}/${subId}`);
        },
        async get() {
          const prefix = `${docPath}/${name}/`;
          const docs = [];
          mockDocs.forEach((data, path) => {
            if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
              docs.push({
                id: path.slice(prefix.length),
                data: () => mockClone(data)
              });
            }
          });
          return { docs, empty: docs.length === 0 };
        }
      };
    },
    async get() {
      const data = mockDocs.get(docPath);
      return {
        exists: data !== undefined,
        id,
        data: () => (data === undefined ? undefined : mockClone(data)),
        ref: mockRef(docPath)
      };
    }
  };
  return ref;
}

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => ({
    collection(name) {
      return {
        doc(id) {
          return mockRef(`${name}/${id}`);
        }
      };
    }
  })
}));

const CUSTOMER_ID = 'cust-receipt';
const ORDER_ID = 'order-receipt-1';

function buildApp() {
  const app = express();
  app.use('/api/customer', require('../src/routes/customerMarketplaceOrders'));
  return app;
}

describe('GET /marketplace-orders/:id/receipt', () => {
  beforeEach(() => {
    mockDocs.clear();
    mockAuth.setTestUid(CUSTOMER_ID);
  });

  it('returns PDF for completed order', async () => {
    mockDocs.set(`marketplaceOrders/${ORDER_ID}`, {
      customerId: CUSTOMER_ID,
      orderStatus: 'completed',
      displayId: 48213,
      createdAt: new Date(),
      shopSnapshot: { name: 'Shop' },
      items: [],
      payment: {},
      delivery: { deliveredAt: new Date() }
    });

    const res = await request(buildApp())
      .get(`/api/customer/marketplace-orders/${ORDER_ID}/receipt`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('ePickup-Shop-order-48213.pdf');
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('returns 409 when not completed', async () => {
    mockDocs.set(`marketplaceOrders/${ORDER_ID}`, {
      customerId: CUSTOMER_ID,
      orderStatus: 'preparing',
      displayId: 48213
    });

    const res = await request(buildApp())
      .get(`/api/customer/marketplace-orders/${ORDER_ID}/receipt`)
      .expect(409);

    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('returns 404 for wrong owner', async () => {
    mockDocs.set(`marketplaceOrders/${ORDER_ID}`, {
      customerId: 'other',
      orderStatus: 'completed',
      displayId: 48213
    });

    const res = await request(buildApp())
      .get(`/api/customer/marketplace-orders/${ORDER_ID}/receipt`)
      .expect(404);

    expect(res.body.error.code).toBe('ORDER_NOT_FOUND');
  });
});
