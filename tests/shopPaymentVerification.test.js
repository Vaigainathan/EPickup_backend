jest.mock('../src/middleware/auth', () => ({
  authMiddleware(req, res, next) {
    req.user = { uid: 'shop-1', userType: 'shop' };
    next();
  },
  requireRole() {
    return function roleMiddleware(req, res, next) {
      next();
    };
  }
}));

const express = require('express');
const request = require('supertest');

const mockDocs = new Map();
let mockEventSeq = 0;
const mockGetEnforcement = jest.fn(async () => ({ newStatuses: false, utrBlocksReject: false }));
const mockSendTemplate = jest.fn(async () => ({ success: true }));
const mockSendToUser = jest.fn(async () => ({ success: true }));

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
      return {
        doc(subId) {
          const child = subId || `auto-${mockEventSeq += 1}`;
          return mockRef(`${path}/${name}/${child}`);
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

jest.mock('../src/services/marketplace/orderStateMachine', () => {
  const actual = jest.requireActual('../src/services/marketplace/orderStateMachine');
  return {
    ...actual,
    getMarketplaceEnforcement: (...args) => mockGetEnforcement(...args)
  };
});

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: (...args) => mockSendTemplate(...args),
  sendToUser: (...args) => mockSendToUser(...args)
}));

const { isPastPaymentGrace } = require('../src/services/marketplace/shopPaymentVerification');
const { presentCustomerOrder } = require('../src/services/marketplace/customerOrderView');
const shopOrderService = require('../src/services/shopOrderService');
const shopOrderRoutes = require('../src/routes/shopOrders');

const UTR = '123456789012';
const SHOP_UTR = '999999999999';
const ON = { newStatuses: true, utrBlocksReject: true };
const MINUTE = 60 * 1000;

function stamp(ms) {
  return { toMillis: () => ms, toDate: () => new Date(ms) };
}

function seedOrder(id, overrides = {}) {
  const payment = overrides.payment || { status: 'pending', amount: 1540 };
  mockDocs.set(`marketplaceOrders/${id}`, {
    customerId: 'cust-1',
    shopId: 'shop-1',
    displayId: 62191,
    orderStatus: 'awaiting_payment',
    itemsTotal: 1540,
    expectedAmount: 1539.99,
    items: [{ name: 'Statue', qty: 1, price: 1540 }],
    handoverOtp: '654321',
    private: { handover: { otp: '654321' } },
    window: {
      start: stamp(Date.now() - (20 * MINUTE)),
      end: stamp(Date.now() + (10 * MINUTE))
    },
    ...overrides,
    payment
  });
}

function seedBasics(unpaidCount = 1) {
  mockDocs.set('users/shop-1', { userType: 'shop' });
  mockDocs.set('users/cust-1', {
    customer: { marketplace: { unpaidCount, stats: { utrCorrections: 0 } } }
  });
  mockDocs.set('shops/shop-1', { marketplaceStats: { reviewsOpened: 0, rejections: 0 } });
  mockDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-1' });
}

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/shop/orders', shopOrderRoutes);
  return server;
}

function post(path, body) {
  const req = request(app()).post(`/api/shop/orders/${path}`);
  return body === undefined ? req : req.send(body);
}

beforeEach(() => {
  mockDocs.clear();
  mockEventSeq = 0;
  mockGetEnforcement.mockReset();
  mockGetEnforcement.mockResolvedValue({ newStatuses: false, utrBlocksReject: false });
  mockSendTemplate.mockClear();
  mockSendToUser.mockClear();
  seedBasics();
});

describe('shop payment verification', () => {
  test('the grace boundary is the instant after window end plus grace', () => {
    expect(isPastPaymentGrace(0, 5 * MINUTE, 5 * MINUTE)).toBe(false);
    expect(isPastPaymentGrace(0, (5 * MINUTE) + 1, 5 * MINUTE)).toBe(true);
  });

  test('switches off: an empty confirm still prepares and releases the matching lock', async () => {
    seedOrder('order-1');
    const response = await post('order-1/confirm-payment', {});
    expect(response.status).toBe(200);
    expect(response.body.data.order.orderStatus).toBe('preparing');
    expect(response.body.data.order.payment.status).toBe('confirmed');
    expect(mockDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
    expect(mockDocs.get('users/cust-1').customer.marketplace.unpaidCount).toBe(0);
    expect([...mockDocs.keys()].some((path) => path.startsWith('utrRegistry/'))).toBe(false);
  });

  test('switches off: reject still cancels an order that has a UTR', async () => {
    seedOrder('order-1', { payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 } });
    const response = await post('order-1/reject');
    expect(response.status).toBe(200);
    expect(response.body.data.order.orderStatus).toBe('cancelled');
    expect(mockDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
  });

  test('an enforcement override does not read appSettings', async () => {
    seedOrder('order-1', { payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 } });
    mockDocs.set(`utrRegistry/${UTR}`, { orderId: 'order-1', customerId: 'cust-1', kind: 'customer' });
    mockGetEnforcement.mockClear();
    const result = await shopOrderService.confirmPayment('shop-1', 'order-1', {
      utrLast4: '9012',
      withinWindowAttested: true
    }, ON);
    expect(mockGetEnforcement).not.toHaveBeenCalled();
    expect(result.order.payment.officialUtr).toBe(UTR);
    expect(mockDocs.get(`utrRegistry/${UTR}`).kind).toBe('customer');
  });

  test('last-4 match keeps kind customer and a shop UTR is kind shop', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOrder('order-1', { payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 } });
    mockDocs.set(`utrRegistry/${UTR}`, { orderId: 'order-1', customerId: 'cust-1', kind: 'customer' });

    const matched = await post('order-1/confirm-payment', {
      utrLast4: '9012',
      withinWindowAttested: true
    });
    expect(matched.status).toBe(200);
    expect(matched.body.data.order.orderStatus).toBe('preparing');
    expect(matched.body.data.order.payment.officialUtr).toBe(UTR);
    expect(mockDocs.get(`utrRegistry/${UTR}`).kind).toBe('customer');
    expect(mockDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'cust-1',
      'MARKETPLACE',
      'PAYMENT_CONFIRMED',
      expect.objectContaining({ displayId: '#62191', orderId: 'order-1' })
    );

    const replay = await post('order-1/confirm-payment', { utrLast4: '9012', withinWindowAttested: true });
    expect(replay.status).toBe(200);
    expect(replay.body.message).toBe('Already processed');

    seedOrder('order-shop', { payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 } });
    mockDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-shop' });
    const missingFull = await post('order-shop/confirm-payment', { utrLast4: '0000', withinWindowAttested: true });
    expect(missingFull.status).toBe(400);
    expect(missingFull.body.error.code).toBe('FULL_UTR_REQUIRED');

    const corrected = await post('order-shop/confirm-payment', {
      utrLast4: '0000',
      fullUtr: SHOP_UTR,
      withinWindowAttested: true
    });
    expect(corrected.status).toBe(200);
    expect(mockDocs.get(`utrRegistry/${SHOP_UTR}`)).toMatchObject({
      orderId: 'order-shop',
      kind: 'shop'
    });
    expect(mockDocs.get('users/cust-1').customer.marketplace.stats.utrCorrections).toBe(1);
    const events = [...mockDocs.keys()]
      .filter((path) => path.startsWith('marketplaceOrders/order-shop/events/'))
      .map((path) => mockDocs.get(path).type);
    expect(events).toEqual(expect.arrayContaining(['shop_confirm', 'utr_corrected']));
    expect(mockSendToUser).toHaveBeenCalled();
    const sent = mockSendToUser.mock.calls[0][1];
    expect(sent.body).toBe(`Payment confirmed with UTR ${SHOP_UTR}.`);
    expect(JSON.stringify(sent.data)).not.toContain(SHOP_UTR);
  });

  test('another order owns the UTR and a missing customer UTR needs the full value', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOrder('order-used', { payment: { status: 'pending', amount: 1540 } });
    mockDocs.set(`utrRegistry/${SHOP_UTR}`, { orderId: 'other-order', customerId: 'someone', kind: 'shop' });
    const used = await post('order-used/confirm-payment', {
      fullUtr: SHOP_UTR,
      withinWindowAttested: true
    });
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe('UTR_USED');
    expect(mockDocs.get('marketplaceOrders/order-used').orderStatus).toBe('awaiting_payment');

    seedOrder('order-none', { payment: { status: 'pending', amount: 1540 } });
    const none = await post('order-none/confirm-payment', { fullUtr: UTR, withinWindowAttested: true });
    expect(none.status).toBe(200);
    expect(mockDocs.get(`utrRegistry/${UTR}`).kind).toBe('shop');
    expect([...mockDocs.keys()].some((path) => path.includes('order-none/events/') && mockDocs.get(path).type === 'utr_corrected')).toBe(false);
  });

  test('a late unattested confirm records payment.late and an attested one does not', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    const lateWindow = {
      start: stamp(Date.now() - (30 * MINUTE)),
      end: stamp(Date.now() - (6 * MINUTE))
    };
    seedOrder('order-late', {
      orderStatus: 'payment_unconfirmed',
      window: lateWindow,
      payment: { status: 'expired', amount: 1540 }
    });
    mockDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-late' });
    const late = await post('order-late/confirm-payment', { fullUtr: UTR, withinWindowAttested: false });
    expect(late.status).toBe(200);
    expect(late.body.data.order.orderStatus).toBe('preparing');
    expect(mockDocs.get('marketplaceOrders/order-late').payment.late).toMatchObject({
      onCancelledOrder: false,
      fulfilled: true,
      confirmedByShopUid: 'shop-1'
    });
    expect(mockDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
    expect(mockDocs.get('users/cust-1').customer.marketplace.unpaidCount).toBe(1);
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'cust-1',
      'MARKETPLACE',
      'PAYMENT_LATE_ACCEPTED',
      expect.any(Object)
    );

    seedOrder('order-attested', {
      window: lateWindow,
      payment: { status: 'pending', amount: 1540 }
    });
    mockDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-attested' });
    const attested = await post('order-attested/confirm-payment', {
      fullUtr: '111111111111',
      withinWindowAttested: true
    });
    expect(attested.status).toBe(200);
    expect(mockDocs.get('marketplaceOrders/order-attested').payment.late).toBeUndefined();
  });

  test('short, receivedAmount, and amount-differs are unavailable', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOrder('order-short', { payment: { status: 'short', amount: 1540 } });
    const short = await post('order-short/confirm-payment', { fullUtr: UTR, withinWindowAttested: true });
    expect(short.status).toBe(409);
    expect(short.body.error.code).toBe('AMOUNT_DIFFERS_UNAVAILABLE');

    seedOrder('order-amt', { payment: { status: 'pending', amount: 1540 } });
    const amount = await post('order-amt/confirm-payment', {
      fullUtr: UTR,
      withinWindowAttested: true,
      receivedAmount: 10
    });
    expect(amount.status).toBe(409);
    expect(amount.body.error.code).toBe('AMOUNT_DIFFERS_UNAVAILABLE');

    const route = await post('order-amt/amount-differs', { receivedAmount: 10 });
    expect(route.status).toBe(409);
    expect(route.body.error.code).toBe('AMOUNT_DIFFERS_UNAVAILABLE');
  });

  test('not found with a UTR opens review and without a UTR is refused', async () => {
    seedOrder('order-1', { payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 } });
    const opened = await post('order-1/payment-not-found', {});
    expect(opened.status).toBe(200);
    expect(opened.body.data.order.orderStatus).toBe('payment_review');
    expect(opened.body.data.order.payment.status).toBe('under_review');
    expect(mockDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
    expect(mockDocs.get('users/cust-1').customer.marketplace.unpaidCount).toBe(0);
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsOpened).toBe(1);
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'cust-1',
      'MARKETPLACE',
      'PAYMENT_UNDER_REVIEW',
      expect.any(Object)
    );

    seedOrder('order-bare', { payment: { status: 'pending', amount: 1540 } });
    const bare = await post('order-bare/payment-not-found', {});
    expect(bare.status).toBe(409);
    expect(bare.body.error.code).toBe('NOT_FOUND_REQUIRES_UTR');
  });

  test('reject with a UTR is blocked only when utrBlocksReject is on', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOrder('order-1', { payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 } });
    const blocked = await post('order-1/reject');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('UTR_PRESENT');

    seedOrder('order-open', { payment: { status: 'pending', amount: 1540 } });
    mockDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-open' });
    const rejected = await post('order-open/reject');
    expect(rejected.status).toBe(200);
    expect(mockDocs.get('marketplaceOrders/order-open').closedReason).toBe('shop_rejected');
    expect(mockDocs.get('shops/shop-1').marketplaceStats.rejections).toBe(1);
    expect(mockDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
  });

  test('paid-check registers the UTR, writes the expected-amount stub, and can stay closed', async () => {
    seedOrder('order-1', {
      orderStatus: 'cancelled',
      payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 },
      cancellation: { reason: 'customer_cancel', paidCheck: 'pending' }
    });
    mockDocs.set(`utrRegistry/${UTR}`, { orderId: 'order-1', customerId: 'cust-1', kind: 'customer' });
    const received = await post('order-1/paid-check', { received: true, utrLast4: '9012' });
    expect(received.status).toBe(200);
    expect(received.body.data.order.orderStatus).toBe('cancelled');
    expect(received.body.data.order.cancellation.paidCheck).toBe('received');
    expect(received.body.data.order.payment.status).toBe('refund_pending');
    const refunds = mockDocs.get('marketplaceOrders/order-1').refunds;
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      reason: 'customer_cancel',
      amount: 1539.99,
      status: 'upi_needed'
    });
    expect(mockDocs.get(`utrRegistry/${UTR}`).kind).toBe('customer');
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'cust-1',
      'MARKETPLACE',
      'REFUND_INITIATED',
      expect.objectContaining({ amount: 1539.99 })
    );

    const again = await post('order-1/paid-check', { received: true, utrLast4: '9012' });
    expect(again.status).toBe(200);
    expect(mockDocs.get('marketplaceOrders/order-1').refunds).toHaveLength(1);

    seedOrder('order-shop', {
      orderStatus: 'cancelled',
      payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 },
      cancellation: { reason: 'customer_cancel', paidCheck: 'pending' }
    });
    const shopTyped = await post('order-shop/paid-check', { received: true, fullUtr: SHOP_UTR });
    expect(shopTyped.status).toBe(200);
    expect(mockDocs.get(`utrRegistry/${SHOP_UTR}`).kind).toBe('shop');

    seedOrder('order-used', {
      orderStatus: 'cancelled',
      payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 },
      cancellation: { reason: 'customer_cancel', paidCheck: 'pending' }
    });
    mockDocs.set('utrRegistry/888888888888', { orderId: 'other-order', kind: 'shop' });
    const used = await post('order-used/paid-check', { received: true, fullUtr: '888888888888' });
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe('UTR_USED');
    expect(mockDocs.get('marketplaceOrders/order-used').refunds).toBeUndefined();

    seedOrder('order-no', {
      orderStatus: 'cancelled',
      payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 },
      cancellation: { reason: 'customer_cancel', paidCheck: 'pending' }
    });
    const closed = await post('order-no/paid-check', { received: false });
    expect(closed.status).toBe(200);
    expect(closed.body.data.order.cancellation.paidCheck).toBe('not_received');
    expect(mockDocs.get('marketplaceOrders/order-no').refunds).toBeUndefined();
    expect(mockDocs.get('marketplaceOrders/order-no').orderStatus).toBe('cancelled');
  });

  test('handed_over and completed cannot be cancelled', async () => {
    seedOrder('order-hand', { orderStatus: 'handed_over', payment: { status: 'confirmed', amount: 1540 } });
    seedOrder('order-done', { orderStatus: 'completed', payment: { status: 'confirmed', amount: 1540 } });
    const handed = await post('order-hand/cancel', { reason: 'too late' });
    const completed = await post('order-done/cancel', { reason: 'too late' });
    expect(handed.status).toBe(409);
    expect(handed.body.error.code).toBe('CANCEL_NOT_ALLOWED');
    expect(completed.status).toBe(409);
    expect(completed.body.error.code).toBe('CANCEL_NOT_ALLOWED');
  });

  test('the customer view shows officialUtr and hides the handover OTP', () => {
    const view = presentCustomerOrder({
      id: 'order-1',
      handoverOtp: '654321',
      private: { secret: true },
      payment: { status: 'confirmed', officialUtr: UTR, customerUtr: UTR, utrSource: 'customer' }
    });
    const body = JSON.stringify(view);
    expect(view.payment.officialUtr).toBe(UTR);
    expect(body).not.toContain('654321');
    expect(body).not.toContain('utrSource');
    expect(body).not.toContain('private');
  });
});
