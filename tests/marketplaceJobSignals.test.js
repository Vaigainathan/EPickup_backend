jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn().mockResolvedValue({ success: true })
}));

const { Timestamp } = require('firebase-admin/firestore');
const { getFirestore } = require('../src/services/firebase');
const paymentTimeoutJob = require('../src/services/marketplacePaymentTimeoutJob');
const slowDriverJob = require('../src/services/marketplaceSlowDriverJob');
const refundJob = require('../src/services/marketplaceRefundJob');
const { MARKETPLACE_DEFAULTS } = require('../src/config/marketplaceDefaults');

function buildOrderRef(signalWrites, refundsSnap) {
  const refundsQuery = { __refundsQuery: true };
  return {
    id: 'order-1',
    path: 'marketplaceOrders/order-1',
    collection(name) {
      if (name === 'events') {
        return { doc: () => ({ id: 'evt-1' }) };
      }
      if (name === 'refunds') {
        return refundsQuery;
      }
      if (name === 'signal') {
        return {
          doc(id) {
            return { id, path: `marketplaceOrders/order-1/signal/${id}` };
          }
        };
      }
      return { doc: () => ({ id: 'x' }) };
    },
    refundsQuery,
    refundsSnap
  };
}

function installDb(orderRef, orderData) {
  const signalWrites = [];
  const db = {
    collection(name) {
      if (name === 'marketplaceOrders') {
        return { doc: () => orderRef };
      }
      if (name === 'marketplaceLocks') {
        return { doc: () => ({ path: 'marketplaceLocks/cust-1_shop-1' }) };
      }
      if (name === 'users') {
        return { doc: () => ({ path: 'users/cust-1' }) };
      }
      if (name === 'shops') {
        return { doc: () => ({ path: 'shops/shop-1' }) };
      }
      return { doc: () => ({ path: 'x' }) };
    },
    runTransaction(fn) {
      const tx = {
        async get(ref) {
          if (ref === orderRef) {
            return { exists: true, id: 'order-1', data: () => orderData, ref: orderRef };
          }
          if (ref && ref.__refundsQuery) {
            return orderRef.refundsSnap;
          }
          if (ref.path === 'marketplaceLocks/cust-1_shop-1') {
            return { exists: true, data: () => ({ orderId: 'order-1' }) };
          }
          if (ref.path === 'users/cust-1') {
            return { exists: true, data: () => ({ customer: { marketplace: { unpaidCount: 1 } } }) };
          }
          return { exists: false };
        },
        update() {},
        delete() {},
        set(ref, data) {
          if (ref.path && ref.path.endsWith('signal/latest')) {
            signalWrites.push(data);
          }
        }
      };
      return fn(tx);
    }
  };
  getFirestore.mockReturnValue(db);
  return signalWrites;
}

describe('job-driven marketplace order signal', () => {
  beforeEach(() => {
    getFirestore.mockReset();
  });

  test('payment timeout timeout_unconfirmed bumps signal timed_out after order write', async () => {
    const nowMs = Date.parse('2026-10-10T12:00:00.000Z');
    const orderRef = buildOrderRef([]);
    const signalWrites = installDb(orderRef, {
      customerId: 'cust-1',
      shopId: 'shop-1',
      orderStatus: 'awaiting_payment',
      window: {
        start: Timestamp.fromMillis(nowMs - 3600000),
        end: Timestamp.fromMillis(nowMs - 1000)
      },
      payment: { status: 'pending' }
    });

    const settings = {
      nudgeMs: 180000,
      reminderMinutes: [5, 10],
      paidCheckMs: 86400000,
      unconfirmedCloseMs: 86400000,
      reviewEscalateMs: 86400000,
      reviewEscalateHours: 24
    };

    const result = await paymentTimeoutJob.applyOne(orderRef, 'awaiting', nowMs, settings);
    expect(result.changed).toBe(true);
    expect(result.kind).toBe('timeout_unconfirmed');
    expect(signalWrites[signalWrites.length - 1].type).toBe('timed_out');
    expect(signalWrites[signalWrites.length - 1].customerId).toBe('cust-1');
  });

  test('slow driver job bumps signal driver_slow after order write', async () => {
    const readyMs = Date.now() - (20 * 60 * 1000);
    const orderRef = buildOrderRef([]);
    const signalWrites = installDb(orderRef, {
      customerId: 'cust-1',
      shopId: 'shop-1',
      orderStatus: 'ready',
      readyAt: Timestamp.fromMillis(readyMs),
      delivery: { stage: 'searching' }
    });

    const outcome = await slowDriverJob.applyOne(orderRef, Date.now(), 15 * 60 * 1000);
    expect(outcome.claimed).toBe(true);
    expect(signalWrites[signalWrites.length - 1].type).toBe('driver_slow');
  });

  test('refund job bumps signal refund_auto_closed after order denorm update', async () => {
    const sentAt = Timestamp.fromMillis(
      Date.now() - (MARKETPLACE_DEFAULTS.REFUND_ACK_AUTO_CLOSE_HOURS + 1) * 60 * 60 * 1000
    );
    const refundId = 'refund-1';
    const refundRef = { id: refundId, path: `marketplaceOrders/order-1/refunds/${refundId}` };
    const refundsSnap = {
      docs: [{
        id: refundId,
        ref: refundRef,
        data: () => ({ status: 'sent', sentAt, reminders: {} })
      }],
      empty: false
    };
    const orderRef = buildOrderRef([], refundsSnap);
    const signalWrites = installDb(orderRef, {
      customerId: 'cust-1',
      shopId: 'shop-1',
      hasOpenRefund: true,
      orderStatus: 'cancelled'
    });

    const actions = await refundJob.applyOrder(orderRef, Date.now());
    expect(actions.some((row) => row.kind === 'auto_close')).toBe(true);
    expect(signalWrites[signalWrites.length - 1].type).toBe('refund_auto_closed');
  });
});
