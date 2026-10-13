const stockDeduction = {
  items: [{ id: 'line0', productId: 'p1', qty: 1 }],
  stockShort: false,
  orderStockDeducted: true
};

const mockConfirmShopPayment = jest.fn();

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

jest.mock('../src/services/marketplace/stock', () => ({
  deductStock: jest.fn(async () => stockDeduction),
  deductOnPreparing: jest.fn(async () => stockDeduction)
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn()
}));

jest.mock('../src/services/marketplace/shopPaymentVerification', () => {
  const actual = jest.requireActual('../src/services/marketplace/shopPaymentVerification');
  return {
    ...actual,
    confirmShopPayment: (...args) => mockConfirmShopPayment(...args)
  };
});

const { Timestamp } = require('firebase-admin/firestore');
const { wrapStrictTransaction } = require('./helpers/strictFirestoreTransaction');
const { getFirestore } = require('../src/services/firebase');
const verification = require('../src/services/marketplace/shopPaymentVerification');
const shopOrderService = require('../src/services/shopOrderService');

function applyPatch(target, patch) {
  Object.keys(patch).forEach((key) => {
    if (!key.includes('.')) {
      target[key] = patch[key];
      return;
    }
    const parts = key.split('.');
    let cur = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') {
        cur[parts[i]] = {};
      }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = patch[key];
  });
}

function buildMockDb(seed) {
  const docs = new Map(Object.entries(seed));
  const events = [];
  const signals = [];

  const db = {
    collection(name) {
      return {
        doc(id) {
          const path = `${name}/${id}`;
          const ref = {
            path,
            id,
            collection(sub) {
              const subPath = `${path}/${sub}`;
              return {
                doc(subId) {
                  const full = `${subPath}/${subId}`;
                  return { path: full, id: subId };
                }
              };
            },
            async get() {
              const row = docs.get(path);
              return {
                exists: row !== undefined,
                data: () => row,
                id,
                ref
              };
            }
          };
          return ref;
        }
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          const row = docs.get(ref.path);
          return {
            exists: row !== undefined,
            data: () => row,
            ref
          };
        },
        update(ref, patch) {
          const row = docs.get(ref.path);
          if (!row) {
            throw new Error(`missing doc ${ref.path}`);
          }
          applyPatch(row, patch);
        },
        set(ref, data) {
          docs.set(ref.path, data);
          if (data && typeof data.type === 'string') {
            events.push({ path: ref.path, data });
          }
          if (ref.path.endsWith('/signal/latest')) {
            signals.push({ path: ref.path, data });
          }
        },
        delete(ref) {
          docs.delete(ref.path);
        }
      };
      return fn(wrapStrictTransaction(tx));
    },
    _docs: docs,
    _events: events,
    _signals: signals
  };
  return db;
}

function shortOrderSeed({
  dueByMs,
  submittedAtMs,
  balanceUtr = '310000000223',
  includeUtr = true
}) {
  const now = Date.now();
  const orderId = 'order-short-1';
  const shopId = 'shop-1';
  const customerId = 'customer-1';
  const orderPath = `marketplaceOrders/${orderId}`;
  const balance = {
    amount: 30,
    amountPaise: 3000,
    dueBy: dueByMs
  };
  if (includeUtr && balanceUtr) {
    balance.utr = balanceUtr;
  }
  if (submittedAtMs != null) {
    balance.submittedAt = Timestamp.fromMillis(submittedAtMs);
  }
  const order = {
    shopId,
    customerId,
    orderStatus: 'awaiting_payment',
    displayId: '12345',
    expectedAmount: 100,
    expectedAmountPaise: 10000,
    items: [{ id: 'line0', productId: 'p1', qty: 1 }],
    payment: {
      status: 'short',
      customerUtr: '310000000111',
      receivedAmount: 70,
      receivedAmountPaise: 7000,
      balance
    }
  };
  const seed = {
    [orderPath]: order,
    [`marketplaceLocks/${customerId}_${shopId}`]: { orderId },
    [`users/${customerId}`]: { customer: { marketplace: { unpaidCount: 1 } } }
  };
  if (includeUtr && balanceUtr) {
    seed[`utrRegistry/${balanceUtr}`] = {
      orderId,
      customerId,
      kind: 'balance',
      at: Timestamp.fromMillis(now - 60000)
    };
  }
  return { orderId, shopId, customerId, order, seed };
}

const actualVerification = jest.requireActual('../src/services/marketplace/shopPaymentVerification');

describe('confirmShopPayment balance (short)', () => {
  beforeEach(() => {
    mockConfirmShopPayment.mockImplementation((args) => actualVerification.confirmShopPayment(args));
  });

  it('happy path with newStatuses on (confirmShopPayment)', async () => {
    const dueByMs = Date.now() + 60 * 60 * 1000;
    const { orderId, shopId, seed } = shortOrderSeed({
      dueByMs,
      submittedAtMs: Date.now() - 1000
    });
    const db = buildMockDb(seed);
    getFirestore.mockReturnValue(db);

    const outcome = await verification.confirmShopPayment({
      shopId,
      orderId,
      body: { utrLast4: '0223', withinWindowAttested: true },
      nowMs: Date.now()
    });

    expect(outcome.alreadyProcessed).toBe(false);
    expect(outcome.notifies).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'PAYMENT_CONFIRMED' })
    ]));
    const stored = db._docs.get(`marketplaceOrders/${orderId}`);
    expect(stored.orderStatus).toBe('preparing');
    expect(stored.payment.status).toBe('confirmed');
    expect(stored.payment.receivedAmountPaise).toBe(10000);
    expect(stored.payment.balance.confirmedAt).toBeTruthy();
    expect(db._events.some((e) => e.data.type === 'balance_confirmed')).toBe(true);
  });

  it('happy path with newStatuses off (shopOrderService delegates to confirmShopPayment)', async () => {
    const dueByMs = Date.now() + 60 * 60 * 1000;
    const { orderId, shopId, seed } = shortOrderSeed({
      dueByMs,
      submittedAtMs: Date.now() - 1000
    });
    const db = buildMockDb(seed);
    getFirestore.mockReturnValue(db);

    jest.spyOn(shopOrderService, 'sendNotifies').mockResolvedValue(undefined);
    jest.spyOn(shopOrderService, 'sendShopNotifies').mockResolvedValue(undefined);
    jest.spyOn(shopOrderService, 'presentOrder').mockImplementation(async (id, data) => ({
      id,
      orderStatus: data.orderStatus,
      payment: data.payment
    }));

    const result = await shopOrderService.confirmPayment(
      shopId,
      orderId,
      { utrLast4: '0223', withinWindowAttested: true },
      { newStatuses: false }
    );

    expect(result.order.orderStatus).toBe('preparing');
    expect(result.order.payment.status).toBe('confirmed');
    expect(mockConfirmShopPayment).toHaveBeenCalled();
  });

  it('confirms after dueBy when balance UTR was submitted in time', async () => {
    const dueByMs = Date.now() - 60 * 1000;
    const submittedAtMs = dueByMs - 5 * 60 * 1000;
    const nowMs = Date.now();
    const { orderId, shopId, seed } = shortOrderSeed({ dueByMs, submittedAtMs });
    const db = buildMockDb(seed);
    getFirestore.mockReturnValue(db);

    const outcome = await verification.confirmShopPayment({
      shopId,
      orderId,
      body: { utrLast4: '0223', withinWindowAttested: true },
      nowMs
    });

    expect(outcome.notifies).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'PAYMENT_CONFIRMED' })
    ]));
    expect(db._docs.get(`marketplaceOrders/${orderId}`).payment.status).toBe('confirmed');
  });

  it('rejects wrong utrLast4 without fullUtr', async () => {
    const dueByMs = Date.now() + 60 * 60 * 1000;
    const { orderId, shopId, seed } = shortOrderSeed({
      dueByMs,
      submittedAtMs: Date.now() - 1000
    });
    getFirestore.mockReturnValue(buildMockDb(seed));

    await expect(verification.confirmShopPayment({
      shopId,
      orderId,
      body: { utrLast4: '9999', withinWindowAttested: true },
      nowMs: Date.now()
    })).rejects.toMatchObject({ status: 400, code: 'FULL_UTR_REQUIRED' });
  });

  it('rejects confirm after dueBy when no balance UTR was submitted in time', async () => {
    const dueByMs = Date.now() - 1000;
    const { orderId, shopId, seed } = shortOrderSeed({
      dueByMs,
      includeUtr: false
    });
    getFirestore.mockReturnValue(buildMockDb(seed));

    await expect(verification.confirmShopPayment({
      shopId,
      orderId,
      body: { fullUtr: '310000000223', withinWindowAttested: true },
      nowMs: Date.now()
    })).rejects.toMatchObject({ status: 409, code: 'BALANCE_WINDOW_CLOSED' });
  });
});

describe('isShortBalanceExpired (payment timeout balance lane)', () => {
  const { isShortBalanceExpired } = actualVerification;

  it('does not expire when balance UTR was submitted before dueBy', () => {
    const dueByMs = Date.now() - 60 * 1000;
    const data = {
      payment: {
        status: 'short',
        balance: {
          dueBy: dueByMs,
          utr: '310000000223',
          submittedAt: dueByMs - 1000
        }
      }
    };
    expect(isShortBalanceExpired(data, Date.now())).toBe(false);
  });

  it('expires when dueBy passed and no in-time balance UTR', () => {
    const dueByMs = Date.now() - 60 * 1000;
    const data = {
      payment: {
        status: 'short',
        balance: { dueBy: dueByMs }
      }
    };
    expect(isShortBalanceExpired(data, Date.now())).toBe(true);
  });
});
