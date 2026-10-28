const mockEmit = jest.fn();
const mockTo = jest.fn(() => ({ emit: mockEmit }));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true }))
}));

jest.mock('../src/services/socket', () => ({
  getSocketIO: jest.fn(() => ({ to: mockTo }))
}));

jest.mock('../src/services/marketplace/orderEvents', () => ({
  appendEvent: jest.fn()
}));

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => ({ __ts: true }))
    }
  }
}));

const { getFirestore } = require('../src/services/firebase');
const { installRealFirestoreGuard } = require('./helpers/realFirestoreGuard');
const { recordMarketplaceHandoverAfterPickup } = require('../src/services/marketplace/marketplacePickupHandover');

describe('marketplace pickup handover socket', () => {
  installRealFirestoreGuard(getFirestore);

  beforeEach(() => {
    mockEmit.mockReset();
    mockTo.mockClear();
    getFirestore.mockReset();
  });

  test('emits marketplace_handover_confirmed after pickup handover', async () => {
    const orderSnap = {
      exists: true,
      data: () => ({
        orderStatus: 'ready',
        shopId: 'shop-1',
        customerId: 'cust-1',
        displayId: 4242
      })
    };

    getFirestore.mockReturnValue({
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({}))
      })),
      runTransaction: jest.fn(async (fn) => fn({
        get: async () => orderSnap,
        update: jest.fn()
      }))
    });

    await recordMarketplaceHandoverAfterPickup({
      bookingId: 'booking-1',
      booking: {
        sourceType: 'marketplace',
        driverId: 'driver-9',
        driverInfo: { name: 'Driver', phone: '1', vehicleNumber: 'TN' }
      },
      driverId: 'driver-9',
      marketplaceOrderId: 'order-1'
    });

    expect(mockTo).toHaveBeenCalledWith('user:driver-9');
    expect(mockEmit).toHaveBeenCalledWith('marketplace_handover_confirmed', {
      bookingId: 'booking-1',
      marketplaceOrderId: 'order-1',
      displayId: 4242
    });
  });
});
