jest.mock('../src/middleware/auth', () => require('./helpers/mockCustomerAuth'));

const express = require('express');
const request = require('supertest');

const mockStore = { docs: [] };

function stamp(iso) {
  const date = new Date(iso);
  return {
    toDate: () => date,
    toMillis: () => date.getTime()
  };
}

function mockBuildDb(current) {
  function chain(filters, lim, cursor) {
    return {
      where(field, op, value) {
        return chain(filters.concat([{ field, op, value }]), lim, cursor);
      },
      orderBy() {
        return chain(filters, lim, cursor);
      },
      limit(value) {
        return chain(filters, value, cursor);
      },
      startAfter(createdAt, id) {
        return chain(filters, lim, { createdAt, id });
      },
      async get() {
        let rows = current.docs.filter((doc) => filters.every((filter) => {
          if (filter.op === '==') {
            return doc[filter.field] === filter.value;
          }
          if (filter.op === 'in') {
            return filter.value.includes(doc[filter.field]);
          }
          return false;
        }));
        rows.sort((left, right) => {
          const diff = right.createdAt.toMillis() - left.createdAt.toMillis();
          if (diff !== 0) {
            return diff;
          }
          if (left.id === right.id) {
            return 0;
          }
          return left.id < right.id ? 1 : -1;
        });
        if (cursor) {
          const cursorMs = cursor.createdAt.toMillis();
          rows = rows.filter((doc) => {
            const millis = doc.createdAt.toMillis();
            if (millis < cursorMs) {
              return true;
            }
            if (millis > cursorMs) {
              return false;
            }
            return doc.id < cursor.id;
          });
        }
        const limited = lim == null ? rows : rows.slice(0, lim);
        return {
          empty: limited.length === 0,
          size: limited.length,
          docs: limited.map((doc) => ({
            id: doc.id,
            data: () => ({ ...doc })
          }))
        };
      }
    };
  }

  return {
    collection() {
      return {
        doc(id) {
          return {
            async get() {
              const found = current.docs.find((doc) => doc.id === id);
              return {
                id,
                exists: Boolean(found),
                data: () => (found ? { ...found } : undefined)
              };
            }
          };
        },
        where(field, op, value) {
          return chain([{ field, op, value }]);
        }
      };
    }
  };
}

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => mockBuildDb(mockStore)
}));

const customerMarketplaceOrderRoutes = require('../src/routes/customerMarketplaceOrders');

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const OTP = '654321';

function order(id, overrides) {
  return {
    id,
    customerId: 'customer-test',
    shopId: 'shop-1',
    items: [{ name: 'Balaji statue', qty: 1, price: 1540 }],
    expectedAmount: 1540,
    expectedAmountPaise: 154000,
    displayId: 62191,
    shopSnapshot: { name: 'Vaigzz store', phone: '9000000000' },
    window: {
      start: stamp('2026-10-07T11:16:06.661Z'),
      end: stamp('2026-10-07T11:31:06.661Z')
    },
    payment: {
      status: 'pending',
      shopUpiId: 'shop@upi',
      amount: 1540,
      initiatedAt: stamp('2026-10-07T11:16:06.661Z'),
      confirmedAt: null,
      expiredAt: null,
      refundedAt: null,
      confirmedByShopUid: 'shop-secret'
    },
    verifiedPayeeName: 'VAIGAINATHAN R',
    handoverOtp: OTP,
    private: { handover: { otp: OTP } },
    createdAt: stamp('2026-10-07T11:16:06.661Z'),
    updatedAt: stamp('2026-10-07T11:16:06.661Z'),
    ...overrides
  };
}

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/customer', customerMarketplaceOrderRoutes);
  return server;
}

describe('customer marketplace order reads', () => {
  beforeEach(() => {
    mockStore.docs = [
      order('mine-new', {
        orderStatus: 'awaiting_payment',
        createdAt: stamp('2026-10-07T11:30:00.000Z')
      }),
      order('mine-mid', {
        orderStatus: 'preparing',
        createdAt: stamp('2026-10-07T11:20:00.000Z'),
        items: [{ name: 'Lamp', qty: 2 }]
      }),
      order('mine-old', {
        orderStatus: 'ready',
        createdAt: stamp('2026-10-07T11:10:00.000Z'),
        items: [{ name: 'Vase', qty: 1 }]
      }),
      order('mine-done', {
        orderStatus: 'completed',
        createdAt: stamp('2026-10-07T11:00:00.000Z'),
        items: [{ name: 'Frame', qty: 1 }]
      }),
      order('other-order', {
        customerId: 'someone-else',
        orderStatus: 'awaiting_payment',
        createdAt: stamp('2026-10-07T11:40:00.000Z')
      })
    ];
  });

  test('owner ongoing list is newest first and history is separate', async () => {
    const ongoing = await request(app()).get('/api/customer/marketplace-orders?group=ongoing');
    expect(ongoing.status).toBe(200);
    expect(ongoing.body.data.orders.map((row) => row.id)).toEqual(['mine-new', 'mine-mid', 'mine-old']);
    expect(ongoing.body.data.orders[0]).toEqual(expect.objectContaining({
      displayId: 62191,
      orderStatus: 'awaiting_payment',
      itemsCount: 1,
      firstItemName: 'Balaji statue',
      expectedAmount: 1540,
      expectedAmountPaise: 154000,
      shopSnapshot: { name: 'Vaigzz store' }
    }));
    expect(ongoing.body.data.orders[0].createdAt).toMatch(ISO);
    expect(ongoing.body.data.orders[0].window.start).toMatch(ISO);
    expect(ongoing.body.data.orders[0].window.end).toMatch(ISO);
    expect(JSON.stringify(ongoing.body)).not.toContain(OTP);
    expect(JSON.stringify(ongoing.body)).not.toContain('shop-secret');
    expect(JSON.stringify(ongoing.body)).not.toContain('someone-else');

    const history = await request(app()).get('/api/customer/marketplace-orders?group=history');
    expect(history.status).toBe(200);
    expect(history.body.data.orders.map((row) => row.id)).toEqual(['mine-done']);
    expect(history.body.data.orders[0].firstItemName).toBe('Frame');
  });

  test('cursor pages ongoing orders after one page-1 order moves to history', async () => {
    const first = await request(app()).get('/api/customer/marketplace-orders?group=ongoing&limit=2');
    expect(first.status).toBe(200);
    expect(first.body.data.orders.map((row) => row.id)).toEqual(['mine-new', 'mine-mid']);
    expect(first.body.data.nextCursor).toEqual(expect.any(String));

    const moved = mockStore.docs.find((doc) => doc.id === 'mine-mid');
    moved.orderStatus = 'completed';

    const second = await request(app()).get(
      `/api/customer/marketplace-orders?group=ongoing&limit=2&cursor=${encodeURIComponent(first.body.data.nextCursor)}`
    );
    expect(second.status).toBe(200);
    expect(second.body.data.orders.map((row) => row.id)).toEqual(['mine-old']);
    expect(second.body.data.nextCursor).toBeNull();
  });

  test('a bad cursor is 400 INVALID_CURSOR', async () => {
    const response = await request(app()).get('/api/customer/marketplace-orders?group=ongoing&cursor=not-a-cursor');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_CURSOR');
  });

  test('another customer and a missing order are 404', async () => {
    const foreign = await request(app()).get('/api/customer/marketplace-orders/other-order');
    const missing = await request(app()).get('/api/customer/marketplace-orders/missing-order');
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect(foreign.body.error.code).toBe('ORDER_NOT_FOUND');
    expect(JSON.stringify(foreign.body)).not.toContain(OTP);
  });

  test('awaiting_payment detail includes paymentDetails and ISO timestamps, with no OTP', async () => {
    const response = await request(app()).get('/api/customer/marketplace-orders/mine-new');
    expect(response.status).toBe(200);
    expect(response.body.data.paymentDetails).toEqual({
      upiId: 'shop@upi',
      expectedAmount: 1540,
      expectedAmountPaise: 154000,
      verifiedPayeeName: 'VAIGAINATHAN R',
      window: {
        start: '2026-10-07T11:16:06.661Z',
        end: '2026-10-07T11:31:06.661Z'
      }
    });
    const view = response.body.data.order;
    expect(view.createdAt).toMatch(ISO);
    expect(view.updatedAt).toMatch(ISO);
    expect(view.window.start).toMatch(ISO);
    expect(view.window.end).toMatch(ISO);
    expect(view.payment.initiatedAt).toMatch(ISO);
    expect(view.payment.confirmedAt).toBeNull();
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(OTP);
    expect(serialized).not.toContain('handoverOtp');
    expect(serialized).not.toContain('confirmedByShopUid');
    expect(serialized).not.toContain('shop-secret');
  });

  test('a preparing order omits paymentDetails', async () => {
    const response = await request(app()).get('/api/customer/marketplace-orders/mine-mid');
    expect(response.status).toBe(200);
    expect(response.body.data.paymentDetails).toBeUndefined();
    expect(response.body.data.order.orderStatus).toBe('preparing');
    expect(JSON.stringify(response.body)).not.toContain(OTP);
  });
});
