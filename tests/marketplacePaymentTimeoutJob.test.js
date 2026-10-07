const mockTimeoutDocs = new Map();
const mockTimeoutOps = [];

function mockTimeoutRef(path) {
  return {
    id: path.split('/').pop(),
    path
  };
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
      return {
        doc(id) {
          return mockTimeoutRef(`${name}/${id}`);
        }
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          const data = mockTimeoutDocs.get(ref.path);
          return {
            exists: data !== undefined,
            id: ref.id,
            data: () => data
          };
        },
        update(ref, patch) {
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
  notifyCustomer: jest.fn()
}));

jest.mock('../src/services/displayIdService', () => ({
  formatDisplayId: (value) => `#${value}`
}));

const job = require('../src/services/marketplacePaymentTimeoutJob');

function userUpdate() {
  return mockTimeoutOps.find((entry) => entry.path === 'users/cust-1' && entry.op === 'update');
}

beforeEach(() => {
  mockTimeoutDocs.clear();
  mockTimeoutOps.length = 0;
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
