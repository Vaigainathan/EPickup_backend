const { CustomerMarketplaceService } = require('../src/services/customerMarketplaceService');
const { sortShops } = require('../src/services/marketplace/browseRanking');
const shopCatalogueService = require('../src/services/shopCatalogueService');

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

jest.mock('../src/services/locationService', () => ({
  calculateHaversineDistance: jest.fn((origin, location) => {
    const latDiff = (location.lat - origin.lat) * 111000;
    const lngDiff = (location.lng - origin.lng) * 111000;
    return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
  }),
  estimateDuration: jest.fn((meters) => meters / 5)
}));

jest.mock('../src/services/shopCatalogueService', () => ({
  resolvePhotoUrl: jest.fn(async (filePath, fallbackUrl) => {
    if (filePath && String(filePath).trim()) {
      return `https://signed/${String(filePath).trim()}`;
    }
    if (fallbackUrl && /^https?:\/\//i.test(String(fallbackUrl))) {
      return String(fallbackUrl).trim();
    }
    if (fallbackUrl && String(fallbackUrl).trim()) {
      return `https://signed/${String(fallbackUrl).trim()}`;
    }
    return null;
  }),
  resolvePhotoFromSource: jest.fn(async (source) => {
    if (!source) {
      return null;
    }
    if (source.kind === 'path') {
      return `https://signed/${source.value}`;
    }
    return source.value;
  }),
  presentProduct: jest.fn(async (data, id) => ({
    id,
    shopId: data.shopId,
    categoryId: data.categoryId,
    name: data.name,
    price: data.price,
    unitType: data.unitType,
    photoUrl: null,
    stock: data.stock ?? 0,
    hasVariants: false,
    variants: []
  })),
  listCategories: jest.fn(async () => [])
}));

function makeUserDoc(id, data) {
  return { id, data: () => data };
}

function makeSnap(id, data, exists = true) {
  return { id, exists, data: () => data };
}

function buildFirestoreMock({ users, shops, products = [], categories = [], settings = {} }) {
  const settingsDoc = {
    exists: true,
    data: () => ({
      RANKING_WEIGHTS: { rating: 0.4, popularity: 0.3, nearness: 0.3 },
      NEW_SHOP_BOOST_DAYS: 30,
      RATING_PRIOR_WEIGHT: 5,
      POLICY_GROUP_A: ['Food & Restaurants'],
      ...settings
    })
  };

  return {
    collection(name) {
      if (name === 'users') {
        return {
          where(field, op, value) {
            expect(field).toBe('userType');
            expect(op).toBe('==');
            expect(value).toBe('shop');
            return {
              get: async () => ({ docs: users })
            };
          },
          doc(id) {
            return {
              get: async () => {
                const found = users.find((u) => u.id === id);
                return found ? makeSnap(id, found.data(), true) : makeSnap(id, {}, false);
              }
            };
          }
        };
      }
      if (name === 'shops') {
        return {
          doc(id) {
            return {
              id,
              get: async () => {
                const found = shops.find((s) => s.id === id);
                return found ? makeSnap(id, found.data, true) : makeSnap(id, {}, false);
              }
            };
          }
        };
      }
      if (name === 'products') {
        return {
          where(field, op, values) {
            if (field === 'shopId' && op === '==') {
              return {
                get: async () => ({
                  docs: products
                    .filter((p) => p.data.shopId === values)
                    .map((p) => ({ id: p.id, data: () => p.data }))
                })
              };
            }
            return {
              get: async () => ({
                docs: products
                  .filter((p) => values.includes(p.data.shopId))
                  .map((p) => ({ id: p.id, data: () => p.data }))
              })
            };
          },
          doc(id) {
            return {
              get: async () => {
                const found = products.find((p) => p.id === id);
                return found ? makeSnap(id, found.data, true) : makeSnap(id, {}, false);
              }
            };
          }
        };
      }
      if (name === 'categories') {
        return {
          where(field, op, values) {
            return {
              get: async () => ({
                docs: categories
                  .filter((c) => values.includes(c.data.shopId))
                  .map((c) => ({ id: c.id, data: () => c.data }))
              })
            };
          }
        };
      }
      if (name === 'appSettings') {
        return {
          doc(id) {
            expect(id).toBe('marketplace');
            return { get: async () => settingsDoc };
          }
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    },
    getAll: async (...refs) => refs.map((ref) => {
      const found = shops.find((s) => s.id === ref.id);
      return found ? makeSnap(ref.id, found.data, true) : makeSnap(ref.id, {}, false);
    })
  };
}

function verifiedShop(id, overrides = {}) {
  return {
    id,
    data: {
      address: `${id} street`,
      location: { latitude: 12.9, longitude: 77.6 },
      orderCount: 1,
      bank: { upiNameVerification: { verifiedName: 'Verified' } },
      rating: { sum: 4, count: 1, average: 4 },
      storefront: { tagline: 'Fresh' },
      ...overrides.data
    }
  };
}

function verifiedUser(id, overrides = {}) {
  return makeUserDoc(id, {
    userType: 'shop',
    isActive: true,
    shop: {
      approvalStatus: 'approved',
      shopName: overrides.shopName || id,
      shopType: overrides.shopType || 'Grocery & Supermarket',
      isOpen: true
    }
  });
}

describe('customerMarketplaceService browse perf', () => {
  const origin = { lat: 12.9, lng: 77.6 };
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    const boostApprovedAt = new Date('2026-05-20T12:00:00.000Z');
    const shops = [
      verifiedShop('shop-a', {
        data: {
          orderCount: 10,
          location: { latitude: 12.9, longitude: 77.6 },
          rating: { sum: 20, count: 5, average: 4 },
          approvedAt: boostApprovedAt
        }
      }),
      verifiedShop('shop-b', {
        data: {
          orderCount: 1,
          location: { latitude: 12.95, longitude: 77.65 },
          rating: { sum: 6, count: 2, average: 3 },
          approvedAt: new Date('2024-01-01T00:00:00.000Z')
        }
      }),
      verifiedShop('shop-c', {
        data: {
          orderCount: 5,
          location: { latitude: 12.85, longitude: 77.55 },
          rating: { sum: 15, count: 3, average: 5 },
          approvedAt: new Date('2024-06-01T00:00:00.000Z')
        }
      })
    ];
    const users = [
      verifiedUser('shop-a', { shopName: 'Alpha Mart' }),
      verifiedUser('shop-b', { shopName: 'Beta Mart' }),
      verifiedUser('shop-c', { shopName: 'Gamma Mart' })
    ];
    const { getFirestore } = require('../src/services/firebase');
    getFirestore.mockReturnValue(buildFirestoreMock({ users, shops }));
    service = new CustomerMarketplaceService();
  });

  test('getShop card deep-equals listShops card for the same shop', async () => {
    const list = await service.listShops({ lat: origin.lat, lng: origin.lng, limit: 50 });
    const detail = await service.getShop('shop-b', { lat: origin.lat, lng: origin.lng });
    const fromList = list.shops.find((row) => row.id === 'shop-b');
    expect(fromList).toBeDefined();
    expect(detail.shop).toEqual(fromList);
  });

  test('getShopOrThrow does not call loadEligibleShops or collectEligibleShopRows', async () => {
    const loadSpy = jest.spyOn(service, 'loadEligibleShops');
    const collectSpy = jest.spyOn(service, 'collectEligibleShopRows');
    await service.getShopOrThrow('shop-a', origin);
    expect(loadSpy).not.toHaveBeenCalled();
    expect(collectSpy).not.toHaveBeenCalled();
    loadSpy.mockRestore();
    collectSpy.mockRestore();
  });

  test('listShops signs photos only for returned page slice', async () => {
    const signSpy = jest.spyOn(shopCatalogueService, 'resolvePhotoFromSource');
    await service.listShops({ lat: origin.lat, lng: origin.lng, limit: 1 });
    expect(signSpy).toHaveBeenCalledTimes(1);
    signSpy.mockRestore();
  });

  test('search signs photos only for shop hits returned', async () => {
    const signSpy = jest.spyOn(shopCatalogueService, 'resolvePhotoFromSource');
    await service.search({ lat: origin.lat, lng: origin.lng, q: 'beta' });
    expect(signSpy).toHaveBeenCalledTimes(1);
    signSpy.mockRestore();
  });

  test('listCategories does not sign any photo', async () => {
    const signSpy = jest.spyOn(shopCatalogueService, 'resolvePhotoFromSource');
    await service.listCategories({ lat: origin.lat, lng: origin.lng });
    expect(signSpy).not.toHaveBeenCalled();
    signSpy.mockRestore();
  });

  test('listShops relevance order matches sortShops on collected rows', async () => {
    const fixedNow = new Date('2026-06-01T12:00:00.000Z');
    const collectSpy = jest.spyOn(service, 'collectEligibleShopRows');
    collectSpy.mockImplementation((orig) => CustomerMarketplaceService.prototype.collectEligibleShopRows
      .call(service, orig, fixedNow));
    const { rows } = await service.collectEligibleShopRows(origin);
    const expectedOrder = sortShops(rows, 'relevance').map((row) => row.id);
    const result = await service.listShops({
      lat: origin.lat,
      lng: origin.lng,
      limit: 50,
      sort: 'relevance'
    });
    expect(result.shops.map((row) => row.id)).toEqual(expectedOrder);
    collectSpy.mockRestore();
  });
});
