jest.mock('../src/middleware/auth', () => require('./helpers/mockCustomerAuth'));

const express = require('express');
const request = require('supertest');

const mockDocs = new Map();
const saveCalls = [];
const publicCalls = [];
let txTail = Promise.resolve();
let mockEventSeq = 0;
const mockSend = jest.fn(async () => ({ success: true }));

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
      return {
        doc(subId) {
          const child = subId || `auto-${mockEventSeq += 1}`;
          return mockRef(`${docPath}/${name}/${child}`);
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

function mockStorage() {
  return {
    bucket() {
      return {
        file(storagePath) {
          return {
            async save(buffer) {
              saveCalls.push({ storagePath, bytes: buffer.length });
            },
            async makePublic() {
              publicCalls.push(storagePath);
            },
            async download() {
              return [];
            },
            async delete() {
              saveCalls.push({ storagePath, deleted: true });
            }
          };
        }
      };
    }
  };
}

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => mockDb(),
  getStorage: () => mockStorage()
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: (...args) => mockSend(...args),
  sendToUser: async () => ({ success: true })
}));

const { uploadPaymentEvidence, submitPaymentReport } = require('../src/services/marketplace/paymentEvidence');
const routes = require('../src/routes/customerMarketplaceOrders');

const KEY = '11111111-1111-4111-8111-111111111111';
const KEY_B = '22222222-2222-4222-8222-222222222222';
const UTR = '246813579024';
const JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/customer', routes);
  return server;
}

function stamp(ms) {
  return { toMillis: () => ms, toDate: () => new Date(ms) };
}

function seedOrder(id, overrides = {}) {
  mockDocs.set(`marketplaceOrders/${id}`, {
    customerId: 'cust-1',
    shopId: 'shop-1',
    displayId: 11,
    orderStatus: 'payment_unconfirmed',
    shopSnapshot: { name: 'Vaigzz' },
    window: { start: stamp(Date.now() - 60 * 1000), end: stamp(Date.now()) },
    payment: { status: 'expired', amount: 100 },
    ...overrides
  });
  mockDocs.set('shops/shop-1', {
    marketplaceStats: { reviewsOpened: 0, reviewsFoundAgainstShop: 0, rejections: 0 }
  });
}

function eventsFor(orderId) {
  return [...mockDocs.keys()]
    .filter((docPath) => docPath.startsWith(`marketplaceOrders/${orderId}/events/`))
    .map((docPath) => mockDocs.get(docPath));
}

function reportOf(orderId) {
  return mockDocs.get(`marketplaceOrders/${orderId}/private/paymentReport`);
}

beforeEach(() => {
  mockDocs.clear();
  saveCalls.length = 0;
  publicCalls.length = 0;
  mockEventSeq = 0;
  txTail = Promise.resolve();
  mockSend.mockClear();
});

describe('payment evidence', () => {
  test('a bad signature is FILE_INVALID and stores nothing', async () => {
    seedOrder('order-1');
    await expect(uploadPaymentEvidence({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: KEY,
      file: { buffer: Buffer.from([0x47, 0x49, 0x46, 0x38]), originalname: 'shot.jpg', mimetype: 'image/jpeg' }
    })).rejects.toMatchObject({ code: 'FILE_INVALID' });
    expect(saveCalls).toHaveLength(0);
    expect(reportOf('order-1')).toBeUndefined();
  });

  test('jpg and png are accepted from the bytes, including a non-image name', async () => {
    seedOrder('order-1');
    const jpeg = await uploadPaymentEvidence({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: KEY,
      file: { buffer: JPEG, originalname: 'notes.txt', mimetype: 'text/plain' }
    });
    expect(jpeg.replay).toBe(false);
    expect(saveCalls).toHaveLength(1);
    expect(publicCalls).toHaveLength(0);
    expect(saveCalls[0].storagePath.endsWith('.jpg')).toBe(true);

    seedOrder('order-png');
    const png = await uploadPaymentEvidence({
      customerId: 'cust-1',
      orderId: 'order-png',
      idempotencyKey: KEY_B,
      file: { buffer: PNG, originalname: 'shot.jpg', mimetype: 'image/jpeg' }
    });
    expect(png.evidenceId).toBeTruthy();
    expect(saveCalls[1].storagePath.endsWith('.png')).toBe(true);
  });

  test('the same idempotency key returns the existing id and does not take a slot', async () => {
    seedOrder('order-1');
    const [first, second] = await Promise.all([
      uploadPaymentEvidence({
        customerId: 'cust-1',
        orderId: 'order-1',
        idempotencyKey: KEY,
        file: { buffer: JPEG }
      }),
      uploadPaymentEvidence({
        customerId: 'cust-1',
        orderId: 'order-1',
        idempotencyKey: KEY,
        file: { buffer: JPEG }
      })
    ]);
    expect(second.evidenceId).toBe(first.evidenceId);
    expect(second.replay).toBe(true);
    expect(reportOf('order-1').evidenceCount).toBe(1);
    expect(saveCalls).toHaveLength(1);
    const stored = [...mockDocs.values()].find((row) => row && row.idempotencyKey === KEY);
    expect(stored.orderId).toBe('order-1');
    expect(stored.customerId).toBe('cust-1');
    expect(stored.purpose).toBe('payment');
  });

  test('two concurrent uploads at count 2 let only one succeed', async () => {
    seedOrder('order-1');
    mockDocs.set('marketplaceOrders/order-1/private/paymentReport', {
      note: null,
      evidenceIds: [],
      evidenceCount: 2,
      submittedAt: null
    });
    const results = await Promise.allSettled([
      uploadPaymentEvidence({
        customerId: 'cust-1',
        orderId: 'order-1',
        idempotencyKey: KEY,
        file: { buffer: JPEG }
      }),
      uploadPaymentEvidence({
        customerId: 'cust-1',
        orderId: 'order-1',
        idempotencyKey: KEY_B,
        file: { buffer: JPEG }
      })
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason.code).toBe('LIMIT_REACHED');
    expect(reportOf('order-1').evidenceCount).toBe(3);
    expect(saveCalls).toHaveLength(1);
  });

  test('a fourth file is LIMIT_REACHED', async () => {
    seedOrder('order-1');
    mockDocs.set('marketplaceOrders/order-1/private/paymentReport', {
      note: null,
      evidenceIds: [],
      evidenceCount: 3,
      submittedAt: null
    });
    await expect(uploadPaymentEvidence({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: KEY,
      file: { buffer: JPEG }
    })).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    expect(saveCalls).toHaveLength(0);
    expect(reportOf('order-1').evidenceCount).toBe(3);
  });

  test('the real route rejects a file over 5MB with multer before anything is stored', async () => {
    const big = Buffer.alloc((5 * 1024 * 1024) + 1);
    big[0] = 0xFF;
    big[1] = 0xD8;
    big[2] = 0xFF;
    const response = await request(app())
      .post('/api/customer/marketplace-orders/order-1/evidence')
      .set('Idempotency-Key', KEY)
      .attach('file', big, 'shot.jpg');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('FILE_INVALID');
    expect(response.body.error.message).toBe('File must be 5MB or smaller');
    expect(saveCalls).toHaveLength(0);
    expect([...mockDocs.keys()].some((docPath) => docPath.startsWith('evidenceUploads/'))).toBe(false);
  }, 20000);

  test('a report from payment_unconfirmed opens one review and keeps the note off the response', async () => {
    seedOrder('order-1');
    const uploaded = await uploadPaymentEvidence({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: KEY,
      file: { buffer: JPEG }
    });
    const result = await submitPaymentReport({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: KEY_B,
      body: { utr: UTR, note: 'slip-note-secret', evidenceIds: [uploaded.evidenceId] }
    });
    const stored = mockDocs.get('marketplaceOrders/order-1');
    expect(stored.orderStatus).toBe('payment_review');
    expect(stored.payment.customerUtr).toBe(UTR);
    expect(stored.payment.review.trigger).toBe('customer_report');
    expect(stored.payment.review.status).toBe('open');
    expect(mockDocs.get(`utrRegistry/${UTR}`).kind).toBe('customer');
    expect(eventsFor('order-1').filter((event) => event.type === 'review_opened')).toHaveLength(1);
    expect(eventsFor('order-1').filter((event) => event.type === 'utr_submitted')).toHaveLength(1);
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsOpened).toBe(1);
    const report = reportOf('order-1');
    expect(report.note).toBe('slip-note-secret');
    expect(report.evidenceIds).toEqual([uploaded.evidenceId]);
    expect(report.evidenceCount).toBe(1);
    expect(mockDocs.get(`evidenceUploads/${uploaded.evidenceId}`).attached).toBe(true);
    const body = JSON.stringify(result.body);
    expect(result.body.data.order.payment.customerUtr).toBe(UTR);
    expect(body).not.toContain('slip-note-secret');
    expect(body).not.toContain(uploaded.evidenceId);
    expect(body).not.toContain('marketplaceOrders/');
    expect(body).not.toContain('evidenceIds');
  });

  test('a second report replaces the note, merges ids, and does not open again', async () => {
    seedOrder('order-1');
    const first = await uploadPaymentEvidence({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: KEY,
      file: { buffer: JPEG }
    });
    const second = await uploadPaymentEvidence({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: KEY_B,
      file: { buffer: PNG }
    });
    await submitPaymentReport({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
      body: { utr: UTR, note: 'first-note', evidenceIds: [first.evidenceId] }
    });
    await submitPaymentReport({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
      body: {
        utr: UTR,
        note: 'second-note',
        evidenceIds: [first.evidenceId, second.evidenceId, first.evidenceId]
      }
    });
    const report = reportOf('order-1');
    expect(report.note).toBe('second-note');
    expect(report.evidenceIds).toEqual([first.evidenceId, second.evidenceId]);
    expect(report.evidenceCount).toBe(2);
    expect(eventsFor('order-1').filter((event) => event.type === 'review_opened')).toHaveLength(1);
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsOpened).toBe(1);
    expect(mockDocs.get('marketplaceOrders/order-1').payment.review.trigger).toBe('customer_report');

    const overflow = reportOf('order-1').evidenceIds.slice();
    mockDocs.set('marketplaceOrders/order-1/private/paymentReport', {
      ...reportOf('order-1'),
      evidenceIds: overflow.concat(['extra-id'])
    });
    await expect(submitPaymentReport({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      body: { utr: UTR, note: 'should-not-stick', evidenceIds: ['another-id'] }
    })).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    expect(reportOf('order-1').note).toBe('second-note');
  });

  test('a foreign evidence id is EVIDENCE_INVALID and a long note is rejected', async () => {
    seedOrder('order-1');
    mockDocs.set('evidenceUploads/foreign-1', {
      orderId: 'order-2',
      customerId: 'cust-1',
      path: 'marketplaceOrders/order-2/evidence/foreign-1.jpg',
      purpose: 'payment',
      attached: false,
      idempotencyKey: KEY
    });
    await expect(submitPaymentReport({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: KEY_B,
      body: { utr: UTR, evidenceIds: ['foreign-1'] }
    })).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' });
    expect(mockDocs.get('marketplaceOrders/order-1').orderStatus).toBe('payment_unconfirmed');

    mockDocs.set('evidenceUploads/help-1', {
      orderId: 'order-1',
      customerId: 'cust-1',
      purpose: 'help',
      attached: false
    });
    await expect(submitPaymentReport({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: KEY_B,
      body: { utr: UTR, evidenceIds: ['help-1'] }
    })).rejects.toMatchObject({ code: 'EVIDENCE_INVALID' });

    await expect(submitPaymentReport({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: KEY_B,
      body: { utr: UTR, note: 'n'.repeat(301) }
    })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(mockDocs.get(`utrRegistry/${UTR}`)).toBeUndefined();
  });

  test('an open utr_timeout review keeps its trigger and review count', async () => {
    seedOrder('order-1', {
      orderStatus: 'payment_review',
      payment: {
        status: 'under_review',
        customerUtr: UTR,
        review: {
          status: 'open',
          trigger: 'utr_timeout',
          shopResponse: null,
          outcome: null
        }
      }
    });
    mockDocs.set('shops/shop-1', { marketplaceStats: { reviewsOpened: 1 } });
    const uploaded = await uploadPaymentEvidence({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: KEY,
      file: { buffer: JPEG }
    });
    await submitPaymentReport({
      customerId: 'cust-1',
      orderId: 'order-1',
      idempotencyKey: KEY_B,
      body: { utr: UTR, note: 'timeout-note', evidenceIds: [uploaded.evidenceId] }
    });
    const stored = mockDocs.get('marketplaceOrders/order-1');
    expect(stored.payment.review.trigger).toBe('utr_timeout');
    expect(stored.payment.review.status).toBe('open');
    expect(mockDocs.get('shops/shop-1').marketplaceStats.reviewsOpened).toBe(1);
    expect(eventsFor('order-1').filter((event) => event.type === 'review_opened')).toHaveLength(0);
    expect(reportOf('order-1').note).toBe('timeout-note');
    expect(reportOf('order-1').evidenceIds).toEqual([uploaded.evidenceId]);
  });
});
