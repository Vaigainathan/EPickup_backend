const mockOrderGet = jest.fn();

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
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
  mapDriverMarketplaceItems,
  loadAssignedMarketplaceContext,
  attachMarketplaceToDriverBooking
} = require('../src/services/marketplace/driverMarketplaceAssignment');

function buildDb() {
  return {
    collection: jest.fn((name) => {
      if (name === 'marketplaceOrders') {
        return {
          doc: jest.fn(() => ({
            get: mockOrderGet
          }))
        };
      }
      return { doc: jest.fn() };
    })
  };
}

describe('driverMarketplaceAssignment', () => {
  beforeEach(() => {
    mockOrderGet.mockReset();
  });

  test('mapDriverMarketplaceItems excludes unavailable and prices', () => {
    const items = mapDriverMarketplaceItems([
      { name: 'Rice', variantLabel: '1kg', qty: 2, price: 100, unavailable: false },
      { name: 'Oil', qty: 1, unavailable: true }
    ]);
    expect(items).toEqual([
      { name: 'Rice', variantLabel: '1kg', qty: 2 }
    ]);
    expect(items[0]).not.toHaveProperty('price');
  });

  test('loadAssignedMarketplaceContext returns null for non-assigned driver', async () => {
    const ctx = await loadAssignedMarketplaceContext(
      buildDb(),
      { sourceType: 'marketplace', driverId: 'other', marketplaceOrderId: 'o1' },
      'driver-1'
    );
    expect(ctx).toBeNull();
    expect(mockOrderGet).not.toHaveBeenCalled();
  });

  test('loadAssignedMarketplaceContext loads compat handedOver and items', async () => {
    mockOrderGet.mockResolvedValue({
      exists: true,
      data: () => ({
        displayId: 42,
        orderStatus: 'ready',
        items: [{ name: 'Tea', variantLabel: null, qty: 1 }]
      })
    });

    const ctx = await loadAssignedMarketplaceContext(
      buildDb(),
      {
        sourceType: 'marketplace',
        driverId: 'driver-1',
        marketplaceOrderId: 'order-1',
        status: 'driver_assigned',
        pickup: { name: 'Corner Store', phone: '9000000002' }
      },
      'driver-1'
    );

    expect(ctx).toEqual({
      displayId: 42,
      handedOver: true,
      shopName: 'Corner Store',
      shopPhone: '9000000002',
      items: [{ name: 'Tea', variantLabel: null, qty: 1 }]
    });
  });

  test('attachMarketplaceToDriverBooking nests marketplace block', () => {
    const booking = { id: 'b1', status: 'driver_assigned' };
    const withMarketplace = attachMarketplaceToDriverBooking(booking, {
      displayId: 1,
      handedOver: false,
      items: []
    });
    expect(withMarketplace.marketplace.handedOver).toBe(false);
    expect(withMarketplace.id).toBe('b1');
  });
});
