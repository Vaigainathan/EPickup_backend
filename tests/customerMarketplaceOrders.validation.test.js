jest.mock('../src/middleware/auth', () => require('./helpers/mockCustomerAuth'));

const express = require('express');
const request = require('supertest');
const customerMarketplaceOrderRoutes = require('../src/routes/customerMarketplaceOrders');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/customer', customerMarketplaceOrderRoutes);
  return app;
}

function postOrder(app, headers, body) {
  const call = request(app).post('/api/customer/marketplace-orders');
  if (headers) {
    Object.keys(headers).forEach((name) => {
      call.set(name, headers[name]);
    });
  }
  return call.send(body);
}

const KEY = '11111111-1111-4111-8111-111111111111';
const VALID = {
  shopId: 'shop-1',
  addressId: 'addr_1',
  items: [{ productId: 'p1', qty: 1, price: 10 }]
};

describe('POST /api/customer/marketplace-orders validation', () => {
  const app = buildApp();

  test('missing Idempotency-Key is 400 VALIDATION', async () => {
    const response = await postOrder(app, null, VALID);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
  });

  test('a non-UUID key is 400 VALIDATION', async () => {
    const response = await postOrder(app, { 'Idempotency-Key': 'not-a-uuid' }, VALID);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
  });

  test('missing shopId is 400 VALIDATION', async () => {
    const response = await postOrder(app, { 'Idempotency-Key': KEY }, {
      addressId: 'addr_1',
      items: VALID.items
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
  });

  test('empty items is 400 VALIDATION', async () => {
    const response = await postOrder(app, { 'Idempotency-Key': KEY }, {
      ...VALID,
      items: []
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
  });

  test('customerNote over 300 characters is 400 VALIDATION', async () => {
    const response = await postOrder(app, { 'Idempotency-Key': KEY }, {
      ...VALID,
      customerNote: 'n'.repeat(301)
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
  });

  test('riderNoteText over 200 characters is 400 VALIDATION', async () => {
    const response = await postOrder(app, { 'Idempotency-Key': KEY }, {
      ...VALID,
      riderNoteText: 'r'.repeat(201)
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
  });

  test('a non-integer qty is 400 VALIDATION', async () => {
    const response = await postOrder(app, { 'Idempotency-Key': KEY }, {
      ...VALID,
      items: [{ productId: 'p1', qty: 1.5, price: 10 }]
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
  });

  test('a missing addressId is 400 VALIDATION', async () => {
    const response = await postOrder(app, { 'Idempotency-Key': KEY }, {
      shopId: 'shop-1',
      items: VALID.items
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION');
  });
});
