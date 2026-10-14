const crypto = require('crypto');
const {
  computePhotoKeyFromSource,
  photoSourceForProduct,
  photoSourceFromPathAndUrl
} = require('../../src/utils/cataloguePhotoKey');
const shopCatalogueService = require('../../src/services/shopCatalogueService');

describe('cataloguePhotoKey', () => {
  test('same path yields stable photoKey; different path yields different key', () => {
    const path = 'shops/s1/products/p1/1_photo.jpg';
    const key1 = computePhotoKeyFromSource({ kind: 'path', value: path });
    const key2 = computePhotoKeyFromSource({ kind: 'path', value: path });
    const key3 = computePhotoKeyFromSource({ kind: 'path', value: 'shops/s1/products/p1/2_photo.jpg' });
    expect(key1).toBe(key2);
    expect(key1).toHaveLength(16);
    expect(key3).not.toBe(key1);
  });

  test('https photoUrl hashes URL when no file path', () => {
    const url = 'https://example.com/photo.jpg';
    const key = computePhotoKeyFromSource({ kind: 'url', value: url });
    const expected = crypto.createHash('sha256').update(url, 'utf8').digest('hex').slice(0, 16);
    expect(key).toBe(expected);
  });

  test('no photo yields null key', () => {
    expect(computePhotoKeyFromSource(null)).toBeNull();
    expect(photoSourceForProduct({})).toBeNull();
  });

  describe('photoKey matches signed source (C1)', () => {
    const signMock = jest.spyOn(shopCatalogueService, 'signReadUrl');

    beforeEach(() => {
      signMock.mockResolvedValue('https://signed.example/read');
    });

    afterAll(() => {
      signMock.mockRestore();
    });

    async function assertSameSource(data) {
      const source = photoSourceForProduct(data);
      const photoKey = computePhotoKeyFromSource(source);
      const photoUrl = await shopCatalogueService.resolvePhotoFromSource(source);
      if (!source) {
        expect(photoKey).toBeNull();
        expect(photoUrl).toBeNull();
        return;
      }
      if (source.kind === 'path') {
        expect(signMock).toHaveBeenCalledWith(source.value);
        expect(photoUrl).toBe('https://signed.example/read');
      } else {
        expect(photoUrl).toBe(source.value);
      }
      expect(photoKey).toBe(computePhotoKeyFromSource(source));
    }

    test('photoFilePath only', async () => {
      signMock.mockClear();
      await assertSameSource({ photoFilePath: 'shops/a/products/b/x.jpg' });
      expect(signMock).toHaveBeenCalledTimes(1);
    });

    test('path stored in photoUrl only', async () => {
      signMock.mockClear();
      await assertSameSource({ photoUrl: 'shops/a/products/b/x.jpg' });
      expect(signMock).toHaveBeenCalledWith('shops/a/products/b/x.jpg');
    });

    test('https photoUrl only', async () => {
      signMock.mockClear();
      const url = 'https://cdn.example/img.png';
      await assertSameSource({ photoUrl: url });
      expect(signMock).not.toHaveBeenCalled();
    });

    test('both fields set prefers photoFilePath', async () => {
      signMock.mockClear();
      await assertSameSource({
        photoFilePath: 'shops/a/products/b/primary.jpg',
        photoUrl: 'https://cdn.example/other.png'
      });
      expect(signMock).toHaveBeenCalledWith('shops/a/products/b/primary.jpg');
    });
  });

  test('photoSourceFromPathAndUrl order matches resolvePhotoUrl contract', () => {
    expect(photoSourceFromPathAndUrl('path-a', 'https://x')).toEqual({ kind: 'path', value: 'path-a' });
    expect(photoSourceFromPathAndUrl('', 'https://x')).toEqual({ kind: 'url', value: 'https://x' });
    expect(photoSourceFromPathAndUrl(null, 'legacy/path')).toEqual({ kind: 'path', value: 'legacy/path' });
  });
});
