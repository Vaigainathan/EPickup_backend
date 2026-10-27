const mockUpdate = jest.fn();
const mockGet = jest.fn();
const mockDocRef = { get: mockGet, update: mockUpdate };
const mockDoc = jest.fn(() => mockDocRef);
const mockCollection = jest.fn(() => ({ doc: mockDoc }));
jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({ collection: mockCollection })),
  getStorage: jest.fn()
}));

const { installRealFirestoreGuard } = require('./helpers/realFirestoreGuard');
const { getFirestore } = require('../src/services/firebase');
const shopCatalogueService = require('../src/services/shopCatalogueService');
const { productSoldOut } = require('../src/services/shopCatalogueService');

installRealFirestoreGuard(getFirestore);

describe('shopCatalogueService.updateProductAvailability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.mockReturnValue({ doc: mockDoc });
    mockDoc.mockReturnValue(mockDocRef);
  });

  it('updates soldOut for owner', async () => {
    mockGet
      .mockResolvedValueOnce({
        exists: true,
        ref: mockDocRef,
        data: () => ({ shopId: 'shop-a', soldOut: false })
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          shopId: 'shop-a',
          soldOut: true,
          updatedAt: { toDate: () => new Date('2026-10-27T10:00:00.000Z') }
        })
      });

    const result = await shopCatalogueService.updateProductAvailability('shop-a', 'prod-1', {
      soldOut: true
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: 'prod-1',
      soldOut: true,
      updatedAt: '2026-10-27T10:00:00.000Z'
    });
  });

  it('returns 403 for other shop', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      ref: mockDocRef,
      data: () => ({ shopId: 'shop-b' })
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

  it('skips write when soldOut unchanged (idempotent)', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      ref: mockDocRef,
      data: () => ({
        shopId: 'shop-a',
        soldOut: true,
        updatedAt: { toDate: () => new Date('2026-10-27T10:00:00.000Z') }
      })
    });

    const result = await shopCatalogueService.updateProductAvailability('shop-a', 'prod-1', {
      soldOut: true
    });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.soldOut).toBe(true);
    expect(productSoldOut({ soldOut: true })).toBe(true);
  });
});
