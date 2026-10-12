const admin = require('firebase-admin');

jest.mock('../src/services/shopOnboardingService', () => ({
  loadShopContext: jest.fn()
}));

jest.mock('../src/services/shopCatalogueService', () => ({
  resolvePhotoUrl: jest.fn(async () => null)
}));

jest.mock('../src/services/firebase', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({
        delete: jest.fn()
      })
    })
  })
}));

const shopOnboardingService = require('../src/services/shopOnboardingService');
const shopStorefrontService = require('../src/services/shopStorefrontService');

describe('deleteStorefrontPhoto', () => {
  it('removes storefront.photoPath with FieldValue.delete', async () => {
    const update = jest.fn();
    shopOnboardingService.loadShopContext
      .mockResolvedValueOnce({
        shopRef: { update },
        shopProfile: {
          storefront: {
            photoPath: 'shops/x/storefront/1.jpg',
            tagline: 'Hi'
          }
        }
      })
      .mockResolvedValueOnce({
        shopRef: { update },
        shopProfile: {
          storefront: {
            tagline: 'Hi'
          }
        }
      });

    await shopStorefrontService.deleteStorefrontPhoto('shop-1');

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(payload['storefront.photoPath']).toEqual(admin.firestore.FieldValue.delete());
    expect(payload['storefront.updatedAt']).toBeDefined();
    expect(payload.updatedAt).toBeDefined();
  });
});
