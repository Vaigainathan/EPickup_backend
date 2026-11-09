const {
  resolveGrossOrderAmount,
  resolveGrossOrderAmountLegacy,
  resolveGrossOrderAmountWithSource
} = require('../src/utils/resolveGrossOrderAmount');

jest.mock('../src/services/fareCalculationService', () => ({
  calculateDistanceAndFare: jest.fn().mockResolvedValue({
    distanceKm: 3,
    fare: { totalFare: 45, baseFare: 20, distanceFare: 25, commission: 5, driverEarnings: 40 }
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

describe('resolveGrossOrderAmount field chain', () => {
  const parcelBooking = {
    pricing: { totalAmount: 150, currency: 'INR' },
    fare: { totalFare: 150 }
  };

  const fareOnlyBooking = {
    fare: { totalFare: 99 }
  };

  test('BEFORE vs AFTER — parcel with pricing.totalAmount unchanged', () => {
    expect(resolveGrossOrderAmountLegacy(parcelBooking)).toBe(150);
    expect(resolveGrossOrderAmount(parcelBooking)).toBe(150);
    expect(resolveGrossOrderAmountWithSource(parcelBooking).field).toBe('pricing.totalAmount');
  });

  test('BEFORE vs AFTER — fare.totalFare-only legacy doc gains amount', () => {
    expect(resolveGrossOrderAmountLegacy(fareOnlyBooking)).toBe(0);
    expect(resolveGrossOrderAmount(fareOnlyBooking)).toBe(99);
    expect(resolveGrossOrderAmountWithSource(fareOnlyBooking).field).toBe('fare.totalFare');
  });

  test('marketplace doc from buildMarketplaceBookingDoc uses pricing.totalFare (delivery charge)', async () => {
    jest.spyOn(shopOrderService, 'getDb').mockReturnValue(
      mockDb({
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
      })
    );

    const doc = await shopOrderService.buildMarketplaceBookingDoc('shop-1', 'order-mkt', {
      customerId: 'cust-1',
      displayId: 10001,
      items: [{ qty: 1 }],
      deliveryAddress: {
        text: 'Drop line',
        coordinates: { latitude: 12.5, longitude: 78.57 }
      }
    });

    const deliveryCharge = doc.pricing.totalFare;
    const resolved = resolveGrossOrderAmountWithSource(doc);

    expect(resolveGrossOrderAmountLegacy(doc)).toBe(deliveryCharge);
    expect(resolved.field).toBe('pricing.totalFare');
    expect(resolved.amount).toBe(deliveryCharge);
    expect(resolved.amount).toBe(45);
  });
});
