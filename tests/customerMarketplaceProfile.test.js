const {
  presentMarketplaceProfile,
  updateMarketplaceProfile
} = require('../src/services/marketplace/customerMarketplaceProfile');
const { presentShopRefund } = require('../src/services/marketplace/refunds');

jest.mock('../src/services/firebase', () => {
  const users = new Map();
  return {
    getFirestore: () => ({
      collection(name) {
        if (name !== 'users') {
          throw new Error('unexpected collection');
        }
        return {
          doc(id) {
            return {
              async get() {
                const data = users.get(id);
                return { exists: data !== undefined, data: () => data };
              },
              async update(patch) {
                const current = users.get(id) || {};
                const next = { ...current };
                Object.keys(patch).forEach((key) => {
                  if (!key.includes('.')) {
                    next[key] = patch[key];
                    return;
                  }
                  const parts = key.split('.');
                  let cursor = next;
                  for (let i = 0; i < parts.length - 1; i += 1) {
                    if (!cursor[parts[i]]) {
                      cursor[parts[i]] = {};
                    }
                    cursor = cursor[parts[i]];
                  }
                  cursor[parts[parts.length - 1]] = patch[key];
                });
                users.set(id, next);
              }
            };
          }
        };
      },
      __users: users
    })
  };
});

describe('presentMarketplaceProfile', () => {
  it('includes refundUpiId for customer profile', () => {
    const view = presentMarketplaceProfile({ refundUpiId: 'user@upi', unpaidCount: 1 });
    expect(view.refundUpiId).toBe('user@upi');
  });
});

describe('presentShopRefund', () => {
  it('does not expose saved profile refundUpiId field', () => {
    const shop = presentShopRefund({
      id: 'r1',
      status: 'upi_needed',
      amount: 10,
      refundUpiId: 'hidden@upi'
    }, 'o1');
    expect(shop.refundUpiId).toBeUndefined();
  });
});

describe('updateMarketplaceProfile', () => {
  const { getFirestore } = require('../src/services/firebase');

  beforeEach(() => {
    getFirestore().__users.clear();
    getFirestore().__users.set('cust-1', { customer: { marketplace: {} } });
  });

  it('rejects invalid UPI', async () => {
    await expect(updateMarketplaceProfile('cust-1', { refundUpiId: 'bad' }))
      .rejects
      .toMatchObject({ code: 'VALIDATION' });
  });

  it('stores valid refundUpiId', async () => {
    const data = await updateMarketplaceProfile('cust-1', { refundUpiId: 'valid@upi' });
    expect(data.refundUpiId).toBe('valid@upi');
  });
});
