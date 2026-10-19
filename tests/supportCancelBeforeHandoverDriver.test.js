const { wrapStrictTransaction } = require('./helpers/strictFirestoreTransaction');

const mockDriverUpdate = jest.fn();
const mockBookingUpdate = jest.fn();
const mockOrderUpdate = jest.fn();
const mockEmit = jest.fn();
const mockTo = jest.fn(() => ({ emit: mockEmit }));

const orderRef = { path: 'marketplaceOrders/order-1' };
const bookingRef = { path: 'bookings/booking-1' };
const driverRef = { path: 'users/driver-1' };

const refs = {
  order: orderRef,
  booking: bookingRef,
  driver: driverRef
};

function txGet(ref) {
  if (ref === refs.order) {
    return Promise.resolve({
      exists: true,
      data: () => ({
        orderStatus: 'ready',
        delivery: { stage: 'assigned' },
        linkedBookingId: 'booking-1',
        customerId: 'customer-1',
        payment: { receivedAmountPaise: 0 },
        items: []
      })
    });
  }
  if (ref === refs.booking) {
    return Promise.resolve({
      exists: true,
      data: () => ({
        status: 'driver_assigned',
        driverId: 'driver-1'
      })
    });
  }
  if (ref === refs.driver) {
    return Promise.resolve({
      exists: true,
      data: () => ({
        driver: { activeBookings: 1, currentBookingId: 'booking-1' }
      })
    });
  }
  return Promise.resolve({ exists: false });
}

const baseTx = {
  get: (ref) => txGet(ref),
  update: jest.fn((ref, patch) => {
    if (ref === refs.driver) {
      mockDriverUpdate(patch);
    }
    if (ref === refs.booking) {
      mockBookingUpdate(patch);
    }
    if (ref === refs.order) {
      mockOrderUpdate(patch);
    }
  }),
  set: jest.fn()
};

const mockRunTransaction = jest.fn(async (fn) => fn(wrapStrictTransaction(baseTx)));

const mockDb = {
  runTransaction: mockRunTransaction,
  collection: jest.fn((name) => {
    if (name === 'marketplaceOrders') {
      return { doc: jest.fn(() => refs.order) };
    }
    if (name === 'bookings') {
      return { doc: jest.fn(() => refs.booking) };
    }
    if (name === 'users') {
      return { doc: jest.fn(() => refs.driver) };
    }
    return { doc: jest.fn() };
  })
};

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => mockDb)
}));

jest.mock('../src/services/marketplace/refunds', () => ({
  refundRemainder: jest.fn(async () => ({ remainderPaise: 0, refunds: [] })),
  createRefund: jest.fn(async () => {}),
  loadRefundDocs: jest.fn(async () => []),
  listShopRefunds: jest.fn(),
  presentShopRefund: jest.fn(),
  OPEN_STATUSES: new Set(),
  toPaise: (v) => v
}));

jest.mock('../src/services/marketplace/stock', () => ({
  cancelRestoresStock: jest.fn(() => false),
  restoreLines: jest.fn(),
  deductStock: jest.fn()
}));

jest.mock('../src/services/marketplace/orderEvents', () => ({
  appendEvent: jest.fn()
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true }))
}));

jest.mock('../src/services/socket', () => ({
  getSocketIO: jest.fn(() => ({ to: mockTo }))
}));

jest.mock('firebase-admin', () => {
  const blockRealFirestore = () => {
    throw new Error('REAL FIRESTORE IN TEST');
  };
  return {
    apps: [{ name: '[DEFAULT]' }],
    initializeApp: jest.fn(blockRealFirestore),
    app: jest.fn(),
    credential: { cert: jest.fn() },
    firestore: {
      FieldValue: {
        serverTimestamp: jest.fn(),
        increment: jest.fn()
      }
    }
  };
});

const shopOrderService = require('../src/services/shopOrderService');

describe('supportCancelBeforeHandover driver release', () => {
  beforeEach(() => {
    mockDriverUpdate.mockReset();
    mockBookingUpdate.mockReset();
    mockOrderUpdate.mockReset();
    mockEmit.mockReset();
    mockTo.mockClear();
    mockRunTransaction.mockClear();
    baseTx.update.mockClear();
    shopOrderService.db = null;
  });

  test('frees driver like bookingStateMachine cancelled and emits booking_cancelled', async () => {
    const result = await shopOrderService.supportCancelBeforeHandover({
      orderId: 'order-1',
      operator: 'support-user',
      note: 'customer request'
    });

    expect(result.wrote).toBe(true);
    expect(mockDriverUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        'driver.isAvailable': true,
        'driver.currentBookingId': null
      })
    );
    expect(mockTo).toHaveBeenCalledWith('user:driver-1');
    expect(mockEmit).toHaveBeenCalledWith(
      'booking_cancelled',
      expect.objectContaining({ bookingId: 'booking-1' })
    );
  });

  test('parcel order without linked booking skips driver update', async () => {
    const originalGet = baseTx.get;
    baseTx.get = (ref) => {
      if (ref === refs.order) {
        return Promise.resolve({
          exists: true,
          data: () => ({
            orderStatus: 'ready',
            delivery: { stage: 'searching' },
            linkedBookingId: null,
            customerId: 'customer-1',
            payment: { receivedAmountPaise: 0 },
            items: []
          })
        });
      }
      return originalGet(ref);
    };

    const result = await shopOrderService.supportCancelBeforeHandover({
      orderId: 'order-1',
      operator: 'support-user',
      note: 'no driver'
    });

    expect(result.wrote).toBe(true);
    expect(mockDriverUpdate).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();

    baseTx.get = originalGet;
  });
});
