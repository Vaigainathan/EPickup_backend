jest.mock('../src/services/bookingService', () => ({
  getBookingDetails: jest.fn(),
  cancelBooking: jest.fn()
}));

jest.mock('../src/middleware/auth', () => ({
  requireRole: () => (req, res, next) => next(),
  requireCustomer: (req, res, next) => next(),
  requireDriver: (req, res, next) => next(),
  userRateLimit: () => (req, res, next) => next(),
  requireOwnership: () => (req, res, next) => next()
}));

const express = require('express');
const request = require('supertest');
jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

const bookingService = require('../src/services/bookingService');
const bookingRoutes = require('../src/routes/booking');

const MARKETPLACE_BODY = {
  success: false,
  error: 'Not a parcel booking',
  code: 'MARKETPLACE_BOOKING'
};

function appWithUser(user) {
  const server = express();
  server.use(express.json());
  server.use((req, res, next) => {
    req.user = user;
    next();
  });
  server.use('/api/bookings', bookingRoutes);
  return server;
}

const marketplaceBooking = {
  customerId: 'cust-1',
  driverId: 'driver-1',
  sourceType: 'marketplace',
  status: 'pending'
};

describe('legacy bookings parcel filter by-id', () => {
  const originalFlag = process.env.FEATURE_PARCEL_SOURCE_FILTER;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.FEATURE_PARCEL_SOURCE_FILTER;
    } else {
      process.env.FEATURE_PARCEL_SOURCE_FILTER = originalFlag;
    }
    jest.clearAllMocks();
  });

  test('customer gets 409 for marketplace booking when flag on', async () => {
    process.env.FEATURE_PARCEL_SOURCE_FILTER = 'true';
    bookingService.getBookingDetails.mockResolvedValue({
      data: {
        booking: { ...marketplaceBooking },
        driver: null,
        tracking: null
      }
    });

    const res = await request(appWithUser({ uid: 'cust-1', userType: 'customer' }))
      .get('/api/bookings/book-mp-1');
    expect(res.status).toBe(409);
    expect(res.body).toEqual(MARKETPLACE_BODY);
  });

  test('driver gets 200 for same marketplace booking when flag on', async () => {
    process.env.FEATURE_PARCEL_SOURCE_FILTER = 'true';
    bookingService.getBookingDetails.mockResolvedValue({
      data: {
        booking: { ...marketplaceBooking },
        driver: { id: 'driver-1' },
        tracking: null
      }
    });

    const res = await request(appWithUser({ uid: 'driver-1', userType: 'driver' }))
      .get('/api/bookings/book-mp-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('marketplace booking returned when flag off', async () => {
    delete process.env.FEATURE_PARCEL_SOURCE_FILTER;
    bookingService.getBookingDetails.mockResolvedValue({
      data: {
        booking: { ...marketplaceBooking },
        driver: null,
        tracking: null
      }
    });

    const res = await request(appWithUser({ uid: 'cust-1', userType: 'customer' }))
      .get('/api/bookings/book-mp-1');
    expect(res.status).toBe(200);
  });
});

describe('POST /api/bookings/:id/cancel ownership', () => {
  beforeEach(() => {
    bookingService.getBookingDetails.mockResolvedValue({
      data: {
        booking: {
          customerId: 'cust-owner',
          driverId: 'driver-1',
          sourceType: 'parcel',
          status: 'pending'
        }
      }
    });
    bookingService.cancelBooking.mockResolvedValue({ data: { ok: true } });
    delete process.env.FEATURE_PARCEL_SOURCE_FILTER;
  });

  test('another customer receives 403', async () => {
    const res = await request(appWithUser({ uid: 'cust-other', userType: 'customer' }))
      .post('/api/bookings/book-1/cancel')
      .send({ reason: 'changed my mind now' });
    expect(res.status).toBe(403);
    expect(bookingService.cancelBooking).not.toHaveBeenCalled();
  });

  test('owner can cancel', async () => {
    const res = await request(appWithUser({ uid: 'cust-owner', userType: 'customer' }))
      .post('/api/bookings/book-1/cancel')
      .send({ reason: 'changed my mind now' });
    expect(res.status).toBe(200);
    expect(bookingService.cancelBooking).toHaveBeenCalledWith('book-1', 'cust-owner', 'changed my mind now');
  });
});

describe('bookingService active query uses parcel filter when flag on', () => {
  const originalFlag = process.env.FEATURE_PARCEL_SOURCE_FILTER;

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.FEATURE_PARCEL_SOURCE_FILTER;
    } else {
      process.env.FEATURE_PARCEL_SOURCE_FILTER = originalFlag;
    }
  });

  test('withParcelSource adds sourceType filter on idempotency-style query', async () => {
    process.env.FEATURE_PARCEL_SOURCE_FILTER = 'true';
    const { withParcelSource } = require('../src/services/parcelSourceFilter');
    const query = { where: jest.fn(() => query) };
    withParcelSource(query);
    expect(query.where).toHaveBeenCalledWith('sourceType', '==', 'parcel');
  });
});
