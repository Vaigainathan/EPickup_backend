jest.mock('../src/services/firebase', () => {
  const getSignedUrl = jest.fn(async () => ['https://signed.example/photo.jpg']);
  return {
    getFirestore: jest.fn(),
    getStorage: jest.fn(() => ({
      bucket: () => ({
        file: () => ({ getSignedUrl })
      })
    })),
    __getSignedUrlMock: () => getSignedUrl
  };
});

const firebase = require('../src/services/firebase');
const shopCatalogueService = require('../src/services/shopCatalogueService');
const { clearSignedUrlCacheForTests } = shopCatalogueService;

describe('shopCatalogueService signed URL cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSignedUrlCacheForTests();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('reuses cached URL within 24 hours without calling getSignedUrl again', async () => {
    const getSignedUrl = firebase.__getSignedUrlMock();
    const path = 'shops/s1/products/p1/photo.jpg';

    const first = await shopCatalogueService.signReadUrl(path);
    const second = await shopCatalogueService.signReadUrl(path);

    expect(first).toBe('https://signed.example/photo.jpg');
    expect(second).toBe(first);
    expect(getSignedUrl).toHaveBeenCalledTimes(1);
  });

  test('calls getSignedUrl again after cache TTL expires', async () => {
    const getSignedUrl = firebase.__getSignedUrlMock();
    const path = 'shops/s1/products/p2/photo.jpg';

    await shopCatalogueService.signReadUrl(path);
    jest.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    await shopCatalogueService.signReadUrl(path);

    expect(getSignedUrl).toHaveBeenCalledTimes(2);
  });

  test('does not cache empty URL so a second call signs again', async () => {
    const getSignedUrl = firebase.__getSignedUrlMock();
    getSignedUrl.mockResolvedValue(['']);
    const path = 'shops/s1/products/p3/photo.jpg';

    await shopCatalogueService.signReadUrl(path);
    await shopCatalogueService.signReadUrl(path);

    expect(getSignedUrl).toHaveBeenCalledTimes(2);
  });
});
