jest.mock('../src/middleware/auth', () => require('./helpers/mockCustomerAuth'));

const express = require('express');
const request = require('supertest');

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
  return {
    id,
    path,
    async get() {
      const data = mockDocs.get(path);
      return {
        exists: data !== undefined,
        id,
        data: () => (data === undefined ? undefined : mockClone(data))
      };
    },
    collection(name) {
      return {
        doc(subId) {
          const child = subId || `auto-${mockEventSeq += 1}`;
          return mockRef(`${path}/${name}/${child}`);
        }
      };
    }
  };
}

function mockBuildDb() {
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
          const data = mockDocs.get(ref.path);
          return {
            exists: data !== undefined,
            id: ref.id,
            data: () => (data === undefined ? undefined : mockClone(data))
          };
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
  getFirestore: () => mockBuildDb()
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: (...args) => mockSendTemplate(...args)
}));

const { isWithinUtrWindow, submitCustomerUtr } = require('../src/services/marketplace/customerOrderActions');
const customerMarketplaceOrderRoutes = require('../src/routes/customerMarketplaceOrders');

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

const KEY = '11111111-1111-4111-8111-111111111111';
const UTR = '123456789012';
const OTHER_UTR = '999999999999';
const HOUR = 60 * 60 * 1000;

function stamp(ms) {
  return {
    toDate: () => new Date(ms),
    toMillis: () => ms
  };
}

function seedOrder(id, overrides = {}) {
  const payment = overrides.payment || { status: 'pending', amount: 1540 };
  const doc = {
    customerId: 'customer-test',
    shopId: 'shop-1',
    displayId: 62191,
    orderStatus: 'awaiting_payment',
    handoverOtp: '654321',
    private: { handover: { otp: '654321' } },
    items: [{ name: 'Statue' }],
    window: { start: stamp(Date.now() - HOUR), end: stamp(Date.now()) },
    ...overrides,
    payment
  };
  mockDocs.set(`marketplaceOrders/${id}`, doc);
}

function seedLock(orderId, shopId = 'shop-1') {
  mockDocs.set(`marketplaceLocks/customer-test_${shopId}`, { orderId });
}

function seedUser(unpaidCount) {
  mockDocs.set('users/customer-test', {
    customer: { marketplace: { unpaidCount } }
  });
}

function pathsStarting(prefix) {
  return [...mockDocs.keys()].filter((path) => path.startsWith(prefix));
}

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/customer', customerMarketplaceOrderRoutes);
  return server;
}

function postUtr(id, utr) {
  return request(app())
    .post(`/api/customer/marketplace-orders/${id}/utr`)
    .set('Idempotency-Key', KEY)
    .send({ utr });
}

function postCancel(id) {
  return request(app())
    .post(`/api/customer/marketplace-orders/${id}/cancel`)
    .set('Idempotency-Key', KEY)
    .send({ reason: 'changed my mind' });
}

beforeEach(() => {
  mockDocs.clear();
  mockEventSeq = 0;
  mockSendTemplate.mockClear();
});

describe('customer UTR submit', () => {
  test('accepts a UTR at exactly 24 hours and rejects one millisecond later', () => {
    const start = 1_700_000_000_000;
    const day = 24 * HOUR;
    expect(isWithinUtrWindow(start, start + day, 24)).toBe(true);
    expect(isWithinUtrWindow(start, start + day + 1, 24)).toBe(false);
  });

  test('pending UTR becomes customer_claimed and a second submit does not write again', async () => {
    seedOrder('order-1');
    seedLock('order-1');
    seedUser(1);

    const created = await postUtr('order-1', UTR);
    expect(created.status).toBe(200);
    expect(created.body.data.order.orderStatus).toBe('awaiting_payment');
    expect(created.body.data.order.payment.status).toBe('customer_claimed');
    expect(created.body.data.order.payment.customerUtr).toBe(UTR);
    expect(created.body.data.order.payment.utrSubmittedAt).toEqual(expect.any(String));
    const body = JSON.stringify(created.body);
    expect(body).not.toContain('654321');
    expect(body).not.toContain('handoverOtp');
    expect(body).not.toContain('private');

    const registry = mockDocs.get(`utrRegistry/${UTR}`);
    expect(registry).toMatchObject({
      orderId: 'order-1',
      customerId: 'customer-test',
      kind: 'customer'
    });
    expect(typeof registry.at.toMillis).toBe('function');
    expect(pathsStarting('utrRegistry/')).toHaveLength(1);
    expect(pathsStarting('marketplaceOrders/order-1/events/')).toHaveLength(1);
    expect(mockDocs.has('marketplaceLocks/customer-test_shop-1')).toBe(true);
    expect(mockDocs.get('users/customer-test').customer.marketplace.unpaidCount).toBe(1);
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'shop-1',
      'MARKETPLACE',
      'UTR_SUBMITTED',
      { displayId: '#62191', orderId: 'order-1' }
    );

    const replay = await postUtr('order-1', UTR);
    expect(replay.status).toBe(200);
    expect(pathsStarting('utrRegistry/')).toHaveLength(1);
    expect(pathsStarting('marketplaceOrders/order-1/events/')).toHaveLength(1);
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
  });

  test('a UTR owned by another order is UTR_USED', async () => {
    seedOrder('order-2');
    mockDocs.set(`utrRegistry/${UTR}`, {
      orderId: 'other-order',
      customerId: 'someone-else',
      kind: 'customer',
      at: stamp(Date.now())
    });

    const response = await postUtr('order-2', UTR);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('UTR_USED');
    expect(mockDocs.get('marketplaceOrders/order-2').payment.status).toBe('pending');
  });

  test('a second different UTR is ALREADY_SUBMITTED', async () => {
    seedOrder('order-3');
    await postUtr('order-3', UTR);
    const response = await postUtr('order-3', OTHER_UTR);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ALREADY_SUBMITTED');
    expect(mockDocs.get('marketplaceOrders/order-3').payment.customerUtr).toBe(UTR);
    expect(mockDocs.has(`utrRegistry/${OTHER_UTR}`)).toBe(false);
  });

  test('payment_unconfirmed inside the window opens review and keeps the lock', async () => {
    seedOrder('order-4', {
      orderStatus: 'payment_unconfirmed',
      payment: { status: 'unconfirmed', amount: 1540 }
    });
    seedLock('order-4');

    const response = await postUtr('order-4', UTR);
    expect(response.status).toBe(200);
    expect(response.body.data.order.orderStatus).toBe('payment_review');
    expect(response.body.data.order.payment.status).toBe('under_review');
    const events = pathsStarting('marketplaceOrders/order-4/events/')
      .map((path) => mockDocs.get(path).type);
    expect(events).toEqual(['utr_submitted', 'review_opened']);
    expect(mockDocs.has('marketplaceLocks/customer-test_shop-1')).toBe(true);
  });

  test('payment_unconfirmed one day and an hour ago is UTR_WINDOW_CLOSED', async () => {
    seedOrder('order-5', {
      orderStatus: 'payment_unconfirmed',
      payment: { status: 'unconfirmed', amount: 1540 },
      window: { start: stamp(Date.now() - (25 * HOUR)), end: stamp(Date.now()) }
    });

    const response = await postUtr('order-5', UTR);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('UTR_WINDOW_CLOSED');
    expect(mockDocs.has(`utrRegistry/${UTR}`)).toBe(false);
  });

  test('another status is INVALID_STATE and another customer is not found', async () => {
    seedOrder('order-6', {
      orderStatus: 'awaiting_payment',
      payment: { status: 'confirmed', amount: 1540 }
    });
    seedOrder('order-7', { customerId: 'other-customer' });

    const invalid = await postUtr('order-6', UTR);
    expect(invalid.status).toBe(409);
    expect(invalid.body.error.code).toBe('INVALID_STATE');

    const missing = await postUtr('order-7', UTR);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toEqual({
      code: 'ORDER_NOT_FOUND',
      message: 'Order not found'
    });
  });

  test('a UTR that is not 12 digits is INVALID_UTR', async () => {
    seedOrder('order-8');
    const response = await postUtr('order-8', '1234');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_UTR');
  });
});

describe('customer UTR on payment_unconfirmed', () => {
  test('opens one customer_report review and counts reviewsOpened once', async () => {
    seedOrder('order-review', {
      orderStatus: 'payment_unconfirmed',
      shopSnapshot: { name: 'Vaigzz' },
      payment: { status: 'expired', amount: 1540 }
    });
    mockDocs.set('shops/shop-1', { marketplaceStats: { reviewsOpened: 0 } });

    const opened = await submitCustomerUtr({
      customerId: 'customer-test',
      orderId: 'order-review',
      idempotencyKey: KEY,
      utr: UTR
    });
    expect(opened.status).toBe(200);
    expect(opened.body.data.order.orderStatus).toBe('payment_review');
    expect(opened.body.data.order.payment.status).toBe('under_review');
    expect(opened.body.data.order.review).toEqual({
      status: 'open',
      openedAt: null,
      outcome: { result: null }
    });
    expect(opened.body.data.order.review.trigger).toBeUndefined();
    const stored = mockDocs.get('marketplaceOrders/order-review');
    expect(stored.payment.review.trigger).toBe('customer_report');
    expect(stored.payment.review.status).toBe('open');
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsOpened).toBe(1);
    const events = pathsStarting('marketplaceOrders/order-review/events/').map((path) => mockDocs.get(path));
    expect(events.filter((event) => event.type === 'review_opened')).toHaveLength(1);
    expect(events.find((event) => event.type === 'review_opened').data).toEqual({ trigger: 'customer_report' });
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'customer-test',
      'MARKETPLACE',
      'PAYMENT_UNDER_REVIEW',
      expect.objectContaining({ orderId: 'order-review', shopName: 'Vaigzz' })
    );
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'shop-1',
      'MARKETPLACE',
      'PAYMENT_REVIEW_SHOP',
      expect.objectContaining({ displayId: '#62191' })
    );
    expect(mockSendTemplate).not.toHaveBeenCalledWith(
      'shop-1',
      'MARKETPLACE',
      'UTR_SUBMITTED',
      expect.anything()
    );

    mockSendTemplate.mockClear();
    const again = await submitCustomerUtr({
      customerId: 'customer-test',
      orderId: 'order-review',
      idempotencyKey: KEY,
      utr: UTR
    });
    expect(again.status).toBe(200);
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsOpened).toBe(1);
    expect(pathsStarting('marketplaceOrders/order-review/events/').length).toBe(events.length);
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });
});

describe('customer cancel', () => {
  test('cancel on payment_review is INVALID_STATE', async () => {
    seedOrder('order-review-cancel', {
      orderStatus: 'payment_review',
      payment: {
        status: 'under_review',
        customerUtr: UTR,
        review: { status: 'open', trigger: 'customer_report' }
      }
    });
    const response = await postCancel('order-review-cancel');
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_STATE');
    expect(mockDocs.get('marketplaceOrders/order-review-cancel').orderStatus).toBe('payment_review');
  });

  test('cancel without a UTR releases the matching lock and does not go below zero', async () => {
    seedOrder('order-c1');
    seedLock('order-c1');
    seedUser(1);

    const response = await postCancel('order-c1');
    expect(response.status).toBe(200);
    expect(response.body.data.order.orderStatus).toBe('cancelled');
    expect(response.body.data.order.payment.status).toBe('cancelled');
    expect(response.body.data.order.cancellation.reason).toBe('customer_unpaid_cancel');
    expect(response.body.data.order.cancellation.paidCheck).toBeNull();
    expect(JSON.stringify(response.body)).not.toContain('654321');
    expect(mockDocs.has('marketplaceLocks/customer-test_shop-1')).toBe(false);
    expect(mockDocs.get('users/customer-test').customer.marketplace.unpaidCount).toBe(0);
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'shop-1',
      'MARKETPLACE',
      'CUSTOMER_CANCELLED',
      { displayId: '#62191', orderId: 'order-c1', detail: 'No payment was recorded.' }
    );

    const eventsBefore = pathsStarting('marketplaceOrders/order-c1/events/').length;
    const replay = await postCancel('order-c1');
    expect(replay.status).toBe(200);
    expect(pathsStarting('marketplaceOrders/order-c1/events/')).toHaveLength(eventsBefore);
    expect(mockDocs.get('users/customer-test').customer.marketplace.unpaidCount).toBe(0);
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);

    seedOrder('order-c0');
    seedLock('order-c0');
    seedUser(0);
    const zero = await postCancel('order-c0');
    expect(zero.status).toBe(200);
    expect(mockDocs.get('users/customer-test').customer.marketplace.unpaidCount).toBe(0);
    expect(mockDocs.has('marketplaceLocks/customer-test_shop-1')).toBe(false);
  });

  test('cancel with a UTR sets paidCheck pending and does not create a refund', async () => {
    seedOrder('order-c2', {
      shopId: 'shop-2',
      payment: { status: 'customer_claimed', customerUtr: UTR, amount: 1540 }
    });
    seedLock('order-c2', 'shop-2');
    seedUser(1);

    const response = await postCancel('order-c2');
    expect(response.status).toBe(200);
    expect(response.body.data.order.cancellation.reason).toBe('customer_cancel');
    expect(response.body.data.order.cancellation.paidCheck).toBe('pending');
    expect(response.body.data.order.cancellation.paidCheckAt).toEqual(expect.any(String));
    expect(response.body.data.order.payment.status).toBe('customer_claimed');
    expect(pathsStarting('refunds/')).toHaveLength(0);
    expect(mockDocs.has('marketplaceLocks/customer-test_shop-2')).toBe(false);
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'shop-2',
      'MARKETPLACE',
      'CUSTOMER_CANCELLED',
      { displayId: '#62191', orderId: 'order-c2', detail: 'Check whether you received the payment.' }
    );
    expect(JSON.stringify(response.body)).not.toContain('654321');
  });

  test('preparing cannot be cancelled', async () => {
    seedOrder('order-prep', { orderStatus: 'preparing', payment: { status: 'confirmed' } });
    const preparing = await postCancel('order-prep');
    expect(preparing.status).toBe(409);
    expect(preparing.body.error.code).toBe('CANCEL_NOT_ALLOWED');
    expect(mockSendTemplate).not.toHaveBeenCalled();
  });

  test('a short order cancels once and refunds the amount received', async () => {
    seedOrder('order-short', {
      shopSnapshot: { name: 'Vaigzz' },
      payment: {
        status: 'short',
        amount: 100,
        receivedAmount: 40,
        balance: { amount: 60, amountPaise: 6000, dueBy: stamp(Date.now() + HOUR), utr: null }
      }
    });
    seedLock('order-short');
    seedUser(1);

    const response = await postCancel('order-short');
    expect(response.status).toBe(200);
    expect(response.body.data.order.orderStatus).toBe('cancelled');
    expect(response.body.data.order.cancellation.reason).toBe('amount_short_cancel');
    expect(response.body.data.order.payment.status).toBe('refund_pending');
    const stored = mockDocs.get('marketplaceOrders/order-short');
    expect(stored.closedReason).toBe('amount_short_cancel');
    expect(response.body.data.refund).toEqual({
      id: refundDocs('order-short')[0].id,
      amount: 40,
      status: 'upi_needed'
    });
    expect(stored.refunds).toBeUndefined();
    expect(stored.hasOpenRefund).toBe(true);
    expect(refundDocs('order-short')).toHaveLength(1);
    expect(refundDocs('order-short')[0]).toMatchObject({ reason: 'amount_short_cancel', amount: 40 });
    expect(mockDocs.has('marketplaceLocks/customer-test_shop-1')).toBe(false);
    expect(mockDocs.get('users/customer-test').customer.marketplace.unpaidCount).toBe(0);
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'customer-test',
      'MARKETPLACE',
      'REFUND_INITIATED',
      expect.objectContaining({
        amount: 40,
        orderId: 'order-short',
        shopName: 'Vaigzz',
        displayId: '#62191'
      })
    );
    const { NotificationTemplateProcessor } = require('../src/services/notificationTemplates');
    const sent = mockSendTemplate.mock.calls.find((call) => call[2] === 'REFUND_INITIATED');
    const processed = NotificationTemplateProcessor.process(
      NotificationTemplateProcessor.getTemplate('MARKETPLACE', 'REFUND_INITIATED'),
      sent[3]
    );
    expect(Object.keys(processed.data).sort()).toEqual(['action', 'displayId', 'orderId', 'shopName', 'type']);
    expect(processed.data.orderId).toBe('order-short');
    expect(processed.data.orderId).not.toBe('');
    expect(processed.data).toEqual({
      type: 'refund_initiated',
      orderId: 'order-short',
      displayId: '#62191',
      shopName: 'Vaigzz',
      action: 'view_order'
    });

    const replay = await postCancel('order-short');
    expect(replay.status).toBe(200);
    expect(refundDocs('order-short')).toHaveLength(1);
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
  });
});

describe('balance UTR', () => {
  const BALANCE = '555555555555';

  function shortOrder(id, extra = {}) {
    const due = extra.dueBy || stamp(Date.now() + HOUR);
    seedOrder(id, {
      payment: {
        status: 'short',
        amount: 100,
        customerUtr: UTR,
        receivedAmount: 40,
        balance: {
          amount: 60,
          amountPaise: 6000,
          dueBy: due,
          utr: extra.utr || null,
          submittedAt: extra.utr ? stamp(Date.now()) : null,
          confirmedAt: null
        }
      }
    });
  }

  function postBalance(id, utr) {
    return request(app())
      .post(`/api/customer/marketplace-orders/${id}/balance-utr`)
      .set('Idempotency-Key', KEY)
      .send({ utr });
  }

  test('a balance UTR before dueBy is kind balance and a repeat does not write again', async () => {
    shortOrder('order-b1');
    seedLock('order-b1');
    const created = await postBalance('order-b1', BALANCE);
    expect(created.status).toBe(200);
    expect(created.body.data.order.orderStatus).toBe('awaiting_payment');
    expect(created.body.data.order.payment.balance.utr).toBe(BALANCE);
    expect(mockDocs.get(`utrRegistry/${BALANCE}`)).toMatchObject({
      orderId: 'order-b1',
      kind: 'balance'
    });
    expect(mockDocs.has('marketplaceLocks/customer-test_shop-1')).toBe(true);
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'shop-1',
      'MARKETPLACE',
      'UTR_SUBMITTED',
      { displayId: '#62191', orderId: 'order-b1' }
    );

    const replay = await postBalance('order-b1', BALANCE);
    expect(replay.status).toBe(200);
    expect(pathsStarting(`utrRegistry/${BALANCE}`)).toHaveLength(1);
    expect(pathsStarting('marketplaceOrders/order-b1/events/')).toHaveLength(1);
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);

    const different = await postBalance('order-b1', OTHER_UTR);
    expect(different.status).toBe(409);
    expect(different.body.error.code).toBe('ALREADY_SUBMITTED');
  });

  test('another order, the payment UTR, and a closed window are refused', async () => {
    shortOrder('order-b2');
    mockDocs.set(`utrRegistry/${BALANCE}`, { orderId: 'other-order', kind: 'customer' });
    const used = await postBalance('order-b2', BALANCE);
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe('UTR_USED');

    shortOrder('order-b3');
    mockDocs.set(`utrRegistry/${UTR}`, { orderId: 'order-b3', customerId: 'customer-test', kind: 'customer' });
    const reused = await postBalance('order-b3', UTR);
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('UTR_USED');

    shortOrder('order-b4', { dueBy: stamp(Date.now()) });
    const closed = await postBalance('order-b4', OTHER_UTR);
    expect(closed.status).toBe(409);
    expect(closed.body.error.code).toBe('BALANCE_WINDOW_CLOSED');
  });

  test('customer GET while short returns the balance and dueBy', async () => {
    const due = stamp(Date.UTC(2026, 0, 2, 3, 4, 5));
    shortOrder('order-b5', { dueBy: due });
    const response = await request(app()).get('/api/customer/marketplace-orders/order-b5');
    expect(response.status).toBe(200);
    expect(response.body.data.paymentDetails.expectedAmount).toBe(60);
    expect(response.body.data.paymentDetails.expectedAmountPaise).toBe(6000);
    expect(response.body.data.paymentDetails.dueBy).toBe('2026-01-02T03:04:05.000Z');
    expect(response.body.data.paymentDetails.upiId).toBeNull();
    expect(response.body.data.order.payment.balance.amount).toBe(60);
    expect(JSON.stringify(response.body)).not.toContain('654321');
  });
});
