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

const { isPastPaymentGrace, isShortBalanceExpired, resolvePaymentReview } = require('../src/services/marketplace/shopPaymentVerification');
const { recordFoundRefund } = require('../src/services/marketplace/refunds');
const { NotificationTemplateProcessor } = require('../src/services/notificationTemplates');
const { presentCustomerOrder } = require('../src/services/marketplace/customerOrderView');
const shopOrderService = require('../src/services/shopOrderService');
const shopOrderRoutes = require('../src/routes/shopOrders');

function refundDocs(orderId) {
  const prefix = `marketplaceOrders/${orderId}/refunds/`;
  const found = [];
  mockDocs.forEach((data, path) => {
    if (path.startsWith(prefix) && path.split('/').length === 4) {
      found.push(data);
    }
  });
  return found;
}

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

function eventsFor(orderId) {
  return [...mockDocs.keys()]
    .filter((path) => path.startsWith(`marketplaceOrders/${orderId}/events/`))
    .map((path) => mockDocs.get(path));
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
    seedOrder('order-1', { expectedAmountPaise: 153999 });
    const response = await post('order-1/confirm-payment', {});
    expect(response.status).toBe(200);
    expect(response.body.data.order.orderStatus).toBe('preparing');
    expect(response.body.data.order.payment.status).toBe('confirmed');
    expect(mockDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
    expect(mockDocs.get('users/cust-1').customer.marketplace.unpaidCount).toBe(0);
    expect([...mockDocs.keys()].some((path) => path.startsWith('utrRegistry/'))).toBe(false);
    expect(response.body.message).toBe('Payment confirmed');
    const storedConfirm = mockDocs.get('marketplaceOrders/order-1').payment;
    expect(storedConfirm.receivedAmount).toBe(1539.99);
    expect(storedConfirm.receivedAmountPaise).toBe(153999);
    const events = eventsFor('order-1');
    expect(events.map((event) => event.type)).toEqual(['stock_deducted', 'stock_short', 'shop_confirm']);
    expect(events.find((event) => event.type === 'shop_confirm')).toMatchObject({
      type: 'shop_confirm',
      actor: { type: 'shop', id: 'shop-1' }
    });
    expect(mockDocs.get('marketplaceOrders/order-1/signal/latest')).toMatchObject({
      customerId: 'cust-1',
      type: 'stock_deducted'
    });
  });

  test('switches off: reject with a customer UTR stays customer_claimed and opens paid-check', async () => {
    seedOrder('order-1', { payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 } });
    const response = await post('order-1/reject');
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Order rejected');
    expect(response.body.data.order.orderStatus).toBe('cancelled');
    expect(response.body.data.order.payment.status).toBe('customer_claimed');
    expect(response.body.data.order.cancellation.paidCheck).toBe('pending');
    const stored = mockDocs.get('marketplaceOrders/order-1');
    expect(stored.closedReason).toBe('shop_rejected');
    expect(stored.payment.status).toBe('customer_claimed');
    expect(stored.cancellation.paidCheck).toBe('pending');
    expect(stored.cancellation.paidCheckAt).toBeTruthy();
    expect(stored.cancellation.reason).toBe('shop_rejected');
    expect(stored.cancellation.cancelledBy).toBe('shop-1');
    expect(mockDocs.get('shops/shop-1').marketplaceStats.rejections).toBe(1);
    expect(mockDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
    expect(eventsFor('order-1')[0]).toMatchObject({
      type: 'rejected',
      actor: { type: 'shop', id: 'shop-1' },
      data: { hadCustomerUtr: true }
    });
  });

  test('switches off: reject without a UTR sets payment.status cancelled', async () => {
    seedOrder('order-bare', { payment: { status: 'pending', amount: 1540 } });
    mockDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-bare' });
    const response = await post('order-bare/reject');
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Order rejected');
    expect(response.body.data.order.orderStatus).toBe('cancelled');
    expect(response.body.data.order.payment.status).toBe('cancelled');
    expect(response.body.data.order.cancellation.paidCheck).toBeNull();
    const stored = mockDocs.get('marketplaceOrders/order-bare');
    expect(stored.closedReason).toBe('shop_rejected');
    expect(stored.cancellation.reason).toBe('shop_rejected');
    expect(stored.cancellation.cancelledBy).toBe('shop-1');
    expect(mockDocs.get('shops/shop-1').marketplaceStats.rejections).toBe(1);
    const event = eventsFor('order-bare')[0];
    expect(event).toMatchObject({
      type: 'rejected',
      actor: { type: 'shop', id: 'shop-1' },
      data: null
    });
    expect(event.data).toBeNull();
  });

  test('switches off: cancel writes the shop reason on the cancelled event', async () => {
    seedOrder('order-1');
    const response = await post('order-1/cancel', { reason: 'out of stock' });
    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Order cancelled');
    expect(response.body.data.order.orderStatus).toBe('cancelled');
    expect(eventsFor('order-1')[0]).toMatchObject({
      type: 'cancelled',
      actor: { type: 'shop', id: 'shop-1' },
      reason: 'out of stock'
    });
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
    expect(sent.body).toBe('Payment confirmed with UTR 9999.');
    expect(JSON.stringify(sent)).not.toMatch(/\d{12}/);
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

  test('confirm-payment still refuses a receivedAmount when new statuses are on', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOrder('order-amt', { payment: { status: 'pending', amount: 1540 } });
    const amount = await post('order-amt/confirm-payment', {
      fullUtr: UTR,
      withinWindowAttested: true,
      receivedAmount: 10
    });
    expect(amount.status).toBe(409);
    expect(amount.body.error.code).toBe('AMOUNT_DIFFERS_UNAVAILABLE');
    expect(mockDocs.get('marketplaceOrders/order-amt').orderStatus).toBe('awaiting_payment');
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
    const refunds = refundDocs('order-1');
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      reason: 'customer_cancel',
      amount: 1539.99,
      status: 'upi_needed'
    });
    expect(mockDocs.get('marketplaceOrders/order-1').hasOpenRefund).toBe(true);
    expect(mockDocs.get('marketplaceOrders/order-1').refunds).toBeUndefined();
    expect(mockDocs.get(`utrRegistry/${UTR}`).kind).toBe('customer');
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'cust-1',
      'MARKETPLACE',
      'REFUND_INITIATED',
      expect.objectContaining({ amount: 1539.99 })
    );

    const again = await post('order-1/paid-check', { received: true, utrLast4: '9012' });
    expect(again.status).toBe(200);
    expect(refundDocs('order-1')).toHaveLength(1);

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
    expect(refundDocs('order-used')).toHaveLength(0);

    seedOrder('order-no', {
      orderStatus: 'cancelled',
      payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 },
      cancellation: { reason: 'customer_cancel', paidCheck: 'pending' }
    });
    const closed = await post('order-no/paid-check', { received: false });
    expect(closed.status).toBe(200);
    expect(closed.body.data.order.cancellation.paidCheck).toBe('not_received');
    expect(refundDocs('order-no')).toHaveLength(0);
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

  test('amount differs writes a short balance, an overpaid stub, or a normal confirm', async () => {
    const money = require('../src/validators/marketplace');
    const toPaise = jest.spyOn(money, 'toPaise');
    seedOrder('order-bad', {
      expectedAmount: 100,
      expectedAmountPaise: 10000,
      payment: { status: 'customer_claimed', customerUtr: UTR, amount: 100 }
    });
    const three = await post('order-bad/amount-differs', { receivedAmount: 10.999, utrLast4: '9012' });
    const text = await post('order-bad/amount-differs', { receivedAmount: 'abc', utrLast4: '9012' });
    expect(three.status).toBe(400);
    expect(text.status).toBe(400);
    expect(three.body.error.code).toBe('VALIDATION');
    expect(text.body.error.code).toBe('VALIDATION');
    expect(toPaise).not.toHaveBeenCalled();
    expect(mockDocs.get('marketplaceOrders/order-bad').payment.status).toBe('customer_claimed');
    toPaise.mockRestore();

    seedOrder('order-short', {
      expectedAmount: 100,
      expectedAmountPaise: 10000,
      payment: { status: 'customer_claimed', customerUtr: UTR, amount: 100 }
    });
    mockDocs.set(`utrRegistry/${UTR}`, { orderId: 'order-short', customerId: 'cust-1', kind: 'customer' });
    mockDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-short' });
    const less = await post('order-short/amount-differs', { receivedAmount: 40, utrLast4: '9012' });
    expect(less.status).toBe(200);
    expect(less.body.data.order.orderStatus).toBe('awaiting_payment');
    const shortStored = mockDocs.get('marketplaceOrders/order-short');
    expect(shortStored.payment.status).toBe('short');
    expect(shortStored.payment.receivedAmount).toBe(40);
    expect(shortStored.payment.receivedAmountPaise).toBe(4000);
    expect(shortStored.payment.balance).toMatchObject({ amount: 60, amountPaise: 6000, utr: null });
    expect(mockDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(true);
    expect(eventsFor('order-short').map((event) => event.type)).toContain('amount_differs');
    const shortPush = mockSendToUser.mock.calls[0][1];
    expect(shortPush.body).toBe('₹40 received, ₹60 short — pay balance or cancel');
    expect(shortPush.data.variables.receivedAmount).toBeUndefined();
    expect(shortPush.data.variables.balanceAmount).toBeUndefined();

    const againShort = await post('order-short/amount-differs', { receivedAmount: 40, utrLast4: '9012' });
    expect(againShort.status).toBe(409);
    expect(againShort.body.error.code).toBe('INVALID_STATE');

    seedOrder('order-more', {
      expectedAmount: 100,
      expectedAmountPaise: 10000,
      payment: { status: 'customer_claimed', customerUtr: '222222222222', amount: 100 }
    });
    mockDocs.set('utrRegistry/222222222222', { orderId: 'order-more', customerId: 'cust-1', kind: 'customer' });
    mockDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-more' });
    const more = await post('order-more/amount-differs', { receivedAmount: 150, utrLast4: '2222' });
    expect(more.status).toBe(200);
    expect(more.body.data.order.orderStatus).toBe('preparing');
    const moreStored = mockDocs.get('marketplaceOrders/order-more');
    expect(moreStored.payment.status).toBe('confirmed');
    expect(moreStored.payment.receivedAmount).toBe(150);
    expect(moreStored.payment.status).toBe('confirmed');
    expect(moreStored.hasOpenRefund).toBe(true);
    expect(moreStored.refunds).toBeUndefined();
    expect(refundDocs('order-more')[0]).toMatchObject({ reason: 'overpaid', amount: 50, status: 'upi_needed' });
    expect(eventsFor('order-more').find((event) => event.type === 'amount_differs').data).toEqual({
      receivedAmount: 150,
      expectedAmount: 100
    });
    expect(mockDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
    const moreReplay = await post('order-more/amount-differs', { receivedAmount: 150, utrLast4: '2222' });
    expect(moreReplay.status).toBe(200);
    expect(refundDocs('order-more')).toHaveLength(1);

    seedOrder('order-equal', {
      expectedAmount: 100,
      expectedAmountPaise: 10000,
      payment: { status: 'pending', amount: 100 }
    });
    mockDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-equal' });
    const equal = await post('order-equal/amount-differs', { receivedAmount: 100, fullUtr: '777777777777' });
    expect(equal.status).toBe(200);
    const equalStored = mockDocs.get('marketplaceOrders/order-equal');
    expect(equalStored.orderStatus).toBe('preparing');
    expect(equalStored.payment.receivedAmount).toBe(100);
    expect(equalStored.payment.receivedAmountPaise).toBe(10000);
    expect(refundDocs('order-equal')).toHaveLength(0);

    seedOrder('order-huge', {
      expectedAmount: 100,
      expectedAmountPaise: 10000,
      payment: { status: 'pending', amount: 100 }
    });
    const huge = await post('order-huge/amount-differs', { receivedAmount: 201, fullUtr: '666666666666' });
    expect(huge.status).toBe(400);
    expect(huge.body.error.code).toBe('VALIDATION');
    expect(mockDocs.get('marketplaceOrders/order-huge').orderStatus).toBe('awaiting_payment');

    seedOrder('order-used', {
      expectedAmount: 100,
      expectedAmountPaise: 10000,
      payment: { status: 'pending', amount: 100 }
    });
    mockDocs.set('utrRegistry/888888888888', { orderId: 'other-order', kind: 'shop' });
    const used = await post('order-used/amount-differs', { receivedAmount: 100, fullUtr: '888888888888' });
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe('UTR_USED');

    seedOrder('order-late', {
      orderStatus: 'payment_unconfirmed',
      expectedAmount: 100,
      expectedAmountPaise: 10000,
      payment: { status: 'expired', amount: 100 }
    });
    const late = await post('order-late/amount-differs', { receivedAmount: 80, fullUtr: '444444444444' });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('INVALID_STATE');
  });

  test('a normal confirm stores receivedAmount equal to expected', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOrder('order-1', {
      expectedAmount: 100,
      expectedAmountPaise: 10000,
      payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 }
    });
    mockDocs.set(`utrRegistry/${UTR}`, { orderId: 'order-1', customerId: 'cust-1', kind: 'customer' });
    const response = await post('order-1/confirm-payment', { utrLast4: '9012', withinWindowAttested: true });
    expect(response.status).toBe(200);
    const stored = mockDocs.get('marketplaceOrders/order-1').payment;
    expect(stored.status).toBe('confirmed');
    expect(stored.receivedAmount).toBe(100);
    expect(stored.receivedAmountPaise).toBe(10000);
  });

  test('balance confirm adds the balance and can register a shop UTR', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    const due = stamp(Date.now() + (15 * MINUTE));
    const balanceUtr = '555555555555';
    seedOrder('order-bal', {
      expectedAmount: 100,
      expectedAmountPaise: 10000,
      payment: {
        status: 'short',
        amount: 100,
        customerUtr: UTR,
        officialUtr: UTR,
        utrSource: 'customer',
        receivedAmount: 40,
        receivedAmountPaise: 4000,
        balance: {
          amount: 60,
          amountPaise: 6000,
          dueBy: due,
          utr: balanceUtr,
          submittedAt: stamp(Date.now()),
          confirmedAt: null
        }
      }
    });
    mockDocs.set(`utrRegistry/${balanceUtr}`, { orderId: 'order-bal', customerId: 'cust-1', kind: 'balance' });
    mockDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-bal' });
    const confirmed = await post('order-bal/confirm-payment', { utrLast4: '5555', withinWindowAttested: true });
    expect(confirmed.status).toBe(200);
    const stored = mockDocs.get('marketplaceOrders/order-bal');
    expect(stored.orderStatus).toBe('preparing');
    expect(stored.payment.status).toBe('confirmed');
    expect(stored.payment.receivedAmount).toBe(100);
    expect(stored.payment.receivedAmountPaise).toBe(10000);
    expect(stored.payment.officialUtr).toBe(UTR);
    expect(stored.payment.utrSource).toBe('customer');
    expect(stored.payment.balance.officialUtr).toBe(balanceUtr);
    expect(stored.payment.balance.utrSource).toBe('customer');
    expect(stored.payment.balance.confirmedAt).toBeTruthy();
    expect(confirmed.body.data.order.payment.officialUtr).toBe(UTR);
    expect(confirmed.body.data.order.payment.balance.officialUtr).toBe(balanceUtr);
    expect(confirmed.body.data.order.payment.balance.utrSource).toBe('customer');
    const customerView = presentCustomerOrder({ id: 'order-bal', payment: stored.payment });
    expect(customerView.payment.balance.officialUtr).toBe(balanceUtr);
    expect(customerView.payment.balance.utrSource).toBeUndefined();
    expect(JSON.stringify(customerView)).not.toContain('utrSource');
    expect(mockDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
    const balanceEvent = eventsFor('order-bal').find((event) => event.type === 'balance_confirmed');
    expect(balanceEvent.data.officialUtr).toBe(balanceUtr);

    seedOrder('order-shop-bal', {
      payment: {
        status: 'short',
        amount: 100,
        customerUtr: UTR,
        officialUtr: UTR,
        utrSource: 'customer',
        receivedAmount: 40,
        receivedAmountPaise: 4000,
        balance: {
          amount: 60,
          amountPaise: 6000,
          dueBy: due,
          utr: null,
          submittedAt: null,
          confirmedAt: null
        }
      }
    });
    mockDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-shop-bal' });
    const shopTyped = await post('order-shop-bal/confirm-payment', { fullUtr: SHOP_UTR, withinWindowAttested: true });
    expect(shopTyped.status).toBe(200);
    expect(mockDocs.get(`utrRegistry/${SHOP_UTR}`)).toMatchObject({ orderId: 'order-shop-bal', kind: 'shop' });
    const shopStored = mockDocs.get('marketplaceOrders/order-shop-bal');
    expect(shopStored.payment.receivedAmount).toBe(100);
    expect(shopStored.payment.officialUtr).toBe(UTR);
    expect(shopStored.payment.utrSource).toBe('customer');
    expect(shopStored.payment.balance.officialUtr).toBe(SHOP_UTR);
    expect(shopStored.payment.balance.utrSource).toBe('shop');
    expect(shopTyped.body.data.order.payment.balance.utrSource).toBe('shop');

    mockGetEnforcement.mockResolvedValue({ newStatuses: false, utrBlocksReject: false });
    seedOrder('order-off', { payment: { status: 'short', amount: 100 } });
    const off = await post('order-off/confirm-payment', {});
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('INVALID_TRANSITION');
    expect(mockDocs.get('marketplaceOrders/order-off').payment.status).toBe('short');
  });

  test('paid-check refunds the stored received amount', async () => {
    seedOrder('order-paid', {
      orderStatus: 'cancelled',
      expectedAmount: 100,
      payment: {
        status: 'customer_claimed',
        customerUtr: UTR,
        amount: 1540,
        receivedAmount: 40
      },
      cancellation: { reason: 'customer_cancel', paidCheck: 'pending' }
    });
    mockDocs.set(`utrRegistry/${UTR}`, { orderId: 'order-paid', customerId: 'cust-1', kind: 'customer' });
    const response = await post('order-paid/paid-check', { received: true, utrLast4: '9012' });
    expect(response.status).toBe(200);
    expect(refundDocs('order-paid')[0].amount).toBe(40);
  });

  function seedOpenReview(id, reviewPatch = {}) {
    seedOrder(id, {
      orderStatus: 'payment_review',
      expectedAmount: 100,
      expectedAmountPaise: 10000,
      items: [{ name: 'Statue', qty: 1, price: 100 }],
      payment: {
        status: 'under_review',
        amount: 100,
        customerUtr: UTR,
        review: {
          status: 'open',
          openedAt: stamp(Date.now()),
          trigger: 'utr_timeout',
          shopResponse: null,
          outcome: null,
          ...reviewPatch
        }
      }
    });
    mockDocs.set(`utrRegistry/${UTR}`, { orderId: id, customerId: 'cust-1', kind: 'customer' });
    mockDocs.set('users/cust-1', {
      customer: { marketplace: { unpaidCount: 1, stats: { utrCorrections: 0, reportsNotVerified: 0 } } }
    });
    mockDocs.set('shops/shop-1', {
      marketplaceStats: { reviewsOpened: 1, reviewsFoundAgainstShop: 0, rejections: 0 }
    });
  }

  test('confirm from an open review does not touch unpaidCount and a shop UTR is registry kind shop', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOpenReview('order-1');
    mockDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-1' });
    const same = await post('order-1/confirm-payment', { utrLast4: '9012', withinWindowAttested: true });
    expect(same.status).toBe(200);
    expect(same.body.data.order.orderStatus).toBe('preparing');
    expect(same.body.data.order.review.outcome.result).toBe('found');
    expect(same.body.data.order.review.trigger).toBe('utr_timeout');
    expect(mockDocs.get('users/cust-1').customer.marketplace.unpaidCount).toBe(1);
    expect(mockDocs.get('marketplaceLocks/cust-1_shop-1').orderId).toBe('order-1');
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsFoundAgainstShop).toBe(0);
    expect(mockDocs.get(`utrRegistry/${UTR}`).kind).toBe('customer');

    seedOpenReview('order-shop-utr');
    const corrected = await post('order-shop-utr/confirm-payment', {
      fullUtr: SHOP_UTR,
      withinWindowAttested: true
    });
    expect(corrected.status).toBe(200);
    const stored = mockDocs.get('marketplaceOrders/order-shop-utr');
    expect(stored.payment.officialUtr).toBe(SHOP_UTR);
    expect(stored.payment.utrSource).toBe('shop');
    expect(mockDocs.get(`utrRegistry/${SHOP_UTR}`).kind).toBe('shop');
    expect(mockDocs.get('users/cust-1').customer.marketplace.unpaidCount).toBe(1);
  });

  test('shop not_found then confirm counts reviewsFoundAgainstShop', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOpenReview('order-1', { trigger: 'utr_timeout' });
    const noted = await post('order-1/payment-not-found', {});
    expect(noted.status).toBe(200);
    expect(mockDocs.get('marketplaceOrders/order-1').payment.review.status).toBe('open');
    expect(mockDocs.get('marketplaceOrders/order-1').payment.review.shopResponse.result).toBe('not_found');
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsOpened).toBe(1);

    const found = await post('order-1/confirm-payment', { utrLast4: '9012', withinWindowAttested: true });
    expect(found.status).toBe(200);
    expect(mockDocs.get('marketplaceOrders/order-1').payment.review.outcome.result).toBe('found');
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsFoundAgainstShop).toBe(1);
    expect(mockDocs.get('users/cust-1').customer.marketplace.unpaidCount).toBe(1);
  });

  test('fulfil false from review cancels with review_refund and shop_cancelled', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOpenReview('order-1');
    const response = await post('order-1/confirm-payment', {
      utrLast4: '9012',
      withinWindowAttested: true,
      fulfil: false
    });
    expect(response.status).toBe(200);
    const stored = mockDocs.get('marketplaceOrders/order-1');
    expect(stored.orderStatus).toBe('cancelled');
    expect(stored.closedReason).toBe('shop_cancelled');
    expect(stored.cancellation.reason).toBe('shop_cancelled');
    expect(stored.cancellation.cancelledBy).toBe('shop-1');
    expect(stored.cancellation.cancelledAt).toBeTruthy();
    expect(stored.payment.status).toBe('refund_pending');
    expect(stored.payment.review.outcome.result).toBe('refund');
    expect(refundDocs('order-1')).toHaveLength(1);
    expect(refundDocs('order-1')[0].reason).toBe('review_refund');
    expect(refundDocs('order-1')[0].amount).toBe(100);
    expect(stored.payment.receivedAmount).toBe(refundDocs('order-1')[0].amount);
    expect(stored.payment.receivedAmountPaise).toBe(10000);
    expect(refundDocs('order-1')[0].reason).not.toBe('late_unfulfilled');
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsFoundAgainstShop).toBe(0);
  });

  test('amount-differs on an open review: equal, over, and short', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOpenReview('order-eq');
    const equal = await post('order-eq/amount-differs', { receivedAmount: 100, utrLast4: '9012' });
    expect(equal.status).toBe(200);
    expect(mockDocs.get('marketplaceOrders/order-eq').orderStatus).toBe('preparing');
    expect(mockDocs.get('marketplaceOrders/order-eq').payment.review.outcome.result).toBe('found');
    expect(refundDocs('order-eq')).toHaveLength(0);
    expect(eventsFor('order-eq').find((event) => event.type === 'amount_differs').data).toEqual({
      receivedAmount: 100,
      expectedAmount: 100
    });

    seedOpenReview('order-over');
    const over = await post('order-over/amount-differs', { receivedAmount: 140, utrLast4: '9012' });
    expect(over.status).toBe(200);
    const overStored = mockDocs.get('marketplaceOrders/order-over');
    expect(overStored.orderStatus).toBe('preparing');
    expect(overStored.payment.status).toBe('confirmed');
    expect(overStored.hasOpenRefund).toBe(true);
    expect(refundDocs('order-over')[0].reason).toBe('overpaid');
    expect(refundDocs('order-over')[0].amount).toBe(40);
    expect(overStored.payment.balance).toBeUndefined();
    expect(eventsFor('order-over').find((event) => event.type === 'amount_differs').data).toEqual({
      receivedAmount: 140,
      expectedAmount: 100
    });

    seedOpenReview('order-short');
    const short = await post('order-short/amount-differs', { receivedAmount: 40, utrLast4: '9012' });
    expect(short.status).toBe(200);
    const shortStored = mockDocs.get('marketplaceOrders/order-short');
    expect(shortStored.orderStatus).toBe('payment_review');
    expect(shortStored.payment.review.status).toBe('open');
    expect(shortStored.payment.review.shopResponse).toMatchObject({ result: 'short', receivedAmount: 40 });
    expect(shortStored.payment.balance).toBeUndefined();
    expect(refundDocs('order-short-review')).toHaveLength(0);
    const shortEvents = eventsFor('order-short');
    expect(shortEvents.find((event) => event.type === 'shop_response').data).toEqual({
      result: 'short',
      receivedAmount: 40
    });
    expect(shortEvents.find((event) => event.type === 'amount_differs').data).toEqual({
      receivedAmount: 40,
      expectedAmount: 100
    });
  });

  test('amount-differs on payment_unconfirmed stays 409', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOrder('order-late', {
      orderStatus: 'payment_unconfirmed',
      expectedAmountPaise: 10000,
      payment: { status: 'expired', customerUtr: UTR, amount: 100 }
    });
    const response = await post('order-late/amount-differs', { receivedAmount: 80, utrLast4: '9012' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE');
  });

  test('confirm and amount-differs on a resolved review are 409', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOpenReview('order-1', {
      status: 'resolved',
      outcome: { result: 'found' }
    });
    mockDocs.set('marketplaceOrders/order-1', {
      ...mockDocs.get('marketplaceOrders/order-1'),
      orderStatus: 'preparing',
      payment: {
        ...mockDocs.get('marketplaceOrders/order-1').payment,
        status: 'confirmed'
      }
    });
    const confirm = await post('order-1/confirm-payment', { utrLast4: '9012', withinWindowAttested: true });
    expect(confirm.status).toBe(409);
    expect(confirm.body.error.code).toBe('INVALID_STATE');
    const amount = await post('order-1/amount-differs', { receivedAmount: 100, utrLast4: '9012' });
    expect(amount.status).toBe(409);
    expect(amount.body.error.code).toBe('INVALID_STATE');
  });

  test('customer-facing exits are closed: shop reject and shop cancel on payment_review are 409', async () => {
    seedOpenReview('order-1');
    const rejected = await post('order-1/reject');
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('INVALID_STATE');
    const cancelled = await post('order-1/cancel', { reason: 'out of stock' });
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error.code).toBe('INVALID_STATE');
    expect(mockDocs.get('marketplaceOrders/order-1').orderStatus).toBe('payment_review');
  });

  test('support not_found counts reportsNotVerified only, and a second close is a no-op', async () => {
    seedOpenReview('order-1');
    const first = await resolvePaymentReview({
      orderId: 'order-1',
      outcome: 'not_found',
      reason: 'bank has no credit',
      operator: 'ops-1'
    });
    expect(first.wrote).toBe(true);
    const stored = mockDocs.get('marketplaceOrders/order-1');
    expect(stored.orderStatus).toBe('cancelled');
    expect(stored.closedReason).toBe('payment_not_verified');
    expect(stored.cancellation.reason).toBe('payment_not_verified');
    expect(stored.cancellation.cancelledBy).toBe('support');
    expect(stored.payment.status).toBe('not_verified');
    expect(refundDocs('order-1')).toHaveLength(0);
    expect(mockDocs.get('users/cust-1').customer.marketplace.stats.reportsNotVerified).toBe(1);
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsFoundAgainstShop).toBe(0);
    const second = await resolvePaymentReview({
      orderId: 'order-1',
      outcome: 'not_found',
      reason: 'again',
      operator: 'ops-1'
    });
    expect(second.alreadyProcessed).toBe(true);
    expect(mockDocs.get('users/cust-1').customer.marketplace.stats.reportsNotVerified).toBe(1);
    expect(eventsFor('order-1').filter((event) => event.type === 'review_resolved')).toHaveLength(1);
    const cancelled = eventsFor('order-1').filter((event) => event.type === 'cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].actor).toEqual({ type: 'support', id: 'ops-1' });
    expect(cancelled[0].reason).toBe('payment_not_verified');
  });

  test('support close and shop confirm: one wins', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOpenReview('order-1', {
      trigger: 'shop_not_found',
      shopResponse: { result: 'not_found', at: stamp(Date.now()) }
    });
    await resolvePaymentReview({
      orderId: 'order-1',
      outcome: 'not_found',
      reason: 'still missing',
      operator: 'ops-1'
    });
    const confirm = await post('order-1/confirm-payment', { utrLast4: '9012', withinWindowAttested: true });
    expect(confirm.status).toBe(409);
    expect(confirm.body.error.code).toBe('INVALID_STATE');
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsFoundAgainstShop).toBe(0);

    seedOpenReview('order-race', { trigger: 'shop_not_found' });
    const won = await post('order-race/confirm-payment', { utrLast4: '9012', withinWindowAttested: true });
    expect(won.status).toBe(200);
    const lost = await resolvePaymentReview({
      orderId: 'order-race',
      outcome: 'refund',
      reason: 'too late',
      operator: 'ops-1'
    });
    expect(lost.alreadyProcessed).toBe(true);
    expect(mockDocs.get('marketplaceOrders/order-race').orderStatus).toBe('preparing');
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsFoundAgainstShop).toBe(1);
  });

  test('support found is refused when the shop said short, and refund uses that amount', async () => {
    seedOpenReview('order-1', {
      trigger: 'shop_not_found',
      shopResponse: { result: 'short', receivedAmount: 40, at: stamp(Date.now()) }
    });
    await expect(resolvePaymentReview({
      orderId: 'order-1',
      outcome: 'found',
      reason: 'looks paid',
      operator: 'ops-1'
    })).rejects.toMatchObject({ code: 'REVIEW_SHORT' });
    expect(mockDocs.get('marketplaceOrders/order-1').orderStatus).toBe('payment_review');
    expect(mockDocs.get('marketplaceOrders/order-1').payment.review.status).toBe('open');

    const refunded = await resolvePaymentReview({
      orderId: 'order-1',
      outcome: 'refund',
      reason: 'return the short amount',
      operator: 'ops-1'
    });
    expect(refunded.wrote).toBe(true);
    const stored = mockDocs.get('marketplaceOrders/order-1');
    expect(stored.closedReason).toBe('support_cancelled');
    expect(stored.cancellation.reason).toBe('support_cancelled');
    expect(stored.cancellation.cancelledBy).toBe('support');
    expect(refundDocs('order-1')[0].reason).toBe('review_refund');
    expect(refundDocs('order-1')[0].amount).toBe(40);
    expect(stored.payment.receivedAmount).toBe(40);
    expect(stored.payment.receivedAmount).toBe(stored.payment.review.shopResponse.receivedAmount);
    expect(stored.payment.receivedAmountPaise).toBe(4000);
    const cancelled = eventsFor('order-1').filter((event) => event.type === 'cancelled');
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].actor).toEqual({ type: 'support', id: 'ops-1' });
    expect(cancelled[0].reason).toBe('support_cancelled');
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsFoundAgainstShop).toBe(1);
  });

  test('REFUND_INITIATED asks for a UPI ID and strips the amount from data.variables', () => {
    const template = NotificationTemplateProcessor.getTemplate('MARKETPLACE', 'REFUND_INITIATED');
    const note = NotificationTemplateProcessor.process(template, {
      displayId: '#11',
      orderId: 'order-1',
      shopName: 'Vaigzz',
      amount: 40
    });
    expect(note.body).toBe('Share your UPI ID to receive your refund.');
    expect(note.body).not.toContain('40');
    expect(note.data).toEqual({
      type: 'refund_initiated',
      orderId: 'order-1',
      displayId: '#11',
      shopName: 'Vaigzz',
      action: 'view_order'
    });
  });

  test('UTR_CORRECTED body and data never contain a 12-digit UTR', () => {
    const template = NotificationTemplateProcessor.getTemplate('MARKETPLACE', 'UTR_CORRECTED');
    const note = NotificationTemplateProcessor.process(template, {
      displayId: '#11',
      orderId: 'order-1',
      shopName: 'Vaigzz',
      utr: '987654321098'
    });
    expect(note.title).toBe('Payment confirmed');
    expect(note.body).toBe('Payment confirmed with UTR 1098.');
    expect(note.body).not.toContain('987654321098');
    expect(JSON.stringify(note)).not.toMatch(/\d{12}/);
    expect(note.data.variables.utr).toBeUndefined();
    expect(note.data.variables.orderId).toBe('order-1');
  });

  test('a short balance is expired at dueBy and not before', () => {
    const due = 1_700_000_000_000;
    const data = { payment: { status: 'short', balance: { dueBy: stamp(due) } } };
    expect(isShortBalanceExpired(data, due - 1)).toBe(false);
    expect(isShortBalanceExpired(data, due)).toBe(true);
    expect(isShortBalanceExpired({ payment: { status: 'pending', balance: { dueBy: stamp(due) } } }, due)).toBe(false);
  });

  test('payment_unconfirmed with fulfil false cancels as late_unfulfilled and does not touch stock', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    mockDocs.set('products/prod-1', { stock: 10, hasVariants: false });
    seedOrder('order-late-no', {
      orderStatus: 'payment_unconfirmed',
      expectedAmount: 1540,
      expectedAmountPaise: 154000,
      items: [{ id: 'line-1', productId: 'prod-1', qty: 1, name: 'Controller' }],
      payment: { status: 'expired', amount: 1540 }
    });
    const late = await post('order-late-no/confirm-payment', { fullUtr: UTR, fulfil: false });
    expect(late.status).toBe(200);
    const stored = mockDocs.get('marketplaceOrders/order-late-no');
    expect(stored.orderStatus).toBe('cancelled');
    expect(stored.closedReason).toBe('late_unfulfilled');
    expect(stored.cancellation.reason).toBe('late_unfulfilled');
    expect(stored.cancellation.cancelledBy).toBe('shop-1');
    expect(stored.payment.receivedAmount).toBe(1540);
    expect(stored.payment.receivedAmountPaise).toBe(154000);
    expect(stored.payment.late).toMatchObject({ onCancelledOrder: false, fulfilled: false });
    expect(mockDocs.get('products/prod-1').stock).toBe(10);
    expect(eventsFor('order-late-no').some((event) => event.type === 'stock_deducted')).toBe(false);
    expect(eventsFor('order-late-no').some((event) => event.type === 'cancelled' && event.data.reason === 'late_unfulfilled')).toBe(true);
    expect(refundDocs('order-late-no')).toHaveLength(1);
    expect(refundDocs('order-late-no')[0].reason).toBe('late_unfulfilled');
    expect(mockSendTemplate.mock.calls.some((call) => call[2] === 'PAYMENT_LATE_ACCEPTED')).toBe(false);
    expect(mockSendTemplate.mock.calls.some((call) => call[2] === 'REFUND_INITIATED')).toBe(true);

    const again = await post('order-late-no/confirm-payment', { fullUtr: UTR, fulfil: false });
    expect(again.status).toBe(200);
    expect(refundDocs('order-late-no')).toHaveLength(1);
  });

  test('fulfil false during the open payment window is refused', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOrder('order-open', { payment: { status: 'pending', amount: 1540 } });
    const refused = await post('order-open/confirm-payment', { fullUtr: UTR, fulfil: false });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('INVALID_STATE');
    expect(mockDocs.get('marketplaceOrders/order-open').orderStatus).toBe('awaiting_payment');
    expect(refundDocs('order-open')).toHaveLength(0);
  });

  test('a qualifying cancelled order records paid_on_cancelled once and does not touch stock', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    mockDocs.set('products/prod-1', { stock: 10, hasVariants: false });
    seedOrder('order-poc', {
      orderStatus: 'cancelled',
      closedReason: 'customer_unpaid_cancel',
      cancellation: { reason: 'customer_unpaid_cancel' },
      expectedAmount: 1540,
      expectedAmountPaise: 154000,
      items: [{ id: 'line-1', productId: 'prod-1', qty: 1, name: 'Controller' }],
      payment: { status: 'cancelled', amount: 1540 }
    });
    const paid = await post('order-poc/confirm-payment', { fullUtr: UTR });
    expect(paid.status).toBe(200);
    const stored = mockDocs.get('marketplaceOrders/order-poc');
    expect(stored.orderStatus).toBe('cancelled');
    expect(stored.payment.late).toMatchObject({ onCancelledOrder: true, fulfilled: false });
    expect(stored.payment.receivedAmount).toBe(1540);
    expect(mockDocs.get('products/prod-1').stock).toBe(10);
    expect(refundDocs('order-poc')).toHaveLength(1);
    expect(refundDocs('order-poc')[0].reason).toBe('paid_on_cancelled');
    expect(eventsFor('order-poc').some((event) => event.type === 'stock_deducted')).toBe(false);

    const again = await post('order-poc/confirm-payment', { fullUtr: UTR });
    expect(again.status).toBe(200);
    expect(refundDocs('order-poc')).toHaveLength(1);
  });

  test('a legacy timeout with no closedReason can be paid on the cancelled order', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOrder('order-legacy', {
      orderStatus: 'cancelled',
      expectedAmount: 1540,
      expectedAmountPaise: 154000,
      payment: { status: 'expired', amount: 1540 }
    });
    const paid = await post('order-legacy/confirm-payment', { fullUtr: UTR });
    expect(paid.status).toBe(200);
    expect(mockDocs.get('marketplaceOrders/order-legacy').orderStatus).toBe('cancelled');
    expect(mockDocs.get('marketplaceOrders/order-legacy').payment.late.onCancelledOrder).toBe(true);
    expect(refundDocs('order-legacy')[0].reason).toBe('paid_on_cancelled');
  });

  test('paid-check, balance_expired, and payment_not_verified stay on their own refund paths', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOrder('order-check', {
      orderStatus: 'cancelled',
      closedReason: 'customer_cancel',
      expectedAmount: 40,
      cancellation: { reason: 'customer_cancel', paidCheck: 'pending' },
      payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540, receivedAmount: 40 }
    });
    const blocked = await post('order-check/confirm-payment', { fullUtr: UTR });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('INVALID_STATE');
    const checked = await post('order-check/paid-check', { received: true, utrLast4: '9012' });
    expect(checked.status).toBe(200);
    expect(refundDocs('order-check')).toHaveLength(1);
    expect(refundDocs('order-check')[0].reason).toBe('customer_cancel');

    seedOrder('order-bal', {
      orderStatus: 'cancelled',
      closedReason: 'balance_expired',
      cancellation: { reason: 'balance_expired' },
      payment: { status: 'cancelled', amount: 100, receivedAmount: 40, receivedAmountPaise: 4000 }
    });
    mockDocs.set('marketplaceOrders/order-bal/refunds/existing', {
      reason: 'balance_expired',
      amount: 40,
      status: 'upi_needed'
    });
    const balance = await post('order-bal/confirm-payment', { fullUtr: SHOP_UTR });
    expect(balance.status).toBe(409);
    expect(refundDocs('order-bal')).toHaveLength(1);

    seedOrder('order-nv', {
      orderStatus: 'cancelled',
      closedReason: 'payment_not_verified',
      cancellation: { reason: 'payment_not_verified' },
      payment: { status: 'not_verified', amount: 40 }
    });
    const notVerified = await post('order-nv/confirm-payment', { fullUtr: SHOP_UTR });
    expect(notVerified.status).toBe(409);
    const found = await recordFoundRefund({
      orderId: 'order-nv',
      amount: 40,
      operator: 'ops-1',
      reason: 'Bank statement shows the payment'
    });
    expect(found.orderStatus).toBe('cancelled');
    expect(refundDocs('order-nv')).toHaveLength(1);
    expect(refundDocs('order-nv')[0].reason).toBe('support_decision');
  });

  test('a cancelled confirm whose refunds already equal the received amount adds no refund', async () => {
    mockGetEnforcement.mockResolvedValue(ON);
    seedOrder('order-zero', {
      orderStatus: 'cancelled',
      closedReason: 'customer_unpaid_cancel',
      cancellation: { reason: 'customer_unpaid_cancel' },
      payment: { status: 'cancelled', amount: 1540, receivedAmount: 40, receivedAmountPaise: 4000 }
    });
    mockDocs.set('marketplaceOrders/order-zero/refunds/existing', {
      reason: 'customer_cancel',
      amount: 40,
      status: 'upi_needed'
    });
    const paid = await post('order-zero/confirm-payment', { fullUtr: UTR });
    expect(paid.status).toBe(200);
    expect(refundDocs('order-zero')).toHaveLength(1);
    expect(refundDocs('order-zero')[0].reason).toBe('customer_cancel');
    expect(mockDocs.get('marketplaceOrders/order-zero').payment.late.onCancelledOrder).toBe(true);
    expect(mockSendTemplate.mock.calls.some((call) => call[2] === 'REFUND_INITIATED')).toBe(false);
  });

  test('support cancel frees an assigned driver once and hides the operator note', async () => {
    mockDocs.set('products/prod-1', { stock: 9, hasVariants: false });
    seedOrder('order-support', {
      orderStatus: 'ready',
      shopSnapshot: { name: 'Vaigzz' },
      delivery: { stage: 'assigned' },
      linkedBookingId: 'book-1',
      items: [{ id: 'line-1', productId: 'prod-1', qty: 1, stockDeducted: 1, name: 'Controller' }],
      payment: { status: 'confirmed', amount: 1540, receivedAmount: 1540, receivedAmountPaise: 154000 }
    });
    mockDocs.set('bookings/book-1', {
      status: 'assigned',
      driverId: 'driver-1',
      sourceType: 'marketplace'
    });
    mockDocs.set('users/driver-1', { driver: { activeBookings: 2 } });

    const cancelled = await shopOrderService.supportCancelBeforeHandover({
      orderId: 'order-support',
      operator: 'ops-1',
      note: 'customer asked'
    });
    expect(cancelled.wrote).toBe(true);
    const stored = mockDocs.get('marketplaceOrders/order-support');
    expect(stored.orderStatus).toBe('cancelled');
    expect(stored.closedReason).toBe('support_cancelled');
    expect(stored.cancellation.reason).toBe('support_cancelled');
    expect(stored.cancellation.shopReason).toBeUndefined();
    expect(stored.cancellation.support).toEqual({ operator: 'ops-1', note: 'customer asked' });
    expect(stored.delivery.stage).toBe('cancelled');
    expect(mockDocs.get('bookings/book-1').status).toBe('cancelled');
    expect(mockDocs.get('users/driver-1').driver.activeBookings).toBe(1);
    expect(mockDocs.get('products/prod-1').stock).toBe(10);
    expect(refundDocs('order-support')[0].reason).toBe('support_cancelled');
    const driverCalls = mockSendTemplate.mock.calls.filter((call) => call[1] === 'DRIVER' && call[2] === 'BOOKING_CANCELLED');
    expect(driverCalls).toHaveLength(1);
    expect(driverCalls[0][0]).toBe('driver-1');
    expect(mockSendTemplate.mock.calls.some((call) => call[1] === 'CUSTOMER' && call[2] === 'BOOKING_CANCELLED')).toBe(false);

    const shopView = await shopOrderService.presentOrder('order-support', stored);
    const customerView = presentCustomerOrder({ ...stored, id: 'order-support' });
    expect(shopView.cancellation.support).toBeUndefined();
    expect(customerView.cancellation.support).toBeUndefined();
    expect(JSON.stringify(shopView)).not.toContain('customer asked');
    expect(JSON.stringify(customerView)).not.toContain('customer asked');

    const again = await shopOrderService.supportCancelBeforeHandover({
      orderId: 'order-support',
      operator: 'ops-1',
      note: 'customer asked'
    });
    expect(again.alreadyProcessed).toBe(true);
    expect(mockDocs.get('users/driver-1').driver.activeBookings).toBe(1);
    expect(mockSendTemplate.mock.calls.filter((call) => call[1] === 'DRIVER')).toHaveLength(1);
    expect(refundDocs('order-support')).toHaveLength(1);
  });

  test('support cancel from preparing restores stock when no booking exists', async () => {
    mockDocs.set('products/prod-1', { stock: 9, hasVariants: false });
    seedOrder('order-prep-support', {
      orderStatus: 'preparing',
      items: [{ id: 'line-1', productId: 'prod-1', qty: 1, stockDeducted: 1, name: 'Controller' }],
      payment: { status: 'confirmed', amount: 1540, receivedAmount: 1540, receivedAmountPaise: 154000 }
    });
    const cancelled = await shopOrderService.supportCancelBeforeHandover({
      orderId: 'order-prep-support',
      operator: 'ops-1',
      note: 'before ready'
    });
    expect(cancelled.wrote).toBe(true);
    const stored = mockDocs.get('marketplaceOrders/order-prep-support');
    expect(stored.orderStatus).toBe('cancelled');
    expect(stored.closedReason).toBe('support_cancelled');
    expect(stored.delivery && stored.delivery.stage).not.toBe('cancelled');
    expect(mockDocs.get('products/prod-1').stock).toBe(10);
    expect(refundDocs('order-prep-support')[0].reason).toBe('support_cancelled');
  });

  test('support cancel refuses photo_captured and picked_up without writing', async () => {
    seedOrder('order-photo', {
      orderStatus: 'ready',
      delivery: { stage: 'assigned' },
      linkedBookingId: 'book-photo',
      payment: { status: 'confirmed', amount: 1540, receivedAmount: 1540, receivedAmountPaise: 154000 }
    });
    mockDocs.set('bookings/book-photo', { status: 'photo_captured', driverId: 'driver-1' });
    mockDocs.set('users/driver-1', { driver: { activeBookings: 2 } });
    await expect(shopOrderService.supportCancelBeforeHandover({
      orderId: 'order-photo',
      operator: 'ops-1',
      note: 'too late'
    })).rejects.toMatchObject({ status: 409, code: 'CANCEL_NOT_ALLOWED' });
    expect(mockDocs.get('marketplaceOrders/order-photo').orderStatus).toBe('ready');
    expect(mockDocs.get('bookings/book-photo').status).toBe('photo_captured');
    expect(mockDocs.get('users/driver-1').driver.activeBookings).toBe(2);
    expect(refundDocs('order-photo')).toHaveLength(0);

    seedOrder('order-picked', {
      orderStatus: 'ready',
      delivery: { stage: 'picked_up' },
      linkedBookingId: 'book-picked',
      payment: { status: 'confirmed', amount: 1540 }
    });
    mockDocs.set('bookings/book-picked', { status: 'picked_up', driverId: 'driver-1' });
    await expect(shopOrderService.supportCancelBeforeHandover({
      orderId: 'order-picked',
      operator: 'ops-1',
      note: 'too late'
    })).rejects.toMatchObject({ status: 409 });
    expect(mockDocs.get('marketplaceOrders/order-picked').orderStatus).toBe('ready');
    expect(mockDocs.get('bookings/book-picked').status).toBe('picked_up');
  });

  test('order_cancelled and customer_cancelled data payloads are the five ids', () => {
    const cancelled = NotificationTemplateProcessor.process(
      NotificationTemplateProcessor.getTemplate('MARKETPLACE', 'ORDER_CANCELLED'),
      {
        displayId: '#11',
        orderId: 'order-1',
        shopName: 'Vaigzz',
        amount: 40,
        reason: 'customer asked',
        reasonLine: ' Reason: customer asked'
      }
    );
    expect(cancelled.data).toEqual({
      type: 'order_cancelled',
      orderId: 'order-1',
      displayId: '#11',
      shopName: 'Vaigzz',
      action: 'view_order'
    });
    const customer = NotificationTemplateProcessor.process(
      NotificationTemplateProcessor.getTemplate('MARKETPLACE', 'CUSTOMER_CANCELLED'),
      {
        displayId: '#11',
        orderId: 'order-1',
        shopName: 'Vaigzz',
        detail: 'The order was cancelled while preparing.',
        amount: 40
      }
    );
    expect(customer.data).toEqual({
      type: 'customer_cancelled',
      orderId: 'order-1',
      displayId: '#11',
      shopName: 'Vaigzz',
      action: 'view_order'
    });
    expect(JSON.stringify(customer.data)).not.toContain('40');
    expect(JSON.stringify(cancelled.data)).not.toContain('customer asked');
  });
});
