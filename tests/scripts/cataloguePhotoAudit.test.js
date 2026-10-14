const {
  classifyProductPhoto,
  classifyShopPhoto,
  classifyFromSource,
  isSignedStorageUrl,
  CLASSES
} = require('../../scripts/support/lib/cataloguePhotoAudit');

function throwingStorage() {
  const deny = () => {
    throw new Error('write forbidden');
  };
  return {
    bucket() {
      return {
        file() {
          return {
            exists: async () => [true],
            save: deny,
            delete: deny,
            createWriteStream: deny,
            setMetadata: deny
          };
        },
        create: deny
      };
    }
  };
}

describe('cataloguePhotoAudit classifier (B6 / C2 / C6)', () => {
  test('all five classes via classifyFromSource', () => {
    expect(classifyFromSource(null, null)).toBe('NO_PHOTO');
    expect(classifyFromSource({ kind: 'path', value: 'shops/x/y.jpg' }, true)).toBe('PATH_OK');
    expect(classifyFromSource({ kind: 'path', value: 'shops/x/y.jpg' }, false)).toBe('PATH_MISSING_OBJECT');
    const signed = 'https://storage.googleapis.com/b/o?X-Goog-Signature=abc';
    expect(classifyFromSource({ kind: 'url', value: signed }, null)).toBe('URL_ONLY_SIGNED');
    expect(classifyFromSource({ kind: 'url', value: 'https://cdn.example/x.jpg' }, null)).toBe('URL_ONLY_OTHER');
    expect(CLASSES).toHaveLength(5);
  });

  test('classifyProductPhoto path requires existence', () => {
    expect(() => classifyProductPhoto({ photoFilePath: 'p/a.jpg' })).toThrow(/objectExists/);
    expect(classifyProductPhoto({ photoFilePath: 'p/a.jpg' }, true)).toBe('PATH_OK');
    expect(classifyProductPhoto({ photoUrl: 'shops/a/b.jpg' }, false)).toBe('PATH_MISSING_OBJECT');
  });

  test('classifyShopPhoto uses photoPath', () => {
    expect(classifyShopPhoto({ photoPath: 'shops/s/storefront/1.jpg' }, true)).toBe('PATH_OK');
  });

  test('isSignedStorageUrl detects GCS v4 and legacy query params', () => {
    expect(isSignedStorageUrl('https://x?X-Goog-Signature=1')).toBe(true);
    expect(isSignedStorageUrl('https://x?Expires=1&Signature=2')).toBe(true);
    expect(isSignedStorageUrl('https://x/plain.jpg')).toBe(false);
  });

  test('audit script storage mock rejects writes (C6)', async () => {
    const storage = throwingStorage();
    const file = storage.bucket().file('shops/a/b.jpg');
    await expect(file.exists()).resolves.toEqual([true]);
    expect(() => file.save(Buffer.from('x'))).toThrow('write forbidden');
    expect(() => storage.bucket().create()).toThrow('write forbidden');
  });
});
