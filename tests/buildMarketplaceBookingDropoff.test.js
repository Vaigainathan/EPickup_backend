jest.mock('../src/services/fareCalculationService', () => ({
  calculateDistanceAndFare: jest.fn().mockResolvedValue({
    distanceKm: 3,
    fare: { totalFare: 45, baseFare: 20, distanceFare: 25 }
  }),
  isFareUnavailableError: jest.fn().mockReturnValue(false),
  FARE_UNAVAILABLE_DETAILS: 'unavailable'
}));

jest.mock('../src/services/displayIdService', () => ({
  formatDisplayId: jest.fn(() => '12345')
}));

const shopOrderService = require('../src/services/shopOrderService');

function mockDb({ shopUser, shopProfile, customer }) {
  return {
    collection: (name) => ({
      doc: (id) => ({
        get: jest.fn().mockResolvedValue({
          exists: true,
          data: () => {
            if (name === 'shops') {
              return shopProfile;
            }
            if (id === 'cust-1') {
              return customer;
            }
            if (id === 'shop-1') {
              return shopUser;
            }
            return {};
          }
        })
      })
    })
  };
}

describe('buildMarketplaceBookingDoc dropoff', () => {
  beforeEach(() => {
    jest.spyOn(shopOrderService, 'getDb').mockReturnValue(mockDb({
      shopUser: {
        shop: { shopName: 'Test Shop' },
        phone: '+911111111111',
        name: 'Shop Owner'
      },
      shopProfile: {
        address: 'Shop addr',
        location: { latitude: 12.49, longitude: 78.56 }
      },
      customer: {
        name: 'Profile Customer',
        phone: '+912222222222'
      }
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('uses snapshot receiver and landmark with rider instructions', async () => {
    const doc = await shopOrderService.buildMarketplaceBookingDoc('shop-1', 'order-1', {
      customerId: 'cust-1',
      displayId: 10001,
      items: [{ qty: 2 }],
      riderNoteText: 'Leave at gate',
      deliveryAddress: {
        text: 'Drop line',
        coordinates: { latitude: 12.5, longitude: 78.57 },
        receiverName: 'Snapshot Receiver',
        receiverPhone: '+919876543210',
        landmark: 'Blue gate'
      }
    });
    expect(doc.dropoff.name).toBe('Snapshot Receiver');
    expect(doc.dropoff.phone).toBe('+919876543210');
    expect(doc.dropoff.address).toBe('Drop line');
    expect(doc.dropoff.landmark).toBe('Blue gate');
    expect(doc.dropoff.instructions).toBe('Leave at gate');
  });

  test('falls back to customer profile when snapshot has no receiver', async () => {
    const doc = await shopOrderService.buildMarketplaceBookingDoc('shop-1', 'order-2', {
      customerId: 'cust-1',
      displayId: 10002,
      items: [{ qty: 1 }],
      deliveryAddress: {
        text: 'Drop line',
        coordinates: { latitude: 12.5, longitude: 78.57 }
      }
    });
    expect(doc.dropoff.name).toBe('Profile Customer');
    expect(doc.dropoff.phone).toBe('+912222222222');
    expect(doc.dropoff.landmark).toBeUndefined();
  });
});
