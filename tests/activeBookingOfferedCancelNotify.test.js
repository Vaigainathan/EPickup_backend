jest.mock('../src/services/releaseBookingTrackingResources', () => ({
  releaseBookingTrackingResources: jest.fn(async () => ({ success: true }))
}));

const mockNotifyOfferedDriversBookingCancelled = jest.fn(async () => {});
jest.mock('../src/services/notifyOfferedDriversBookingCancelled', () => ({
  notifyOfferedDriversBookingCancelled: (...args) => mockNotifyOfferedDriversBookingCancelled(...args)
}));

const ActiveBookingService = require('../src/services/activeBookingService');

describe('activeBookingService cancel notifies offered drivers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('calls notify when unassigned with notifiedDrivers', async () => {
    const bookingRef = { path: 'bookings/b1', id: 'b1' };
    const bookingDoc = {
      id: 'b1',
      ref: bookingRef,
      data: () => ({
        status: 'pending',
        driverId: null,
        notifiedDrivers: ['driver-x']
      })
    };
    const querySnap = { empty: false, docs: [bookingDoc] };
    const db = {
      collection: jest.fn((name) => {
        if (name === 'bookings') {
          return {
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            doc: jest.fn(() => bookingRef)
          };
        }
        return { doc: jest.fn() };
      }),
      runTransaction: jest.fn(async (fn) => {
        const tx = {
          get: jest.fn(async () => querySnap),
          update: jest.fn()
        };
        return fn(tx);
      })
    };

    const service = new ActiveBookingService();
    service.getDb = () => db;
    service.db = db;

    const result = await service.cancelActiveBooking('customer-1', 'no longer needed');
    expect(result.success).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(mockNotifyOfferedDriversBookingCancelled).toHaveBeenCalledWith(
      'b1',
      ['driver-x'],
      'no longer needed',
      'customer-1',
      expect.objectContaining({ skipDriverId: null })
    );
  });

  test('skips notify when driver assigned', async () => {
    const bookingRef = { path: 'bookings/b1', id: 'b1' };
    const driverRef = { path: 'users/driver-1', id: 'driver-1' };
    const bookingDoc = {
      id: 'b1',
      ref: bookingRef,
      data: () => ({
        status: 'driver_assigned',
        driverId: 'driver-1',
        notifiedDrivers: ['driver-x']
      })
    };
    const querySnap = { empty: false, docs: [bookingDoc] };
    const db = {
      collection: jest.fn((name) => {
        if (name === 'bookings') {
          return {
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            doc: jest.fn(() => bookingRef)
          };
        }
        if (name === 'users') {
          return { doc: jest.fn(() => driverRef) };
        }
        return { doc: jest.fn() };
      }),
      runTransaction: jest.fn(async (fn) => {
        const tx = {
          get: jest.fn(async (ref) => {
            if (ref === driverRef) {
              return { exists: true, data: () => ({ driver: { currentBookingId: 'b1' } }) };
            }
            return querySnap;
          }),
          update: jest.fn()
        };
        return fn(tx);
      })
    };

    const service = new ActiveBookingService();
    service.getDb = () => db;
    service.db = db;

    await service.cancelActiveBooking('customer-1', 'test');
    await new Promise((r) => setImmediate(r));
    expect(mockNotifyOfferedDriversBookingCancelled).not.toHaveBeenCalled();
  });
});