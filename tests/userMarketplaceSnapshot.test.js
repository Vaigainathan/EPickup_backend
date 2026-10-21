const store = new Map();

function docPath(collectionPath, id) {
  return `${collectionPath}/${id}`;
}

function parseRef(path) {
  const parts = path.split('/');
  const id = parts.pop();
  const collectionPath = parts.join('/');
  return { collectionPath, id };
}

const mockDb = {
  collection(name) {
    const collectionPath = name;
    return {
      doc(id) {
        const path = docPath(collectionPath, id);
        return {
          path,
          id,
          collection(subName) {
            return mockDb.collection(`${path}/${subName}`);
          },
          async get() {
            const data = store.get(path);
            return {
              exists: data !== undefined,
              data: () => data
            };
          },
          async set(data) {
            store.set(path, { ...data });
          },
          async delete() {
            return store.delete(path);
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
    serverTimestamp: () => ({ __serverTimestamp: true })
  }
}));

const {
  saveMarketplaceSnapshot,
  loadMarketplaceSnapshot,
  deleteMarketplaceSnapshot,
  prepareRestrictSnapshot,
  SNAPSHOT_DOC_ID
} = require('../scripts/support/userMarketplaceSnapshot');

describe('userMarketplaceSnapshot (Firestore private doc)', () => {
  beforeEach(() => {
    store.clear();
  });

  test('stores snapshot under users/{id}/private/marketplaceRestrictionSnapshot', async () => {
    const customerId = 'cust-snap-1';
    const path = await saveMarketplaceSnapshot(customerId, { restriction: { active: false } });
    expect(path).toContain(`users/${customerId}/private/${SNAPSHOT_DOC_ID}`);
    const loaded = await loadMarketplaceSnapshot(customerId);
    expect(loaded.marketplace).toEqual({ restriction: { active: false } });
  });

  test('prepareRestrictSnapshot refuses overwrite without force', async () => {
    const customerId = 'cust-snap-2';
    await saveMarketplaceSnapshot(customerId, { restriction: { active: false } });
    const outcome = await prepareRestrictSnapshot(customerId, { stats: { orders: 1 } }, { force: false });
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('SNAPSHOT_EXISTS');
    expect((await loadMarketplaceSnapshot(customerId)).marketplace).toEqual({ restriction: { active: false } });
  });

  test('prepareRestrictSnapshot overwrites with force', async () => {
    const customerId = 'cust-snap-3';
    await saveMarketplaceSnapshot(customerId, { old: true });
    const outcome = await prepareRestrictSnapshot(customerId, { new: true }, { force: true });
    expect(outcome.ok).toBe(true);
    expect(outcome.overwritten).toBe(true);
    expect((await loadMarketplaceSnapshot(customerId)).marketplace).toEqual({ new: true });
  });

  test('deleteMarketplaceSnapshot removes the doc', async () => {
    const customerId = 'cust-snap-4';
    await saveMarketplaceSnapshot(customerId, {});
    expect(await loadMarketplaceSnapshot(customerId)).not.toBeNull();
    expect(await deleteMarketplaceSnapshot(customerId)).toBe(true);
    expect(await loadMarketplaceSnapshot(customerId)).toBeNull();
    expect(await deleteMarketplaceSnapshot(customerId)).toBe(false);
  });
});
