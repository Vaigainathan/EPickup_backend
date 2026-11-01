const {
  NotificationTemplateProcessor,
  NOTIFICATION_TEMPLATES
} = require('../src/services/notificationTemplates');

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true }))
}));

describe('marketplace notifications', () => {
  test('UTR_SUBMITTED interpolates customerName amount utr', () => {
    const template = NOTIFICATION_TEMPLATES.MARKETPLACE.UTR_SUBMITTED;
    const processed = NotificationTemplateProcessor.process(template, {
      orderId: 'o1',
      displayId: 12,
      shopName: 'Tea Shop',
      customerName: 'Ada',
      amount: 120,
      utr: '123456789012'
    }, { category: 'MARKETPLACE', templateKey: 'UTR_SUBMITTED' });
    expect(processed.body).toContain('Ada');
    expect(processed.body).toContain('120');
    expect(processed.body).toContain('9012');
    expect(processed.body).not.toMatch(/\{\{/);
  });

  test('shop push templates use final data.type values', () => {
    const assigned = NotificationTemplateProcessor.process(
      NOTIFICATION_TEMPLATES.MARKETPLACE.DRIVER_ASSIGNED_SHOP,
      { orderId: 'o1', displayId: 3, shopName: 'S', driverName: 'Ravi' },
      { category: 'MARKETPLACE', templateKey: 'DRIVER_ASSIGNED_SHOP' }
    );
    expect(assigned.data.type).toBe('order_driver_assigned');
    expect(assigned.data.orderId).toBe('o1');
    expect(assigned.data.displayId).toBe('00003');

    const arrived = NotificationTemplateProcessor.process(
      NOTIFICATION_TEMPLATES.MARKETPLACE.DRIVER_AT_SHOP_SHOP,
      { orderId: 'o1', displayId: 3, shopName: 'S', driverName: 'Ravi' },
      { category: 'MARKETPLACE', templateKey: 'DRIVER_AT_SHOP_SHOP' }
    );
    expect(arrived.data.type).toBe('order_driver_arrived');

    const pickedUp = NotificationTemplateProcessor.process(
      NOTIFICATION_TEMPLATES.MARKETPLACE.ORDER_PICKED_UP_SHOP,
      { orderId: 'o1', displayId: 3, shopName: 'S', driverName: 'Ravi' },
      { category: 'MARKETPLACE', templateKey: 'ORDER_PICKED_UP_SHOP' }
    );
    expect(pickedUp.data.type).toBe('order_picked_up');
  });

  test('marketplaceSyncService maps shop stages to templates', () => {
    const sync = require('../src/services/marketplaceSyncService');
    expect(sync.SHOP_PUSH_BY_STAGE.assigned).toBe('DRIVER_ASSIGNED_SHOP');
    expect(sync.SHOP_PUSH_BY_STAGE.at_shop).toBe('DRIVER_AT_SHOP_SHOP');
    expect(sync.PUSH_BY_STAGE.on_the_way).toBe('OUT_FOR_DELIVERY');
  });
});
