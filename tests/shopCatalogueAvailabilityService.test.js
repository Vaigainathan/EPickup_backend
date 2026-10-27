const mockUpdate = jest.fn();
const mockGet = jest.fn();
const mockDocRef = { get: mockGet, update: mockUpdate };
const mockDoc = jest.fn(() => mockDocRef);
const mockCollection = jest.fn(() => ({ doc: mockDoc }));

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({ collection: mockCollection })),
  getStorage: jest.fn(() => ({
    bucket: () => ({
      file: () => ({
        getSignedUrl: jest.fn(async () => ['https://example.com/photo'])
      })
    })
  }))
}));

const { installRealFirestoreGuard } = require('./helpers/realFirestoreGuard');
const { getFirestore } = require('../src/services/firebase');
const shopCatalogueService = require('../src/services/shopCatalogueService');
const { productSoldOut } = require('../src/services/shopCatalogueService');

installRealFirestoreGuard(getFirestore);

function productDoc(overrides = {}) {
  return {
    shopId: 'shop-a',
    categoryId: 'cat-1',
    name: 'Biryani',
    price: 120,
    unitType: 'Piece',
    stock: 5,
    isActive: true,
    soldOut: false,
    hasVariants: false,
    variants: [],
    ...overrides
  };
}

describe('shopCatalogueService.updateProductAvailability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.mockReturnValue({ doc: mockDoc });
    mockDoc.mockReturnValue(mockDocRef);
  });

  it('updates soldOut for owner and returns full presentProduct shape', async () => {
    mockGet
      .mockResolvedValueOnce({
        exists: true,
        ref: mockDocRef,
        data: () => productDoc({ soldOut: false })
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => productDoc({
          soldOut: true,
          updatedAt: { toDate: () => new Date('2026-10-27T10:00:00.000Z') }
        })
      });

    const result = await shopCatalogueService.updateProductAvailability('shop-a', 'prod-1', {
      soldOut: true
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('prod-1');
    expect(result.name).toBe('Biryani');
    expect(result.price).toBe(120);
    expect(result.unitType).toBe('Piece');
    expect(result.soldOut).toBe(true);
    expect(result.stock).toBe(5);
    expect(result.hasVariants).toBe(false);
  });

  it('returns 403 for other shop', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      ref: mockDocRef,
      data: () => productDoc({ shopId: 'shop-b' })
    });

    await expect(
      shopCatalogueService.updateProductAvailability('shop-a', 'prod-1', { soldOut: true })
    ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when soldOut is not boolean', async () => {
    await expect(
      shopCatalogueService.updateProductAvailability('shop-a', 'prod-1', {})
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_AVAILABILITY' });
  });

  it('skips write when soldOut unchanged and still returns full product (idempotent)', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      ref: mockDocRef,
      data: () => productDoc({
        soldOut: true,
        updatedAt: { toDate: () => new Date('2026-10-27T10:00:00.000Z') }
      })
    });

    const result = await shopCatalogueService.updateProductAvailability('shop-a', 'prod-1', {
      soldOut: true
    });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.soldOut).toBe(true);
    expect(result.name).toBe('Biryani');
    expect(productSoldOut({ soldOut: true })).toBe(true);
  });
});
