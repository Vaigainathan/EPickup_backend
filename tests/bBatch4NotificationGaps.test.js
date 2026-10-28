jest.mock('../instrument.js', () => ({}));

const {
  passesDriverNewBookingNotifyEligibility,
  isDriverVerified,
  driverAccountSuspensionReason
} = require('../src/utils/driverBookingEligibility');
const { buildNewBookingDisplayPush } = require('../src/utils/newBookingDisplayPush');
const { NotificationTemplateProcessor } = require('../src/services/notificationTemplates');
const { buildMarketplacePushData } = require('../src/services/marketplace/marketplacePush');
const {
  assertMarketplaceOrderCancelAllowed,
  shouldCancelLinkedBooking
} = require('../src/services/marketplace/marketplaceLinkedBookingCancel');

describe('B-BATCH-4 driverBookingEligibility', () => {
  test('passes when online, available, verified, active account', () => {
    expect(passesDriverNewBookingNotifyEligibility({
      accountStatus: 'active',
      driver: { isOnline: true, isAvailable: true, verificationStatus: 'verified' }
    })).toBe(true);
  });

  test('fails when not available', () => {
    expect(passesDriverNewBookingNotifyEligibility({
      accountStatus: 'active',
      driver: { isOnline: true, isAvailable: false, verificationStatus: 'verified' }
    })).toBe(false);
  });

  test('fails when unverified', () => {
    expect(isDriverVerified({ driver: { verificationStatus: 'pending' } })).toBe(false);
  });

  test('fails when account suspended', () => {
    expect(driverAccountSuspensionReason({ accountStatus: 'suspended' })).toBe('suspended');
    expect(passesDriverNewBookingNotifyEligibility({
      accountStatus: 'suspended',
      driver: { isOnline: true, isAvailable: true, verificationStatus: 'verified' }
    })).toBe(false);
  });
});

describe('B-BATCH-4 newBookingDisplayPush', () => {
  test('marketplace copy uses shop name and delivery fee', () => {
    const copy = buildNewBookingDisplayPush({
      sourceType: 'marketplace',
      pickup: { name: 'Tea Stall' },
      fare: { totalFare: 45 }
    });
    expect(copy.title).toBe('New shop order');
    expect(copy.body).toContain('Tea Stall');
    expect(copy.body).toContain('₹45');
  });

  test('parcel copy unchanged', () => {
    const copy = buildNewBookingDisplayPush({
      sourceType: 'parcel',
      pickup: { address: 'Main Road' }
    });
    expect(copy.title).toContain('New Booking Available');
    expect(copy.body).toContain('Main Road');
  });
});

describe('B-BATCH-4 notification templates', () => {
  test('ORDER_PACKED mentions finding a delivery partner', () => {
    const template = NotificationTemplateProcessor.getTemplate('MARKETPLACE', 'ORDER_PACKED');
    const processed = NotificationTemplateProcessor.process(template, { deliveryFee: 50 }, {
      category: 'MARKETPLACE',
      templateKey: 'ORDER_PACKED'
    });
    expect(processed.title).toBe('Order ready');
    expect(processed.body).toContain('finding a delivery partner');
    expect(processed.data.type).toBe('order_packed');
  });

  test('MARKETPLACE FINDING_NEW_DRIVER uses marketplace data contract', () => {
    const template = NotificationTemplateProcessor.getTemplate('MARKETPLACE', 'FINDING_NEW_DRIVER');
    const processed = NotificationTemplateProcessor.process(template, {
      orderId: 'ord1',
      displayId: '42',
      shopName: 'Bakery'
    }, {
      category: 'MARKETPLACE',
      templateKey: 'FINDING_NEW_DRIVER'
    });
    expect(processed.data.type).toBe('finding_new_driver');
    expect(buildMarketplacePushData('FINDING_NEW_DRIVER', 'finding_new_driver', {
      orderId: 'ord1',
      displayId: '42',
      shopName: 'Bakery'
    })).toEqual({
      type: 'finding_new_driver',
      orderId: 'ord1',
      displayId: '00042',
      shopName: 'Bakery',
      action: 'tracking'
    });
  });

  test('ORDER_DELIVERED_SHOP template', () => {
    const template = NotificationTemplateProcessor.getTemplate('MARKETPLACE', 'ORDER_DELIVERED_SHOP');
    const processed = NotificationTemplateProcessor.process(template, { displayId: 7 }, {
      category: 'MARKETPLACE',
      templateKey: 'ORDER_DELIVERED_SHOP'
    });
    expect(processed.body).toContain('00007');
    expect(processed.data.type).toBe('order_delivered');
  });
});

describe('B-BATCH-4 linked booking cancel policy', () => {
  test('shouldCancelLinkedBooking skips terminal statuses', () => {
    expect(shouldCancelLinkedBooking({ status: 'cancelled' })).toBe(false);
    expect(shouldCancelLinkedBooking({ status: 'driver_assigned', driverId: 'd1' })).toBe(true);
  });

  test('assertMarketplaceOrderCancelAllowed rejects past pickup', () => {
    expect(() => assertMarketplaceOrderCancelAllowed(
      { orderStatus: 'ready' },
      { status: 'picked_up', driverId: 'd1' }
    )).toThrow(expect.objectContaining({ code: 'CANCEL_NOT_ALLOWED' }));
  });
});
