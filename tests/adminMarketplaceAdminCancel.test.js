const mockOrderGet = jest.fn();
const mockBookingGet = jest.fn();

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn((name) => {
      if (name === 'marketplaceOrders') {
        return {
          doc: jest.fn(() => ({
            get: mockOrderGet,
            collection: jest.fn(() => ({
              orderBy: jest.fn(() => ({
                limit: jest.fn(() => ({
                  get: jest.fn(async () => ({ docs: [] }))
                }))
              })),
              get: jest.fn(async () => ({ docs: [] }))
            }))
          }))
        };
      }
      if (name === 'bookings') {
        return { doc: jest.fn(() => ({ get: mockBookingGet })) };
      }
      if (name === 'users') {
        return { doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })) };
      }
      return { doc: jest.fn() };
    })
  }))
}));

jest.mock('../src/services/shopOrderService', () => ({
  supportCancelBeforeHandover: jest.fn()
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

const adminMarketplaceService = require('../src/services/admin/adminMarketplaceService');

describe('adminMarketplaceService.getOrderDetail cancel hints', () => {
  beforeEach(() => {
    mockOrderGet.mockReset();
    mockBookingGet.mockReset();
  });

  test('summary includes canAdminCancel and cancelBlockedReason for stuck handed_over', async () => {
    mockOrderGet.mockResolvedValue({
      exists: true,
      id: 'order-23419',
      data: () => ({
        orderStatus: 'handed_over',
        linkedBookingId: 'booking-1',
        customerId: 'c1',
        shopId: 's1',
        payment: {}
      })
    });
    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'driver_arrived', driverId: 'd1' })
    });

    const detail = await adminMarketplaceService.getOrderDetail('order-23419');
    expect(detail.summary.canAdminCancel).toBe(true);
    expect(detail.summary.cancelBlockedReason).toBeNull();
  });

  test('summary blocks cancel after pickup on linked booking', async () => {
    mockOrderGet.mockResolvedValue({
      exists: true,
      id: 'order-x',
      data: () => ({
        orderStatus: 'handed_over',
        linkedBookingId: 'booking-1',
        payment: {}
      })
    });
    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'picked_up', driverId: 'd1' })
    });

    const detail = await adminMarketplaceService.getOrderDetail('order-x');
    expect(detail.summary.canAdminCancel).toBe(false);
    expect(detail.summary.cancelBlockedReason).toMatch(/pickup/i);
  });
});
