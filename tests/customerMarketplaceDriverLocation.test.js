jest.mock('../src/middleware/auth', () => require('./helpers/mockCustomerAuth'));

const { Timestamp } = require('firebase-admin/firestore');
const express = require('express');
const request = require('supertest');

const mockAuth = require('./helpers/mockCustomerAuth');
const mockStore = {
  marketplaceOrders: {},
  bookings: {},
  driverLocations: {}
};

const DRIVER_ID = 'drv-secret-8841';
const DRIVER_PHONE = '9001122334';
const BOOKING_ID = 'booking-live-1';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function mockBuildDb(current) {
  return {
    collection(name) {
      const bucket = current[name] || {};
      return {
        doc(id) {
          return {
            async get() {
              const found = Object.prototype.hasOwnProperty.call(bucket, id) ? bucket[id] : undefined;
              return {
                id,
                exists: found !== undefined,
                data: () => (found ? { ...found } : undefined)
              };
            }
          };
        }
      };
    }
  };
}

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => mockBuildDb(mockStore)
}));

const customerMarketplaceOrderRoutes = require('../src/routes/customerMarketplaceOrders');

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/customer', customerMarketplaceOrderRoutes);
  return server;
}

function resetStore() {
  mockStore.marketplaceOrders = {};
  mockStore.bookings = {};
  mockStore.driverLocations = {};
}

function putOrder(id, overrides) {
  mockStore.marketplaceOrders[id] = {
    customerId: 'customer-test',
    delivery: { stage: 'assigned' },
    linkedBookingId: BOOKING_ID,
    driverInfo: { id: DRIVER_ID, phone: DRIVER_PHONE, name: 'Secret Driver' },
    ...overrides
  };
}

function putBooking(driverId = DRIVER_ID) {
  mockStore.bookings[BOOKING_ID] = {
    driverId,
    driverInfo: { phone: DRIVER_PHONE, name: 'Secret Driver' }
  };
}

function putFix(overrides) {
  mockStore.driverLocations[DRIVER_ID] = {
    latitude: 12.9716,
    longitude: 77.5946,
    bookingId: BOOKING_ID,
    lastUpdated: new Date(),
    accuracy: 5,
    speed: 12,
    heading: 180,
    ...overrides
  };
}

function getLocation(id = 'order-1') {
  return request(app()).get(`/api/customer/marketplace-orders/${id}/driver-location`);
}

describe('customer marketplace driver location', () => {
  beforeEach(() => {
    resetStore();
    mockAuth.resetTestUid();
  });

  test('another customer and a missing order are 404', async () => {
    putOrder('other-order', { customerId: 'someone-else' });
    const foreign = await getLocation('other-order');
    const missing = await getLocation('missing-order');
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body.error.code).toBe('ORDER_NOT_FOUND');
    expect(missing.body.error.code).toBe('ORDER_NOT_FOUND');
  });

  test('searching, null, delivered, and cancelled are 409', async () => {
    const stages = ['searching', null, 'delivered', 'cancelled'];
    for (const stage of stages) {
      putOrder('order-1', { delivery: { stage } });
      const response = await getLocation();
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('INVALID_STATE');
    }
  });

  test('assigned with a fresh matching fix returns only lat, lng, and updatedAt', async () => {
    const updated = new Date();
    putOrder('order-1');
    putBooking();
    putFix({ lastUpdated: updated });
    const response = await getLocation();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        location: {
          lat: 12.9716,
          lng: 77.5946,
          updatedAt: updated.toISOString()
        }
      }
    });
    expect(Object.keys(response.body.data.location).sort()).toEqual(['lat', 'lng', 'updatedAt']);
    expect(response.body.data.location.updatedAt).toMatch(ISO);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(DRIVER_ID);
    expect(serialized).not.toContain(DRIVER_PHONE);
  });

  test('no booking, no driver, no location doc, a 61s-old fix, and a bookingId mismatch are null', async () => {
    putOrder('order-1', { linkedBookingId: '' });
    let response = await getLocation();
    expect(response.body.data).toEqual({ location: null });

    putOrder('order-1');
    putBooking(null);
    response = await getLocation();
    expect(response.body.data).toEqual({ location: null });

    putBooking();
    response = await getLocation();
    expect(response.body.data).toEqual({ location: null });

    putFix({ lastUpdated: new Date(Date.now() - 61000) });
    response = await getLocation();
    expect(response.body.data).toEqual({ location: null });

    putFix({ bookingId: 'some-other-booking', lastUpdated: new Date() });
    response = await getLocation();
    expect(response.body.data).toEqual({ location: null });
  });

  test('at_shop, picked_up, and on_the_way also return a fresh fix', async () => {
    putBooking();
    putFix();
    for (const stage of ['at_shop', 'picked_up', 'on_the_way']) {
      putOrder('order-1', { delivery: { stage } });
      const response = await getLocation();
      expect(response.status).toBe(200);
      expect(response.body.data.location.lat).toBe(12.9716);
    }
  });

  test('a Firestore Timestamp lastUpdated is returned as ISO', async () => {
    const updated = new Date();
    putOrder('order-1');
    putBooking();
    putFix({ lastUpdated: Timestamp.fromDate(updated) });
    const response = await getLocation();
    expect(response.status).toBe(200);
    expect(response.body.data.location).toEqual({
      lat: 12.9716,
      lng: 77.5946,
      updatedAt: updated.toISOString()
    });
  });

  test('epoch milliseconds lastUpdated is returned as ISO', async () => {
    const updatedMs = Date.now();
    putOrder('order-1');
    putBooking();
    putFix({ lastUpdated: updatedMs });
    const response = await getLocation();
    expect(response.body.data.location.updatedAt).toBe(new Date(updatedMs).toISOString());
  });

  test('a lastUpdated more than 60s in the future is null', async () => {
    putOrder('order-1');
    putBooking();
    putFix({ lastUpdated: new Date(Date.now() + 61000) });
    const response = await getLocation();
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ location: null });
  });

  test('a string lastUpdated is null', async () => {
    putOrder('order-1');
    putBooking();
    putFix({ lastUpdated: new Date().toISOString() });
    const response = await getLocation();
    expect(response.body.data).toEqual({ location: null });
  });

  test('lat and lng are used only when latitude and longitude are absent', async () => {
    putOrder('order-1');
    putBooking();
    putFix({
      latitude: undefined,
      longitude: undefined,
      lat: 13.08,
      lng: 80.27
    });
    const fallback = await getLocation();
    expect(fallback.body.data.location.lat).toBe(13.08);
    expect(fallback.body.data.location.lng).toBe(80.27);

    putFix({ latitude: '12.9716', longitude: 77.5946, lat: 13.08, lng: 80.27 });
    const bad = await getLocation();
    expect(bad.body.data).toEqual({ location: null });
  });

  test('the 31st request in a minute is 429', async () => {
    const uid = 'mp10b-driver-location-rate';
    mockAuth.setTestUid(uid);
    putOrder('rate-order', { customerId: uid });
    putBooking();
    putFix();
    const server = app();
    let response;
    for (let i = 0; i < 31; i += 1) {
      response = await request(server).get('/api/customer/marketplace-orders/rate-order/driver-location');
      if (i < 30) {
        expect(response.status).toBe(200);
      }
    }
    expect(response.status).toBe(429);
    expect(response.body.code).toBe('RATE_LIMITED');
  });
});
