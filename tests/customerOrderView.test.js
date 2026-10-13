const {
  presentCustomerOrder,
  presentCustomerOrderSummary,
  presentCustomerDriverInfo,
  presentShopSnapshot,
  DELIVERY_STAGE_TIME_KEYS
} = require('../src/services/marketplace/customerOrderView');
const { shopSnapshotAddress } = require('../src/services/marketplace/createCustomerOrder');

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

  test('balance.officialUtr is returned and balance.utrSource is omitted', () => {
    const view = presentCustomerOrder({
      id: 'ord-2',
      payment: {
        status: 'confirmed',
        officialUtr: '123456789012',
        utrSource: 'customer',
        balance: {
          amount: 60,
          amountPaise: 6000,
          utr: '555555555555',
          officialUtr: '555555555555',
          utrSource: 'customer'
        }
      }
    });

    expect(view.payment.balance.officialUtr).toBe('555555555555');
    expect(view.payment.balance.utrSource).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('utrSource');
    expect(view.payment.officialUtr).toBe('123456789012');
  });

  test('delivery stageTimes, deliveredAt, readyAt, and payment.confirmedAt are exposed', () => {
    const view = presentCustomerOrder({
      id: 'ord-track',
      readyAt: '2026-10-10T10:00:00.000Z',
      delivery: {
        stage: 'on_the_way',
        fare: 45,
        deliveredAt: '2026-10-10T11:30:00.000Z',
        stageTimes: {
          assigned: '2026-10-10T10:05:00.000Z',
          at_shop: '2026-10-10T10:20:00.000Z'
        }
      },
      payment: {
        status: 'confirmed',
        confirmedAt: '2026-10-10T09:00:00.000Z'
      }
    });
    expect(view.readyAt).toBe('2026-10-10T10:00:00.000Z');
    expect(view.payment.confirmedAt).toBe('2026-10-10T09:00:00.000Z');
    expect(view.delivery.deliveredAt).toBe('2026-10-10T11:30:00.000Z');
    expect(view.delivery.stageTimes).toEqual({
      assigned: '2026-10-10T10:05:00.000Z',
      at_shop: '2026-10-10T10:20:00.000Z',
      picked_up: null,
      on_the_way: null,
      delivered: null
    });
    DELIVERY_STAGE_TIME_KEYS.forEach((key) => {
      expect(view.delivery.stageTimes).toHaveProperty(key);
    });
  });

  test('driverInfo is shaped to name, vehicle, phone only', () => {
    expect(presentCustomerDriverInfo({
      id: 'drv-1',
      name: 'Ravi',
      phone: '9000000001',
      vehicleNumber: 'TN 09 AB 1234',
      rating: 4.9
    })).toEqual({
      name: 'Ravi',
      vehicle: 'TN 09 AB 1234',
      phone: '9000000001'
    });
    const view = presentCustomerOrder({
      id: 'ord-driver',
      driverInfo: { id: 'drv-1', name: 'Ravi', phone: '1', vehicle: 'TN01', extra: true }
    });
    expect(view.driverInfo).toEqual({ name: 'Ravi', vehicle: 'TN01', phone: '1' });
    expect(JSON.stringify(view)).not.toContain('drv-1');
    expect(presentCustomerDriverInfo({ id: 'only' })).toBeNull();
  });

  test('shopSnapshot includes address when stored; older snapshots omit address as null', () => {
    expect(presentShopSnapshot({
      name: 'Shop',
      category: 'Food',
      phone: '1',
      address: ' 12 Main St  '
    })).toEqual({
      name: 'Shop',
      category: 'Food',
      phone: '1',
      address: '12 Main St'
    });
    expect(presentShopSnapshot({ name: 'Legacy Shop', phone: '9' }).address).toBeNull();
    const view = presentCustomerOrder({
      id: 'ord-snap',
      shopSnapshot: { name: 'Legacy Shop' }
    });
    expect(view.shopSnapshot.address).toBeNull();
  });

  test('review shows status, openedAt, and outcome.result only', () => {
    const view = presentCustomerOrder({
      id: 'ord-3',
      payment: {
        status: 'under_review',
        review: {
          status: 'open',
          openedAt: '2026-10-08T00:00:00.000Z',
          trigger: 'shop_not_found',
          shopResponse: { result: 'not_found', note: 'secret' },
          outcome: null
        }
      }
    });
    expect(view.review).toEqual({
      status: 'open',
      openedAt: '2026-10-08T00:00:00.000Z',
      outcome: { result: null }
    });
    expect(JSON.stringify(view.review)).not.toContain('shop_not_found');
    expect(JSON.stringify(view.review)).not.toContain('not_found');
    expect(JSON.stringify(view.review)).not.toContain('secret');
  });
});

describe('shopSnapshotAddress at order create', () => {
  test('reads shops profile address field', () => {
    expect(shopSnapshotAddress({ address: ' 42 Bazaar Road ' })).toBe('42 Bazaar Road');
    expect(shopSnapshotAddress({ address: '' })).toBeNull();
    expect(shopSnapshotAddress({})).toBeNull();
  });
});

describe('presentCustomerOrderSummary', () => {
  const baseOrder = {
    id: 'ord-list',
    displayId: 1001,
    orderStatus: 'preparing',
    shopSnapshot: { name: 'Test Shop', phone: '9000000000' },
    items: [{ name: 'Item A', qty: 1 }],
    expectedAmount: 500,
    expectedAmountPaise: 50000,
    policyGroup: 'A',
    hasOpenRefund: true,
    hasOpenHelp: false,
    createdAt: '2026-10-10T10:00:00.000Z',
    window: { start: '2026-10-10T10:00:00.000Z', end: '2026-10-10T10:15:00.000Z' },
    delivery: { stage: 'to_customer', deliveredAt: '2026-10-10T11:00:00.000Z' },
    payment: { status: 'confirmed' }
  };

  test('includes new list fields without sensitive payment or shop contact data', () => {
    const summary = presentCustomerOrderSummary({
      ...baseOrder,
      payment: {
        status: 'initiated',
        customerUtr: '123456789012',
        balance: { utr: '999999999999', amount: 10 }
      },
      refunds: [{ status: 'upi_needed', id: 'r1' }]
    });

    expect(summary).toEqual({
      id: 'ord-list',
      displayId: 1001,
      orderStatus: 'preparing',
      shopSnapshot: { name: 'Test Shop' },
      itemsCount: 1,
      firstItemName: 'Item A',
      expectedAmount: 500,
      expectedAmountPaise: 50000,
      createdAt: '2026-10-10T10:00:00.000Z',
      window: {
        start: '2026-10-10T10:00:00.000Z',
        end: '2026-10-10T10:15:00.000Z'
      },
      rating: null,
      hasOpenHelp: false,
      paymentStatus: 'initiated',
      balanceSubmitted: true,
      deliveryStage: 'to_customer',
      hasOpenRefund: true,
      refundAction: 'share_upi',
      policyGroup: 'A',
      deliveredAt: '2026-10-10T11:00:00.000Z'
    });

    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('999999999999');
    expect(serialized).not.toContain('123456789012');
    expect(serialized).not.toContain('9000000000');
    expect(serialized).not.toContain('"payment"');
    expect(serialized).not.toContain('utr');
  });

  test('refundAction confirm_received when a refund is sent', () => {
    const summary = presentCustomerOrderSummary({
      ...baseOrder,
      hasOpenRefund: true,
      refunds: [{ status: 'due' }, { status: 'sent', id: 'r2' }]
    });
    expect(summary.refundAction).toBe('confirm_received');
  });

  test('refundAction is null without refunds on the order doc (list query path)', () => {
    const summary = presentCustomerOrderSummary({
      ...baseOrder,
      hasOpenRefund: true
    });
    expect(summary.refundAction).toBeNull();
  });

  test('balanceSubmitted is false without balance UTR', () => {
    const summary = presentCustomerOrderSummary({
      ...baseOrder,
      payment: { status: 'short', balance: { amount: 10 } }
    });
    expect(summary.balanceSubmitted).toBe(false);
    expect(summary.paymentStatus).toBe('short');
  });

  test('balanceSubmitted ignores main payment officialUtr when balance has no UTR', () => {
    const summary = presentCustomerOrderSummary({
      ...baseOrder,
      orderStatus: 'completed',
      payment: {
        status: 'confirmed',
        officialUtr: '123456789012',
        customerUtr: '123456789012'
      }
    });
    expect(summary.balanceSubmitted).toBe(false);
    expect(summary.paymentStatus).toBe('confirmed');
    expect(JSON.stringify(summary)).not.toContain('123456789012');
  });

  test('refundAction uses denormalized customerRefundAction on the order doc first', () => {
    const summary = presentCustomerOrderSummary({
      ...baseOrder,
      customerRefundAction: 'confirm_received',
      refunds: [{ status: 'upi_needed' }]
    });
    expect(summary.refundAction).toBe('confirm_received');
  });
});
