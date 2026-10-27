const express = require('express');
const request = require('supertest');

const mockUpdateProductAvailability = jest.fn();

jest.mock('../src/middleware/auth', () => require('./helpers/mockShopAuth'));
jest.mock('../src/services/shopCatalogueService', () => ({
  requireShopId: jest.fn(async (uid) => uid),
  updateProductAvailability: (...args) => mockUpdateProductAvailability(...args)
}));

const shopProductsRoutes = require('../src/routes/shopProducts');
const { setTestShopUid, resetTestShopUid } = require('./helpers/mockShopAuth');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/shop/products', shopProductsRoutes);
  return app;
}

describe('PATCH /api/shop/products/:id/availability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTestShopUid();
    setTestShopUid('shop-owner');
  });

  it('returns 200 for owner with expected shape', async () => {
    mockUpdateProductAvailability.mockResolvedValue({
      id: 'prod-1',
      soldOut: true,
      updatedAt: '2026-10-27T10:00:00.000Z'
    });

    const res = await request(buildApp())
      .patch('/api/shop/products/prod-1/availability')
      .send({ soldOut: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        id: 'prod-1',
        soldOut: true,
        updatedAt: '2026-10-27T10:00:00.000Z'
      }
    });
    expect(mockUpdateProductAvailability).toHaveBeenCalledWith('shop-owner', 'prod-1', { soldOut: true });
  });

  it('returns 403 when service rejects other shop', async () => {
    const error = new Error('You do not have access to this product');
    error.status = 403;
    error.code = 'FORBIDDEN';
    mockUpdateProductAvailability.mockRejectedValue(error);

    const res = await request(buildApp())
      .patch('/api/shop/products/prod-other/availability')
      .send({ soldOut: false });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 400 for invalid body', async () => {
    const error = new Error('soldOut must be a boolean');
    error.status = 400;
    error.code = 'INVALID_AVAILABILITY';
    mockUpdateProductAvailability.mockRejectedValue(error);

    const res = await request(buildApp())
      .patch('/api/shop/products/prod-1/availability')
      .send({ soldOut: 'true' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_AVAILABILITY');
  });

  it('is idempotent when service returns stable soldOut', async () => {
    const payload = {
      id: 'prod-1',
      soldOut: true,
      updatedAt: '2026-10-27T10:00:00.000Z'
    };
    mockUpdateProductAvailability.mockResolvedValue(payload);

    const app = buildApp();
    const first = await request(app)
      .patch('/api/shop/products/prod-1/availability')
      .send({ soldOut: true });
    const second = await request(app)
      .patch('/api/shop/products/prod-1/availability')
      .send({ soldOut: true });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.data.soldOut).toBe(true);
    expect(mockUpdateProductAvailability).toHaveBeenCalledTimes(2);
  });
});
