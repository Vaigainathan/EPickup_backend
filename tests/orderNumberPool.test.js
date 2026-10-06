const { Timestamp } = require('firebase-admin/firestore');
const {
  numberForIndex,
  allocateInTransaction,
  isPoolEnabled,
  PoolNoFreeNumberError
} = require('../src/services/orderNumberPool');

function fakeDb(state) {
  const ops = [];
  const db = {
    collection(name) {
      return {
        doc(id) {
          return { path: `${name}/${id}` };
        }
      };
    }
  };
  const transaction = {
    async get(ref) {
      ops.push({ op: 'get', path: ref.path });
      if (ref.path === 'system_counters/order_number_pool') {
        if (!state.counter) {
          return { exists: false, data() { return undefined; } };
        }
        return { exists: true, data() { return state.counter; } };
      }
      const number = Number(ref.path.slice('orderNumbers/'.length));
      const exists = state.taken.has(number);
      return {
        exists,
        data() {
          return exists ? { number } : undefined;
        }
      };
    },
    set(ref, data) {
      ops.push({ op: 'set', path: ref.path, data });
    }
  };
  return { db, transaction, ops };
}

function assertReadsBeforeWrites(ops) {
  const firstWrite = ops.findIndex((entry) => entry.op === 'set');
  const lastRead = ops.reduce((last, entry, index) => (entry.op === 'get' ? index : last), -1);
  expect(lastRead).toBeGreaterThanOrEqual(0);
  expect(firstWrite).toBeGreaterThan(lastRead);
}

describe('numberForIndex', () => {
  test('matches the formula at the first two indexes', () => {
    expect(numberForIndex(0)).toBe(40011);
    expect(numberForIndex(1)).toBe(47930);
  });

  test('maps 0..89999 onto 90000 distinct numbers inside 10000..99999', () => {
    const seen = new Set();
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 90000; i += 1) {
      const number = numberForIndex(i);
      seen.add(number);
      if (number < min) {
        min = number;
      }
      if (number > max) {
        max = number;
      }
    }
    expect(seen.size).toBe(90000);
    expect(min).toBeGreaterThanOrEqual(10000);
    expect(max).toBeLessThanOrEqual(99999);
  });
});

describe('allocateInTransaction', () => {
  test('takes the first free candidate and writes the registry after every read', async () => {
    const { db, transaction, ops } = fakeDb({
      counter: { nextIndex: 0, totalAllocated: 4 },
      taken: new Set()
    });

    const number = await allocateInTransaction(transaction, db, { kind: 'parcel', refId: 'booking-1' });

    expect(number).toBe(40011);
    assertReadsBeforeWrites(ops);
    expect(ops.filter((entry) => entry.op === 'get').map((entry) => entry.path)).toEqual([
      'system_counters/order_number_pool',
      'orderNumbers/40011'
    ]);
    expect(ops.filter((entry) => entry.op === 'set')).toEqual([
      {
        op: 'set',
        path: 'orderNumbers/40011',
        data: {
          number: 40011,
          kind: 'parcel',
          refId: 'booking-1',
          source: 'pool',
          createdAt: expect.any(Timestamp)
        }
      },
      {
        op: 'set',
        path: 'system_counters/order_number_pool',
        data: { nextIndex: 1, totalAllocated: 5 }
      }
    ]);
  });

  test('skips taken candidates and advances nextIndex past the chosen index', async () => {
    const { db, transaction, ops } = fakeDb({
      counter: { nextIndex: 5, totalAllocated: 5 },
      taken: new Set([numberForIndex(5), numberForIndex(6)])
    });

    const number = await allocateInTransaction(transaction, db, { kind: 'shop_order', refId: 'order-9' });

    expect(number).toBe(numberForIndex(7));
    assertReadsBeforeWrites(ops);
    const counterWrite = ops.find((entry) => entry.path === 'system_counters/order_number_pool' && entry.op === 'set');
    expect(counterWrite.data).toEqual({ nextIndex: 8, totalAllocated: 6 });
    const registryWrite = ops.find((entry) => entry.op === 'set' && entry.path.startsWith('orderNumbers/'));
    expect(registryWrite.data).toEqual({
      number: numberForIndex(7),
      kind: 'shop_order',
      refId: 'order-9',
      source: 'pool',
      createdAt: expect.any(Timestamp)
    });
  });

  test('treats a missing counter document as nextIndex 0 and totalAllocated 0', async () => {
    const { db, transaction, ops } = fakeDb({
      counter: null,
      taken: new Set()
    });

    const number = await allocateInTransaction(transaction, db, { kind: 'parcel', refId: 'booking-2' });

    expect(number).toBe(numberForIndex(0));
    const counterWrite = ops.find((entry) => entry.path === 'system_counters/order_number_pool' && entry.op === 'set');
    expect(counterWrite.data).toEqual({ nextIndex: 1, totalAllocated: 1 });
  });

  test('throws POOL_NO_FREE_NUMBER and writes nothing when 20 candidates exist', async () => {
    const taken = new Set();
    for (let offset = 0; offset < 20; offset += 1) {
      taken.add(numberForIndex(3 + offset));
    }
    const { db, transaction, ops } = fakeDb({
      counter: { nextIndex: 3, totalAllocated: 3 },
      taken
    });

    let thrown = null;
    try {
      await allocateInTransaction(transaction, db, { kind: 'parcel', refId: 'booking-3' });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PoolNoFreeNumberError);
    expect(thrown.code).toBe('POOL_NO_FREE_NUMBER');
    expect(ops.some((entry) => entry.op === 'set')).toBe(false);
  });
});

describe('isPoolEnabled', () => {
  const original = process.env.FEATURE_ORDER_NUMBER_POOL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FEATURE_ORDER_NUMBER_POOL;
    } else {
      process.env.FEATURE_ORDER_NUMBER_POOL = original;
    }
  });

  test('is on only when the env value is exactly true', () => {
    delete process.env.FEATURE_ORDER_NUMBER_POOL;
    expect(isPoolEnabled()).toBe(false);
    process.env.FEATURE_ORDER_NUMBER_POOL = 'false';
    expect(isPoolEnabled()).toBe(false);
    process.env.FEATURE_ORDER_NUMBER_POOL = 'TRUE';
    expect(isPoolEnabled()).toBe(false);
    process.env.FEATURE_ORDER_NUMBER_POOL = '1';
    expect(isPoolEnabled()).toBe(false);
    process.env.FEATURE_ORDER_NUMBER_POOL = 'true';
    expect(isPoolEnabled()).toBe(true);
  });
});
