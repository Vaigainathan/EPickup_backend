const sharp = require('sharp');

const saveCalls = [];
const deleteCalls = [];

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn()
  })),
  getStorage: jest.fn(() => ({
    bucket: () => ({
      file: (path) => ({
        save: jest.fn(async () => {
          saveCalls.push(path);
        }),
        delete: jest.fn(async () => {
          deleteCalls.push(path);
        })
      })
    })
  }))
}));

const shopCatalogueService = require('../src/services/shopCatalogueService');

async function validPhotoFile() {
  const buffer = await sharp({
    create: { width: 10, height: 10, channels: 3, background: '#ccc' }
  })
    .jpeg()
    .toBuffer();
  return {
    buffer,
    size: buffer.length,
    mimetype: 'image/jpeg',
    originalname: 'photo.jpg'
  };
}

function ownedProduct(overrides = {}) {
  const updateMock = jest.fn().mockResolvedValue(undefined);
  const getMock = jest.fn().mockResolvedValue({
    data: () => ({
      shopId: 'shop-1',
      categoryId: 'cat-1',
      name: 'Old',
      price: 5,
      photoFilePath: 'shops/shop-1/products/p1/old_photo.jpg',
      photoUrl: 'shops/shop-1/products/p1/old_photo.jpg',
      thumbFilePath: 'shops/shop-1/products/p1/old_photo_thumb.jpg',
      ...overrides
    })
  });
  return {
    ref: { update: updateMock, get: getMock },
    id: 'p1',
    data: {
      shopId: 'shop-1',
      categoryId: 'cat-1',
      name: 'Old',
      price: 5,
      photoFilePath: 'shops/shop-1/products/p1/old_photo.jpg',
      photoUrl: 'shops/shop-1/products/p1/old_photo.jpg',
      thumbFilePath: 'shops/shop-1/products/p1/old_photo_thumb.jpg',
      ...overrides
    },
    updateMock,
    getMock
  };
}

describe('shopCatalogueService.updateProduct photo replace', () => {
  let deleteQuietSpy;

  beforeEach(() => {
    saveCalls.length = 0;
    deleteCalls.length = 0;
    deleteQuietSpy = jest.spyOn(shopCatalogueService, 'deleteStorageObjectQuiet');
    deleteQuietSpy.mockImplementation(async (path) => {
      deleteCalls.push(path);
    });
  });

  afterEach(() => {
    deleteQuietSpy.mockRestore();
  });

  it('deletes old storage paths only after Firestore update succeeds', async () => {
    const owned = ownedProduct();
    jest.spyOn(shopCatalogueService, 'getOwnedProduct').mockResolvedValue(owned);
    jest.spyOn(shopCatalogueService, 'getOwnedCategory').mockResolvedValue({ id: 'cat-1' });

    const order = [];
    owned.updateMock.mockImplementation(async () => {
      order.push('update');
    });
    deleteQuietSpy.mockImplementation(async (path) => {
      order.push(`delete:${path}`);
      deleteCalls.push(path);
    });

    const file = await validPhotoFile();
    await shopCatalogueService.updateProduct('shop-1', 'p1', { name: 'New' }, file);

    expect(owned.updateMock).toHaveBeenCalled();
    expect(order[0]).toBe('update');
    expect(order.filter((e) => e.startsWith('delete:'))).toHaveLength(2);
    expect(deleteCalls).toContain('shops/shop-1/products/p1/old_photo.jpg');
    expect(deleteCalls).toContain('shops/shop-1/products/p1/old_photo_thumb.jpg');
  });

  it('does not delete old files when Firestore update fails', async () => {
    const owned = ownedProduct();
    jest.spyOn(shopCatalogueService, 'getOwnedProduct').mockResolvedValue(owned);
    jest.spyOn(shopCatalogueService, 'getOwnedCategory').mockResolvedValue({ id: 'cat-1' });
    owned.updateMock.mockRejectedValue(new Error('firestore down'));

    const file = await validPhotoFile();
    await expect(
      shopCatalogueService.updateProduct('shop-1', 'p1', { name: 'New' }, file)
    ).rejects.toThrow('firestore down');

    expect(deleteQuietSpy).not.toHaveBeenCalled();
  });
});
