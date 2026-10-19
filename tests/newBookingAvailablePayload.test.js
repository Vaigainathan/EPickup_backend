const { buildNewBookingSocketFields } = require('../src/services/marketplace/newBookingAvailablePayload');

describe('buildNewBookingSocketFields', () => {
  test('defaults parcel fields when missing', () => {
    expect(buildNewBookingSocketFields({})).toEqual({
      sourceType: 'parcel',
      marketplaceOrderId: null,
      displayId: null
    });
  });

  test('passes marketplace booking identifiers', () => {
    expect(buildNewBookingSocketFields({
      sourceType: 'marketplace',
      marketplaceOrderId: 'order-abc',
      displayId: 9001
    })).toEqual({
      sourceType: 'marketplace',
      marketplaceOrderId: 'order-abc',
      displayId: 9001
    });
  });
});
