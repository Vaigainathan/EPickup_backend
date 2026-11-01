const mockTransitionBooking = jest.fn();
const mockBookingGet = jest.fn();
const mockBookingUpdate = jest.fn();
const mockOrderGet = jest.fn();

const bookingRef = {
  get: mockBookingGet,
  update: mockBookingUpdate
};

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'bookings') {
      return {
        doc: jest.fn(() => bookingRef)
      };
    }
    if (name === 'marketplaceOrders') {
      return {
        doc: jest.fn(() => ({
          get: mockOrderGet
        }))
      };
    }
    if (name === 'booking_status_updates') {
      return { add: jest.fn(async () => {}) };
    }
    return { doc: jest.fn() };
  })
};

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => mockDb)
}));

jest.mock('../src/services/bookingStateMachine', () => ({
  transitionBooking: (...args) => mockTransitionBooking(...args)
}));

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    increment: jest.fn((n) => n)
  }
}));

jest.mock('firebase-admin', () => {
  const blockRealFirestore = () => {
    throw new Error('REAL FIRESTORE IN TEST');
  };
  return {
    apps: [{ name: '[DEFAULT]' }],
    initializeApp: jest.fn(blockRealFirestore),
    app: jest.fn(),
    credential: { cert: jest.fn() },
    firestore: blockRealFirestore
  };
});

const {
  driverStatusWorkflowService,
  DriverStatusError
} = require('../src/services/driverStatusWorkflowService');

describe('driverStatusWorkflowService marketplace handover', () => {
  beforeEach(() => {
    mockTransitionBooking.mockReset();
    mockTransitionBooking.mockResolvedValue({ success: true });
    mockBookingGet.mockReset();
    mockBookingUpdate.mockReset();
    mockOrderGet.mockReset();
    driverStatusWorkflowService.db = null;
  });

  test('parcel booking allows photo_captured without order read', async () => {
    mockBookingGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          driverId: 'driver-1',
          status: 'driver_arrived',
          sourceType: 'parcel',
          pickup: { coordinates: { latitude: 12, longitude: 78 } }
        })
      })
      .mockResolvedValueOnce({
        data: () => ({
          driverId: 'driver-1',
          status: 'photo_captured',
          statusMeta: { sequence: 1 }
        })
      });

    const result = await driverStatusWorkflowService.updateStatus({
      bookingId: 'booking-1',
      driverId: 'driver-1',
      requestedStatus: 'photo_captured',
      location: { latitude: 12, longitude: 78 }
    });

    expect(result.status).toBe('photo_captured');
    expect(mockOrderGet).not.toHaveBeenCalled();
    expect(mockTransitionBooking).toHaveBeenCalled();
  });

  test('marketplace booking allows photo_captured without shop handover gate', async () => {
    mockBookingGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          driverId: 'driver-1',
          status: 'driver_arrived',
          sourceType: 'marketplace',
          marketplaceOrderId: 'order-1',
          pickup: { coordinates: { latitude: 12, longitude: 78 } }
        })
      })
      .mockResolvedValueOnce({
        data: () => ({
          driverId: 'driver-1',
          status: 'photo_captured',
          statusMeta: { sequence: 1 }
        })
      });

    const result = await driverStatusWorkflowService.updateStatus({
      bookingId: 'booking-1',
      driverId: 'driver-1',
      requestedStatus: 'photo_captured',
      location: { latitude: 12, longitude: 78 }
    });

    expect(result.status).toBe('photo_captured');
    expect(mockOrderGet).not.toHaveBeenCalled();
    expect(mockTransitionBooking).toHaveBeenCalled();
  });

  test('marketplace booking allows photo_captured when order still ready', async () => {
    mockBookingGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          driverId: 'driver-1',
          status: 'driver_arrived',
          sourceType: 'marketplace',
          marketplaceOrderId: 'order-1',
          pickup: { coordinates: { latitude: 12, longitude: 78 } }
        })
      })
      .mockResolvedValueOnce({
        data: () => ({
          driverId: 'driver-1',
          status: 'photo_captured',
          statusMeta: { sequence: 1 }
        })
      });
    mockOrderGet.mockResolvedValue({
      exists: true,
      data: () => ({ orderStatus: 'ready' })
    });

    const result = await driverStatusWorkflowService.updateStatus({
      bookingId: 'booking-1',
      driverId: 'driver-1',
      requestedStatus: 'photo_captured',
      location: { latitude: 12, longitude: 78 }
    });

    expect(result.status).toBe('photo_captured');
    expect(mockTransitionBooking).toHaveBeenCalled();
  });
});
