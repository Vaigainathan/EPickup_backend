const mockPresentProduct = jest.fn();

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({})),
  getStorage: jest.fn(() => ({
    bucket: () => ({
      file: () => ({
        getSignedUrl: jest.fn(async () => ['https://example.com/photo'])
      })
    })
  }))
}));

jest.mock('../src/services/shopCatalogueService', () => ({
  presentProduct: (...args) => mockPresentProduct(...args),
  listCategories: jest.fn(async () => [])
}));

const customerMarketplaceService = require('../src/services/customerMarketplaceService');

describe('customer browse product soldOut', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('includes soldOut true when present on product', async () => {
    mockPresentProduct.mockResolvedValue({
      id: 'prod-1',
      shopId: 'shop-1',
      categoryId: 'cat-1',
      name: 'Biryani',
      description: null,
      price: 100,
      unitType: 'Plate',
      weight: null,
      photoUrl: null,
      photoKey: null,
      thumbUrl: null,
      thumbKey: null,
      isActive: true,
      soldOut: true,
      stock: 10,
      hasVariants: false,
      variants: []
    });

    const product = await customerMarketplaceService.presentCustomerProduct(
      { shopId: 'shop-1', soldOut: true, price: 100, name: 'Biryani' },
      'prod-1'
    );

    expect(product.soldOut).toBe(true);
  });

  it('includes soldOut false when field absent', async () => {
    mockPresentProduct.mockResolvedValue({
      id: 'prod-2',
      shopId: 'shop-1',
      categoryId: 'cat-1',
      name: 'Rice',
      description: null,
      price: 50,
      unitType: 'Plate',
      weight: null,
      photoUrl: null,
      photoKey: null,
      thumbUrl: null,
      thumbKey: null,
      isActive: true,
      soldOut: false,
      stock: 5,
      hasVariants: false,
      variants: []
    });

    const product = await customerMarketplaceService.presentCustomerProduct(
      { shopId: 'shop-1', price: 50, name: 'Rice' },
      'prod-2'
    );

    expect(product.soldOut).toBe(false);
  });
});
