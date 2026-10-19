const mockEmit = jest.fn();
const mockTo = jest.fn(() => ({ emit: mockEmit }));
const mockBookingGet = jest.fn();

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true }))
}));

jest.mock('../src/services/socket', () => ({
  getSocketIO: jest.fn(() => ({ to: mockTo }))
}));

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn((name) => {
      if (name === 'bookings') {
        return {
          doc: jest.fn(() => ({
            get: mockBookingGet
          }))
        };
      }
      return { doc: jest.fn() };
    })
  }))
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

const shopOrderService = require('../src/services/shopOrderService');

describe('confirmHandover driver socket', () => {
  beforeEach(() => {
    mockEmit.mockReset();
    mockTo.mockClear();
    mockBookingGet.mockReset();
    jest.restoreAllMocks();
  });

  test('emits marketplace_handover_confirmed to assigned driver', async () => {
    jest.spyOn(shopOrderService, 'runOwnedTransition').mockResolvedValue({
      alreadyProcessed: false,
      order: {
        linkedBookingId: 'booking-1',
        displayId: 4242,
        customerId: 'customer-1'
      },
      handoverSource: {}
    });

    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({ driverId: 'driver-9' })
    });

    await shopOrderService.confirmHandover('shop-1', 'order-1', {
      otp: '111111',
      displayId: 4242
    });

    expect(mockTo).toHaveBeenCalledWith('user:driver-9');
    expect(mockEmit).toHaveBeenCalledWith('marketplace_handover_confirmed', {
      bookingId: 'booking-1',
      marketplaceOrderId: 'order-1',
      displayId: 4242
    });
  });

  test('does not emit when handover already processed', async () => {
    jest.spyOn(shopOrderService, 'runOwnedTransition').mockResolvedValue({
      alreadyProcessed: true,
      order: { linkedBookingId: 'booking-1', displayId: 1 }
    });

    await shopOrderService.confirmHandover('shop-1', 'order-1', {
      otp: '111111',
      displayId: 1
    });

    expect(mockEmit).not.toHaveBeenCalled();
  });
});
