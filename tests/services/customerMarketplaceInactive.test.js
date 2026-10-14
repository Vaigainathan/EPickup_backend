const { classifyOrderLines } = require('../../src/services/marketplace/createCustomerOrder');

jest.mock('../../src/services/shopCatalogueService', () => ({
  presentProduct: jest.fn(async (data, id) => ({
    id,
    shopId: data.shopId,
    categoryId: data.categoryId,
    name: data.name,
    description: null,
    price: data.price,
    unitType: 'Piece',
    photoUrl: null,
    photoKey: null,
    isActive: data.isActive !== false,
    stock: data.stock ?? 0,
    hasVariants: false,
    variants: []
  })),
  listCategories: jest.fn(async () => []),
  resolvePhotoFromSource: jest.fn(async () => null)
}));

const customerMarketplaceService = require('../../src/services/customerMarketplaceService');

function mockDbForProducts(docs) {
  return {
    collection(name) {
      if (name === 'products') {
        return {
          where(field, op, value) {
            if (op === 'in') {
              const ids = value;
              return {
                get: async () => ({
                  docs: docs
                    .filter((row) => ids.includes(row.shopId))
                    .map((row) => ({
                      id: row.id,
                      data: () => row
                    }))
                })
              };
            }
            return {
              get: async () => ({
                docs: docs
                  .filter((row) => row.shopId === value)
                  .map((row) => ({
                    id: row.id,
                    data: () => row
                  }))
              })
            };
          },
          doc(id) {
            const row = docs.find((d) => d.id === id);
            return {
              get: async () => ({
                exists: Boolean(row),
                data: () => row || {}
              })
            };
          }
        };
      }
      if (name === 'users' || name === 'shops') {
        return {
          doc() {
            return {
              get: async () => ({
                exists: true,
                data: () => ({
                  userType: 'shop',
                  isActive: true,
                  shop: { approvalStatus: 'approved' },
                  bank: { upiNameVerification: { verifiedName: 'Shop' } },
                  location: { latitude: 12.9, longitude: 77.6 },
                  address: 'Addr'
                })
              })
            };
          }
        };
      }
      return { doc: () => ({ get: async () => ({ exists: false }) }) };
    }
  };
}

describe('customer marketplace inactive products (B2 / C5)', () => {
  const inactiveProduct = {
    id: 'prod-inactive',
    shopId: 'shop-1',
    categoryId: 'cat-1',
    name: 'Hidden Item',
    price: 10,
    stock: 5,
    isActive: false
  };

  beforeEach(() => {
    jest.spyOn(customerMarketplaceService, 'getDb').mockReturnValue(
      mockDbForProducts([inactiveProduct])
    );
    jest.spyOn(customerMarketplaceService, 'assertEligibleShop').mockResolvedValue({
      identity: { shopName: 'S', shopType: 'Food & Restaurants' },
      profile: {}
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('listProducts includes inactive with isActive false', async () => {
    const { products } = await customerMarketplaceService.listProducts('shop-1', {});
    expect(products).toHaveLength(1);
    expect(products[0].isActive).toBe(false);
  });

  test('getProduct returns inactive product', async () => {
    const { product } = await customerMarketplaceService.getProduct('prod-inactive');
    expect(product.isActive).toBe(false);
  });

  test('search includes inactive product', async () => {
    jest.spyOn(customerMarketplaceService, 'collectEligibleShopRows').mockResolvedValue({
      rows: [{ id: 'shop-1', shopName: 'Test Shop' }],
      settings: {}
    });
    const result = await customerMarketplaceService.search({
      lat: 12.9,
      lng: 77.6,
      q: 'hidden'
    });
    expect(result.products.some((p) => p.id === 'prod-inactive' && p.isActive === false)).toBe(true);
  });

  test('classifyOrderLines rejects inactive with reason inactive', () => {
    const productsById = new Map([
      ['prod-inactive', { ...inactiveProduct, isActive: false }]
    ]);
    const { badLines } = classifyOrderLines(
      [{ productId: 'prod-inactive', qty: 1, price: 10 }],
      productsById,
      'shop-1'
    );
    expect(badLines).toHaveLength(1);
    expect(badLines[0].reason).toBe('inactive');
  });
});
