const { presentCustomerOrder } = require('../src/services/marketplace/customerOrderView');

describe('presentCustomerOrder', () => {
  test('handover OTP and private data never appear', () => {
    const view = presentCustomerOrder({
      id: 'ord-1',
      shopId: 'shop-1',
      customerId: 'cust-1',
      items: [{ name: 'Rice', qty: 1 }],
      itemsTotal: 100,
      deliveryFee: 20,
      deliveryAddress: { text: 'Home' },
      orderStatus: 'ready',
      displayId: 42,
      linkedBookingId: 'book-1',
      driverInfo: { name: 'Ravi', phone: '1', vehicle: 'TN01' },
      handoverOtp: '654321',
      private: { handover: { otp: '654321' } },
      shopNotes: 'leave at counter',
      payment: {
        status: 'confirmed',
        shopUpiId: 'shop@upi',
        amount: 100,
        transactionReference: 'ord-1',
        customerUtr: '123456789012',
        customerUpiId: 'me@upi',
        initiatedAt: null,
        confirmedAt: null,
        expiredAt: null,
        refundedAt: null,
        confirmedByShopUid: 'shop-1'
      },
      cancellation: { reason: null, cancelledAt: null, cancelledBy: null },
      createdAt: 't1',
      updatedAt: 't2'
    });

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('654321');
    expect(serialized).not.toContain('handoverOtp');
    expect(serialized).not.toContain('private');
    expect(serialized).not.toContain('confirmedByShopUid');
    expect(serialized).not.toContain('shopNotes');
    expect(view.payment).toEqual({
      status: 'confirmed',
      shopUpiId: 'shop@upi',
      amount: 100,
      transactionReference: 'ord-1',
      customerUtr: '123456789012',
      officialUtr: null,
      receivedAmount: null,
      receivedAmountPaise: null,
      customerUpiId: 'me@upi',
      utrSubmittedAt: null,
      initiatedAt: null,
      confirmedAt: null,
      expiredAt: null,
      refundedAt: null,
      balance: null
    });
    expect(view.id).toBe('ord-1');
    expect(view.orderStatus).toBe('ready');
  });
});
