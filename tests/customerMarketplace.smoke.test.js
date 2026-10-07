jest.mock('../src/middleware/auth', () => require('./helpers/mockCustomerAuth'));

const express = require('express');
const request = require('supertest');
const customerMarketplaceRoutes = require('../src/routes/customerMarketplace');

function buildApp() {
  const app = express();
  app.use('/api/customer/marketplace', customerMarketplaceRoutes);
  return app;
}

describe('GET /api/customer/marketplace/categories', () => {
  test('missing lat and lng returns 400', async () => {
    const response = await request(buildApp()).get('/api/customer/marketplace/categories');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'INVALID_LOCATION',
        message: 'lat is required'
      }
    });
  });
});
