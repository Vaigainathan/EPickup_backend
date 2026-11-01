const mockEmit = jest.fn();
const mockTo = jest.fn(() => ({ emit: mockEmit }));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true }))
}));

jest.mock('../src/services/socket', () => ({
  getSocketIO: jest.fn(() => ({ to: mockTo }))
}));

jest.mock('../src/services/marketplace/orderEvents', () => ({
  appendEvent: jest.fn()
}));

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

jest.mock('firebase-admin', () => ({
  apps: [{ name: '[DEFAULT]' }],
  initializeApp: jest.fn(),
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => ({ __ts: true })),
      increment: jest.fn((n) => ({ __inc: n })),
      delete: jest.fn(() => ({ __delete: true }))
    }
  }
}));

const { getFirestore } = require('../src/services/firebase');
const { installRealFirestoreGuard } = require('./helpers/realFirestoreGuard');
const {
  assertMarketplacePickupAllowed,
  recordMarketplaceHandoverAfterPickup
} = require('../src/services/marketplace/marketplacePickupHandover');
const { DriverStatusError } = require('../src/services/driverStatusWorkflowService');

describe('marketplace pickup = handover', () => {
  describe('assertMarketplacePickupAllowed', () => {
    test('other driver gets 403', () => {
      expect(() => assertMarketplacePickupAllowed({
        booking: { sourceType: 'marketplace', driverId: 'driver-a', status: 'driver_arrived' },
        driverId: 'driver-b',
        order: { orderStatus: 'ready' }
      })).toThrow(DriverStatusError);

      try {
        assertMarketplacePickupAllowed({
          booking: { sourceType: 'marketplace', driverId: 'driver-a', status: 'driver_arrived' },
          driverId: 'driver-b',
          order: { orderStatus: 'ready' }
        });
      } catch (error) {
        expect(error.statusCode).toBe(403);
      }
    });

    test('not arrived gets 409', () => {
      try {
        assertMarketplacePickupAllowed({
          booking: { sourceType: 'marketplace', driverId: 'd1', status: 'driver_assigned' },
          driverId: 'd1',
          order: { orderStatus: 'ready' }
        });
        throw new Error('expected throw');
      } catch (error) {
        expect(error.statusCode).toBe(409);
      }
    });

    test('order not ready gets 409', () => {
      try {
        assertMarketplacePickupAllowed({
          booking: { sourceType: 'marketplace', driverId: 'd1', status: 'driver_arrived' },
          driverId: 'd1',
          order: { orderStatus: 'preparing' }
        });
        throw new Error('expected throw');
      } catch (error) {
        expect(error.code).toBe('ORDER_NOT_READY');
      }
    });
  });

  describe('recordMarketplaceHandoverAfterPickup', () => {
    installRealFirestoreGuard(getFirestore);

    beforeEach(() => {
      mockEmit.mockReset();
      mockTo.mockClear();
      getFirestore.mockReset();
    });

    test('success sets handed_over on order', async () => {
      const orderRef = {
        get: jest.fn(),
        update: jest.fn()
      };
      const orderSnap = {
        exists: true,
        data: () => ({
          orderStatus: 'ready',
          shopId: 'shop-1',
          customerId: 'cust-1',
          displayId: 42
        })
      };
      orderRef.get.mockResolvedValue(orderSnap);

      getFirestore.mockReturnValue({
        collection: jest.fn((name) => {
          if (name === 'marketplaceOrders') {
            return { doc: jest.fn(() => orderRef) };
          }
          return { doc: jest.fn() };
        }),
        runTransaction: jest.fn(async (fn) => fn({
          get: async () => orderSnap,
          update: orderRef.update
        }))
      });

      const outcome = await recordMarketplaceHandoverAfterPickup({
        bookingId: 'b1',
        booking: {
          sourceType: 'marketplace',
          driverId: 'd1',
          driverInfo: { name: 'Ravi', phone: '9', vehicleNumber: 'TN01' }
        },
        driverId: 'd1',
        marketplaceOrderId: 'order-1'
      });

      expect(outcome.alreadyHandedOver).toBe(false);
      expect(orderRef.update).toHaveBeenCalled();
      const notify = require('../src/services/notificationService').sendTemplateNotification;
      expect(notify).toHaveBeenCalledWith(
        'shop-1',
        'MARKETPLACE',
        'ORDER_PICKED_UP_SHOP',
        expect.objectContaining({ driverName: 'Ravi' })
      );
    });
  });
});
