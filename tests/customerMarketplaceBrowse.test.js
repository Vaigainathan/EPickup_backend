const {
  CustomerMarketplaceService,
  LEGACY_CARD_FIELDS,
  parseSort,
  decodeCursor,
  pageShops,
  hasVerifiedUpiName
} = require('../src/services/customerMarketplaceService');

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

jest.mock('../src/services/locationService', () => ({
  calculateHaversineDistance: jest.fn(() => 5000),
  estimateDuration: jest.fn(() => 600)
}));

jest.mock('../src/services/shopCatalogueService', () => ({
  resolvePhotoUrl: jest.fn(async (path) => (path ? `https://signed/${path}` : null)),
  presentProduct: jest.fn(async (data, id) => ({
    id,
    shopId: data.shopId,
    categoryId: data.categoryId,
    name: data.name,
    description: data.description ?? null,
    price: data.price,
    unitType: data.unitType,
    weight: data.weight ?? null,
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

describe('customerMarketplaceService browse', () => {
  const verifiedShop = {
    id: 'shop-verified',
    data: {
      address: '1 Main St',
      location: { latitude: 12.9, longitude: 77.6 },
      orderCount: 3,
      bank: { upiNameVerification: { verifiedName: 'Verified Shop' } },
      rating: { sum: 8, count: 2, average: 4 },
      storefront: { tagline: 'Fresh daily' }
    }
  };

  const unverifiedShop = {
    id: 'shop-unverified',
    data: {
      address: '2 Side St',
      location: { latitude: 12.91, longitude: 77.61 },
      orderCount: 1,
      bank: {}
    }
  };

  const users = [
    makeUserDoc('shop-verified', {
      userType: 'shop',
      isActive: true,
      shop: { approvalStatus: 'approved', shopName: 'Verified Mart', shopType: 'Grocery & Supermarket', isOpen: true }
    }),
    makeUserDoc('shop-unverified', {
      userType: 'shop',
      isActive: true,
      shop: { approvalStatus: 'approved', shopName: 'Hidden Mart', shopType: 'Grocery & Supermarket', isOpen: true }
    }),
    makeUserDoc('shop-pending', {
      userType: 'shop',
      isActive: true,
      shop: { approvalStatus: 'pending', shopName: 'Pending Mart', shopType: 'Grocery & Supermarket', isOpen: true }
    })
  ];

  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    const { getFirestore } = require('../src/services/firebase');
    getFirestore.mockReturnValue(buildFirestoreMock({
      users,
      shops: [verifiedShop, unverifiedShop],
      products: [
        {
          id: 'prod-hidden',
          data: { shopId: 'shop-unverified', name: 'Secret Item', isActive: true }
        },
        {
          id: 'prod-visible',
          data: { shopId: 'shop-verified', name: 'Rice', isActive: true }
        }
      ]
    }));
    service = new CustomerMarketplaceService();
  });

  test('hasVerifiedUpiName requires verified name', () => {
    expect(hasVerifiedUpiName({ bank: { upiNameVerification: { verifiedName: 'X' } } })).toBe(true);
    expect(hasVerifiedUpiName({ bank: {} })).toBe(false);
  });

  test('loadEligibleShops hides unverified and unapproved shops from shop list', async () => {
    const shops = await service.loadEligibleShops({ lat: 12.9, lng: 77.6 });
    expect(shops.map((s) => s.id)).toEqual(['shop-verified']);
    expect(shops.find((s) => s.shopName === 'Pending Mart')).toBeUndefined();
    expect(shops.find((s) => s.shopName === 'Hidden Mart')).toBeUndefined();
  });

  test('listCategories counts only the same eligible shops as the shop list', async () => {
    const result = await service.listCategories({ lat: 12.9, lng: 77.6 });
    const grocery = result.categories.find((row) => row.category === 'Grocery & Supermarket');
    expect(grocery.shopCount).toBe(1);
    expect(grocery.comingSoon).toBe(false);
  });

  test('legacy card fields snapshot keeps pre-MP-14 names and meaning', async () => {
    const shops = await service.loadEligibleShops({ lat: 12.9, lng: 77.6 });
    const shop = shops[0];
    LEGACY_CARD_FIELDS.forEach((field) => {
      expect(shop).toHaveProperty(field);
    });
    expect(shop.isOpen).toBe(true);
    expect(shop.orderCount).toBe(3);
    expect(shop).toHaveProperty('photoUrl');
    expect(shop).toHaveProperty('isOpenNow');
    expect(shop).toHaveProperty('policyGroup');
  });

  test('parseSort maps orders to relevance', () => {
    expect(parseSort('orders')).toBe('relevance');
    expect(parseSort('')).toBe('relevance');
  });

  test('listShops sort=orders uses relevance ordering', async () => {
    const spy = jest.spyOn(service, 'buildEligibleShopRows');
    spy.mockResolvedValue({
      shops: [
        {
          id: 'a',
          shopType: 'Grocery & Supermarket',
          isOpenNow: true,
          relevanceScore: 2,
          fairRating: 4,
          distanceKm: 1
        },
        {
          id: 'b',
          shopType: 'Grocery & Supermarket',
          isOpenNow: true,
          relevanceScore: 1,
          fairRating: 3,
          distanceKm: 2
        }
      ],
      settings: {}
    });
    const result = await service.listShops({ lat: 12.9, lng: 77.6, sort: 'orders' });
    expect(result.shops.map((row) => row.id)).toEqual(['a', 'b']);
    spy.mockRestore();
  });

  test('decodeCursor rejects malformed cursor with INVALID_CURSOR', () => {
    expect(() => decodeCursor('%%%', 'relevance')).toThrow();
    try {
      decodeCursor('%%%', 'relevance');
    } catch (error) {
      expect(error.code).toBe('INVALID_CURSOR');
      expect(error.status).toBe(400);
    }
  });

  test('decodeCursor resets offset when sort in cursor does not match request', () => {
    const cursor = Buffer.from(JSON.stringify({
      sort: 'distance',
      offset: 4,
      now: '2026-01-01T00:00:00.000Z'
    }), 'utf8').toString('base64url');
    const decoded = decodeCursor(cursor, 'relevance');
    expect(decoded.offset).toBe(0);
    expect(decoded.now).toBe('2026-01-01T00:00:00.000Z');
  });

  test('cursor offset pagination continues after page one', () => {
    const shops = [
      { id: 'a', distanceKm: 1, fairRating: 1, relevanceScore: 1, isOpenNow: true },
      { id: 'b', distanceKm: 2, fairRating: 1, relevanceScore: 1, isOpenNow: true },
      { id: 'c', distanceKm: 3, fairRating: 1, relevanceScore: 1, isOpenNow: true }
    ];
    const nowIso = '2026-06-01T12:00:00.000Z';
    const page1 = pageShops(shops, 'relevance', 2, null, nowIso);
    expect(page1.shops.map((s) => s.id)).toEqual(['a', 'b']);
    const cursor = decodeCursor(page1.nextCursor, 'relevance');
    const page2 = pageShops(shops, 'relevance', 2, cursor, nowIso);
    expect(page2.shops.map((s) => s.id)).toEqual(['c']);
  });

  test('listShops page two continues after page one using cursor now not wall clock', async () => {
    const rows = [
      {
        id: 'a',
        shopType: 'Grocery & Supermarket',
        isOpenNow: true,
        relevanceScore: 1,
        fairRating: 1,
        distanceKm: 1
      },
      {
        id: 'b',
        shopType: 'Grocery & Supermarket',
        isOpenNow: true,
        relevanceScore: 1,
        fairRating: 1,
        distanceKm: 2
      },
      {
        id: 'c',
        shopType: 'Grocery & Supermarket',
        isOpenNow: true,
        relevanceScore: 1,
        fairRating: 1,
        distanceKm: 3
      }
    ];
    const buildNows = [];
    const spy = jest.spyOn(service, 'buildEligibleShopRows');
    spy.mockImplementation(async (_origin, now) => {
      buildNows.push(now.toISOString());
      return { shops: rows, settings: {} };
    });

    const page1 = await service.listShops({ lat: 12.9, lng: 77.6, limit: 2 });
    const cursorNow = decodeCursor(page1.nextCursor, 'relevance').now;
    await new Promise((resolve) => { setTimeout(resolve, 15); });
    const page2 = await service.listShops({
      lat: 12.9,
      lng: 77.6,
      limit: 2,
      cursor: page1.nextCursor
    });
    spy.mockRestore();

    expect(page1.shops.map((row) => row.id)).toEqual(['a', 'b']);
    expect(page2.shops.map((row) => row.id)).toEqual(['c']);
    expect(buildNows).toHaveLength(2);
    expect(buildNows[1]).toBe(cursorNow);
    expect(buildNows[1]).toBe(buildNows[0]);
    expect(new Date(buildNows[1]).getTime()).not.toBe(new Date().getTime());
  });

  test('search excludes products from ineligible shops', async () => {
    const result = await service.search({
      lat: 12.9,
      lng: 77.6,
      q: 'secret'
    });
    expect(result.products).toHaveLength(0);

    const visible = await service.search({
      lat: 12.9,
      lng: 77.6,
      q: 'rice'
    });
    expect(visible.products).toHaveLength(1);
    expect(visible.products[0].shopId).toBe('shop-verified');
  });

  test('search rejects q longer than 50 characters', async () => {
    await expect(service.search({
      lat: 12.9,
      lng: 77.6,
      q: 'x'.repeat(51)
    })).rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });
});
