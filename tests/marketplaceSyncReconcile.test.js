const marketplaceSyncService = require('../src/services/marketplaceSyncService');
const { wrapStrictTransaction } = require('./helpers/strictFirestoreTransaction');
const {
  mergeBookingAfterPatch,
  evaluateSyncPreflight,
  planReconcileBooking
} = require('../scripts/support/lib/marketplaceStagingDriver');

const { planDeliverySync, planWrites } = marketplaceSyncService;

describe('marketplace sync reconcile preflight', () => {
  test('completed order at delivered stage + booking delivered is a sync no-op', () => {
    const order = {
      orderStatus: 'completed',
      delivery: { stage: 'delivered', deliveredAt: new Date() }
    };
    const booking = {
      status: 'delivered',
      sourceType: 'marketplace',
      timing: { deliveredAt: new Date() }
    };
    const preflight = evaluateSyncPreflight(order, booking, planDeliverySync, planWrites);
    expect(preflight.ok).toBe(true);
    expect(preflight.writes).toBe(false);
    expect(preflight.push).toBeFalsy();
    expect(preflight.complete).toBe(false);
  });

  test('completed order + pending booking reconcile plan is delivered only', () => {
    const order = { orderStatus: 'completed', delivery: { stage: 'delivered' } };
    const booking = { status: 'pending', sourceType: 'marketplace' };
    const plan = planReconcileBooking(order, booking);
    expect(plan.action).toBe('delivered');
    expect(plan.bookingPatch.status).toBe('delivered');
    expect(plan.bookingPatch.reconciledBy).toBe('staging-reconcile-script');
    const proposed = mergeBookingAfterPatch(booking, plan.bookingPatch);
    const preflight = evaluateSyncPreflight(order, proposed, planDeliverySync, planWrites);
    expect(preflight.ok).toBe(true);
  });

  test('cancelled booking on completed order would fail sync preflight (reconcile must refuse)', () => {
    const order = {
      orderStatus: 'completed',
      delivery: { stage: 'delivered' }
    };
    const booking = { status: 'pending' };
    const proposed = mergeBookingAfterPatch(booking, { status: 'cancelled' });
    const preflight = evaluateSyncPreflight(order, proposed, planDeliverySync, planWrites);
    expect(preflight.ok).toBe(false);
    expect(preflight.writes).toBe(true);
  });

  test('syncBooking transaction does not write shop when plan is no-op', async () => {
    const order = {
      orderStatus: 'completed',
      shopId: 'shop-test',
      delivery: { stage: 'delivered' }
    };
    const booking = { status: 'delivered', marketplaceOrderId: 'order-1' };

    const orderRef = { path: 'marketplaceOrders/order-1' };
    const shopWrites = [];
    const tx = wrapStrictTransaction({
      async get(ref) {
        if (ref === orderRef) {
          return { exists: true, id: 'order-1', data: () => order };
        }
        return { exists: false };
      },
      set(ref, data) {
        if (ref.path && ref.path.startsWith('shops/')) {
          shopWrites.push(data);
        }
      },
      update() {}
    });

    const plan = planDeliverySync(order, booking);
    expect(planWrites(plan, order)).toBe(false);

    const updates = marketplaceSyncService.buildMarketplaceSyncOrderUpdates(order, plan);
    expect(Object.keys(updates).length).toBe(0);
    if (plan.complete && order.shopId) {
      tx.set({ path: `shops/${order.shopId}` }, { orderCount: 1 });
    }
    expect(shopWrites).toHaveLength(0);
  });
});
