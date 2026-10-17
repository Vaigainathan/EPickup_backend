jest.mock('../src/middleware/auth', () => require('./helpers/mockCustomerAuth'));

jest.mock('../src/middleware/userRateLimiter', () => ({
  userRateLimiter: () => (req, res, next) => next()
}));

const customerMarketplaceService = require('../src/services/customerMarketplaceService');

const express = require('express');
const request = require('supertest');
const customerMarketplaceRoutes = require('../src/routes/customerMarketplace');

const stubEligibleRows = {
  rows: [
    {
      id: 'shop-a',
      shopName: 'Mart',
      shopType: 'Grocery & Supermarket',
      distanceKm: null,
      etaMinutes: null,
      isOpenNow: true,
      rating: { average: 4, count: 2 },
      isNew: false
    }
  ],
  settings: {
    weights: { rating: 0.4, popularity: 0.3, nearness: 0.3 },
    priorWeight: 5,
    boostDays: 30,
    policyGroupA: ['Food & Restaurants']
  }
};

function buildApp() {
  const app = express();
  app.use('/api/customer/marketplace', customerMarketplaceRoutes);
  return app;
}

describe('GET /api/customer/marketplace/categories', () => {
  let collectSpy;

  beforeEach(() => {
    collectSpy = jest
      .spyOn(customerMarketplaceService, 'collectEligibleShopRows')
      .mockResolvedValue(stubEligibleRows);
  });

  afterEach(() => {
    collectSpy.mockRestore();
  });

  test('missing lat and lng returns 200 with null category ETAs', async () => {
    const response = await request(buildApp()).get('/api/customer/marketplace/categories');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    const grocery = response.body.data.categories.find((row) => row.category === 'Grocery & Supermarket');
    expect(grocery).toMatchObject({
      shopCount: 1,
      etaMinMinutes: null,
      etaMaxMinutes: null,
      comingSoon: false
    });
    expect(collectSpy).toHaveBeenCalledWith(null);
  });

  test('only lat returns 400 INVALID_LOCATION', async () => {
    const response = await request(buildApp()).get('/api/customer/marketplace/categories?lat=12.9');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'INVALID_LOCATION',
        message: 'lng is required'
      }
    });
    expect(collectSpy).not.toHaveBeenCalled();
  });
});
