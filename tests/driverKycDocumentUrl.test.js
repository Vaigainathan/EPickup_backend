const {
  parseDriverKycStorageReference,
  storagePathFromDriverKycFields,
  resolveDriverKycReadUrl,
  signDriverKycPath,
  setSignUrlImplForTests,
  clearSignCacheForTests,
  DRIVER_KYC_SIGNED_URL_TTL_MS,
  isDriverKycDocumentPresent
} = require('../src/services/driverKycDocumentUrlService');

describe('driverKycDocumentUrlService', () => {
  beforeEach(() => {
    clearSignCacheForTests();
    setSignUrlImplForTests(null);
  });

  afterAll(() => {
    setSignUrlImplForTests(null);
    clearSignCacheForTests();
  });

  describe('parseDriverKycStorageReference', () => {
    it('parses gs:// bucket and path', () => {
      expect(parseDriverKycStorageReference('gs://my-bucket/drivers/u/documents/rc_book/a.jpg')).toEqual({
        bucket: 'my-bucket',
        path: 'drivers/u/documents/rc_book/a.jpg'
      });
    });

    it('parses storage.googleapis.com signed URL into path', () => {
      const url = 'https://storage.googleapis.com/bkt/drivers/x/documents/rc_book/f.jpg?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Expires=99999';
      expect(parseDriverKycStorageReference(url)).toEqual({
        bucket: 'bkt',
        path: 'drivers/x/documents/rc_book/f.jpg'
      });
    });

    it('parses firebasestorage.googleapis.com URL', () => {
      const url = 'https://firebasestorage.googleapis.com/v0/b/bkt/o/drivers%2Fu%2Fdocuments%2Frc_book%2Ff.jpg?alt=media';
      expect(parseDriverKycStorageReference(url)).toEqual({
        bucket: 'bkt',
        path: 'drivers/u/documents/rc_book/f.jpg'
      });
    });

    it('returns legacyUrl for unparseable https', () => {
      expect(parseDriverKycStorageReference('https://example.com/doc.jpg')).toEqual({
        legacyUrl: 'https://example.com/doc.jpg'
      });
    });

    it('treats bare storage path as path', () => {
      expect(parseDriverKycStorageReference('drivers/u/documents/aadhaar_card/x.jpg')).toEqual({
        bucket: null,
        path: 'drivers/u/documents/aadhaar_card/x.jpg'
      });
    });
  });

  describe('storagePathFromDriverKycFields', () => {
    it('prefers filePath over url', () => {
      expect(storagePathFromDriverKycFields({
        filePath: 'drivers/a/documents/rc_book/1.jpg',
        url: 'https://storage.googleapis.com/b/drivers/a/documents/rc_book/2.jpg'
      })).toBe('drivers/a/documents/rc_book/1.jpg');
    });
  });

  describe('signDriverKycPath / resolveDriverKycReadUrl', () => {
    it('signs path-only with expiry approximately 1 hour', async () => {
      const before = Date.now();
      let capturedExpires;
      setSignUrlImplForTests(async (filePath) => {
        capturedExpires = before + DRIVER_KYC_SIGNED_URL_TTL_MS;
        return {
          url: `https://signed.example/${filePath}`,
          signedUrlExpiresAt: new Date(capturedExpires).toISOString(),
          bucket: 'test-bucket',
          path: filePath
        };
      });

      const result = await resolveDriverKycReadUrl({
        filePath: 'drivers/u/documents/profile_photo/p.jpg'
      });

      expect(result.source).toBe('signed');
      expect(result.url).toContain('drivers/u/documents/profile_photo/p.jpg');
      const expiresMs = new Date(result.signedUrlExpiresAt).getTime();
      expect(expiresMs).toBeGreaterThanOrEqual(before + DRIVER_KYC_SIGNED_URL_TTL_MS - 1000);
      expect(expiresMs).toBeLessThanOrEqual(before + DRIVER_KYC_SIGNED_URL_TTL_MS + 5000);
    });

    it('re-signs legacy https storage URL via parsed path', async () => {
      const legacy = 'https://storage.googleapis.com/bkt/drivers/u/documents/rc_book/old.jpg?X-Goog-Signature=abc';
      setSignUrlImplForTests(async (filePath) => ({
        url: `https://fresh-signed.example/${filePath}`,
        signedUrlExpiresAt: new Date(Date.now() + DRIVER_KYC_SIGNED_URL_TTL_MS).toISOString(),
        bucket: 'bkt',
        path: filePath
      }));

      const result = await resolveDriverKycReadUrl({ url: legacy });
      expect(result.source).toBe('signed');
      expect(result.url).toBe('https://fresh-signed.example/drivers/u/documents/rc_book/old.jpg');
    });

    it('returns unparseable legacy URL unchanged', async () => {
      const legacy = 'https://cdn.example.com/kyc.jpg';
      const result = await resolveDriverKycReadUrl({ downloadURL: legacy });
      expect(result.source).toBe('legacy');
      expect(result.url).toBe(legacy);
      expect(result.signedUrlExpiresAt).toBeNull();
    });
  });

  describe('isDriverKycDocumentPresent', () => {
    it('counts filePath without url', () => {
      expect(isDriverKycDocumentPresent({
        filePath: 'drivers/u/documents/rc_book/a.jpg'
      })).toBe(true);
    });
  });
});
