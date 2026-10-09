const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const mockDocs = new Map();
const mockSendTemplate = jest.fn(async () => ({ success: true }));
const mockCaptureMessage = jest.fn();

function mockClone(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (typeof value.toMillis === 'function' || value instanceof Date) {
    return value;
  }
  const method = value._methodName || value.methodName;
  if (method) {
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

function docsUnder(prefix) {
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
  return docs;
}

function mockRef(docPath) {
  const id = docPath.split('/').pop();
  return {
    id,
    path: docPath,
    collection(name) {
      const prefix = `${docPath}/${name}/`;
      return {
        doc(subId) {
          const child = subId || `auto-${mockDocs.size + 1}`;
          return mockRef(`${docPath}/${name}/${child}`);
        },
        async get() {
          const docs = docsUnder(prefix);
          return { docs, empty: docs.length === 0, size: docs.length };
        }
      };
    },
    async get() {
      const data = mockDocs.get(docPath);
      return {
        exists: data !== undefined,
        id,
        ref: mockRef(docPath),
        data: () => (data === undefined ? undefined : mockClone(data))
      };
    }
  };
}

function mockRead(data, field) {
  return field.split('.').reduce((cursor, key) => (cursor == null ? undefined : cursor[key]), data);
}

function mockDb() {
  return {
    collection(name) {
      const filters = [];
      const api = {
        where(field, op, value) {
          filters.push({ field, op, value });
          return api;
        },
        doc(docId) {
          return mockRef(`${name}/${docId}`);
        },
        async get() {
          const docs = [];
          mockDocs.forEach((data, docPath) => {
            if (!docPath.startsWith(`${name}/`) || docPath.split('/').length !== 2) {
              return;
            }
            const matches = filters.every((filter) => mockRead(data, filter.field) === filter.value);
            if (!matches) {
              return;
            }
            docs.push({
              id: docPath.split('/').pop(),
              ref: mockRef(docPath),
              data: () => mockClone(data)
            });
          });
          return { docs, empty: docs.length === 0, size: docs.length };
        }
      };
      return api;
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
  sendTemplateNotification: (...args) => mockSendTemplate(...args)
}));

jest.mock('../instrument.js', () => ({
  captureMessage: (...args) => mockCaptureMessage(...args)
}));

jest.mock('../src/services/displayIdService', () => ({
  formatDisplayId: (value) => (value == null ? '' : `#${value}`)
}));

const {
  submitCustomerUpi,
  acknowledgeRefund,
  markRefundSent,
  resolveRefundDispute,
  recordFoundRefund,
  listShopRefunds,
  presentShopRefund
} = require('../src/services/marketplace/refunds');
const job = require('../src/services/marketplaceRefundJob');
const shopOrderService = require('../src/services/shopOrderService');
const { NotificationTemplateProcessor } = require('../src/services/notificationTemplates');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const KEY = '11111111-1111-4111-8111-111111111111';
const KEY_TWO = '22222222-2222-4222-8222-222222222222';
const UPI = 'refund@okaxis';
const UTR = '123456789012';
const OTHER_UTR = '999999999999';
const ON = { newStatuses: true };

function stamp(ms) {
  return { toMillis: () => ms, toDate: () => new Date(ms) };
}

function isServerStamp(value) {
  const probe = admin.firestore.FieldValue.serverTimestamp();
  if (!value || typeof value !== 'object' || typeof value.toMillis === 'function') {
    return false;
  }
  if (typeof value.isEqual === 'function' && value.isEqual(probe)) {
    return true;
  }
  const method = value._methodName || value.methodName;
  const probeMethod = probe._methodName || probe.methodName;
  return Boolean(method) && method === probeMethod;
}

function blankReminders() {
  return {
    upi24: false,
    upi72: false,
    upiAlert7d: false,
    due24: false,
    due48: false,
    ack24: false
  };
}

function putOrder(id, data) {
  mockDocs.set(`marketplaceOrders/${id}`, {
    customerId: 'cust-1',
    shopId: 'shop-1',
    displayId: 11,
    shopSnapshot: { name: 'Vaigzz' },
    ...data
  });
}

function putRefund(orderId, refundId, data) {
  mockDocs.set(`marketplaceOrders/${orderId}/refunds/${refundId}`, {
    id: refundId,
    orderId,
    shopId: 'shop-1',
    customerId: 'cust-1',
    reason: 'overpaid',
    amount: 40,
    status: 'upi_needed',
    customerUpiId: null,
    reminders: blankReminders(),
    overdueCounted: false,
    ...data
  });
}

function orderOf(id) {
  return mockDocs.get(`marketplaceOrders/${id}`);
}

function refundOf(orderId, refundId) {
  return mockDocs.get(`marketplaceOrders/${orderId}/refunds/${refundId}`);
}

function eventsOf(orderId) {
  const prefix = `marketplaceOrders/${orderId}/events/`;
  const found = [];
  mockDocs.forEach((data, docPath) => {
    if (docPath.startsWith(prefix)) {
      found.push(data);
    }
  });
  return found;
}

beforeEach(() => {
  mockDocs.clear();
  mockSendTemplate.mockClear();
  mockCaptureMessage.mockClear();
  job.ticking = false;
});

describe('customer refund UPI', () => {
  beforeEach(() => {
    putOrder('order-1', {
      orderStatus: 'preparing',
      payment: { status: 'confirmed' },
      hasOpenRefund: true
    });
    putRefund('order-1', 'refund-1', {});
  });

  test('rejects a mismatch and an invalid UPI', async () => {
    await expect(submitCustomerUpi({
      customerId: 'cust-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      idempotencyKey: KEY,
      upiId: UPI,
      upiIdConfirm: 'other@okaxis'
    })).rejects.toMatchObject({ code: 'MISMATCH' });

    await expect(submitCustomerUpi({
      customerId: 'cust-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      idempotencyKey: KEY,
      upiId: 'not-an-upi',
      upiIdConfirm: 'not-an-upi'
    })).rejects.toMatchObject({ code: 'INVALID_UPI' });
    expect(refundOf('order-1', 'refund-1').status).toBe('upi_needed');
  });

  test('stores the UPI, starts the 24h due clock, and can save it on the profile', async () => {
    const now = Date.UTC(2026, 6, 1);
    mockDocs.set('users/cust-1', { customer: { marketplace: {} } });
    const result = await submitCustomerUpi({
      customerId: 'cust-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      idempotencyKey: KEY,
      upiId: ` ${UPI} `,
      upiIdConfirm: UPI,
      save: true,
      nowMs: now
    });
    const refund = refundOf('order-1', 'refund-1');
    expect(result.body.data.refund.customerUpiId).toBe(UPI);
    expect(refund.status).toBe('due');
    expect(refund.customerUpiId).toBe(UPI);
    expect(refund.dueBy.toMillis()).toBe(now + (24 * HOUR));
    expect(orderOf('order-1').payment.status).toBe('confirmed');
    expect(mockDocs.get('users/cust-1').customer.marketplace.refundUpiId).toBe(UPI);
    expect(mockSendTemplate).toHaveBeenCalledWith('shop-1', 'MARKETPLACE', 'REFUND_DUE', expect.any(Object));
    expect(eventsOf('order-1').some((event) => event.type === 'refund_upi')).toBe(true);

    const replay = await submitCustomerUpi({
      customerId: 'cust-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      idempotencyKey: KEY,
      upiId: UPI,
      upiIdConfirm: UPI,
      nowMs: now
    });
    expect(replay.body.data.refund.status).toBe('due');
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);

    await expect(submitCustomerUpi({
      customerId: 'cust-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      idempotencyKey: KEY_TWO,
      upiId: UPI,
      upiIdConfirm: UPI
    })).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
  });
});

describe('shop marks a refund sent', () => {
  beforeEach(() => {
    putOrder('order-1', {
      orderStatus: 'cancelled',
      payment: { status: 'refund_pending' },
      hasOpenRefund: true
    });
    putRefund('order-1', 'refund-1', { status: 'due', customerUpiId: UPI, amount: 40 });
  });

  test('requires the refund amount and a fresh UTR', async () => {
    await expect(markRefundSent({
      shopId: 'shop-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      refundUtr: UTR,
      amount: 39,
      actor: { type: 'shop', id: 'shop-1' }
    })).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' });

    mockDocs.set(`utrRegistry/${UTR}`, { orderId: 'order-1', kind: 'customer' });
    await expect(markRefundSent({
      shopId: 'shop-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      refundUtr: UTR,
      amount: 40,
      actor: { type: 'shop', id: 'shop-1' }
    })).rejects.toMatchObject({ code: 'UTR_USED' });
    mockDocs.delete(`utrRegistry/${UTR}`);

    const sent = await markRefundSent({
      shopId: 'shop-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      refundUtr: UTR,
      amount: 40,
      actor: { type: 'shop', id: 'shop-1' },
      eventReason: 'Paid from the shop UPI'
    });
    expect(sent.alreadyProcessed).toBe(false);
    expect(refundOf('order-1', 'refund-1').status).toBe('sent');
    expect(mockDocs.get(`utrRegistry/${UTR}`).kind).toBe('refund');
    expect(eventsOf('order-1').find((event) => event.type === 'refund_sent').data.refundUtrLast4).toBe('9012');
    expect(mockSendTemplate).toHaveBeenCalledWith(
      'cust-1',
      'MARKETPLACE',
      'REFUND_SENT',
      expect.objectContaining({ refundUtr: UTR })
    );

    const replay = await markRefundSent({
      shopId: 'shop-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      refundUtr: UTR,
      amount: 40,
      actor: { type: 'shop', id: 'shop-1' }
    });
    expect(replay.alreadyProcessed).toBe(true);

    await expect(markRefundSent({
      shopId: 'shop-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      refundUtr: OTHER_UTR,
      amount: 40,
      actor: { type: 'shop', id: 'shop-1' }
    })).rejects.toMatchObject({ code: 'ALREADY_SUBMITTED' });
  });
});

describe('acknowledgement and the payment mirror', () => {
  test('a cancelled order stays refund_pending until every refund is closed', async () => {
    putOrder('order-1', {
      orderStatus: 'cancelled',
      payment: { status: 'refund_pending' },
      hasOpenRefund: true
    });
    putRefund('order-1', 'refund-1', { status: 'sent', refundUtr: UTR });
    putRefund('order-1', 'refund-2', { status: 'due', customerUpiId: UPI });

    await acknowledgeRefund({
      customerId: 'cust-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      received: true,
      idempotencyKey: KEY
    });
    expect(refundOf('order-1', 'refund-1').status).toBe('confirmed');
    expect(orderOf('order-1').hasOpenRefund).toBe(true);
    expect(orderOf('order-1').payment.status).toBe('refund_pending');

    putRefund('order-1', 'refund-2', { status: 'sent', refundUtr: OTHER_UTR, amount: 40 });
    await acknowledgeRefund({
      customerId: 'cust-1',
      orderId: 'order-1',
      refundId: 'refund-2',
      received: true,
      idempotencyKey: KEY_TWO
    });
    expect(orderOf('order-1').hasOpenRefund).toBe(false);
    expect(orderOf('order-1').payment.status).toBe('refunded');
  });

  test('an active order keeps payment confirmed when the refund closes', async () => {
    putOrder('order-1', {
      orderStatus: 'preparing',
      payment: { status: 'confirmed' },
      hasOpenRefund: true
    });
    putRefund('order-1', 'refund-1', { status: 'sent', refundUtr: UTR, reason: 'overpaid' });
    await acknowledgeRefund({
      customerId: 'cust-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      received: true,
      idempotencyKey: KEY
    });
    expect(orderOf('order-1').payment.status).toBe('confirmed');
    expect(orderOf('order-1').hasOpenRefund).toBe(false);
  });

  test('not received opens a dispute, including a late dispute inside 7 days', async () => {
    const closedAt = Date.UTC(2026, 6, 1);
    putOrder('order-1', {
      orderStatus: 'cancelled',
      payment: { status: 'refunded' },
      hasOpenRefund: false
    });
    putRefund('order-1', 'refund-1', { status: 'sent', refundUtr: UTR });
    await acknowledgeRefund({
      customerId: 'cust-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      received: false,
      idempotencyKey: KEY
    });
    expect(refundOf('order-1', 'refund-1').status).toBe('disputed');
    expect(orderOf('order-1').hasOpenRefund).toBe(true);
    expect(orderOf('order-1').payment.status).toBe('refund_pending');
    expect(mockCaptureMessage).toHaveBeenCalled();

    putOrder('order-closed', {
      orderStatus: 'cancelled',
      payment: { status: 'refunded' },
      hasOpenRefund: false
    });
    putRefund('order-closed', 'refund-1', {
      status: 'closed',
      autoClosedAt: stamp(closedAt),
      refundUtr: UTR
    });
    await acknowledgeRefund({
      customerId: 'cust-1',
      orderId: 'order-closed',
      refundId: 'refund-1',
      received: false,
      idempotencyKey: KEY,
      nowMs: closedAt + (7 * DAY) - 1
    });
    expect(refundOf('order-closed', 'refund-1').status).toBe('disputed');
    expect(eventsOf('order-closed').find((event) => event.type === 'refund_disputed').data.late).toBe(true);
    expect(orderOf('order-closed').payment.status).toBe('refund_pending');

    putRefund('order-closed', 'refund-1', {
      status: 'closed',
      autoClosedAt: stamp(closedAt)
    });
    putOrder('order-closed', {
      orderStatus: 'cancelled',
      payment: { status: 'refunded' },
      hasOpenRefund: false
    });
    await expect(acknowledgeRefund({
      customerId: 'cust-1',
      orderId: 'order-closed',
      refundId: 'refund-1',
      received: false,
      idempotencyKey: KEY_TWO,
      nowMs: closedAt + (7 * DAY)
    })).rejects.toMatchObject({ code: 'INVALID_STATE' });

    putRefund('order-1', 'refund-1', { status: 'confirmed', refundUtr: UTR });
    await expect(acknowledgeRefund({
      customerId: 'cust-1',
      orderId: 'order-1',
      refundId: 'refund-1',
      received: false,
      idempotencyKey: KEY_TWO
    })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});

describe('support resend and a found refund', () => {
  test('resend to due keeps the UPI and resend to upi_needed clears it', async () => {
    const now = Date.UTC(2026, 7, 1);
    putOrder('order-1', {
      orderStatus: 'preparing',
      payment: { status: 'confirmed' },
      hasOpenRefund: true
    });
    putRefund('order-1', 'refund-1', {
      status: 'disputed',
      customerUpiId: UPI,
      refundUtr: UTR,
      sentAt: stamp(now - HOUR),
      reminders: { ...blankReminders(), due24: true, due48: true }
    });
    mockDocs.set(`utrRegistry/${UTR}`, { orderId: 'order-1', kind: 'refund' });

    await resolveRefundDispute({
      orderId: 'order-1',
      refundId: 'refund-1',
      outcome: 'resend',
      to: 'due',
      operator: 'ops-mp8',
      nowMs: now
    });
    const due = refundOf('order-1', 'refund-1');
    expect(due.status).toBe('due');
    expect(due.customerUpiId).toBe(UPI);
    expect(due.refundUtr).toBeNull();
    expect(due.reminders.due24).toBe(false);
    expect(due.dueBy.toMillis()).toBe(now + (24 * HOUR));
    expect(mockDocs.get(`utrRegistry/${UTR}`).kind).toBe('refund');
    expect(eventsOf('order-1')[0]).toMatchObject({
      type: 'refund_resent',
      data: { to: 'due', refundUtrLast4: '9012' }
    });
    expect(orderOf('order-1').payment.status).toBe('confirmed');

    putRefund('order-1', 'refund-1', {
      status: 'disputed',
      customerUpiId: UPI,
      refundUtr: UTR
    });
    await resolveRefundDispute({
      orderId: 'order-1',
      refundId: 'refund-1',
      outcome: 'resend',
      to: 'upi_needed',
      operator: 'ops-mp8',
      nowMs: now
    });
    const cleared = refundOf('order-1', 'refund-1');
    expect(cleared.status).toBe('upi_needed');
    expect(cleared.customerUpiId).toBeNull();
    expect(isServerStamp(cleared.upiChaseFrom)).toBe(true);
    expect(cleared.reminders.upi24).toBe(false);
  });

  test('a found refund is only for a not-verified cancellation', async () => {
    putOrder('order-review', { orderStatus: 'payment_review', payment: { status: 'under_review', review: { status: 'open' } } });
    await expect(recordFoundRefund({
      orderId: 'order-review',
      amount: 40,
      operator: 'ops-mp8',
      reason: 'Bank statement shows the payment'
    })).rejects.toMatchObject({ code: 'INVALID_STATE' });

    putOrder('order-other', {
      orderStatus: 'cancelled',
      closedReason: 'customer_cancel',
      payment: { status: 'customer_claimed' }
    });
    await expect(recordFoundRefund({
      orderId: 'order-other',
      amount: 40,
      operator: 'ops-mp8',
      reason: 'Found later'
    })).rejects.toMatchObject({ code: 'INVALID_STATE' });

    putOrder('order-1', {
      orderStatus: 'cancelled',
      closedReason: 'payment_not_verified',
      payment: { status: 'not_verified' },
      items: [{ name: 'Statue' }]
    });
    const created = await recordFoundRefund({
      orderId: 'order-1',
      amount: 40,
      operator: 'ops-mp8',
      reason: 'Bank statement shows the payment'
    });
    expect(created.orderStatus).toBe('cancelled');
    expect(orderOf('order-1').orderStatus).toBe('cancelled');
    expect(orderOf('order-1').hasOpenRefund).toBe(true);
    expect(orderOf('order-1').payment.status).toBe('refund_pending');
    expect(orderOf('order-1').payment.receivedAmount).toBe(40);
    expect(orderOf('order-1').payment.receivedAmountPaise).toBe(4000);
    const stored = [...mockDocs.entries()].find(([docPath]) => docPath.startsWith('marketplaceOrders/order-1/refunds/'));
    expect(stored[1].reason).toBe('support_decision');
    expect(eventsOf('order-1').find((event) => event.type === 'refund_created').reason).toBe('Bank statement shows the payment');
    expect(mockDocs.get('marketplaceOrders/order-1/signal/latest')).toMatchObject({
      customerId: 'cust-1',
      type: 'refund_created'
    });

    await expect(recordFoundRefund({
      orderId: 'order-1',
      amount: 40,
      operator: 'ops-mp8',
      reason: 'Bank statement shows the payment'
    })).rejects.toThrow(`A found refund is already recorded (refund ${stored[1].id})`);
  });
});

describe('refund job', () => {
  const start = Date.UTC(2031, 5, 1);

  function preparingOverpaid() {
    putOrder('order-1', {
      orderStatus: 'preparing',
      payment: { status: 'confirmed' },
      hasOpenRefund: true
    });
    putRefund('order-1', 'refund-1', {
      reason: 'overpaid',
      status: 'upi_needed',
      upiChaseFrom: stamp(start)
    });
  }

  test('does nothing when new statuses are off', async () => {
    preparingOverpaid();
    const result = await job.runTick({ nowMs: start + (8 * DAY), enforcement: { newStatuses: false } });
    expect(result.actions).toEqual([]);
    expect(refundOf('order-1', 'refund-1').reminders.upiAlert7d).toBe(false);
  });

  test('chases an overpaid refund on a preparing order and leaves payment confirmed', async () => {
    preparingOverpaid();
    const exact = await job.runTick({ nowMs: start + (24 * HOUR), enforcement: ON });
    expect(exact.actions).toEqual([]);

    const first = await job.runTick({ nowMs: start + (24 * HOUR) + 1, enforcement: ON });
    expect(first.actions.map((action) => action.kind)).toEqual(['upi24']);
    expect(isServerStamp(refundOf('order-1', 'refund-1').updatedAt)).toBe(true);
    expect(orderOf('order-1').payment.status).toBe('confirmed');

    const again = await job.runTick({ nowMs: start + (24 * HOUR) + 2, enforcement: ON });
    expect(again.actions).toEqual([]);

    const second = await job.runTick({ nowMs: start + (72 * HOUR) + 1, enforcement: ON });
    expect(second.actions.map((action) => action.kind)).toEqual(['upi72']);
    const third = await job.runTick({ nowMs: start + (72 * HOUR) + 2, enforcement: ON });
    expect(third.actions).toEqual([]);

    const alert = await job.runTick({ nowMs: start + (7 * DAY) + 1, enforcement: ON });
    expect(alert.actions.map((action) => action.kind)).toEqual(['upi7d']);
    expect(refundOf('order-1', 'refund-1').status).toBe('upi_needed');
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'Marketplace refund UPI still missing',
      expect.objectContaining({ level: 'warning' })
    );
    const alertAgain = await job.runTick({ nowMs: start + (7 * DAY) + 2, enforcement: ON });
    expect(alertAgain.actions).toEqual([]);
    expect(orderOf('order-1').payment.status).toBe('confirmed');

    putRefund('order-1', 'refund-1', {
      status: 'due',
      customerUpiId: UPI,
      upiSubmittedAt: stamp(start),
      dueBy: stamp(start + (24 * HOUR)),
      reminders: blankReminders()
    });
    const dueExact = await job.runTick({ nowMs: start + (24 * HOUR), enforcement: ON });
    expect(dueExact.actions).toEqual([]);
    const due = await job.runTick({ nowMs: start + (24 * HOUR) + 1, enforcement: ON });
    expect(due.actions.map((action) => action.kind)).toEqual(['due24']);
    expect(mockSendTemplate).toHaveBeenCalledWith('shop-1', 'MARKETPLACE', 'REFUND_OVERDUE', expect.any(Object));
    expect(orderOf('order-1').payment.status).toBe('confirmed');

    mockDocs.set('shops/shop-1', { marketplaceStats: { refundsOverdue: 0 } });
    putRefund('order-1', 'refund-1', {
      status: 'due',
      customerUpiId: UPI,
      upiSubmittedAt: stamp(start),
      dueBy: stamp(start + (24 * HOUR)),
      reminders: { ...blankReminders(), due24: true },
      overdueCounted: false
    });
    const escalateExact = await job.runTick({ nowMs: start + (48 * HOUR), enforcement: ON });
    expect(escalateExact.actions).toEqual([]);
    const escalate = await job.runTick({ nowMs: start + (48 * HOUR) + 1, enforcement: ON });
    expect(escalate.actions.map((action) => action.kind)).toEqual(['due48']);
    expect(mockDocs.get('shops/shop-1').marketplaceStats.refundsOverdue).toBe(1);
    const escalateAgain = await job.runTick({ nowMs: start + (48 * HOUR) + 2, enforcement: ON });
    expect(escalateAgain.actions).toEqual([]);
    expect(mockDocs.get('shops/shop-1').marketplaceStats.refundsOverdue).toBe(1);
    expect(orderOf('order-1').payment.status).toBe('confirmed');

    putRefund('order-1', 'refund-1', {
      status: 'sent',
      refundUtr: UTR,
      sentAt: stamp(start),
      reminders: blankReminders()
    });
    const ackExact = await job.runTick({ nowMs: start + (24 * HOUR), enforcement: ON });
    expect(ackExact.actions).toEqual([]);
    const ack = await job.runTick({ nowMs: start + (24 * HOUR) + 1, enforcement: ON });
    expect(ack.actions.map((action) => action.kind)).toEqual(['ack24']);

    putRefund('order-1', 'refund-1', {
      status: 'sent',
      refundUtr: UTR,
      sentAt: stamp(start),
      reminders: { ...blankReminders(), ack24: true }
    });
    const closeExact = await job.runTick({ nowMs: start + (48 * HOUR), enforcement: ON });
    expect(closeExact.actions).toEqual([]);
    const closed = await job.runTick({ nowMs: start + (48 * HOUR) + 1, enforcement: ON });
    expect(closed.actions.map((action) => action.kind)).toEqual(['auto_close']);
    expect(refundOf('order-1', 'refund-1').status).toBe('closed');
    expect(orderOf('order-1').hasOpenRefund).toBe(false);
    expect(orderOf('order-1').payment.status).toBe('confirmed');
    expect(JSON.stringify(orderOf('order-1'))).not.toContain(String(start));
  });

  test('an overlapping tick is skipped and the job never queries payment status', async () => {
    job.ticking = true;
    const skipped = await job.runTick({ nowMs: start, enforcement: ON });
    expect(skipped).toEqual({ skipped: true, reason: 'overlap', actions: [] });

    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'services', 'marketplaceRefundJob.js'),
      'utf8'
    );
    expect(source).not.toContain("collectionGroup('refunds')");
    expect(source).not.toContain('payment.status');
    expect(source).toContain("where('hasOpenRefund', '==', true)");
  });
});

describe('refund views and the legacy sent route', () => {
  test('the shop refund row shows the refund UPI and hides the UTR until it is sent', async () => {
    const view = await shopOrderService.presentOrder('order-1', {
      shopId: 'shop-1',
      customerId: 'cust-1',
      orderStatus: 'preparing',
      payment: { status: 'confirmed', note: 'secret-note' },
      evidence: [{ path: 'secret-file' }],
      hasOpenRefund: true
    }, [{
      id: 'refund-1',
      status: 'due',
      reason: 'overpaid',
      amount: 40,
      customerUpiId: UPI,
      refundUtr: UTR
    }]);
    expect(view.refunds[0].customerUpiId).toBe(UPI);
    expect(view.refunds[0].refundUtr).toBeNull();
    expect(view.evidence).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('secret-note');
    expect(JSON.stringify(view)).not.toContain('secret-file');
    expect(view.payment.status).toBe('confirmed');
    expect(presentShopRefund({
      id: 'refund-1',
      status: 'sent',
      customerUpiId: UPI,
      refundUtr: UTR,
      sentAmount: 40
    }, 'order-1').refundUtr).toBe(UTR);
  });

  test('the shop list reads hasOpenRefund and the legacy route refuses when new statuses are on', async () => {
    putOrder('order-1', {
      shopId: 'shop-1',
      orderStatus: 'preparing',
      payment: { status: 'confirmed' },
      hasOpenRefund: true
    });
    putRefund('order-1', 'refund-1', { status: 'due', customerUpiId: UPI });
    putOrder('order-closed', {
      shopId: 'shop-1',
      orderStatus: 'cancelled',
      hasOpenRefund: false
    });
    const rows = await listShopRefunds('shop-1', 'due', Date.UTC(2026, 0, 1));
    expect(rows).toHaveLength(1);
    expect(rows[0].customerUpiId).toBe(UPI);

    await expect(shopOrderService.refundSent('shop-1', 'order-1', ON))
      .rejects.toMatchObject({ code: 'REFUND_UTR_REQUIRED' });
    expect(orderOf('order-1').payment.status).toBe('confirmed');
    expect(refundOf('order-1', 'refund-1').status).toBe('due');
  });

  test('OFF legacy refund-sent closes open refunds and clears hasOpenRefund', async () => {
    putOrder('order-1', {
      orderStatus: 'cancelled',
      payment: { status: 'refund_pending', amount: 40 },
      hasOpenRefund: true
    });
    putRefund('order-1', 'refund-upi', { status: 'upi_needed' });
    putRefund('order-1', 'refund-due', { status: 'due', customerUpiId: UPI });
    putRefund('order-1', 'refund-sent', { status: 'sent', refundUtr: UTR });
    putRefund('order-1', 'refund-disputed', { status: 'disputed', refundUtr: OTHER_UTR });
    putRefund('order-1', 'refund-done', { status: 'confirmed', refundUtr: '888888888888' });

    const result = await shopOrderService.refundSent('shop-1', 'order-1', { newStatuses: false });
    expect(result.alreadyProcessed).toBe(false);
    expect(orderOf('order-1').payment.status).toBe('refunded');
    expect(orderOf('order-1').hasOpenRefund).toBe(false);
    ['refund-upi', 'refund-due', 'refund-sent', 'refund-disputed'].forEach((refundId) => {
      expect(refundOf('order-1', refundId).status).toBe('closed');
      expect(refundOf('order-1', refundId).closedBy).toBe('legacy_refund_sent');
    });
    expect(refundOf('order-1', 'refund-done').status).toBe('confirmed');
    expect(refundOf('order-1', 'refund-done').closedBy).toBeUndefined();
    const closedEvents = eventsOf('order-1').filter((event) => event.type === 'refund_auto_closed');
    expect(closedEvents).toHaveLength(4);
    expect(closedEvents.every((event) => event.data && event.data.legacy === true)).toBe(true);
    expect(mockDocs.get('marketplaceOrders/order-1/signal/latest').type).toBe('refund_auto_closed');

    putOrder('order-on', {
      orderStatus: 'cancelled',
      payment: { status: 'refund_pending' },
      hasOpenRefund: true
    });
    putRefund('order-on', 'refund-1', { status: 'upi_needed' });
    await expect(shopOrderService.refundSent('shop-1', 'order-on', ON))
      .rejects.toMatchObject({ code: 'REFUND_UTR_REQUIRED' });
    expect(orderOf('order-on').hasOpenRefund).toBe(true);
    expect(orderOf('order-on').payment.status).toBe('refund_pending');
    expect(refundOf('order-on', 'refund-1').status).toBe('upi_needed');
  });

  test('OFF legacy refund-sent with no open refund writes payment_refunded and one signal', async () => {
    putOrder('order-empty', {
      orderStatus: 'cancelled',
      payment: { status: 'refund_pending', amount: 40 },
      hasOpenRefund: false
    });
    const result = await shopOrderService.refundSent('shop-1', 'order-empty', { newStatuses: false });
    expect(result.alreadyProcessed).toBe(false);
    expect(orderOf('order-empty').payment.status).toBe('refunded');
    expect(eventsOf('order-empty').map((event) => event.type)).toEqual(['payment_refunded']);
    expect(eventsOf('order-empty')[0].actor).toEqual({ type: 'shop', id: 'shop-1' });
    const signal = mockDocs.get('marketplaceOrders/order-empty/signal/latest');
    expect(Object.keys(signal).sort()).toEqual(['customerId', 'type', 'updatedAt']);
    expect(signal).toMatchObject({ customerId: 'cust-1', type: 'payment_refunded' });
  });

  test('REFUND_SENT shows the last 4 and the payload has no full UTR or amount', () => {
    const sent = NotificationTemplateProcessor.process(
      NotificationTemplateProcessor.getTemplate('MARKETPLACE', 'REFUND_SENT'),
      { displayId: '#11', refundUtr: UTR, amount: 40, upiId: UPI }
    );
    expect(sent.body).toContain('9012');
    expect(JSON.stringify(sent)).not.toMatch(/\d{12}/);
    expect(sent.data.variables.amount).toBeUndefined();
    expect(sent.data.variables.refundUtr).toBeUndefined();
    expect(sent.data.variables.upiId).toBeUndefined();

    const initiated = NotificationTemplateProcessor.process(
      NotificationTemplateProcessor.getTemplate('MARKETPLACE', 'REFUND_INITIATED'),
      { displayId: '#11', amount: 40 }
    );
    expect(initiated.body).toBe('Share your UPI ID to receive your refund.');
    expect(initiated.data).toEqual({
      type: 'refund_initiated',
      orderId: '',
      displayId: '#11',
      shopName: '',
      action: 'view_order'
    });
    expect(JSON.stringify(initiated.data)).not.toContain('40');
  });
});
