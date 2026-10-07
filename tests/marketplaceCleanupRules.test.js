const {
  chooseCleanupTarget,
  recentOrdersForCleanup,
  shouldDecrementUnpaid
} = require('../scripts/support/marketplaceCleanupRules');

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

  test('no lock and no --order selects nothing, even when a cancelled order is older than preparing', () => {
    expect(chooseCleanupTarget({})).toEqual({ orderId: null, foundBy: null });
    expect(chooseCleanupTarget({ lockOrderId: 'prep' })).toEqual({
      orderId: 'prep',
      foundBy: 'lock'
    });
    expect(chooseCleanupTarget({
      explicitOrderId: 'prep',
      lockOrderId: 'old-cancel'
    })).toEqual({ orderId: 'prep', foundBy: 'order-flag' });
  });

  test('recent orders are the 5 newest for this shop', () => {
    const orders = [
      { id: 'old-cancel', shopId: 'shop-1', orderStatus: 'cancelled', displayId: 13946, createdAtMs: 10, createdAt: '2020-01-01T00:00:00.000Z' },
      { id: 'a', shopId: 'shop-1', orderStatus: 'awaiting_payment', displayId: 1, createdAtMs: 20, createdAt: '2020-01-02T00:00:00.000Z' },
      { id: 'b', shopId: 'shop-1', orderStatus: 'preparing', displayId: 2, createdAtMs: 30, createdAt: '2020-01-03T00:00:00.000Z' },
      { id: 'c', shopId: 'shop-1', orderStatus: 'ready', displayId: 3, createdAtMs: 40, createdAt: '2020-01-04T00:00:00.000Z' },
      { id: 'd', shopId: 'shop-1', orderStatus: 'preparing', displayId: 4, createdAtMs: 50, createdAt: '2020-01-05T00:00:00.000Z' },
      { id: 'e', shopId: 'shop-1', orderStatus: 'preparing', displayId: 5, createdAtMs: 60, createdAt: '2020-01-06T00:00:00.000Z' },
      { id: 'other', shopId: 'shop-2', orderStatus: 'preparing', displayId: 99, createdAtMs: 70, createdAt: '2020-01-07T00:00:00.000Z' }
    ];
    expect(recentOrdersForCleanup(orders, 'shop-1')).toEqual([
      { id: 'e', displayId: 5, status: 'preparing', createdAt: '2020-01-06T00:00:00.000Z' },
      { id: 'd', displayId: 4, status: 'preparing', createdAt: '2020-01-05T00:00:00.000Z' },
      { id: 'c', displayId: 3, status: 'ready', createdAt: '2020-01-04T00:00:00.000Z' },
      { id: 'b', displayId: 2, status: 'preparing', createdAt: '2020-01-03T00:00:00.000Z' },
      { id: 'a', displayId: 1, status: 'awaiting_payment', createdAt: '2020-01-02T00:00:00.000Z' }
    ]);
  });
});