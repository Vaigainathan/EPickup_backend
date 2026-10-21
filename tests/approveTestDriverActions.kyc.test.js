const { isDriverDocumentPresent } = require('../scripts/support/approveTestDriverActions');

describe('approveTestDriverActions KYC presence', () => {
  it('treats filePath-only document as present', () => {
    expect(isDriverDocumentPresent({
      filePath: 'drivers/test-uid/documents/driving_license/1.jpg'
    })).toBe(true);
  });

  it('still treats url as present', () => {
    expect(isDriverDocumentPresent({
      url: 'https://storage.googleapis.com/b/x.jpg'
    })).toBe(true);
  });
});
