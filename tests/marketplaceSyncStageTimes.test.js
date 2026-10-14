const admin = require('firebase-admin');

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../src/services/marketplace/orderEvents', () => ({
  appendEvent: jest.fn(),
  touchOrderSignal: jest.fn(),
  bumpOrderSignal: jest.fn()
}));

const { getFirestore } = require('../src/services/firebase');
const { appendEvent } = require('../src/services/marketplace/orderEvents');
const marketplaceSyncService = require('../src/services/marketplaceSyncService');

const {
  buildMarketplaceSyncOrderUpdates,
  stageTimeStored,
  STAGE_TIMES_TRACKED,
  planDeliverySync
} = marketplaceSyncService;

const SERVER_TIME = admin.firestore.FieldValue.serverTimestamp();

describe('buildMarketplaceSyncOrderUpdates stageTimes', () => {
  test('writes stage time when advancing into a tracked stage', () => {
    const order = { delivery: { stage: 'searching' } };
    const plan = { stage: 'assigned' };
    const updates = buildMarketplaceSyncOrderUpdates(order, plan);
    expect(updates['delivery.stage']).toBe('assigned');
    expect(updates['delivery.stageTimes.assigned']).toEqual(SERVER_TIME);
    expect(updates.updatedAt).toEqual(SERVER_TIME);
  });

  test('does not rewrite stage time when already stored', () => {
    const order = {
      delivery: {
        stage: 'assigned',
        stageTimes: { assigned: new Date('2020-01-01T00:00:00.000Z') }
      }
    };
    const plan = { stage: 'at_shop' };
    const updates = buildMarketplaceSyncOrderUpdates(order, plan);
    expect(updates['delivery.stage']).toBe('at_shop');
    expect(updates['delivery.stageTimes.assigned']).toBeUndefined();
    expect(updates['delivery.stageTimes.at_shop']).toEqual(SERVER_TIME);
    expect(stageTimeStored(order, 'assigned')).toBe(true);
  });

  test('does not set stageTimes for searching or cancelled', () => {
    const order = { delivery: { stage: null } };
    const searching = buildMarketplaceSyncOrderUpdates(order, { stage: 'searching' });
    expect(searching['delivery.stageTimes.searching']).toBeUndefined();

    const cancelled = buildMarketplaceSyncOrderUpdates(
      { delivery: { stage: 'on_the_way' } },
      { stage: 'cancelled' }
    );
    expect(cancelled['delivery.stage']).toBe('cancelled');
    expect(cancelled['delivery.stageTimes.cancelled']).toBeUndefined();
  });

  test('tracked stages match customer presenter keys', () => {
    const { DELIVERY_STAGE_TIME_KEYS } = require('../src/services/marketplace/customerOrderView');
    expect(STAGE_TIMES_TRACKED).toEqual(DELIVERY_STAGE_TIME_KEYS);
  });
});

describe('syncBooking transaction stageTimes', () => {
  function mockDbForOrder(orderData) {
    let updatePayload = null;
    const orderRef = {
      id: 'order-1',
      path: 'marketplaceOrders/order-1',
      collection() {
        return { doc: () => ({ id: 'evt-1' }) };
      }
    };
    const db = {
      collection(name) {
        if (name === 'marketplaceOrders') {
          return { doc: () => orderRef };
        }
        if (name === 'shops') {
          return { doc: () => ({ id: 'shop-1' }) };
        }
        return { doc: () => ({ id: 'x' }) };
      },
      runTransaction(fn) {
        const tx = {
          async get(ref) {
            if (ref === orderRef) {
              return { exists: true, id: 'order-1', data: () => orderData };
            }
            return { exists: false };
          },
          update(ref, patch) {
            updatePayload = patch;
          },
          set() {}
        };
        return fn(tx);
      }
    };
    getFirestore.mockReturnValue(db);
    return {
      getUpdatePayload: () => updatePayload
    };
  }

  beforeEach(() => {
    appendEvent.mockClear();
    getFirestore.mockReset();
  });

  test('persists stageTimes.assigned in the same transaction as delivery.stage', async () => {
    const { getUpdatePayload } = mockDbForOrder({
      customerId: 'cust-1',
      shopId: 'shop-1',
      orderStatus: 'handed_over',
      delivery: { stage: 'searching' }
    });

    const plan = planDeliverySync(
      { delivery: { stage: 'searching' }, orderStatus: 'handed_over' },
      { status: 'driver_assigned', fare: { totalFare: 45 } }
    );
    expect(plan.stage).toBe('assigned');

    await marketplaceSyncService.syncBooking({
      bookingId: 'book-1',
      booking: {
        marketplaceOrderId: 'order-1',
        status: 'driver_assigned',
        fare: { totalFare: 45 }
      }
    });

    expect(getUpdatePayload()).toMatchObject({
      'delivery.stage': 'assigned',
      'delivery.stageTimes.assigned': SERVER_TIME
    });
    expect(appendEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: 'delivery_stage' }),
      'cust-1'
    );
  });

  test('second sync to the same stage does not add another stage time key', async () => {
    const { getUpdatePayload } = mockDbForOrder({
      customerId: 'cust-1',
      shopId: 'shop-1',
      orderStatus: 'handed_over',
      deliveryFee: 45,
      delivery: {
        stage: 'assigned',
        fare: 45,
        stageTimes: { assigned: new Date('2026-10-10T12:00:00.000Z') }
      }
    });

    await marketplaceSyncService.syncBooking({
      bookingId: 'book-1',
      booking: {
        marketplaceOrderId: 'order-1',
        status: 'driver_assigned',
        fare: { totalFare: 45 }
      }
    });

    expect(getUpdatePayload()).toBeNull();
    expect(appendEvent).not.toHaveBeenCalled();
  });
});
