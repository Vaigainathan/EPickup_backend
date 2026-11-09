const mockDocs = new Map();

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

jest.mock('../src/services/parcel/parcelBookingCancelledNotify', () => ({
  notifyParcelBookingCancelled: jest.fn(async () => {})
}));

const { getFirestore } = require('../src/services/firebase');

function buildDb() {
  return {
    collection(name) {
      return {
        doc(id) {
          const path = `${name}/${id}`;
          return {
            path,
            id,
            get: async () => ({
              exists: mockDocs.has(path),
              data: () => mockDocs.get(path)
            })
          };
        },
        where() {
          return {
            where() {
              return this;
            },
            get: async () => ({ empty: true, docs: [], forEach() {} })
          };
        }
      };
    },
    batch() {
      return {
        update: jest.fn(),
        commit: jest.fn(async () => {})
      };
    },
    runTransaction: jest.fn(async (fn) => {
      const tx = {
        get: async (ref) => ({
          exists: mockDocs.has(ref.path),
          data: () => (mockDocs.has(ref.path) ? { ...mockDocs.get(ref.path) } : undefined)
        }),
        update: (ref, patch) => {
          mockDocs.set(ref.path, { ...mockDocs.get(ref.path), ...patch });
        },
        delete: () => {}
      };
      return fn(tx);
    })
  };
}

describe('handleBookingTimeout race with parcel pending timeout job', () => {
  let driverMatchingService;

  beforeEach(() => {
    mockDocs.clear();
    getFirestore.mockReturnValue(buildDb());
    jest.isolateModules(() => {
      driverMatchingService = require('../src/services/driverMatchingService');
    });
  });

  test('txn_ALREADY_CANCELLED still returns cancel success shape', async () => {
    const bookingId = 'race-booking';
    mockDocs.set(`bookings/${bookingId}`, {
      status: 'pending',
      sourceType: 'parcel',
      customerId: 'cust-1',
      pickup: { coordinates: { latitude: 12, longitude: 77 } }
    });

    jest.spyOn(driverMatchingService, 'handleExpiredAssignments').mockResolvedValue({ success: true });
    jest.spyOn(driverMatchingService, 'findAvailableDrivers').mockResolvedValue([]);
    jest.spyOn(driverMatchingService, 'attemptDriverAssignment').mockResolvedValue({ success: false });

    const cancelService = require('../src/services/parcel/parcelPendingCancelService');
    jest.spyOn(cancelService, 'cancelPendingParcelInTransaction').mockResolvedValue({
      changed: false,
      code: 'ALREADY_CANCELLED'
    });

    const result = await driverMatchingService.handleBookingTimeout(bookingId);
    expect(result).toEqual({
      success: true,
      message: 'Booking cancelled due to no drivers available',
      action: 'cancelled'
    });
  });
});
