const { chooseCleanupTarget, shouldDecrementUnpaid } = require('../scripts/support/marketplaceCleanupRules');

describe('marketplace cleanup rules', () => {
  test('deleting a lock decrements unpaidCount for a cancelled order when the count is above 0', () => {
    expect(shouldDecrementUnpaid({
      deleteLock: true,
      orderStatus: 'cancelled',
      unpaidCount: 1
    })).toBe(true);
    expect(shouldDecrementUnpaid({
      deleteLock: true,
      orderStatus: 'preparing',
      unpaidCount: 1
    })).toBe(true);
    expect(shouldDecrementUnpaid({
      deleteLock: true,
      orderStatus: 'cancelled',
      unpaidCount: 0
    })).toBe(false);
  });

  test('a preparing order with no lock does not decrement unpaidCount', () => {
    expect(shouldDecrementUnpaid({
      deleteLock: false,
      orderStatus: 'preparing',
      unpaidCount: 1
    })).toBe(false);
  });

  test('no lock and no cancelled order selects the newest order of any status', () => {
    const chosen = chooseCleanupTarget({
      shopId: 'shop-1',
      orders: [
        { id: 'old', shopId: 'shop-1', orderStatus: 'awaiting_payment', createdAtMs: 10 },
        { id: 'prep', shopId: 'shop-1', orderStatus: 'preparing', createdAtMs: 20 },
        { id: 'other-shop', shopId: 'shop-2', orderStatus: 'preparing', createdAtMs: 30 }
      ]
    });
    expect(chosen).toEqual({ orderId: 'prep', foundBy: 'newest-order' });
  });

  test('a cancelled order is preferred, and --order or the lock wins before that', () => {
    const orders = [
      { id: 'prep', shopId: 'shop-1', orderStatus: 'preparing', createdAtMs: 50 },
      { id: 'old-cancel', shopId: 'shop-1', orderStatus: 'cancelled', createdAtMs: 10 },
      { id: 'new-cancel', shopId: 'shop-1', orderStatus: 'cancelled', createdAtMs: 40 }
    ];
    expect(chooseCleanupTarget({ shopId: 'shop-1', orders })).toEqual({
      orderId: 'new-cancel',
      foundBy: 'cancelled-order'
    });
    expect(chooseCleanupTarget({
      lockOrderId: 'prep',
      shopId: 'shop-1',
      orders
    })).toEqual({ orderId: 'prep', foundBy: 'lock' });
    expect(chooseCleanupTarget({
      explicitOrderId: 'prep',
      lockOrderId: 'old-cancel',
      shopId: 'shop-1',
      orders
    })).toEqual({ orderId: 'prep', foundBy: 'order-flag' });
  });
});
