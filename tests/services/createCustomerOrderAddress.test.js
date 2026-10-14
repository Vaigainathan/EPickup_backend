const { wrapStrictTransaction } = require('../helpers/strictFirestoreTransaction');
const {
  createMarketplaceOrder,
  orderIdFor,
  addressCoordinates
} = require('../../src/services/marketplace/createCustomerOrder');

jest.mock('../../src/services/orderNumberPool', () => ({
  isPoolEnabled: () => false
}));

jest.mock('../../src/services/displayIdService', () => ({
  marketplaceCounterDoc: 'marketplace_orders',
  generateHash: () => 1,
  formatDisplayId: (id) => String(id)
}));

jest.mock('../../src/services/marketplace/orderEvents', () => ({
  appendEvent: jest.fn()
}));

function buildFirestoreScenario({ orderExists, customerData }) {
  const orderId = orderIdFor('cust-1', '11111111-1111-4111-8111-111111111111');
  const writes = [];

  const tx = wrapStrictTransaction({
    get: async (ref) => {
      if (ref && ref.__query) {
        return { docs: [] };
      }
      const path = ref.path || ref.id || '';
      if (path.includes('marketplaceOrders')) {
        return {
          exists: orderExists,
          data: () => ({ customerId: 'cust-1', orderStatus: 'awaiting_payment', items: [] })
        };
      }
      if (path.includes('marketplaceLocks')) {
        return { exists: false, data: () => ({}) };
      }
      if (path.includes('users/cust-1')) {
        return { exists: true, data: () => customerData };
      }
      if (path.includes('users/shop-1')) {
        return {
          exists: true,
          data: () => ({
            userType: 'shop',
            isActive: true,
            shop: { approvalStatus: 'approved', shopName: 'S', shopType: 'Food' },
            phone: '9999999999'
          })
        };
      }
      if (path.includes('shops/shop-1')) {
        return {
          exists: true,
          data: () => ({
            bank: { upiId: 'shop@upi', upiNameVerification: { verifiedName: 'Verified' } },
            location: { latitude: 12.9, longitude: 77.6 },
            address: 'Shop addr'
          })
        };
      }
      if (path.includes('appSettings')) {
        return { exists: false, data: () => ({}) };
      }
      if (path.includes('products')) {
        return {
          exists: true,
          data: () => ({
            shopId: 'shop-1',
            isActive: true,
            name: 'Item',
            price: 10,
            stock: 5
          })
        };
      }
      if (path.includes('system_counters')) {
        return { exists: true, data: () => ({ nextValue: 1, totalGenerated: 0 }) };
      }
      return { exists: false, data: () => ({}) };
    },
    set: (...args) => {
      writes.push('set');
      return Promise.resolve();
    },
    update: (...args) => {
      writes.push('update');
      return Promise.resolve();
    }
  });

  const db = {
    collection(name) {
      const chain = {
        doc(id) {
          return { path: `${name}/${id}`, id };
        },
        where() {
          const query = { __query: true };
          return {
            where() {
              return query;
            },
            get: async () => ({ docs: [] })
          };
        }
      };
      return chain;
    },
    runTransaction(fn) {
      return fn(tx);
    }
  };

  return { db, orderId, writes };
}

jest.mock('../../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

const { getFirestore } = require('../../src/services/firebase');

describe('createCustomerOrder address coordinates (B4 / C4)', () => {
  const idempotencyKey = '11111111-1111-4111-8111-111111111111';
  const baseBody = {
    shopId: 'shop-1',
    addressId: 'addr-1',
    items: [{ productId: 'prod-1', qty: 1, price: 10 }]
  };

  test('addressCoordinates returns null without coords', () => {
    expect(addressCoordinates({ text: 'No pin' })).toBeNull();
  });

  test('ADDRESS_INVALID when coordinates missing on new order', async () => {
    const { db, writes } = buildFirestoreScenario({
      orderExists: false,
      customerData: {
        customer: {
          addresses: [{ id: 'addr-1', text: 'Home' }],
          marketplace: { unpaidCount: 0 }
        }
      }
    });
    getFirestore.mockReturnValue(db);

    await expect(
      createMarketplaceOrder({
        customerId: 'cust-1',
        idempotencyKey,
        body: baseBody
      })
    ).rejects.toMatchObject({
      status: 400,
      code: 'ADDRESS_INVALID'
    });
    expect(writes).toHaveLength(0);
  });

  test('idempotent replay returns 200 without coordinate validation', async () => {
    const { db } = buildFirestoreScenario({
      orderExists: true,
      customerData: {
        customer: {
          addresses: [{ id: 'addr-1', text: 'Home' }],
          marketplace: { unpaidCount: 0 }
        }
      }
    });
    getFirestore.mockReturnValue(db);

    const result = await createMarketplaceOrder({
      customerId: 'cust-1',
      idempotencyKey,
      body: baseBody
    });
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
  });
});
