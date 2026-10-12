jest.mock('../src/middleware/auth', () => ({
  ...require('./helpers/mockCustomerAuth'),
  userRateLimit: () => (req, res, next) => next()
}));

const express = require('express');
const request = require('supertest');

const mockDocs = new Map();

function mockClone(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (typeof value.toDate === 'function') {
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

function mockRef(docPath) {
  const id = docPath.split('/').pop();
  return {
    id,
    path: docPath,
    async get() {
      const data = mockDocs.get(docPath);
      return {
        exists: data !== undefined,
        id,
        data: () => (data === undefined ? undefined : mockClone(data))
      };
    }
  };
}

const mockDb = {
  collection(name) {
    return {
      doc(id) {
        return mockRef(`${name}/${id}`);
      }
    };
  }
};

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mockDb,
  Timestamp: {
    fromDate: (date) => date,
    now: () => new Date()
  }
}));

const CUSTOMER_ID = 'cust-invoice-1';
const BOOKING_ID = 'booking-parcel-1';

const completedBooking = {
  customerId: CUSTOMER_ID,
  sourceType: 'parcel',
  status: 'completed',
  displayId: 15567,
  createdAt: new Date('2026-01-15T10:00:00.000Z'),
  completedAt: new Date('2026-01-15T12:00:00.000Z'),
  pickup: { name: 'Sender', address: 'Pickup St', phone: '9000000001' },
  dropoff: { name: 'Receiver', address: 'Drop St', phone: '9000000002' },
  package: { weight: 2, description: 'Docs' },
  fare: { base: 40, distance: 20, total: 60, currency: 'INR' },
  paymentMethod: 'cash',
  paymentStatus: 'completed'
};

const mockAuth = require('./helpers/mockCustomerAuth');

function buildApp() {
  mockAuth.setTestUid(CUSTOMER_ID);
  const app = express();
  app.use('/api/customer', require('../src/routes/customer'));
  return app;
}

describe('GET /api/customer/invoice/:bookingId', () => {
  beforeEach(() => {
    mockDocs.clear();
    mockDocs.set(`bookings/${BOOKING_ID}`, completedBooking);
    mockDocs.set(`users/${CUSTOMER_ID}`, {
      phoneNumber: '9000000000',
      email: 'c@example.com',
      customer: { name: 'Customer' }
    });
  });

  it('returns JSON invoice payload unchanged shape', async () => {
    const res = await request(buildApp())
      .get(`/api/customer/invoice/${BOOKING_ID}`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      bookingId: BOOKING_ID,
      customer: expect.objectContaining({ name: expect.any(String) }),
      pickup: expect.objectContaining({ address: 'Pickup St' }),
      dropoff: expect.objectContaining({ address: 'Drop St' }),
      fare: expect.objectContaining({ totalFare: 60, currency: 'INR' }),
      paymentMethod: 'cash',
      paymentStatus: 'completed'
    });
    expect(res.body.data.invoiceId).toMatch(/^INV-/);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('returns application/pdf for format=pdf', async () => {
    const res = await request(buildApp())
      .get(`/api/customer/invoice/${BOOKING_ID}?format=pdf`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(100);
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });
});
