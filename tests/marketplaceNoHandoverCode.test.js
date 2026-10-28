jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) }))
        })),
        get: jest.fn()
      }))
    }))
  }))
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true }))
}));

jest.mock('firebase-admin', () => ({
  apps: [],
  initializeApp: jest.fn(),
  firestore: Object.assign(jest.fn(), {
    FieldValue: { serverTimestamp: jest.fn(), increment: jest.fn() }
  })
}));

const { getFirestore } = require('../src/services/firebase');
const shopOrderService = require('../src/services/shopOrderService');
const { presentCustomerOrder } = require('../src/services/marketplace/customerOrderView');
const { loadAssignedMarketplaceContext } = require('../src/services/marketplace/driverMarketplaceAssignment');

describe('no handover code in API payloads', () => {
  test('shop presentOrder omits handoverOtp and handoverCode', async () => {
    const order = await shopOrderService.presentOrder('o1', {
      shopId: 's1',
      orderStatus: 'ready',
      displayId: 1,
      items: [],
      payment: {},
      delivery: {}
    });
    expect(order.handoverOtp).toBeUndefined();
    expect(order.handoverCode).toBeUndefined();
    expect(order.handedOverAt).toBeNull();
  });

  test('customer presentOrder omits handover fields', () => {
    const view = presentCustomerOrder({
      id: 'o1',
      orderStatus: 'ready',
      items: [],
      payment: {},
      delivery: {}
    });
    expect(view.handoverOtp).toBeUndefined();
    expect(view.handoverCode).toBeUndefined();
    expect(view.handedOverAt).toBeNull();
  });

  test('driver marketplace context has no handoverCode', async () => {
    getFirestore.mockReturnValue({
      collection: jest.fn(() => ({
        doc: jest.fn(() => ({
          get: jest.fn(async () => ({
            exists: true,
            data: () => ({
              displayId: 9,
              orderStatus: 'ready',
              items: [{ name: 'Tea', qty: 2, unavailable: false }]
            })
          }))
        }))
      }))
    });
    const ctx = await loadAssignedMarketplaceContext(getFirestore(), {
      sourceType: 'marketplace',
      driverId: 'd1',
      marketplaceOrderId: 'o1',
      status: 'driver_assigned',
      pickup: { name: 'Shop', phone: '99' }
    }, 'd1');
    expect(ctx.handoverCode).toBeUndefined();
    expect(ctx.handedOver).toBe(true);
    expect(ctx.shopName).toBe('Shop');
    expect(ctx.items).toEqual([{ name: 'Tea', variantLabel: null, qty: 2 }]);
  });
});
