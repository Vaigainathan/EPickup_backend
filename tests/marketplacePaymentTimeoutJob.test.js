const mockTimeoutDocs = new Map();
const mockTimeoutOps = [];
const mockNotifyCustomer = jest.fn(async () => ({ success: true }));
const mockSendTemplate = jest.fn(async () => ({ success: true }));
const mockCaptureMessage = jest.fn();
let mockEventSeq = 0;
let mockFlipOnRead = null;

function mockTimeoutRef(path) {
  const id = path.split('/').pop();
  return {
    id,
    path,
    collection(name) {
      return {
        doc(subId) {
          const child = subId || `auto-${mockEventSeq += 1}`;
          return mockTimeoutRef(`${path}/${name}/${child}`);
        }
      };
    },
    async get() {
      const data = mockTimeoutDocs.get(path);
      return {
        exists: data !== undefined,
        id,
        data: () => data
      };
    }
  };
}

function mockMillis(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (typeof value === 'number') {
    return value;
  }
  return null;
}

function mockRead(data, field) {
  return field.split('.').reduce((cursor, key) => (cursor == null ? undefined : cursor[key]), data);
}

function mockMatches(data, filters) {
  return filters.every((filter) => {
    const current = mockRead(data, filter.field);
    if (filter.op === '==') {
      return current === filter.value;
    }
    if (filter.op === 'in') {
      return filter.value.includes(current);
    }
    const left = mockMillis(current);
    const right = mockMillis(filter.value);
    if (left == null || right == null) {
      return false;
    }
    if (filter.op === '<') {
      return left < right;
    }
    if (filter.op === '<=') {
      return left <= right;
    }
    return false;
  });
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

function mockTimeoutDb() {
  return {
    collection(name) {
      const filters = [];
      const api = {
        where(field, op, value) {
          filters.push({ field, op, value });
          return api;
        },
        doc(id) {
          return mockTimeoutRef(`${name}/${id}`);
        },
        async get() {
          const docs = [];
          mockTimeoutDocs.forEach((data, path) => {
            if (!path.startsWith(`${name}/`) || path.split('/').length !== 2) {
              return;
            }
            if (!mockMatches(data, filters)) {
              return;
            }
            docs.push({
              id: path.split('/').pop(),
              ref: mockTimeoutRef(path),
              data: () => data
            });
          });
          return { docs, size: docs.length, empty: docs.length === 0 };
        }
      };
      return api;
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          if (mockFlipOnRead && ref.path === mockFlipOnRead.path) {
            mockApplyPatch(mockTimeoutDocs.get(ref.path), mockFlipOnRead.patch);
            mockFlipOnRead = null;
          }
          const data = mockTimeoutDocs.get(ref.path);
          return {
            exists: data !== undefined,
            id: ref.id,
            data: () => data
          };
        },
        set(ref, data) {
          rejectArrayServerTimestamp(data, '');
          mockTimeoutOps.push({ op: 'set', path: ref.path, data });
          mockTimeoutDocs.set(ref.path, data);
        },
        update(ref, patch) {
          rejectArrayServerTimestamp(patch, '');
          mockTimeoutOps.push({ op: 'update', path: ref.path, patch });
          const current = { ...(mockTimeoutDocs.get(ref.path) || {}) };
          mockTimeoutDocs.set(ref.path, mockApplyPatch(current, patch));
        },
        delete(ref) {
          mockTimeoutOps.push({ op: 'delete', path: ref.path });
          mockTimeoutDocs.delete(ref.path);
        }
      };
      return fn(tx);
    }
  };
}

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => mockTimeoutDb()
}));

jest.mock('../src/services/shopOrderService', () => ({
  notifyCustomer: (...args) => mockNotifyCustomer(...args)
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: (...args) => mockSendTemplate(...args)
}));

jest.mock('../instrument.js', () => ({
  captureMessage: (...args) => mockCaptureMessage(...args)
}));

jest.mock('../src/services/displayIdService', () => ({
  formatDisplayId: (value) => `#${value}`
}));

const admin = require('firebase-admin');
const job = require('../src/services/marketplacePaymentTimeoutJob');
const { _resetEnforcementCache } = require('../src/services/marketplace/orderStateMachine');

const ON = { newStatuses: true };
const OFF = { newStatuses: false };

function stamp(ms) {
  return { toMillis: () => ms, toDate: () => new Date(ms) };
}

function rejectArrayServerTimestamp(value, path, insideArray) {
  if (isServerStamp(value)) {
    if (insideArray) {
      throw new Error(`FieldValue.serverTimestamp() cannot be used inside of an array (found in field ${path})`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const next = path ? `${path}.\`${index}\`` : `\`${index}\``;
      rejectArrayServerTimestamp(item, next, true);
    });
    return;
  }
  if (!value || typeof value !== 'object' || typeof value.toMillis === 'function') {
    return;
  }
  Object.keys(value).forEach((key) => {
    const next = path ? `${path}.${key}` : key;
    rejectArrayServerTimestamp(value[key], next, insideArray);
  });
}

function isRealClockTimestamp(value, simulatedNow) {
  return Boolean(value)
    && typeof value.toMillis === 'function'
    && value.toMillis() !== simulatedNow
    && Math.abs(value.toMillis() - Date.now()) < 5000;
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

function eventsFor(orderId) {
  return [...mockTimeoutDocs.entries()]
    .filter(([path]) => path.startsWith(`marketplaceOrders/${orderId}/events/`))
    .map(([, data]) => data);
}

function seedTimeout(ms = 900000) {
  mockTimeoutDocs.set('appSettings/marketplace', { PAYMENT_TIMEOUT_MS: ms });
}

function seedLock(orderId = 'order-1') {
  mockTimeoutDocs.set(`marketplaceLocks/cust-1_shop-1`, { orderId });
  mockTimeoutDocs.set('users/cust-1', { customer: { marketplace: { unpaidCount: 1 } } });
}

function putOrder(id, data) {
  mockTimeoutDocs.set(`marketplaceOrders/${id}`, {
    customerId: 'cust-1',
    shopId: 'shop-1',
    displayId: 11,
    ...data
  });
}

function userUpdate() {
  return mockTimeoutOps.find((entry) => entry.path === 'users/cust-1' && entry.op === 'update');
}

beforeEach(() => {
  mockTimeoutDocs.clear();
  mockTimeoutOps.length = 0;
  mockEventSeq = 0;
  mockFlipOnRead = null;
  mockNotifyCustomer.mockClear();
  mockSendTemplate.mockClear();
  mockCaptureMessage.mockClear();
  job.ticking = false;
  _resetEnforcementCache();
  mockTimeoutDocs.set('marketplaceOrders/order-1', {
    customerId: 'cust-1',
    shopId: 'shop-1',
    displayId: 62191,
    orderStatus: 'awaiting_payment',
    payment: { status: 'pending' }
  });
});

describe('legacy payment expiry set', () => {
  test('short is not selected by the old timeout set', () => {
    expect(job.isLegacyPaymentExpireable('short')).toBe(false);
    expect(job.isLegacyPaymentExpireable('pending')).toBe(true);
    expect(job.isLegacyPaymentExpireable('initiated')).toBe(true);
  });
});

describe('expireOne lock release', () => {
  test('deletes a lock that points at this order and decrements a positive unpaid count', async () => {
    mockTimeoutDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-1' });
    mockTimeoutDocs.set('users/cust-1', { customer: { marketplace: { unpaidCount: 1 } } });

    const result = await job.expireOne(mockTimeoutRef('marketplaceOrders/order-1'));
    expect(result.expired).toBe(true);
    expect(mockTimeoutDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
    expect(userUpdate().patch['customer.marketplace.unpaidCount']).toBe(0);
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').payment.status).toBe('expired');
    const events = [...mockTimeoutDocs.keys()].filter((path) => path.startsWith('marketplaceOrders/order-1/events/'));
    expect(events).toHaveLength(1);
    expect(mockTimeoutDocs.get(events[0]).type).toBe('timed_out');
  });

  test('leaves a lock that points at a different order', async () => {
    mockTimeoutDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'other-order' });
    mockTimeoutDocs.set('users/cust-1', { customer: { marketplace: { unpaidCount: 1 } } });

    await job.expireOne(mockTimeoutRef('marketplaceOrders/order-1'));
    expect(mockTimeoutDocs.get('marketplaceLocks/cust-1_shop-1').orderId).toBe('other-order');
    expect(userUpdate().patch['customer.marketplace.unpaidCount']).toBe(0);
  });

  test('does not decrement an unpaid count that is already zero', async () => {
    mockTimeoutDocs.set('marketplaceLocks/cust-1_shop-1', { orderId: 'order-1' });
    mockTimeoutDocs.set('users/cust-1', { customer: { marketplace: { unpaidCount: 0 } } });

    await job.expireOne(mockTimeoutRef('marketplaceOrders/order-1'));
    expect(mockTimeoutDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
    expect(userUpdate()).toBeUndefined();
    expect(mockTimeoutDocs.get('users/cust-1').customer.marketplace.unpaidCount).toBe(0);
  });
});

describe('payment job modes', () => {
  test('OFF expires pending and initiated only and writes a legacy timed_out event', async () => {
    const now = Date.UTC(2026, 5, 1);
    seedTimeout();
    seedLock();
    putOrder('order-1', {
      orderStatus: 'awaiting_payment',
      createdAt: stamp(now - (16 * 60 * 1000)),
      window: { start: stamp(now - (60 * 1000)), end: stamp(now + (14 * 60 * 1000)) },
      payment: { status: 'pending' }
    });
    putOrder('order-short', {
      orderStatus: 'awaiting_payment',
      createdAt: stamp(now - (60 * 60 * 1000)),
      payment: { status: 'short', balance: { dueBy: stamp(now - (60 * 1000)) } }
    });
    putOrder('order-fresh', {
      orderStatus: 'awaiting_payment',
      createdAt: stamp(now - (60 * 1000)),
      window: { start: stamp(now - (20 * 60 * 1000)), end: stamp(now - (5 * 60 * 1000)) },
      payment: { status: 'initiated' }
    });

    const result = await job.runTick({ nowMs: now, enforcement: OFF });

    expect(result.newStatuses).toBe(false);
    expect(result.actions).toEqual([{ id: 'order-1', kind: 'legacy_expire', changed: true }]);
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').orderStatus).toBe('cancelled');
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').payment.status).toBe('expired');
    expect(eventsFor('order-1')[0]).toMatchObject({
      type: 'timed_out',
      actor: { type: 'system', id: 'payment-job' },
      data: { mode: 'legacy' }
    });
    expect(mockNotifyCustomer).toHaveBeenCalledWith('cust-1', 'PAYMENT_EXPIRED', expect.objectContaining({
      displayId: '#11',
      orderId: 'order-1'
    }));
    expect(mockTimeoutDocs.get('marketplaceOrders/order-short').orderStatus).toBe('awaiting_payment');
    expect(mockTimeoutDocs.get('marketplaceOrders/order-fresh').orderStatus).toBe('awaiting_payment');
    expect(eventsFor('order-short')).toHaveLength(0);
    expect(eventsFor('order-fresh')).toHaveLength(0);
  });

  test('OFF skips the tick when the timeout setting is missing', async () => {
    putOrder('order-1', {
      orderStatus: 'awaiting_payment',
      createdAt: stamp(Date.UTC(2020, 0, 1)),
      payment: { status: 'pending' }
    });

    const result = await job.runTick({ nowMs: Date.UTC(2026, 0, 1), enforcement: OFF });

    expect(result).toMatchObject({
      skipped: true,
      reason: 'appSettings/marketplace document is missing',
      newStatuses: false
    });
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').orderStatus).toBe('awaiting_payment');
    expect(mockNotifyCustomer).not.toHaveBeenCalled();
  });

  test('ON leaves an old createdAt alone while the payment window is still open', async () => {
    const now = Date.UTC(2026, 5, 1);
    seedTimeout();
    putOrder('order-1', {
      orderStatus: 'awaiting_payment',
      createdAt: stamp(now - (2 * 60 * 60 * 1000)),
      window: { start: stamp(now - (60 * 1000)), end: stamp(now + (14 * 60 * 1000)) },
      payment: { status: 'pending' }
    });

    const result = await job.runTick({ nowMs: now, enforcement: ON });

    expect(result.newStatuses).toBe(true);
    expect(result.actions).toEqual([]);
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').orderStatus).toBe('awaiting_payment');
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').payment.status).toBe('pending');
    expect(mockNotifyCustomer).not.toHaveBeenCalled();
  });

  test('a second nudge tick does not write or push again', async () => {
    const start = Date.UTC(2026, 0, 1);
    const now = start + (4 * 60 * 1000);
    putOrder('order-1', {
      displayId: 7,
      orderStatus: 'awaiting_payment',
      shopSnapshot: { name: 'Vaigzz' },
      window: { start: stamp(start), end: stamp(start + (15 * 60 * 1000)) },
      payment: { status: 'pending' }
    });

    const first = await job.runTick({ nowMs: now, enforcement: ON });
    const second = await job.runTick({ nowMs: now, enforcement: ON });

    expect(first.actions).toEqual([{ id: 'order-1', kind: 'nudge', changed: true }]);
    expect(second.actions).toEqual([]);
    expect(isServerStamp(mockTimeoutDocs.get('marketplaceOrders/order-1').payment.nudges.utr3min)).toBe(true);
    expect(eventsFor('order-1')).toHaveLength(1);
    expect(eventsFor('order-1')[0].type).toBe('utr_nudge');
    expect(mockNotifyCustomer).toHaveBeenCalledTimes(1);
    expect(mockNotifyCustomer).toHaveBeenCalledWith('cust-1', 'UTR_NUDGE', {
      displayId: '#7',
      orderId: 'order-1',
      shopName: 'Vaigzz'
    });
  });

  test('the 5 minute shop reminder is one push and the 10 minute reminder waits', async () => {
    const start = Date.UTC(2026, 0, 2);
    putOrder('order-1', {
      orderStatus: 'awaiting_payment',
      window: { start: stamp(start), end: stamp(start + (15 * 60 * 1000)) },
      payment: { status: 'customer_claimed', customerUtr: '123456789012' }
    });

    const first = await job.runTick({ nowMs: start + (11 * 60 * 1000), enforcement: ON });
    expect(first.actions).toEqual([{ id: 'order-1', kind: 'reminder', changed: true }]);
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').payment.remindersSent.min5).toEqual(expect.anything());
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').payment.remindersSent.min10).toBeUndefined();
    expect(isServerStamp(mockTimeoutDocs.get('marketplaceOrders/order-1').payment.remindersSent.min5)).toBe(true);
    expect(mockSendTemplate).toHaveBeenCalledTimes(1);
    expect(mockSendTemplate).toHaveBeenCalledWith('shop-1', 'MARKETPLACE', 'PAYMENT_REMINDER', expect.objectContaining({
      displayId: '#11'
    }));
    expect(eventsFor('order-1')[0]).toMatchObject({ type: 'reminder_sent', data: { minute: 5 } });

    const second = await job.runTick({ nowMs: start + (11 * 60 * 1000), enforcement: ON });
    expect(second.actions).toEqual([{ id: 'order-1', kind: 'reminder', changed: true }]);
    expect(isServerStamp(mockTimeoutDocs.get('marketplaceOrders/order-1').payment.remindersSent.min10)).toBe(true);
    expect(mockSendTemplate).toHaveBeenCalledTimes(2);
    expect(eventsFor('order-1').map((event) => event.data.minute)).toEqual([5, 10]);
  });

  test('a short balance is not reminded', async () => {
    const start = Date.UTC(2026, 0, 3);
    const now = start + (11 * 60 * 1000);
    putOrder('order-1', {
      orderStatus: 'awaiting_payment',
      window: { start: stamp(start), end: stamp(start + (20 * 60 * 1000)) },
      payment: {
        status: 'short',
        balance: { dueBy: stamp(now + (60 * 1000)), utr: '555555555555' }
      }
    });

    const result = await job.runTick({ nowMs: now, enforcement: ON });

    expect(result.actions).toEqual([]);
    expect(mockSendTemplate).not.toHaveBeenCalled();
    expect(mockNotifyCustomer).not.toHaveBeenCalled();
  });

  test('a window end with a customer UTR opens review and releases the lock', async () => {
    const start = Date.UTC(2026, 2, 1);
    const now = start + (15 * 60 * 1000);
    seedLock();
    putOrder('order-1', {
      orderStatus: 'awaiting_payment',
      window: { start: stamp(start), end: stamp(now) },
      payment: { status: 'customer_claimed', customerUtr: '123456789012' }
    });

    const result = await job.runTick({ nowMs: now, enforcement: ON });
    const order = mockTimeoutDocs.get('marketplaceOrders/order-1');

    expect(result.actions).toEqual([{ id: 'order-1', kind: 'timeout_review', changed: true }]);
    expect(order.orderStatus).toBe('payment_review');
    expect(order.payment.status).toBe('under_review');
    expect(order.payment.review.trigger).toBe('utr_timeout');
    expect(isServerStamp(order.payment.review.openedAt)).toBe(true);
    expect(eventsFor('order-1')[0]).toMatchObject({
      type: 'review_opened',
      data: { trigger: 'utr_timeout' }
    });
    expect(JSON.stringify(eventsFor('order-1')[0])).not.toContain('123456789012');
    expect(mockNotifyCustomer).toHaveBeenCalledWith('cust-1', 'PAYMENT_UNDER_REVIEW', expect.objectContaining({
      orderId: 'order-1'
    }));
    expect(mockSendTemplate).not.toHaveBeenCalled();
    expect(mockTimeoutDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
    expect(userUpdate().patch['customer.marketplace.unpaidCount']).toBe(0);
  });

  test('a window end without a UTR becomes payment_unconfirmed', async () => {
    const start = Date.UTC(2026, 2, 2);
    const now = start + (15 * 60 * 1000);
    seedLock();
    putOrder('order-1', {
      orderStatus: 'awaiting_payment',
      window: { start: stamp(start), end: stamp(now) },
      payment: { status: 'pending' }
    });

    const result = await job.runTick({ nowMs: now, enforcement: ON });
    const order = mockTimeoutDocs.get('marketplaceOrders/order-1');

    expect(result.actions).toEqual([{ id: 'order-1', kind: 'timeout_unconfirmed', changed: true }]);
    expect(order.orderStatus).toBe('payment_unconfirmed');
    expect(order.payment.status).toBe('expired');
    expect(isServerStamp(order.payment.expiredAt)).toBe(true);
    expect(eventsFor('order-1')[0]).toMatchObject({
      type: 'timed_out',
      data: { mode: 'unconfirmed' }
    });
    expect(mockNotifyCustomer).toHaveBeenCalledWith('cust-1', 'PAYMENT_NOT_CONFIRMED', expect.any(Object));
    expect(mockNotifyCustomer).not.toHaveBeenCalledWith('cust-1', 'PAYMENT_EXPIRED', expect.anything());
    expect(mockTimeoutDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);
  });

  test('an expired short balance cancels once and refunds the amount received', async () => {
    const now = Date.UTC(2026, 3, 1);
    seedLock();
    putOrder('order-1', {
      orderStatus: 'awaiting_payment',
      items: [{ name: 'Balaji' }],
      window: { start: stamp(now - (20 * 60 * 1000)), end: stamp(now - (5 * 60 * 1000)) },
      payment: {
        status: 'short',
        receivedAmount: 40,
        balance: { dueBy: stamp(now - 1000), utr: '555555555555' }
      }
    });

    const first = await job.runTick({ nowMs: now, enforcement: ON });
    const order = mockTimeoutDocs.get('marketplaceOrders/order-1');

    expect(first.actions).toEqual([{ id: 'order-1', kind: 'balance_expired', changed: true }]);
    expect(order.orderStatus).toBe('cancelled');
    expect(order.closedReason).toBe('balance_expired');
    expect(order.cancellation.reason).toBe('balance_expired');
    expect(isServerStamp(order.cancellation.cancelledAt)).toBe(true);
    expect(order.payment.status).toBe('refund_pending');
    expect(order.refunds).toHaveLength(1);
    expect(order.refunds[0].reason).toBe('balance_expired');
    expect(order.refunds[0].amount).toBe(40);
    expect(order.refunds[0].status).toBe('upi_needed');
    expect(order.refunds[0].customerUpiId).toBeNull();
    expect(isServerStamp(order.refunds[0].createdAt)).toBe(false);
    expect(isRealClockTimestamp(order.refunds[0].createdAt, now)).toBe(true);
    expect(eventsFor('order-1')[0]).toMatchObject({
      type: 'cancelled',
      reason: 'balance_expired'
    });
    expect(mockNotifyCustomer).toHaveBeenCalledWith('cust-1', 'REFUND_INITIATED', expect.objectContaining({
      amount: 40
    }));
    expect(mockTimeoutDocs.has('marketplaceLocks/cust-1_shop-1')).toBe(false);

    const second = await job.runTick({ nowMs: now + 60000, enforcement: ON });
    expect(second.actions).toEqual([]);
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').refunds).toHaveLength(1);
    expect(mockNotifyCustomer).toHaveBeenCalledTimes(1);
  });

  test('an overdue paid check is a log and Sentry flag with no status change', async () => {
    const now = Date.UTC(2026, 4, 1);
    const hour = 60 * 60 * 1000;
    putOrder('order-1', {
      displayId: 42,
      orderStatus: 'cancelled',
      cancellation: {
        paidCheck: 'pending',
        paidCheckAt: stamp(now - (24 * hour) - 1000)
      }
    });

    const first = await job.runTick({ nowMs: now, enforcement: ON });
    const order = mockTimeoutDocs.get('marketplaceOrders/order-1');

    expect(first.actions).toEqual([{ id: 'order-1', kind: 'paid_check_alert', changed: true }]);
    expect(order.orderStatus).toBe('cancelled');
    expect(isServerStamp(order.cancellation.paidCheckEscalatedAt)).toBe(true);
    expect(eventsFor('order-1')[0]).toMatchObject({
      type: 'paid_check',
      data: { escalated: true }
    });
    expect(mockCaptureMessage).toHaveBeenCalledWith('Marketplace paid check overdue', {
      level: 'warning',
      extra: { orderId: 'order-1', displayId: 42 }
    });
    expect(mockNotifyCustomer).not.toHaveBeenCalled();
    expect(mockSendTemplate).not.toHaveBeenCalled();

    const second = await job.runTick({ nowMs: now + hour, enforcement: ON });
    expect(second.actions).toEqual([]);
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(eventsFor('order-1')).toHaveLength(1);
  });

  test('a paid check that is exactly 24 hours old is not escalated', async () => {
    const now = Date.UTC(2026, 4, 2);
    putOrder('order-1', {
      orderStatus: 'cancelled',
      cancellation: {
        paidCheck: 'pending',
        paidCheckAt: stamp(now - (24 * 60 * 60 * 1000))
      }
    });

    const result = await job.runTick({ nowMs: now, enforcement: ON });

    expect(result.actions).toEqual([]);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').cancellation.paidCheckEscalatedAt).toBeUndefined();
  });

  test('payment_unconfirmed older than 24 hours closes without touching the lock', async () => {
    const now = Date.UTC(2026, 6, 1);
    const start = now - (24 * 60 * 60 * 1000) - 1000;
    seedLock('someone-else');
    putOrder('order-1', {
      orderStatus: 'payment_unconfirmed',
      window: { start: stamp(start), end: stamp(start + (15 * 60 * 1000)) },
      payment: { status: 'expired' }
    });

    const result = await job.runTick({ nowMs: now, enforcement: ON });
    const order = mockTimeoutDocs.get('marketplaceOrders/order-1');

    expect(result.actions).toEqual([{ id: 'order-1', kind: 'unconfirmed_close', changed: true }]);
    expect(order.orderStatus).toBe('cancelled');
    expect(order.closedReason).toBe('unconfirmed_expired');
    expect(order.cancellation.reason).toBe('unconfirmed_expired');
    expect(isServerStamp(order.cancellation.cancelledAt)).toBe(true);
    expect(eventsFor('order-1')[0]).toMatchObject({
      type: 'cancelled',
      reason: 'unconfirmed_expired'
    });
    expect(mockNotifyCustomer).toHaveBeenCalledWith('cust-1', 'ORDER_CLOSED_UNCONFIRMED', expect.any(Object));
    expect(mockTimeoutDocs.get('marketplaceLocks/cust-1_shop-1').orderId).toBe('someone-else');
    expect(mockTimeoutDocs.get('users/cust-1').customer.marketplace.unpaidCount).toBe(1);
  });

  test('payment_unconfirmed at exactly 24 hours stays open', async () => {
    const now = Date.UTC(2026, 6, 2);
    const start = now - (24 * 60 * 60 * 1000);
    putOrder('order-1', {
      orderStatus: 'payment_unconfirmed',
      window: { start: stamp(start) },
      payment: { status: 'expired' }
    });

    const result = await job.runTick({ nowMs: now, enforcement: ON });

    expect(result.actions).toEqual([]);
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').orderStatus).toBe('payment_unconfirmed');
  });

  test('a confirm that lands before the transaction wins', async () => {
    const start = Date.UTC(2026, 7, 1);
    putOrder('order-1', {
      orderStatus: 'awaiting_payment',
      window: { start: stamp(start), end: stamp(start) },
      payment: { status: 'pending', customerUtr: '123456789012' }
    });
    mockFlipOnRead = {
      path: 'marketplaceOrders/order-1',
      patch: { orderStatus: 'preparing', 'payment.status': 'confirmed' }
    };

    const result = await job.runTick({ nowMs: start, enforcement: ON });

    expect(result.actions).toEqual([]);
    expect(mockTimeoutOps.filter((entry) => entry.op === 'update' && entry.path === 'marketplaceOrders/order-1')).toHaveLength(0);
    expect(mockNotifyCustomer).not.toHaveBeenCalled();
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').orderStatus).toBe('preparing');
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').payment.status).toBe('confirmed');
    expect(eventsFor('order-1')).toHaveLength(0);
  });

  test('dry run reports the action and writes nothing', async () => {
    const start = Date.UTC(2026, 0, 4);
    putOrder('order-1', {
      orderStatus: 'awaiting_payment',
      window: { start: stamp(start), end: stamp(start + (15 * 60 * 1000)) },
      payment: { status: 'pending' }
    });

    const result = await job.runTick({
      nowMs: start + (4 * 60 * 1000),
      enforcement: ON,
      dryRun: true
    });

    expect(result.dryRun).toBe(true);
    expect(result.actions).toEqual([{
      id: 'order-1',
      displayId: 11,
      kind: 'nudge',
      orderStatus: 'awaiting_payment',
      paymentStatus: 'pending'
    }]);
    expect(eventsFor('order-1')).toHaveLength(0);
    expect(mockNotifyCustomer).not.toHaveBeenCalled();
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').payment.nudges).toBeUndefined();
  });

  test('a tick limited to one customer and shop leaves other orders alone', async () => {
    const start = Date.UTC(2026, 0, 5);
    const now = start + (4 * 60 * 1000);
    putOrder('order-1', {
      orderStatus: 'awaiting_payment',
      window: { start: stamp(start), end: stamp(start + (15 * 60 * 1000)) },
      payment: { status: 'pending' }
    });
    putOrder('order-other', {
      customerId: 'other',
      shopId: 'other-shop',
      orderStatus: 'awaiting_payment',
      window: { start: stamp(start), end: stamp(start + (15 * 60 * 1000)) },
      payment: { status: 'pending' }
    });

    const result = await job.runTick({
      nowMs: now,
      enforcement: ON,
      only: { customerId: 'cust-1', shopId: 'shop-1' }
    });

    expect(result.actions.map((action) => action.id)).toEqual(['order-1']);
    expect(mockTimeoutDocs.get('marketplaceOrders/order-other').payment.nudges).toBeUndefined();
  });

  test('an overlapping tick on the same process is skipped', async () => {
    job.ticking = true;
    const result = await job.runTick({ nowMs: Date.UTC(2026, 0, 1), enforcement: ON });
    expect(result).toEqual({ skipped: true, reason: 'overlap', actions: [] });
  });
});

describe('firestore array timestamps', () => {
  test('a server timestamp inside an array is rejected', async () => {
    const db = require('../src/services/firebase').getFirestore();
    const orderRef = db.collection('marketplaceOrders').doc('order-1');
    await expect(db.runTransaction(async (tx) => {
      tx.update(orderRef, {
        refunds: [{ createdAt: admin.firestore.FieldValue.serverTimestamp() }]
      });
    })).rejects.toThrow(
      'FieldValue.serverTimestamp() cannot be used inside of an array (found in field refunds.`0`.createdAt)'
    );
    expect(mockTimeoutDocs.get('marketplaceOrders/order-1').refunds).toBeUndefined();
  });
});

describe('simulated clock', () => {
  test('a simulated now selects orders and every written timestamp is the server clock', async () => {
    const now = Date.UTC(2030, 0, 1);
    const hour = 60 * 60 * 1000;
    putOrder('order-nudge', {
      orderStatus: 'awaiting_payment',
      window: { start: stamp(now - (4 * 60 * 1000)), end: stamp(now + (10 * 60 * 1000)) },
      payment: { status: 'pending' }
    });
    putOrder('order-reminder', {
      orderStatus: 'awaiting_payment',
      window: { start: stamp(now - (6 * 60 * 1000)), end: stamp(now + (10 * 60 * 1000)) },
      payment: { status: 'customer_claimed', customerUtr: '123456789012' }
    });
    putOrder('order-review', {
      orderStatus: 'awaiting_payment',
      window: { start: stamp(now - (20 * 60 * 1000)), end: stamp(now - 1000) },
      payment: { status: 'customer_claimed', customerUtr: '123456789012' }
    });
    putOrder('order-open', {
      orderStatus: 'awaiting_payment',
      window: { start: stamp(now - (20 * 60 * 1000)), end: stamp(now - 1000) },
      payment: { status: 'pending' }
    });
    putOrder('order-balance', {
      orderStatus: 'awaiting_payment',
      items: [],
      payment: { status: 'short', receivedAmount: 40, balance: { dueBy: stamp(now - 1000) } }
    });
    putOrder('order-paid', {
      orderStatus: 'cancelled',
      cancellation: { paidCheck: 'pending', paidCheckAt: stamp(now - (25 * hour)) }
    });
    putOrder('order-close', {
      orderStatus: 'payment_unconfirmed',
      window: { start: stamp(now - (25 * hour)) },
      payment: { status: 'expired' }
    });

    await job.runTick({ nowMs: now, enforcement: ON });

    const nudge = mockTimeoutDocs.get('marketplaceOrders/order-nudge');
    const reminder = mockTimeoutDocs.get('marketplaceOrders/order-reminder');
    const review = mockTimeoutDocs.get('marketplaceOrders/order-review');
    const opened = mockTimeoutDocs.get('marketplaceOrders/order-open');
    const balance = mockTimeoutDocs.get('marketplaceOrders/order-balance');
    const paid = mockTimeoutDocs.get('marketplaceOrders/order-paid');
    const closed = mockTimeoutDocs.get('marketplaceOrders/order-close');
    const written = [
      nudge.payment.nudges.utr3min,
      reminder.payment.remindersSent.min5,
      review.payment.review.openedAt,
      opened.payment.expiredAt,
      balance.cancellation.cancelledAt,
      paid.cancellation.paidCheckEscalatedAt,
      closed.cancellation.cancelledAt
    ];
    written.forEach((value) => {
      expect(isServerStamp(value)).toBe(true);
      expect(typeof value.toMillis).not.toBe('function');
    });
    expect(isRealClockTimestamp(balance.refunds[0].createdAt, now)).toBe(true);
    const eventTimes = [
      ...eventsFor('order-nudge'),
      ...eventsFor('order-reminder'),
      ...eventsFor('order-review'),
      ...eventsFor('order-open'),
      ...eventsFor('order-balance'),
      ...eventsFor('order-paid'),
      ...eventsFor('order-close')
    ].map((event) => event.at);
    expect(eventTimes.length).toBeGreaterThan(0);
    eventTimes.forEach((value) => {
      expect(isServerStamp(value)).toBe(true);
    });
    const stored = JSON.stringify([nudge, reminder, review, opened, balance, paid, closed, eventTimes]);
    expect(stored).not.toContain(String(now));
  });
});
