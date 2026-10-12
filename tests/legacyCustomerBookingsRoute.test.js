jest.mock('../src/middleware/auth', () => ({
  ...require('./helpers/mockCustomerAuth'),
  requireRole: () => (req, res, next) => next(),
  requireCustomer: (req, res, next) => next(),
  requireDriver: (req, res, next) => next(),
  userRateLimit: () => (req, res, next) => next(),
  requireOwnership: () => (req, res, next) => next()
}));

jest.mock('../src/services/customerParcelBookingHistory', () => {
  const actual = jest.requireActual('../src/services/customerParcelBookingHistory');
  return {
    ...actual,
    listCustomerParcelBookings: jest.fn()
  };
});

const express = require('express');
const request = require('supertest');
const bookingRoutes = require('../src/routes/booking');
const {
  listCustomerParcelBookings,
  presentCustomerParcelBookingHistory
} = require('../src/services/customerParcelBookingHistory');
let testUid = 'customer-test';

function app() {
  const server = express();
  server.use(express.json());
  server.use((req, res, next) => {
    req.user = { uid: testUid, userType: 'customer' };
    next();
  });
  server.use('/api/bookings', bookingRoutes);
  return server;
}

describe('GET /api/bookings/customer/:customerId', () => {
  beforeEach(() => {
    testUid = 'customer-test';
    listCustomerParcelBookings.mockReset();
  });

  test('returns 403 when customer id does not match caller', async () => {
    testUid = 'customer-a';
    const res = await request(app()).get('/api/bookings/customer/customer-b');
    expect(res.status).toBe(403);
    expect(listCustomerParcelBookings).not.toHaveBeenCalled();
  });

  test('returns presented list for own customer id', async () => {
    testUid = 'customer-a';
    const row = {
      id: 'b1',
      status: 'delivered',
      totalFare: 99,
      fare: { total: 99, totalFare: 99, currency: 'INR', commission: 1 },
      pricing: { totalFare: 99, currency: 'INR', commission: 1 }
    };
    listCustomerParcelBookings.mockResolvedValue({
      data: [row],
      pagination: { limit: 20, offset: 0, total: 1, hasMore: false }
    });

    const res = await request(app()).get('/api/bookings/customer/customer-a');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual(presentCustomerParcelBookingHistory(row));
    expect(res.body.data[0].fare.commission).toBeUndefined();
  });
});
