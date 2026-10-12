const {
  NOTIFICATION_TEMPLATES,
  NotificationTemplateProcessor,
  NotificationBuilder
} = require('../src/services/notificationTemplates');
const {
  MARKETPLACE_PUSH_DATA_KEYS,
  MARKETPLACE_ALLOWED_ACTIONS,
  MARKETPLACE_TEMPLATE_ACTION,
  isMarketplacePushData
} = require('../src/services/marketplace/marketplacePush');
const shopOrderService = require('../src/services/shopOrderService');
const expoPushService = require('../src/services/expoPushService');
const notificationService = require('../src/services/notificationService');

const UTR_12 = '123456789012';
const UPI_PATTERN = /@[a-z]/i;

const baseVars = {
  orderId: 'order-abc-123',
  displayId: 14357,
  shopName: 'Vaigzz Store',
  amount: 250,
  deliveryFee: 45,
  driverName: 'Ravi',
  customerName: 'Test Customer',
  expectedAmount: 500,
  utr: UTR_12,
  refundUtr: UTR_12
};

function processMarketplace(templateKey) {
  const template = NOTIFICATION_TEMPLATES.MARKETPLACE[templateKey];
  return NotificationTemplateProcessor.process(template, baseVars, {
    category: 'MARKETPLACE',
    templateKey
  });
}

function scanDataForForbiddenPatterns(data) {
  const json = JSON.stringify(data);
  if (json.includes(UTR_12)) {
    return 'full UTR in data';
  }
  if (UPI_PATTERN.test(json)) {
    return 'UPI pattern in data';
  }
  return null;
}

describe('marketplace notification audit (MP-18)', () => {
  const templateKeys = Object.keys(NOTIFICATION_TEMPLATES.MARKETPLACE);

  it('covers every MARKETPLACE template key in action map', () => {
    templateKeys.forEach((key) => {
      expect(MARKETPLACE_TEMPLATE_ACTION[key]).toBeDefined();
    });
  });

  describe.each(templateKeys)('template %s', (templateKey) => {
    it('produces exactly five string data keys with valid action and displayId', () => {
      const notification = processMarketplace(templateKey);
      const data = notification.data;
      expect(Object.keys(data).sort()).toEqual([...MARKETPLACE_PUSH_DATA_KEYS].sort());
      MARKETPLACE_PUSH_DATA_KEYS.forEach((key) => {
        expect(typeof data[key]).toBe('string');
      });
      expect(data.displayId).toMatch(/^\d{5}$/);
      expect(data.displayId).not.toContain('#');
      expect(MARKETPLACE_ALLOWED_ACTIONS.has(data.action)).toBe(true);
      expect(data.action).toBe(MARKETPLACE_TEMPLATE_ACTION[templateKey]);
      expect(data).not.toHaveProperty('variables');
      expect(data).not.toHaveProperty('bookingId');
      expect(data).not.toHaveProperty('driverId');
      expect(data).not.toHaveProperty('paymentId');
      expect(data).not.toHaveProperty('status');
      const forbidden = scanDataForForbiddenPatterns(data);
      expect(forbidden).toBeNull();
      expect(isMarketplacePushData(data)).toBe(true);
      expect(notification.marketplace).toBe(true);
    });
  });

  it('Expo marketplace merge does not add parcel extras', () => {
    const notification = processMarketplace('PAYMENT_CONFIRMED');
    const cleaned = expoPushService.removeUndefinedValues(notification.data);
    const marketplace = isMarketplacePushData(cleaned);
    expect(marketplace).toBe(true);
    const keys = Object.keys(cleaned);
    expect(keys.sort()).toEqual([...MARKETPLACE_PUSH_DATA_KEYS].sort());
  });

  it('parcel driver-assigned notification object unchanged (bookingId preserved)', () => {
    const bookingData = {
      id: 'booking-parcel-99',
      estimatedPickupTime: '15 mins'
    };
    const driverData = { name: 'Parcel Driver' };
    const notification = NotificationBuilder.customerDriverAssigned(bookingData, driverData);
    expect(notification.bookingId).toBe('booking-parcel-99');
    expect(notification.title).toContain('Driver Assigned');
    expect(notification.body).toContain('Parcel Driver');
    expect(notification.data).toBeDefined();
    expect(notification.marketplace).toBeUndefined();
  });

  it('parcel FCM data via buildFcmDataPayload matches pre–MP-18 shape (bookingId + driverId)', () => {
    const isoSpy = jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-01-01T00:00:00.000Z');
    const notification = NotificationBuilder.customerDriverAssigned(
      { id: 'booking-parcel-99', estimatedPickupTime: '15 mins' },
      { name: 'Parcel Driver' }
    );
    notification.driverId = 'driver-parcel-1';

    const fcmData = notificationService.buildFcmDataPayload(notification, {});
    const strData = {};
    Object.entries(fcmData).forEach(([k, v]) => {
      if (v !== undefined && v !== null) {
        strData[k] = String(v);
      }
    });

    expect(strData).toEqual({
      bookingId: 'booking-parcel-99',
      driverId: 'driver-parcel-1',
      paymentId: '',
      timestamp: '2026-01-01T00:00:00.000Z'
    });
    expect(JSON.stringify(strData)).toBe(
      '{"bookingId":"booking-parcel-99","driverId":"driver-parcel-1","paymentId":"","timestamp":"2026-01-01T00:00:00.000Z"}'
    );
    isoSpy.mockRestore();
  });

  describe('OUT_FOR_DELIVERY handover rules', () => {
    it('shouldSendOutForDeliveryPush when handed_over and not delivered', () => {
      expect(shopOrderService.shouldSendOutForDeliveryPush({
        orderStatus: 'handed_over',
        delivery: { stage: 'on_the_way' }
      })).toBe(true);
    });

    it('does not send when already delivered', () => {
      expect(shopOrderService.shouldSendOutForDeliveryPush({
        orderStatus: 'handed_over',
        delivery: { stage: 'delivered' }
      })).toBe(false);
    });

    it('does not send when not handed_over', () => {
      expect(shopOrderService.shouldSendOutForDeliveryPush({
        orderStatus: 'ready',
        delivery: { stage: 'searching' }
      })).toBe(false);
    });
  });
});
