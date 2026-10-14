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
          if (global.__FAIL_THUMB_SAVE__ && saveCalls.length >= 1) {
            throw new Error('thumb save failed');
          }
          saveCalls.push(path);
        }),
        delete: jest.fn(async () => {
          deleteCalls.push(path);
        })
      })
    })
  }))
}));

jest.mock('../src/services/catalogueThumbnail', () => {
  const actual = jest.requireActual('../src/services/catalogueThumbnail');
  return {
    ...actual,
    generateCatalogueThumbBuffer: jest.fn((buffer) => actual.generateCatalogueThumbBuffer(buffer))
  };
});

const { generateCatalogueThumbBuffer, invalidImageError } = require('../src/services/catalogueThumbnail');
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

describe('shopCatalogueService.uploadProductPhoto', () => {
  beforeEach(() => {
    saveCalls.length = 0;
    deleteCalls.length = 0;
    global.__FAIL_THUMB_SAVE__ = false;
    generateCatalogueThumbBuffer.mockImplementation(
      jest.requireActual('../src/services/catalogueThumbnail').generateCatalogueThumbBuffer
    );
  });

  it('does not write to storage when thumbnail generation fails', async () => {
    generateCatalogueThumbBuffer.mockRejectedValue(invalidImageError());
    const file = await validPhotoFile();
    await expect(
      shopCatalogueService.uploadProductPhoto('shop-1', 'prod-1', file)
    ).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    expect(saveCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it('deletes the original when thumb upload fails', async () => {
    global.__FAIL_THUMB_SAVE__ = true;
    const file = await validPhotoFile();
    await expect(
      shopCatalogueService.uploadProductPhoto('shop-1', 'prod-1', file)
    ).rejects.toThrow('thumb save failed');
    expect(saveCalls).toHaveLength(1);
    expect(deleteCalls).toEqual([saveCalls[0]]);
  });

  it('saves original and thumb on success', async () => {
    const file = await validPhotoFile();
    const result = await shopCatalogueService.uploadProductPhoto('shop-1', 'prod-1', file);
    expect(saveCalls).toHaveLength(2);
    expect(result.photoFilePath).toBe(saveCalls[0]);
    expect(result.thumbFilePath).toBe(saveCalls[1]);
    expect(result.thumbFilePath).toMatch(/_thumb\.jpg$/);
  });
});

describe('shopCatalogueService.createProduct storage failure', () => {
  const setMock = jest.fn();

  beforeEach(() => {
    saveCalls.length = 0;
    deleteCalls.length = 0;
    global.__FAIL_THUMB_SAVE__ = true;
    setMock.mockReset();
    const { getFirestore } = require('../src/services/firebase');
    getFirestore.mockReturnValue({
      collection: (name) => {
        if (name === 'categories') {
          return {
            doc: () => ({
              get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({ shopId: 'shop-1' })
              })
            })
          };
        }
        if (name === 'products') {
          return {
            doc: () => ({
              id: 'new-prod',
              set: setMock,
              get: jest.fn()
            })
          };
        }
        return { doc: () => ({}) };
      }
    });
  });

  it('does not write Firestore when thumb upload fails after original save', async () => {
    const file = await validPhotoFile();
    await expect(
      shopCatalogueService.createProduct(
        'shop-1',
        { name: 'Item', categoryId: 'cat-1', price: 10 },
        file
      )
    ).rejects.toThrow('thumb save failed');
    expect(setMock).not.toHaveBeenCalled();
  });
});
