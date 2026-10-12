const crypto = require('crypto');
const mockDocs = new Map();
const saveCalls = [];
let txTail = Promise.resolve();
let mockEventSeq = 0;
const mockCreateRefund = jest.fn(() => ({ refundId: 'ref-help-1' }));
let mockRemainderPaise = 10000;

jest.mock('../src/services/marketplace/refunds', () => {
  const actual = jest.requireActual('../src/services/marketplace/refunds');
  return {
    ...actual,
    createRefund: (...args) => mockCreateRefund(...args),
    refundRemainder: jest.fn(async () => ({
      refunds: [],
      remainderPaise: mockRemainderPaise
    }))
  };
});

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

function mockRef(docPath) {
  const id = docPath.split('/').pop();
  const ref = {
    id,
    path: docPath,
    collection(name) {
      const childPrefix = `${docPath}/${name}/`;
      return {
        doc(subId) {
          const child = subId || `auto-${mockEventSeq += 1}`;
          return mockRef(`${childPrefix}${child}`);
        },
        async get() {
          const docs = [];
          mockDocs.forEach((data, path) => {
            if (!path.startsWith(childPrefix)) {
              return;
            }
            const rest = path.slice(childPrefix.length);
            if (rest.includes('/')) {
              return;
            }
            docs.push({
              id: rest,
              data: () => mockClone(data)
            });
          });
          return { docs, empty: docs.length === 0, size: docs.length };
        }
      };
    },
    async get() {
      const data = mockDocs.get(docPath);
      return {
        exists: data !== undefined,
        id,
        ref,
        data: () => (data === undefined ? undefined : mockClone(data))
      };
    }
  };
  return ref;
}

function mockQuery(collectionName, filters) {
  return {
    where(field, op, value) {
      return mockQuery(collectionName, filters.concat([{ field, op, value }]));
    },
    async get() {
      const docs = [];
      mockDocs.forEach((data, docPath) => {
        const prefix = `${collectionName}/`;
        if (!docPath.startsWith(prefix) || docPath.slice(prefix.length).includes('/')) {
          return;
        }
        const row = data || {};
        const match = filters.every((filter) => filter.op === '==' && row[filter.field] === filter.value);
        if (!match) {
          return;
        }
        docs.push({
          id: docPath.slice(prefix.length),
          ref: mockRef(docPath),
          data: () => mockClone(row)
        });
      });
      return { docs, size: docs.length, empty: docs.length === 0 };
    }
  };
}

function mockDb() {
  return {
    collection(name) {
      return {
        doc(id) {
          return mockRef(`${name}/${id}`);
        },
        where(field, op, value) {
          return mockQuery(name, [{ field, op, value }]);
        }
      };
    },
    async runTransaction(fn) {
      const previous = txTail;
      let release;
      txTail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      const tx = {
        async get(target) {
          return target.get();
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
      try {
        return await fn(tx);
      } finally {
        release();
      }
    }
  };
}

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => mockDb(),
  getStorage: () => ({
    bucket: () => ({
      file() {
        return {
          async save(buffer) {
            saveCalls.push(buffer.length);
          },
          async delete() {}
        };
      }
    })
  })
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true }))
}));

const { Timestamp } = require('firebase-admin/firestore');
const { submitMarketplaceHelp, resolveMarketplaceHelp } = require('../src/services/marketplace/helpRequests');
const { uploadHelpEvidence } = require('../src/services/marketplace/helpEvidence');
const { getCustomerOrder } = require('../src/services/marketplace/customerOrderRead');
const { presentCustomerOrder, presentCustomerOrderSummary } = require('../src/services/marketplace/customerOrderView');

const KEY = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0x00]);

function seedCompletedOrder(id, overrides = {}) {
  const deliveredAt = Timestamp.fromMillis(Date.now() - (60 * 60 * 1000));
  mockDocs.set(`marketplaceOrders/${id}`, {
    customerId: 'cust-1',
    shopId: 'shop-1',
    displayId: 99,
    orderStatus: 'completed',
    policyGroup: 'A',
    shopSnapshot: { name: 'Vaigzz' },
    payment: { amount: 250, receivedAmount: 250, status: 'confirmed' },
    delivery: { stage: 'delivered', deliveredAt },
    helpTicketIds: [],
    hasOpenHelp: false,
    ...overrides
  });
  mockDocs.set('appSettings/marketplace', {
    HELP_WINDOW_HOURS_A: 2,
    HELP_ALERT_MINUTES: 30
  });
}

function ticketCount() {
  return [...mockDocs.keys()].filter((path) => path.startsWith('supportTickets/')).length;
}

beforeEach(() => {
  mockDocs.clear();
  saveCalls.length = 0;
  txTail = Promise.resolve();
  mockEventSeq = 0;
  mockCreateRefund.mockClear();
  mockRemainderPaise = 10000;
});

describe('marketplace help core', () => {
  test('item problem without photos returns 400 VALIDATION', async () => {
    seedCompletedOrder('ord-1');
    await expect(submitMarketplaceHelp({
      customerId: 'cust-1',
      orderId: 'ord-1',
      idempotencyKey: KEY,
      body: { problem: 'damaged', description: 'Box was wet', evidenceIds: [] }
    })).rejects.toMatchObject({ status: 400, code: 'VALIDATION' });
    expect(ticketCount()).toBe(0);
  });

  test('Group A item problem after the window returns HELP_WINDOW_CLOSED', async () => {
    const old = Timestamp.fromMillis(Date.now() - (3 * 60 * 60 * 1000));
    seedCompletedOrder('ord-window', { delivery: { stage: 'delivered', deliveredAt: old } });
    mockDocs.set('evidenceUploads/ev-1', {
      orderId: 'ord-window',
      customerId: 'cust-1',
      purpose: 'help',
      path: 'marketplaceOrders/ord-window/evidence/ev-1.jpg',
      attached: false
    });
    await expect(submitMarketplaceHelp({
      customerId: 'cust-1',
      orderId: 'ord-window',
      idempotencyKey: KEY,
      body: { problem: 'wrong_item', description: 'Got rice not dal', evidenceIds: ['ev-1'] }
    })).rejects.toMatchObject({ status: 409, code: 'HELP_WINDOW_CLOSED' });
  });

  test('payment problem after the window is allowed', async () => {
    const old = Timestamp.fromMillis(Date.now() - (3 * 60 * 60 * 1000));
    seedCompletedOrder('ord-pay', { delivery: { stage: 'delivered', deliveredAt: old } });
    const result = await submitMarketplaceHelp({
      customerId: 'cust-1',
      orderId: 'ord-pay',
      idempotencyKey: KEY,
      body: { problem: 'payment', description: 'Charged twice', evidenceIds: [] }
    });
    expect(result.ticket.problem).toBe('payment');
    expect(ticketCount()).toBe(1);
  });

  test('second open ticket returns HELP_ALREADY_OPEN', async () => {
    seedCompletedOrder('ord-dup', { hasOpenHelp: true, helpTicketIds: ['t-existing'] });
    mockDocs.set('supportTickets/t-existing', {
      category: 'marketplace_order',
      status: 'open',
      orderId: 'ord-dup'
    });
    await expect(submitMarketplaceHelp({
      customerId: 'cust-1',
      orderId: 'ord-dup',
      idempotencyKey: crypto.randomUUID(),
      body: { problem: 'other', description: 'Still broken', evidenceIds: [] }
    })).rejects.toMatchObject({ status: 409, code: 'HELP_ALREADY_OPEN' });
  });

  test('same Idempotency-Key returns the same ticket with one write', async () => {
    seedCompletedOrder('ord-idem');
    mockDocs.set('evidenceUploads/ev-a', {
      orderId: 'ord-idem',
      customerId: 'cust-1',
      purpose: 'help',
      path: 'marketplaceOrders/ord-idem/evidence/ev-a.jpg',
      attached: false
    });
    const first = await submitMarketplaceHelp({
      customerId: 'cust-1',
      orderId: 'ord-idem',
      idempotencyKey: KEY,
      body: { problem: 'quality', description: 'Stale food', evidenceIds: ['ev-a'] }
    });
    const second = await submitMarketplaceHelp({
      customerId: 'cust-1',
      orderId: 'ord-idem',
      idempotencyKey: KEY,
      body: { problem: 'quality', description: 'Stale food', evidenceIds: ['ev-a'] }
    });
    expect(second.ticket.id).toBe(first.ticket.id);
    expect(ticketCount()).toBe(1);
  });

  test('help evidence limit is 3 independent of payment evidence', async () => {
    seedCompletedOrder('ord-ev');
    mockDocs.set('marketplaceOrders/ord-ev/private/paymentReport', {
      note: null,
      evidenceIds: ['p1', 'p2', 'p3'],
      evidenceCount: 3,
      submittedAt: null
    });
    ['p1', 'p2', 'p3'].forEach((id) => {
      mockDocs.set(`evidenceUploads/${id}`, {
        orderId: 'ord-ev',
        customerId: 'cust-1',
        purpose: 'payment',
        attached: true
      });
    });
    const keys = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333'
    ];
    for (const key of keys) {
      await uploadHelpEvidence({
        customerId: 'cust-1',
        orderId: 'ord-ev',
        idempotencyKey: key,
        file: { buffer: JPEG }
      });
    }
    await expect(uploadHelpEvidence({
      customerId: 'cust-1',
      orderId: 'ord-ev',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
      file: { buffer: JPEG }
    })).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    const helpRows = [...mockDocs.entries()].filter(([, row]) => row && row.purpose === 'help');
    expect(helpRows).toHaveLength(3);
    expect(reportPaymentCount()).toBe(3);
  });

  test('resolve refund over remainder is 409; within calls createRefund support_decision', async () => {
    seedCompletedOrder('ord-ref');
    mockDocs.set('supportTickets/t-ref', {
      category: 'marketplace_order',
      orderId: 'ord-ref',
      customerId: 'cust-1',
      status: 'open'
    });
    mockRemainderPaise = 5000;
    await expect(resolveMarketplaceHelp({
      ticketId: 't-ref',
      status: 'resolved',
      outcome: 'refund',
      amount: 100,
      operator: 'support-1'
    })).rejects.toMatchObject({ status: 409, code: 'VALIDATION' });
    expect(mockCreateRefund).not.toHaveBeenCalled();

    mockRemainderPaise = 10000;
    const ok = await resolveMarketplaceHelp({
      ticketId: 't-ref',
      status: 'resolved',
      outcome: 'refund',
      amount: 100,
      operator: 'support-1'
    });
    expect(ok.refundId).toBe('ref-help-1');
    expect(mockCreateRefund).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      reason: 'support_decision',
      amount: 100
    }));
  });

  test('customer summary and detail expose help fields without sensitive data', async () => {
    const raw = {
      id: 'ord-view',
      customerId: 'cust-1',
      hasOpenHelp: true,
      helpTicketIds: ['t-view'],
      help: {
        id: 't-view',
        status: 'reviewing',
        problem: 'damaged',
        outcome: null
      }
    };
    const detail = presentCustomerOrder(raw);
    const summary = presentCustomerOrderSummary(raw);
    const serialized = JSON.stringify({ detail, summary });
    expect(serialized).not.toContain('secret text');
    expect(serialized).not.toContain('ev-secret');
    expect(serialized).not.toContain('internal note');
    expect(serialized).not.toContain('/evidence/');
    expect(detail.hasOpenHelp).toBe(true);
    expect(detail.help).toEqual({
      id: 't-view',
      status: 'reviewing',
      problem: 'damaged',
      outcome: null
    });
    expect(summary.hasOpenHelp).toBe(true);

    mockDocs.set('marketplaceOrders/ord-read', {
      customerId: 'cust-1',
      shopId: 'shop-1',
      hasOpenHelp: true,
      helpTicketIds: ['t-read'],
      orderStatus: 'completed',
      items: [],
      payment: { status: 'confirmed', amount: 1 },
      cancellation: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    mockDocs.set('supportTickets/t-read', {
      category: 'marketplace_order',
      status: 'open',
      problem: 'missing_item',
      description: 'hidden',
      evidenceIds: ['x'],
      supportNote: 'nope',
      resolution: null
    });
    const db = require('../src/services/firebase').getFirestore();
    const body = await getCustomerOrder(db, 'cust-1', 'ord-read');
    const viewJson = JSON.stringify(body.order);
    expect(viewJson).not.toContain('hidden');
    expect(viewJson).not.toContain('nope');
    expect(body.order.help.status).toBe('submitted');
    expect(body.order.help.problem).toBe('missing_item');
  });
});

function reportPaymentCount() {
  return [...mockDocs.values()].filter((row) => row && row.purpose === 'payment').length;
}
