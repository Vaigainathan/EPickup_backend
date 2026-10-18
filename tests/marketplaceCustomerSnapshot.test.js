jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true }))
}));

const mockRunTransaction = jest.fn();

const mockDb = {
  runTransaction: (...args) => mockRunTransaction(...args),
  collection: jest.fn()
};

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => mockDb)
}));

jest.mock('firebase-admin', () => {
  const blockRealFirestore = () => {
    throw new Error('REAL FIRESTORE IN TEST');
  };
  return {
    apps: [],
    initializeApp: jest.fn(blockRealFirestore),
    app: jest.fn(blockRealFirestore),
    credential: { cert: jest.fn() },
    firestore: blockRealFirestore
  };
});

const { wrapStrictTransaction } = require('./helpers/strictFirestoreTransaction');
const {
  buildCustomerSnapshot,
  resolveCustomerSnapshotName,
  resolveCustomerSnapshotPayerUpiName,
  createMarketplaceOrder
} = require('../src/services/marketplace/createCustomerOrder');
const { presentCustomerOrder } = require('../src/services/marketplace/customerOrderView');
const shopOrderService = require('../src/services/shopOrderService');

describe('marketplace customerSnapshot', () => {
  beforeEach(() => {
    mockRunTransaction.mockReset();
    mockDb.collection.mockReset();
  });

  test('resolveCustomerSnapshotName uses name then displayName then Customer with max 60', () => {
    expect(resolveCustomerSnapshotName({ name: '  Ada  ' })).toBe('Ada');
    expect(resolveCustomerSnapshotName({ displayName: 'Display' })).toBe('Display');
    expect(resolveCustomerSnapshotName({})).toBe('Customer');
    const long = 'x'.repeat(80);
    expect(resolveCustomerSnapshotName({ name: long }).length).toBe(60);
  });

  test('resolveCustomerSnapshotPayerUpiName trims and caps at 100', () => {
    expect(resolveCustomerSnapshotPayerUpiName({ payerUpiName: '  Pay  ' })).toBe('Pay');
    expect(resolveCustomerSnapshotPayerUpiName({ payerUpiName: '   ' })).toBeNull();
    expect(resolveCustomerSnapshotPayerUpiName({})).toBeNull();
    const long = 'y'.repeat(120);
    expect(resolveCustomerSnapshotPayerUpiName({ payerUpiName: long }).length).toBe(100);
  });

  test('createMarketplaceOrder idempotent replay returns 200 without re-notify', async () => {
    const notificationService = require('../src/services/notificationService');
    notificationService.sendTemplateNotification.mockClear();
    const existingOrder = {
      shopId: 'shop-1',
      orderStatus: 'awaiting_payment',
      payment: { status: 'pending' }
    };

    mockDb.collection.mockImplementation((name) => ({
      doc: (id) => ({ path: `${name}/${id}`, id })
    }));

    mockRunTransaction.mockImplementation(async (fn) => {
      const tx = wrapStrictTransaction({
        async get(ref) {
          if (ref.path && ref.path.startsWith('marketplaceOrders/')) {
            return { exists: true, data: () => existingOrder };
          }
          return { exists: false, data: () => ({}) };
        },
        set() {},
        update() {}
      });
      return fn(tx);
    });

    const result = await createMarketplaceOrder({
      customerId: 'cust-1',
      idempotencyKey: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      body: {
        shopId: 'shop-1',
        addressId: 'addr-1',
        items: [{ productId: 'p1', qty: 1, price: 10 }]
      }
    });
    expect(result.status).toBe(200);
    expect(notificationService.sendTemplateNotification).not.toHaveBeenCalled();
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
  });

  test('order tx set payload includes customerSnapshot under strict transaction', async () => {
    const orderWrites = [];
    const innerTx = {
      async get() {
        return { exists: false, data: () => ({}) };
      },
      set(ref, data) {
        if (ref.path === 'marketplaceOrders/order-tx') {
          orderWrites.push(data);
        }
      },
      update() {}
    };
    const tx = wrapStrictTransaction(innerTx);
    const customerData = { name: 'Tx User' };
    const marketplaceProfile = { payerUpiName: 'Tx Pay' };
    const orderData = {
      shopId: 'shop-1',
      customerSnapshot: buildCustomerSnapshot(customerData, marketplaceProfile)
    };
    await tx.set({ path: 'marketplaceOrders/order-tx' }, orderData);
    expect(orderWrites[0].customerSnapshot).toEqual({
      name: 'Tx User',
      payerUpiName: 'Tx Pay'
    });
  });

  test('buildCustomerSnapshot shape', () => {
    expect(buildCustomerSnapshot(
      { name: 'Sam' },
      { payerUpiName: 'Sam Pay' }
    )).toEqual({
      name: 'Sam',
      payerUpiName: 'Sam Pay'
    });
  });

  test('presentCustomerOrder does not expose customerSnapshot', () => {
    const view = presentCustomerOrder({
      id: 'order-1',
      shopId: 'shop-1',
      customerSnapshot: { name: 'Hidden', payerUpiName: 'Hidden Pay' },
      orderStatus: 'awaiting_payment',
      items: [],
      payment: { status: 'pending' }
    });
    expect(view).not.toHaveProperty('customerSnapshot');
    expect(JSON.stringify(view)).not.toContain('Hidden Pay');
  });

  test('presentOrder returns snapshot fields and null for legacy docs', async () => {
    const readHandover = jest.spyOn(shopOrderService, 'readHandoverOtp').mockResolvedValue(null);
    const withSnapshot = await shopOrderService.presentOrder('o1', {
      shopId: 'shop-1',
      orderStatus: 'preparing',
      items: [],
      itemsTotal: 10,
      payment: { status: 'confirmed', amount: 10 },
      customerSnapshot: { name: 'Buyer', payerUpiName: 'Buyer UPI' },
      closedReason: 'shop_cancelled',
      hasOpenHelp: false
    }, []);
    expect(withSnapshot.customerName).toBe('Buyer');
    expect(withSnapshot.payerUpiName).toBe('Buyer UPI');
    expect(withSnapshot.closedReason).toBe('shop_cancelled');
    expect(withSnapshot.refunds[0]).toBeUndefined();

    const legacy = await shopOrderService.presentOrder('o2', {
      shopId: 'shop-1',
      orderStatus: 'preparing',
      items: [],
      itemsTotal: 10,
      payment: { status: 'confirmed', amount: 10 },
      hasOpenHelp: false
    }, []);
    expect(legacy.customerName).toBeNull();
    expect(legacy.payerUpiName).toBeNull();
    expect(legacy.closedReason).toBeNull();
    readHandover.mockRestore();
  });

  test('presentOrder nested refunds include displayId and customerName from order data', async () => {
    const readHandover = jest.spyOn(shopOrderService, 'readHandoverOtp').mockResolvedValue(null);
    const order = await shopOrderService.presentOrder('o3', {
      shopId: 'shop-1',
      displayId: 'ORD-42',
      orderStatus: 'cancelled',
      items: [],
      itemsTotal: 10,
      payment: { status: 'refund_pending', amount: 10 },
      customerSnapshot: { name: 'Refund Buyer', payerUpiName: null },
      hasOpenHelp: false
    }, [{
      id: 'ref-1',
      status: 'due',
      amount: 10
    }]);
    expect(order.refunds).toHaveLength(1);
    expect(order.refunds[0].displayId).toBe('ORD-42');
    expect(order.refunds[0].customerName).toBe('Refund Buyer');
    readHandover.mockRestore();
  });
});
