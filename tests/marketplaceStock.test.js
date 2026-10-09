const mockDocs = new Map();
let mockEventSeq = 0;
const mockSendTemplate = jest.fn(async () => ({ success: true }));

function mockClone(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (typeof value.toMillis === 'function' || value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(mockClone);
  }
  const copy = {};
  Object.keys(value).forEach((key) => {
    copy[key] = mockClone(value[key]);
  });
  return copy;
}

function mockApplyPatch(target, patch) {
  Object.keys(patch).forEach((key) => {
    if (!key.includes('.')) {
      target[key] = patch[key];
      return;
    }
    const parts = key.split('.');
    let cursor = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (!cursor[parts[index]] || typeof cursor[parts[index]] !== 'object') {
        cursor[parts[index]] = {};
      }
      cursor = cursor[parts[index]];
    }
    cursor[parts[parts.length - 1]] = patch[key];
  });
  return target;
}

function mockRef(path) {
  const id = path.split('/').pop();
  const ref = {
    id,
    path,
    collection(name) {
      const prefix = `${path}/${name}/`;
      return {
        doc(subId) {
          const child = subId || `auto-${mockEventSeq += 1}`;
          return mockRef(`${path}/${name}/${child}`);
        },
        async get() {
          const docs = [];
          mockDocs.forEach((data, docPath) => {
            if (!docPath.startsWith(prefix)) {
              return;
            }
            const rest = docPath.slice(prefix.length);
            if (!rest || rest.includes('/')) {
              return;
            }
            docs.push({
              id: rest,
              ref: mockRef(docPath),
              data: () => mockClone(data)
            });
          });
          return { docs, empty: docs.length === 0, size: docs.length };
        }
      };
    },
    async get() {
      const data = mockDocs.get(path);
      return {
        exists: data !== undefined,
        id,
        data: () => (data === undefined ? undefined : mockClone(data))
      };
    }
  };
  ref.firestore = mockDb();
  return ref;
}

function mockDb() {
  return {
    collection(name) {
      return {
        doc(id) {
          return mockRef(`${name}/${id}`);
        }
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data) {
          mockDocs.set(ref.path, mockClone(data));
        },
        update(ref, patch) {
          const current = mockClone(mockDocs.get(ref.path) || {});
          mockDocs.set(ref.path, mockApplyPatch(current, patch));
        },
        delete(ref) {
          mockDocs.delete(ref.path);
        }
      };
      return fn(tx);
    }
  };
}

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => mockDb()
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: (...args) => mockSendTemplate(...args),
  sendToUser: jest.fn(async () => ({ success: true }))
}));

const { deductStock, restoreLines, cancelRestoresStock } = require('../src/services/marketplace/stock');
const shopOrderService = require('../src/services/shopOrderService');
const { NotificationTemplateProcessor } = require('../src/services/notificationTemplates');

const ACTOR = { type: 'shop', id: 'shop-1' };
const OFF = { newStatuses: false, utrBlocksReject: false };
const ON = { newStatuses: true, utrBlocksReject: true };

function orderRef(id) {
  return mockDb().collection('marketplaceOrders').doc(id);
}

function product(id) {
  return mockDocs.get(`products/${id}`);
}

function order(id) {
  return mockDocs.get(`marketplaceOrders/${id}`);
}

function eventPaths(id) {
  const prefix = `marketplaceOrders/${id}/events/`;
  const found = [];
  mockDocs.forEach((data, path) => {
    if (path.startsWith(prefix) && path.split('/').length === 4) {
      found.push(data);
    }
  });
  return found;
}

function refunds(id) {
  const prefix = `marketplaceOrders/${id}/refunds/`;
  const found = [];
  mockDocs.forEach((data, path) => {
    if (path.startsWith(prefix) && path.split('/').length === 4) {
      found.push(data);
    }
  });
  return found;
}

function templateCalls(type) {
  return mockSendTemplate.mock.calls.filter((call) => call[2] === type);
}

function seedProduct(id, stock, extra = {}) {
  mockDocs.set(`products/${id}`, {
    shopId: 'shop-1',
    isActive: true,
    name: 'Rice',
    price: 10,
    stock,
    hasVariants: false,
    variants: [],
    ...extra
  });
}

function seedOrder(id, data) {
  mockDocs.set(`marketplaceOrders/${id}`, {
    customerId: 'cust-1',
    shopId: 'shop-1',
    displayId: 12,
    shopSnapshot: { name: 'Shop' },
    itemsTotal: 20,
    expectedAmount: 20,
    expectedAmountPaise: 2000,
    payment: { status: 'confirmed', amount: 20, receivedAmount: 20, receivedAmountPaise: 2000 },
    ...data
  });
}

beforeEach(() => {
  mockDocs.clear();
  mockEventSeq = 0;
  mockSendTemplate.mockClear();
});

describe('deductStock', () => {
  test('takes min(qty, stock) and never goes below 0', async () => {
    seedProduct('rice', 1);
    const db = mockDb();
    const result = await db.runTransaction((tx) => deductStock(tx, db, {
      orderRef: orderRef('order-1'),
      actor: ACTOR,
      customerId: 'cust-1',
      items: [
        { productId: 'rice', qty: 2, price: 10 },
        { productId: 'missing', qty: 1, price: 10 }
      ]
    }));
    expect(result.items[0]).toMatchObject({ id: 'line0', stockDeducted: 1 });
    expect(result.items[1]).toMatchObject({ id: 'line1', stockDeducted: 0 });
    expect(result.stockShort).toBe(true);
    expect(result.orderStockDeducted).toBe(true);
    expect(product('rice').stock).toBe(0);
    expect(mockDocs.has('products/missing')).toBe(false);
  });

  test('two lines of one variant share one remaining count', async () => {
    seedProduct('rice', 0, {
      hasVariants: true,
      variants: [{ id: 'v1', stock: 3, priceOverride: 8 }]
    });
    const db = mockDb();
    const result = await db.runTransaction((tx) => deductStock(tx, db, {
      orderRef: orderRef('order-1'),
      actor: ACTOR,
      customerId: 'cust-1',
      items: [
        { id: 'line0', productId: 'rice', variantId: 'v1', qty: 2, price: 8 },
        { id: 'line1', productId: 'rice', variantId: 'v1', qty: 2, price: 8 }
      ]
    }));
    expect(result.items.map((line) => line.stockDeducted)).toEqual([2, 1]);
    expect(product('rice').variants[0].stock).toBe(0);
    expect(product('rice').stock).toBe(0);
  });

  test('inactive product still deducts', async () => {
    seedProduct('rice', 4, { isActive: false });
    const db = mockDb();
    const result = await db.runTransaction((tx) => deductStock(tx, db, {
      orderRef: orderRef('order-1'),
      actor: ACTOR,
      customerId: 'cust-1',
      items: [{ productId: 'rice', qty: 1, price: 10 }]
    }));
    expect(result.items[0].stockDeducted).toBe(1);
    expect(result.stockShort).toBe(false);
    expect(product('rice').stock).toBe(3);
  });

  test('replay with every line short writes nothing', async () => {
    seedProduct('rice', 5);
    const db = mockDb();
    const items = [{ id: 'line0', productId: 'rice', qty: 3, price: 10, stockDeducted: 0 }];
    const result = await db.runTransaction((tx) => deductStock(tx, db, {
      orderRef: orderRef('order-1'),
      actor: ACTOR,
      customerId: 'cust-1',
      items
    }));
    expect(result.wrote).toBe(false);
    expect(result.orderStockDeducted).toBe(false);
    expect(product('rice').stock).toBe(5);
    expect(eventPaths('order-1')).toHaveLength(0);
  });

  test('last unit is taken by the first confirm', async () => {
    seedProduct('rice', 1);
    const db = mockDb();
    const first = await db.runTransaction((tx) => deductStock(tx, db, {
      orderRef: orderRef('order-a'),
      actor: ACTOR,
      customerId: 'cust-1',
      items: [{ id: 'line0', productId: 'rice', qty: 1, price: 10 }]
    }));
    const second = await db.runTransaction((tx) => deductStock(tx, db, {
      orderRef: orderRef('order-b'),
      actor: ACTOR,
      customerId: 'cust-1',
      items: [{ id: 'line0', productId: 'rice', qty: 1, price: 10 }]
    }));
    expect(first.items[0].stockDeducted).toBe(1);
    expect(second.items[0].stockDeducted).toBe(0);
    expect(second.stockShort).toBe(true);
    expect(product('rice').stock).toBe(0);
  });

  test('legacy confirm deducts before preparing', async () => {
    seedProduct('rice', 4);
    seedOrder('order-1', {
      orderStatus: 'awaiting_payment',
      itemsTotal: 20,
      payment: { status: 'pending', amount: 20 },
      items: [{ id: 'line0', productId: 'rice', name: 'Rice', qty: 2, price: 10 }]
    });
    mockDocs.set('users/cust-1', { customer: { marketplace: { unpaidCount: 1 } } });
    const result = await shopOrderService.confirmPayment('shop-1', 'order-1', {}, OFF);
    expect(result.order.orderStatus).toBe('preparing');
    expect(result.order.stockShort).toBe(false);
    expect(result.order.items[0].stockDeducted).toBe(2);
    expect(product('rice').stock).toBe(2);
    expect(eventPaths('order-1').some((event) => event.type === 'stock_deducted')).toBe(true);
  });
});

describe('restoreLines', () => {
  test('puts back only stockDeducted and a second restore writes nothing', async () => {
    seedProduct('rice', 1);
    const db = mockDb();
    const items = [{ id: 'line0', productId: 'rice', qty: 2, price: 10, stockDeducted: 2 }];
    const first = await db.runTransaction((tx) => restoreLines(tx, db, {
      orderRef: orderRef('order-1'),
      actor: ACTOR,
      customerId: 'cust-1',
      items
    }));
    expect(first.items[0].stockRestored).toBe(true);
    expect(product('rice').stock).toBe(3);
    const second = await db.runTransaction((tx) => restoreLines(tx, db, {
      orderRef: orderRef('order-1'),
      actor: ACTOR,
      customerId: 'cust-1',
      items: first.items
    }));
    expect(second.wrote).toBe(false);
    expect(product('rice').stock).toBe(3);
  });

  test('missing product skips the stock write and marks missing', async () => {
    const db = mockDb();
    const result = await db.runTransaction((tx) => restoreLines(tx, db, {
      orderRef: orderRef('order-1'),
      actor: ACTOR,
      customerId: 'cust-1',
      items: [{ id: 'line0', productId: 'gone', qty: 1, price: 10, stockDeducted: 1 }]
    }));
    expect(result.items[0].stockRestored).toBe(true);
    expect(mockDocs.has('products/gone')).toBe(false);
    const events = eventPaths('order-1');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stock_restored');
    expect(events[0].data.lines[0]).toMatchObject({ units: 0, missing: true });
  });
});

describe('markUnavailable', () => {
  test('all lines unavailable returns 409 and writes nothing', async () => {
    seedProduct('rice', 4);
    seedOrder('order-1', {
      orderStatus: 'preparing',
      items: [
        { id: 'line0', productId: 'rice', qty: 1, price: 10, stockDeducted: 1 },
        { id: 'line1', productId: 'rice', qty: 1, price: 10, stockDeducted: 1 }
      ]
    });
    await expect(shopOrderService.markUnavailable('shop-1', 'order-1', {
      itemIds: ['line0', 'line1']
    })).rejects.toMatchObject({ status: 409, code: 'ALL_ITEMS_UNAVAILABLE', message: 'use cancel' });
    expect(product('rice').stock).toBe(4);
    expect(refunds('order-1')).toHaveLength(0);
    expect(order('order-1').items[0].unavailable).toBeUndefined();
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  test('one line restores, keeps payment confirmed, and sends one refund push', async () => {
    seedProduct('rice', 2);
    seedOrder('order-1', {
      orderStatus: 'preparing',
      items: [
        { id: 'line0', productId: 'rice', qty: 1, price: 10, stockDeducted: 1 },
        { id: 'line1', productId: 'rice', qty: 1, price: 10, stockDeducted: 1 }
      ]
    });
    const result = await shopOrderService.markUnavailable('shop-1', 'order-1', { itemIds: ['line0'] });
    expect(result.order.orderStatus).toBe('preparing');
    expect(result.order.payment.status).toBe('confirmed');
    expect(result.order.items[0].unavailable).toBe(true);
    expect(result.order.items[0].stockRestored).toBe(true);
    expect(result.order.items[1].unavailable).toBeUndefined();
    expect(product('rice').stock).toBe(3);
    expect(refunds('order-1').map((refund) => refund.reason)).toEqual(['stock_short']);
    expect(refunds('order-1')[0].amount).toBe(10);
    expect(templateCalls('ITEMS_UNAVAILABLE')).toHaveLength(1);
    expect(templateCalls('REFUND_INITIATED')).toHaveLength(1);
    const pushIds = {
      displayId: '#00012',
      orderId: 'order-1',
      shopName: 'Shop'
    };
    expect(templateCalls('ITEMS_UNAVAILABLE')[0][3]).toEqual(pushIds);
    expect(templateCalls('REFUND_INITIATED')[0][3]).toEqual(pushIds);
    const itemsData = NotificationTemplateProcessor.process(
      NotificationTemplateProcessor.getTemplate('MARKETPLACE', 'ITEMS_UNAVAILABLE'),
      templateCalls('ITEMS_UNAVAILABLE')[0][3]
    ).data;
    const refundData = NotificationTemplateProcessor.process(
      NotificationTemplateProcessor.getTemplate('MARKETPLACE', 'REFUND_INITIATED'),
      templateCalls('REFUND_INITIATED')[0][3]
    ).data;
    expect(Object.keys(itemsData)).toEqual(['type', 'orderId', 'displayId', 'shopName', 'action']);
    expect(itemsData).toEqual({
      type: 'items_unavailable',
      orderId: 'order-1',
      displayId: '#00012',
      shopName: 'Shop',
      action: 'view_order'
    });
    expect(Object.keys(refundData)).toEqual(['type', 'orderId', 'displayId', 'shopName', 'action']);
    expect(refundData).toEqual({
      type: 'refund_initiated',
      orderId: 'order-1',
      displayId: '#00012',
      shopName: 'Shop',
      action: 'view_order'
    });

    await shopOrderService.markUnavailable('shop-1', 'order-1', { itemIds: ['line0'] });
    expect(templateCalls('REFUND_INITIATED')).toHaveLength(1);
    expect(product('rice').stock).toBe(3);
    expect(refunds('order-1')).toHaveLength(1);
  });

  test('a refund over the amount received writes nothing', async () => {
    seedProduct('rice', 2);
    seedOrder('order-1', {
      orderStatus: 'preparing',
      payment: { status: 'confirmed', amount: 100, receivedAmount: 50, receivedAmountPaise: 5000 },
      items: [
        { id: 'line0', productId: 'rice', qty: 1, price: 90, stockDeducted: 1 },
        { id: 'line1', productId: 'rice', qty: 1, price: 10, stockDeducted: 1 }
      ]
    });
    await expect(shopOrderService.markUnavailable('shop-1', 'order-1', {
      itemIds: ['line0']
    })).rejects.toMatchObject({ status: 409, code: 'REFUND_CAP' });
    expect(product('rice').stock).toBe(2);
    expect(refunds('order-1')).toHaveLength(0);
  });
});

describe('shop cancel restore', () => {
  test('ready + assigned cancel restores (both modes)', async () => {
    expect(cancelRestoresStock({
      orderStatus: 'ready',
      delivery: { stage: 'assigned' }
    })).toBe(true);

    seedProduct('rice', 1);
    seedOrder('order-off', {
      orderStatus: 'ready',
      delivery: { stage: 'assigned' },
      items: [{ id: 'line0', productId: 'rice', qty: 2, price: 10, stockDeducted: 2 }]
    });
    const off = await shopOrderService.cancelOrder('shop-1', 'order-off', { reason: 'closed' }, OFF);
    expect(off.order.orderStatus).toBe('cancelled');
    expect(off.order.cancellation.reason).toBe('shop_cancelled');
    expect(off.order.cancellation.shopReason).toBe('closed');
    expect(order('order-off').closedReason).toBe('shop_cancelled');
    expect(order('order-off').cancellation.shopReason).toBe('closed');
    expect(order('order-off').items[0].stockRestored).toBe(true);
    expect(product('rice').stock).toBe(3);
    expect(templateCalls('REFUND_INITIATED')).toHaveLength(1);
    expect(templateCalls('REFUND_INITIATED')[0][3].reasonLine).toBe(' Reason: closed');

    seedProduct('rice', 1);
    seedOrder('order-on-assigned', {
      orderStatus: 'ready',
      delivery: { stage: 'assigned' },
      items: [{ id: 'line0', productId: 'rice', qty: 2, price: 10, stockDeducted: 2 }]
    });
    await expect(shopOrderService.cancelOrder('shop-1', 'order-on-assigned', { reason: 'closed' }, ON))
      .rejects.toMatchObject({ status: 409, code: 'CANCEL_NOT_ALLOWED' });
    expect(product('rice').stock).toBe(1);
    expect(order('order-on-assigned').orderStatus).toBe('ready');

    seedOrder('order-on-searching', {
      orderStatus: 'ready',
      delivery: { stage: 'searching' },
      items: [{ id: 'line0', productId: 'rice', qty: 2, price: 10, stockDeducted: 2 }]
    });
    await shopOrderService.cancelOrder('shop-1', 'order-on-searching', { reason: 'closed' }, ON);
    expect(order('order-on-searching').items[0].stockRestored).toBe(true);
    expect(product('rice').stock).toBe(3);
  });

  test('ready + picked_up cancel does not restore', async () => {
    expect(cancelRestoresStock({
      orderStatus: 'ready',
      delivery: { stage: 'picked_up' }
    })).toBe(false);
    seedProduct('rice', 1);
    seedOrder('order-off', {
      orderStatus: 'ready',
      delivery: { stage: 'picked_up' },
      items: [{ id: 'line0', productId: 'rice', qty: 2, price: 10, stockDeducted: 2 }]
    });
    await shopOrderService.cancelOrder('shop-1', 'order-off', { reason: 'left' }, OFF);
    expect(order('order-off').orderStatus).toBe('cancelled');
    expect(order('order-off').items[0].stockRestored).toBeUndefined();
    expect(product('rice').stock).toBe(1);

    seedOrder('order-on', {
      orderStatus: 'ready',
      delivery: { stage: 'picked_up' },
      items: [{ id: 'line0', productId: 'rice', qty: 2, price: 10, stockDeducted: 2 }]
    });
    await expect(shopOrderService.cancelOrder('shop-1', 'order-on', { reason: 'left' }, ON))
      .rejects.toMatchObject({ code: 'CANCEL_NOT_ALLOWED' });
    expect(product('rice').stock).toBe(1);
  });

  test('cancel refund is the remainder after existing refunds', async () => {
    seedProduct('rice', 0);
    seedOrder('order-1', {
      orderStatus: 'preparing',
      payment: { status: 'confirmed', amount: 30, receivedAmount: 30, receivedAmountPaise: 3000 },
      itemsTotal: 30,
      items: [
        { id: 'line0', productId: 'rice', qty: 1, price: 10, stockDeducted: 1, stockRestored: true, unavailable: true },
        { id: 'line1', productId: 'rice', qty: 2, price: 10, stockDeducted: 2 }
      ]
    });
    mockDocs.set('marketplaceOrders/order-1/refunds/existing', {
      reason: 'stock_short',
      amount: 10,
      status: 'upi_needed'
    });
    mockSendTemplate.mockClear();
    await shopOrderService.cancelOrder('shop-1', 'order-1', { reason: 'closed' }, OFF);
    const created = refunds('order-1').find((refund) => refund.reason === 'shop_cancel');
    expect(created.amount).toBe(20);
    expect(order('order-1').payment.status).toBe('refund_pending');
    expect(order('order-1').closedReason).toBe('shop_cancelled');
    expect(order('order-1').cancellation.reason).toBe('shop_cancelled');
    expect(order('order-1').cancellation.shopReason).toBe('closed');
    expect(product('rice').stock).toBe(2);
    expect(templateCalls('REFUND_INITIATED')).toHaveLength(1);
  });
});

describe('presentOrder stock', () => {
  test('stockShortOpen is computed and stockShort stays the stored flag', async () => {
    const shown = await shopOrderService.presentOrder('order-1', {
      shopId: 'shop-1',
      itemsTotal: 30,
      stockShort: true,
      items: [
        { qty: 2, price: 10, stockDeducted: 1 },
        { qty: 1, price: 10, stockDeducted: 0, unavailable: true }
      ],
      payment: { status: 'confirmed', amount: 30, customerUpiId: 'secret@upi' }
    }, []);
    expect(shown.stockShort).toBe(true);
    expect(shown.stockShortOpen).toBe(true);

    const waiting = await shopOrderService.presentOrder('order-2', {
      shopId: 'shop-1',
      itemsTotal: 10,
      items: [{ qty: 1, price: 10 }],
      payment: { status: 'pending', amount: 10 }
    }, []);
    expect(waiting.stockShort).toBe(false);
    expect(waiting.stockShortOpen).toBe(false);
  });
});
