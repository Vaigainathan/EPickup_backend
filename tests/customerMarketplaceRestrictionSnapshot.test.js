const REAL_FIRESTORE_GUARD = process.env.JEST_ALLOW_REAL_FIRESTORE === '1';

function assertNoRealFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!REAL_FIRESTORE_GUARD && projectId && projectId !== 'unit-test') {
    throw new Error(
      `Refusing tests: FIREBASE_PROJECT_ID=${projectId}. Set JEST_ALLOW_REAL_FIRESTORE=1 to override.`
    );
  }
}

process.env.FIREBASE_PROJECT_ID = 'unit-test';
assertNoRealFirestore();

const store = new Map();

const mockDb = {
  collection(name) {
    const collectionPath = name;
    return {
      doc(id) {
        const path = `${collectionPath}/${id}`;
        return {
          path,
          collection(sub) {
            const subPath = `${path}/${sub}`;
            return {
              doc(subId) {
                const docPath = `${subPath}/${subId}`;
                return {
                  path: docPath,
                  async get() {
                    const data = store.get(docPath);
                    return { exists: data !== undefined, data: () => data };
                  },
                  async set(data) {
                    store.set(docPath, { ...data });
                  },
                  async delete() {
                    store.delete(docPath);
                  }
                };
              }
            };
          },
          async get() {
            const data = store.get(path);
            return { exists: data !== undefined, data: () => data };
          },
          async update(patch) {
            const existing = store.get(path) || {};
            const next = JSON.parse(JSON.stringify(existing));
            Object.entries(patch).forEach(([key, value]) => {
              if (!key.includes('.')) {
                next[key] = value;
                return;
              }
              const parts = key.split('.');
              let cursor = next;
              for (let i = 0; i < parts.length - 1; i += 1) {
                const part = parts[i];
                cursor[part] = cursor[part] && typeof cursor[part] === 'object' ? cursor[part] : {};
                cursor = cursor[part];
              }
              cursor[parts[parts.length - 1]] = value;
            });
            store.set(path, next);
          }
        };
      }
    };
  }
};

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => mockDb)
}));

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

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    serverTimestamp: () => 'TS'
  }
}));

const {
  restrictCustomerMarketplace,
  unrestrictCustomerMarketplace
} = require('../src/services/admin/customerMarketplaceRestrictionService');
const { prepareRestrictSnapshot, loadMarketplaceSnapshot } = require('../src/utils/marketplaceProfileSnapshot');

describe('customer marketplace restrict snapshot (Firestore)', () => {
  const customerId = 'cust-restrict-1';

  beforeEach(() => {
    store.clear();
    store.set(`users/${customerId}`, {
      userType: 'customer',
      customer: {
        marketplace: {
          payerUpiName: 'Before',
          restriction: { active: false }
        }
      }
    });
  });

  test('restrict then unrestrict restores marketplace exactly', async () => {
    await restrictCustomerMarketplace(customerId, {
      reason: 'abuse',
      operator: 'admin-1'
    });

    const afterRestrict = store.get(`users/${customerId}`);
    expect(afterRestrict.customer.marketplace.restriction.active).toBe(true);

    const result = await unrestrictCustomerMarketplace(customerId, { operator: 'admin-1' });
    expect(result.unrestricted).toBe(true);
    expect(result.restoredKeys).toContain('payerUpiName');

    const afterRestore = store.get(`users/${customerId}`);
    expect(afterRestore.customer.marketplace.payerUpiName).toBe('Before');
    expect(afterRestore.customer.marketplace.restriction).toEqual({ active: false });
  });

  test('restrict refuses without force when snapshot already exists', async () => {
    await restrictCustomerMarketplace(customerId, {
      reason: 'first',
      operator: 'admin-1'
    });

    await expect(
      restrictCustomerMarketplace(customerId, {
        reason: 'second',
        operator: 'admin-1'
      })
    ).rejects.toMatchObject({
      status: 409,
      code: 'SNAPSHOT_EXISTS',
      message: 'Marketplace snapshot already exists; pass force to overwrite'
    });
  });

  test('snapshot stays in Firestore until unrestrict (dry-run / no apply equivalent)', async () => {
    await restrictCustomerMarketplace(customerId, {
      reason: 'hold',
      operator: 'admin-1'
    });

    const snapPath = `users/${customerId}/private/marketplaceRestrictionSnapshot`;
    expect(store.has(snapPath)).toBe(true);
    expect(await loadMarketplaceSnapshot(customerId)).toMatchObject({
      customerId,
      marketplace: expect.objectContaining({ payerUpiName: 'Before' })
    });

    await unrestrictCustomerMarketplace(customerId, { operator: 'admin-1' });
    expect(store.has(snapPath)).toBe(false);
    expect(await loadMarketplaceSnapshot(customerId)).toBeNull();
  });

  test('prepareRestrictSnapshot returns SNAPSHOT_EXISTS when doc present and force false', async () => {
    const marketplace = { payerUpiName: 'Before', restriction: { active: false } };
    const first = await prepareRestrictSnapshot(customerId, marketplace, { force: false });
    expect(first.ok).toBe(true);

    const second = await prepareRestrictSnapshot(customerId, marketplace, { force: false });
    expect(second.ok).toBe(false);
    expect(second.code).toBe('SNAPSHOT_EXISTS');
  });
});
