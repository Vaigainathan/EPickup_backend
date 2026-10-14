const { presentDeliveryAddress } = require('../src/services/marketplace/presentDeliveryAddress');
const { presentCustomerOrderSummary } = require('../src/services/marketplace/customerOrderView');

describe('presentDeliveryAddress', () => {
  test('shop shape omits addressId and nulls missing fields', () => {
    const view = presentDeliveryAddress({ text: 'Line' }, { includeAddressId: false });
    expect(view).toEqual({
      text: 'Line',
      coordinates: null,
      label: null,
      houseNo: null,
      street: null,
      landmark: null,
      receiverName: null,
      receiverPhone: null
    });
    expect(view.addressId).toBeUndefined();
  });

  test('customer shape includes addressId', () => {
    const view = presentDeliveryAddress({
      addressId: 'addr_1',
      text: 'Line',
      label: 'Home',
      coordinates: { latitude: 12.5, longitude: 78.5 }
    }, { includeAddressId: true });
    expect(view.addressId).toBe('addr_1');
    expect(view.coordinates).toEqual({ lat: 12.5, lng: 78.5 });
    expect(view.label).toBe('Home');
  });
});

describe('presentCustomerOrderSummary', () => {
  test('includes shopId and omits sensitive payment UTR fields', () => {
    const summary = presentCustomerOrderSummary({
      id: 'order-1',
      shopId: 'shop-abc',
      displayId: 12345,
      orderStatus: 'awaiting_payment',
      deliveryAddress: { text: 'Addr', addressId: 'addr_1' },
      payment: {
        status: 'pending',
        customerUtr: 'SECRET-UTR',
        shopUpiId: 'shop@upi'
      },
      items: [{ name: 'Item' }]
    });
    expect(summary.shopId).toBe('shop-abc');
    expect(summary.customerUtr).toBeUndefined();
    expect(summary.payment).toBeUndefined();
    expect(summary.handoverOtp).toBeUndefined();
  });
});
