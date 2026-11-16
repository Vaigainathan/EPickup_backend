function setPath(target, path, value) {
  const parts = path.split('.');
  let current = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    current[parts[index]] = current[parts[index]] || {};
    current = current[parts[index]];
  }
  current[parts[parts.length - 1]] = value;
}

function makeDb(initialDocuments) {
  const documents = new Map(Object.entries(initialDocuments));
  const updates = [];
  const ref = (collection, id) => ({ path: `${collection}/${id}`, collection, id });
  const snapshot = (documentRef) => {
    const data = documents.get(documentRef.path);
    return {
      exists: Boolean(data),
      data: () => data
    };
  };
  const db = {
    collection: (collection) => ({
      doc: (id) => ref(collection, id)
    }),
    runTransaction: async (callback) => callback({
      get: async (documentRef) => snapshot(documentRef),
      update: (documentRef, patch) => {
        updates.push({ path: documentRef.path, patch });
        const data = documents.get(documentRef.path);
        Object.entries(patch).forEach(([path, value]) => setPath(data, path, value));
      },
      delete: (documentRef) => documents.delete(documentRef.path)
    })
  };
  return { db, documents, updates };
}

describe('releaseBookingTrackingResources', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/services/firebase', () => ({
      getFirestore: jest.fn()
    }));
  });

  it('clears tracking resources without changing driver fields', async () => {
    const { db, documents, updates } = makeDb({
      'bookings/booking-1': {
        driverId: 'driver-1',
        tracking: { isActive: true }
      },
      'tripTracking/booking-1': { isActive: true },
      'booking_locks/booking-1': { locked: true },
      'driverLocations/driver-1': { currentTripId: 'booking-1' },
      'users/driver-1': {
        driver: { currentBookingId: 'booking-1', activeBookings: 1, isOnline: true }
      }
    });
    const { releaseBookingTrackingResources } = require('../src/services/releaseBookingTrackingResources');

    await releaseBookingTrackingResources({ bookingId: 'booking-1', db });
    await releaseBookingTrackingResources({ bookingId: 'booking-1', db });

    expect(documents.get('tripTracking/booking-1').isActive).toBe(false);
    expect(documents.get('bookings/booking-1').tracking.isActive).toBe(false);
    expect(documents.has('booking_locks/booking-1')).toBe(false);
    expect(documents.get('driverLocations/driver-1').currentTripId).toBeNull();
    expect(documents.get('users/driver-1').driver).toEqual({
      currentBookingId: 'booking-1',
      activeBookings: 1,
      isOnline: true
    });
    expect(updates.some((update) => update.path === 'users/driver-1')).toBe(false);
  });

  it('preserves a driver location assigned to another trip', async () => {
    const { db, documents } = makeDb({
      'bookings/booking-1': { driverId: 'driver-1' },
      'tripTracking/booking-1': { isActive: true },
      'driverLocations/driver-1': { currentTripId: 'booking-2' },
      'users/driver-1': {
        driver: { currentBookingId: 'booking-1', activeBookings: 2, isOnline: true }
      }
    });
    const { releaseBookingTrackingResources } = require('../src/services/releaseBookingTrackingResources');

    await releaseBookingTrackingResources({ bookingId: 'booking-1', db });

    expect(documents.get('driverLocations/driver-1').currentTripId).toBe('booking-2');
    expect(documents.get('users/driver-1').driver.activeBookings).toBe(2);
  });

  it('can preserve the driver location pointer while cleaning tracking resources', async () => {
    const { db, documents } = makeDb({
      'bookings/booking-1': {
        driverId: 'driver-1',
        tracking: { isActive: true }
      },
      'tripTracking/booking-1': { isActive: true },
      'booking_locks/booking-1': { locked: true },
      'driverLocations/driver-1': { currentTripId: 'booking-1' },
      'users/driver-1': { driver: { currentBookingId: 'booking-1' } }
    });
    const { releaseBookingTrackingResources } = require('../src/services/releaseBookingTrackingResources');

    await releaseBookingTrackingResources({
      bookingId: 'booking-1',
      clearDriverLocation: false,
      db
    });

    expect(documents.get('tripTracking/booking-1').isActive).toBe(false);
    expect(documents.get('bookings/booking-1').tracking.isActive).toBe(false);
    expect(documents.has('booking_locks/booking-1')).toBe(false);
    expect(documents.get('driverLocations/driver-1').currentTripId).toBe('booking-1');
  });
});
