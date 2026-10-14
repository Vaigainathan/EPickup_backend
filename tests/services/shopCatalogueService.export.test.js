/**
 * Guards the singleton export used by customerMarketplaceService (no jest.mock here).
 */
const shopCatalogueService = require('../../src/services/shopCatalogueService');

describe('shopCatalogueService singleton export', () => {
  test('exposes resolvePhotoFromSource and resolvePhotoUrl', () => {
    expect(typeof shopCatalogueService.resolvePhotoFromSource).toBe('function');
    expect(typeof shopCatalogueService.resolvePhotoUrl).toBe('function');
  });
});
