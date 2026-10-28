jest.mock('../src/middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.user = { uid: 'shop-user' };
    next();
  },
  requireRole: () => (_req, _res, next) => next()
}));

jest.mock('../src/services/shopCatalogueService', () => ({
  requireShopId: jest.fn(async () => 'shop-1')
}));

jest.mock('../src/services/shopOrderService', () => ({
  confirmHandover: jest.fn()
}));

const express = require('express');
const request = require('supertest');
const shopOrders = require('../src/routes/shopOrders');

const app = express();
app.use(express.json());
app.use('/api/shop/orders', shopOrders);

describe('confirm-handover removed', () => {
  test('returns 410 HANDOVER_REMOVED', async () => {
    const res = await request(app)
      .post('/api/shop/orders/order-1/confirm-handover')
      .send({ otp: '123456', displayId: 1 });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('HANDOVER_REMOVED');
    expect(res.body.error.message).toContain('delivery partner');
  });
});
