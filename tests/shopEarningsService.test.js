jest.mock('firebase-admin', () => {
  const blockRealFirestore = () => {
    throw new Error('REAL FIRESTORE IN TEST');
  };
  return {
    apps: [],
    initializeApp: jest.fn(blockRealFirestore),
    app: jest.fn(blockRealFirestore),
    credential: { cert: jest.fn() },
    firestore: blockRealFirestore
  };
});

const orders = [];
const refundsByOrderId = new Map();
const shopUsers = [];

function docRef(collectionName, id) {
  return {
    id,
    collection(name) {
      if (collectionName !== 'marketplaceOrders' || name !== 'refunds') {
        throw new Error(`Unexpected subcollection ${name}`);
      }
      return {
        async get() {
          const rows = refundsByOrderId.get(id) || [];
          return {
            docs: rows.map((row) => ({
              id: row.id,
              data: () => row
            }))
          };
        }
      };
    }
  };
}

const mockDb = {
  collection(name) {
    if (name === 'marketplaceOrders') {
      return {
        where(field, op, value) {
          const filters = [[field, op, value]];
          const chain = {
            where(f, o, v) {
              filters.push([f, o, v]);
              return chain;
            },
            orderBy() {
              return chain;
            },
            async get() {
              let rows = orders.slice();
              filters.forEach(([f, o, v]) => {
                if (f === 'shopId' && o === '==') {
                  rows = rows.filter((row) => row.shopId === v);
                }
              });
              return {
                docs: rows.map((row) => ({
                  id: row.id,
                  ref: docRef('marketplaceOrders', row.id),
                  data: () => {
                    const { id: _id, ...rest } = row;
                    return rest;
                  }
                }))
              };
            }
          };
          return chain;
        },
        orderBy() {
          return {
            async get() {
              return {
                docs: orders.map((row) => ({
                  id: row.id,
                  ref: docRef('marketplaceOrders', row.id),
                  data: () => {
                    const { id: _id, ...rest } = row;
                    return rest;
                  }
                }))
              };
            }
          };
        }
      };
    }
    if (name === 'users') {
      return {
        where(field, op, value) {
          return {
            async get() {
              const rows = shopUsers.filter((u) => u[field] === value);
              return {
                docs: rows.map((row) => ({
                  id: row.id,
                  data: () => {
                    const { id: _id, ...rest } = row;
                    return rest;
                  }
                }))
              };
            }
          };
        },
        doc(id) {
          return {
            async get() {
              const row = shopUsers.find((u) => u.id === id);
              if (!row) {
                return { exists: false };
              }
              return {
                exists: true,
                data: () => {
                  const { id: _id, ...rest } = row;
                  return rest;
                }
              };
            }
          };
        }
      };
    }
    throw new Error(`Unexpected collection ${name}`);
  }
};

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => mockDb),
  getFirebaseApp: jest.fn(() => ({}))
}));

const {
  aggregateEarnings,
  shouldLoadRefunds,
  moneyReceivedPaise,
  moneyReceivedAtMs,
  computeShopEarnings,
  listAdminShopEarnings,
  resolveShopApprovalStatus
} = require('../src/services/marketplace/shopEarningsService');

describe('shopEarningsService', () => {
  beforeEach(() => {
    orders.length = 0;
    refundsByOrderId.clear();
    shopUsers.length = 0;
  });

  test('shouldLoadRefunds when money received without payment confirmed', () => {
    expect(shouldLoadRefunds({
      payment: { status: 'under_review', receivedAmount: 100, receivedAmountPaise: 10000 },
      hasOpenRefund: false,
      customerRefundAction: null
    })).toBe(true);
  });

  test('late cancel: received and refunded both counted, net zero', () => {
    const receivedAt = new Date('2026-03-15T12:00:00.000Z');
    const sentAt = new Date('2026-03-15T14:00:00.000Z');
    const now = new Date('2026-03-15T18:00:00.000Z');
    const { presentAggregate } = require('../src/services/marketplace/shopEarningsService');
    const state = aggregateEarnings([{
      order: {
        shopId: 'shop-a',
        orderStatus: 'cancelled',
        cancellation: { cancelledAt: receivedAt },
        payment: {
          status: 'under_review',
          receivedAmount: 200,
          receivedAmountPaise: 20000,
          confirmedAt: receivedAt
        }
      },
      refunds: [{
        status: 'sent',
        amount: 200,
        sentAmount: 200,
        sentAt
      }]
    }], now);
    const out = presentAggregate(state, now);
    expect(out.periods.today.received).toBe(200);
    expect(out.periods.today.refunded).toBe(200);
    expect(out.periods.today.net).toBe(0);
    expect(out.periods.today.paidOrders).toBe(1);
    expect(out.periods.today.refundsSent).toBe(1);
  });

  test('short payment uses receivedAmount not full amount', () => {
    const at = new Date('2026-03-15T10:00:00.000Z');
    const now = new Date('2026-03-15T18:00:00.000Z');
    const { presentAggregate } = require('../src/services/marketplace/shopEarningsService');
    const state = aggregateEarnings([{
      order: {
        shopId: 'shop-a',
        orderStatus: 'preparing',
        payment: {
          status: 'short',
          amount: 500,
          receivedAmount: 250,
          receivedAmountPaise: 25000,
          confirmedAt: at
        }
      },
      refunds: []
    }], now);
    expect(presentAggregate(state, now).periods.today.received).toBe(250);
  });

  test('partial refund due is not deducted from net', () => {
    const at = new Date('2026-03-15T10:00:00.000Z');
    const now = new Date('2026-03-15T18:00:00.000Z');
    const { presentAggregate } = require('../src/services/marketplace/shopEarningsService');
    const state = aggregateEarnings([{
      order: {
        shopId: 'shop-a',
        orderStatus: 'preparing',
        payment: {
          status: 'confirmed',
          amount: 500,
          receivedAmount: 500,
          receivedAmountPaise: 50000,
          confirmedAt: at
        }
      },
      refunds: [{ status: 'due', amount: 75 }]
    }], now);
    const out = presentAggregate(state, now);
    expect(out.periods.today.net).toBe(500);
    expect(out.refundsDue.count).toBe(1);
    expect(out.refundsDue.amount).toBe(75);
  });

  test('disputed refund counts as refunded', () => {
    const receivedAt = new Date('2026-03-15T09:00:00.000Z');
    const sentAt = new Date('2026-03-15T11:00:00.000Z');
    const now = new Date('2026-03-15T18:00:00.000Z');
    const { presentAggregate } = require('../src/services/marketplace/shopEarningsService');
    const state = aggregateEarnings([{
      order: {
        shopId: 'shop-a',
        orderStatus: 'cancelled',
        cancellation: { cancelledAt: receivedAt },
        payment: {
          status: 'refunded',
          receivedAmount: 100,
          receivedAmountPaise: 10000,
          confirmedAt: receivedAt
        }
      },
      refunds: [{ status: 'disputed', amount: 100, sentAmount: 100, sentAt }]
    }], now);
    expect(presentAggregate(state, now).periods.today.refunded).toBe(100);
  });

  test('legacy confirmed order without receivedAmount uses payment.amount', () => {
    const at = new Date('2026-03-15T09:00:00.000Z');
    const now = new Date('2026-03-15T18:00:00.000Z');
    expect(moneyReceivedPaise({
      payment: { status: 'confirmed', amount: 99, confirmedAt: at }
    })).toBe(9900);
  });

  test('IST boundary splits today vs yesterday', () => {
    const now = new Date('2026-03-16T19:00:00.000Z');
    const todayIst = new Date('2026-03-16T19:30:00.000Z');
    const yesterdayIst = new Date('2026-03-15T18:30:00.000Z');
    const { presentAggregate } = require('../src/services/marketplace/shopEarningsService');
    const state = aggregateEarnings([
      {
        order: {
          shopId: 's1',
          payment: { receivedAmount: 10, receivedAmountPaise: 1000, confirmedAt: todayIst }
        },
        refunds: []
      },
      {
        order: {
          shopId: 's1',
          payment: { receivedAmount: 20, receivedAmountPaise: 2000, confirmedAt: yesterdayIst }
        },
        refunds: []
      }
    ], now);
    const out = presentAggregate(state, now);
    expect(out.periods.today.received).toBe(10);
    expect(out.periods.yesterday.received).toBe(20);
  });

  test('month change assigns thisMonth vs lastMonth', () => {
    const now = new Date('2026-04-05T12:00:00.000Z');
    const thisMonthAt = new Date('2026-04-01T06:00:00.000Z');
    const lastMonthAt = new Date('2026-03-28T06:00:00.000Z');
    const { presentAggregate } = require('../src/services/marketplace/shopEarningsService');
    const state = aggregateEarnings([
      {
        order: {
          shopId: 's1',
          payment: { receivedAmount: 11, receivedAmountPaise: 1100, confirmedAt: thisMonthAt }
        },
        refunds: []
      },
      {
        order: {
          shopId: 's1',
          payment: { receivedAmount: 22, receivedAmountPaise: 2200, confirmedAt: lastMonthAt }
        },
        refunds: []
      }
    ], now);
    const out = presentAggregate(state, now);
    expect(out.periods.thisMonth.received).toBe(11);
    expect(out.periods.lastMonth.received).toBe(22);
  });

  test('partial unavailable-item refund counts received and due separately', () => {
    const at = new Date('2026-03-15T10:00:00.000Z');
    const now = new Date('2026-03-15T18:00:00.000Z');
    const { presentAggregate } = require('../src/services/marketplace/shopEarningsService');
    const state = aggregateEarnings([{
      order: {
        shopId: 'shop-a',
        orderStatus: 'preparing',
        payment: {
          status: 'confirmed',
          amount: 500,
          receivedAmount: 500,
          receivedAmountPaise: 50000,
          confirmedAt: at
        }
      },
      refunds: [{ status: 'upi_needed', amount: 75, reason: 'stock_short' }]
    }], now);
    const out = presentAggregate(state, now);
    expect(out.periods.today.received).toBe(500);
    expect(out.periods.today.net).toBe(500);
    expect(out.refundsDue.amount).toBe(75);
  });

  test('other shop orders excluded from computeShopEarnings', async () => {
    orders.push(
      {
        id: 'o1',
        shopId: 'shop-a',
        payment: {
          status: 'confirmed',
          receivedAmount: 100,
          receivedAmountPaise: 10000,
          confirmedAt: new Date('2026-03-15T10:00:00.000Z')
        }
      },
      {
        id: 'o2',
        shopId: 'shop-b',
        payment: {
          status: 'confirmed',
          receivedAmount: 999,
          receivedAmountPaise: 99900,
          confirmedAt: new Date('2026-03-15T10:00:00.000Z')
        }
      }
    );
    const now = new Date('2026-03-15T18:00:00.000Z');
    const out = await computeShopEarnings('shop-a', { now });
    expect(out.periods.allTime.received).toBe(100);
  });

  test('listAdminShopEarnings includes zero-order shops and approvalStatus', async () => {
    shopUsers.push(
      { id: 'shop-a', userType: 'shop', shop: { shopName: 'A', approvalStatus: 'approved' }, isActive: true },
      { id: 'shop-b', userType: 'shop', shop: { shopName: 'B', approvalStatus: 'pending' }, isActive: false, suspendedAt: new Date() }
    );
    orders.push({
      id: 'o1',
      shopId: 'shop-a',
      payment: {
        status: 'confirmed',
        receivedAmount: 50,
        receivedAmountPaise: 5000,
        confirmedAt: new Date('2026-03-15T10:00:00.000Z')
      }
    });
    const now = new Date('2026-03-15T18:00:00.000Z');
    const data = await listAdminShopEarnings('today', { now });
    expect(data.shops).toHaveLength(2);
    const zeroShop = data.shops.find((s) => s.shopId === 'shop-b');
    expect(zeroShop.net).toBe(0);
    expect(zeroShop.approvalStatus).toBe('suspended');
    expect(resolveShopApprovalStatus({ shop: { approvalStatus: 'approved' }, isActive: true })).toBe('approved');
  });

  test('moneyReceivedAtMs falls back to payment.late.receivedAt', () => {
    const late = new Date('2026-03-10T08:00:00.000Z');
    const ms = moneyReceivedAtMs({
      payment: {
        receivedAmount: 50,
        late: { receivedAt: late }
      }
    });
    expect(ms).toBe(late.getTime());
  });
});

describe('adminMarketplace earnings auth', () => {
  test('shops/earnings route is guarded with superAdminOnly', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../src/routes/adminMarketplace.js'),
      'utf8'
    );
    expect(src).toContain("router.get('/shops/earnings', superAdminOnly");
    expect(src).toContain("router.get('/shops/:shopId/earnings', superAdminOnly");
  });
});

describe('shopDashboard todayEarnings equals today net', () => {
  test('getStats todayEarnings matches aggregate today net', async () => {
    orders.push({
      id: 'o1',
      shopId: 'shop-x',
      orderStatus: 'preparing',
      payment: {
        status: 'confirmed',
        amount: 300,
        receivedAmount: 300,
        receivedAmountPaise: 30000,
        confirmedAt: new Date('2026-03-15T10:00:00.000Z')
      }
    });
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-15T18:00:00.000Z'));
    const shopDashboardService = require('../src/services/shopDashboardService');
    const stats = await shopDashboardService.getStats('shop-x');
    expect(stats.todayEarnings).toBe(300);
    jest.useRealTimers();
  });
});
