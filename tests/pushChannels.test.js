const {
  resolvePushDeliveryOptions,
  SHOP_RING_TEMPLATE
} = require('../src/constants/pushChannels');
const {
  markShopRingSent,
  shouldDowngradeShopIncomingRing,
  resetShopRingBurstForTests
} = require('../src/services/shopRingBurstCooldown');

describe('pushChannels', () => {
  test('driver offer uses new_order_v5', () => {
    const opts = resolvePushDeliveryOptions({
      userType: 'driver',
      category: 'DRIVER',
      templateKey: 'NEW_BOOKING',
      isDriverOffer: true
    });
    expect(opts.channelId).toBe('new_order_v5');
    expect(opts.sound).toBe('new_order.wav');
  });

  test('shop INCOMING_PAYMENT always uses shop_orders_v2 ring', () => {
    const ring = resolvePushDeliveryOptions({
      userType: 'shop',
      category: 'MARKETPLACE',
      templateKey: SHOP_RING_TEMPLATE
    });
    expect(ring.channelId).toBe('shop_orders_v2');
    expect(ring.sound).toBe('shop_new_order_v2.wav');
  });

  test('shop UTR_SUBMITTED uses shop_orders_v2 ring', () => {
    const opts = resolvePushDeliveryOptions({
      userType: 'shop',
      category: 'MARKETPLACE',
      templateKey: 'UTR_SUBMITTED'
    });
    expect(opts.channelId).toBe('shop_orders_v2');
    expect(opts.sound).toBe('shop_new_order_v2.wav');
  });

  test('shop PAYMENT_REMINDER uses shop_reminders_v2', () => {
    const opts = resolvePushDeliveryOptions({
      userType: 'shop',
      category: 'MARKETPLACE',
      templateKey: 'PAYMENT_REMINDER'
    });
    expect(opts.channelId).toBe('shop_reminders_v2');
    expect(opts.sound).toBe('shop_reminder_v2.wav');
  });

  test('shop payment review templates use shop_payments', () => {
    const opts = resolvePushDeliveryOptions({
      userType: 'shop',
      category: 'MARKETPLACE',
      templateKey: 'PAYMENT_REVIEW_SHOP'
    });
    expect(opts.channelId).toBe('shop_payments');
  });
});

describe('shopRingBurstCooldown fail-open', () => {
  afterEach(() => {
    resetShopRingBurstForTests();
  });

  test('in-memory cooldown downgrades within 60s', async () => {
    markShopRingSent('shop-a', Date.now());
    const db = {
      collection: () => ({
        where: () => ({ where: () => ({ where: () => ({ limit: () => ({ get: async () => { throw new Error('should not query'); } }) }) }) })
      })
    };
    const down = await shouldDowngradeShopIncomingRing(db, 'shop-a');
    expect(down).toBe(true);
  });

  test('query failure fails open (no downgrade)', async () => {
    const db = {
      collection: () => ({
        where: () => ({
          where: () => ({
            where: () => ({
              limit: () => ({
                get: async () => {
                  throw new Error('index missing');
                }
              })
            })
          })
        })
      })
    };
    const down = await shouldDowngradeShopIncomingRing(db, 'shop-b');
    expect(down).toBe(false);
  });
});