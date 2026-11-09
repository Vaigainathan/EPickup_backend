const { wrapStrictTransaction } = require('./helpers/strictFirestoreTransaction');
const {
  cancelPendingParcelInTransaction,
  canSystemCancelPendingParcel
} = require('../src/services/parcel/parcelPendingCancelService');

const bookingId = 'book-pending-1';

let bookingStore = {};
let lockStore = { exists: false };
let ops = [];

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

function makeSnap(data, exists = true) {
  return { exists, data: () => (exists ? { ...data } : undefined) };
}

function buildDb() {
  const bookingRef = { path: `bookings/${bookingId}`, id: bookingId };
  const lockRef = { path: `booking_locks/${bookingId}`, id: bookingId };

  return {
    collection(name) {
      if (name === 'bookings') {
        return {
          doc: () => bookingRef
        };
      }
      if (name === 'booking_locks') {
        return {
          doc: () => lockRef
        };
      }
      return { doc: () => ({ path: 'x/y' }) };
    },
    runTransaction: jest.fn(async (fn) => {
      ops = [];
      const tx = wrapStrictTransaction({
        get: jest.fn(async (ref) => {
          const path = ref.path || '';
          ops.push({ type: 'get', path });
          if (path.startsWith('bookings/')) {
            return makeSnap(bookingStore, Object.keys(bookingStore).length > 0);
          }
          if (path.startsWith('booking_locks/')) {
            return makeSnap(lockStore.data || {}, lockStore.exists);
          }
          return makeSnap(null, false);
        }),
        update: jest.fn((ref, patch) => {
          ops.push({ type: 'update', path: ref.path, patch });
          if ((ref.path || '').startsWith('bookings/')) {
            bookingStore = { ...bookingStore, ...patch };
          }
        }),
        delete: jest.fn((ref) => {
          ops.push({ type: 'delete', path: ref.path });
          if ((ref.path || '').startsWith('booking_locks/')) {
            lockStore = { exists: false, data: {} };
          }
        })
      });
      return fn(tx);
    })
  };
}

describe('parcelPendingCancelService strict transaction', () => {
  beforeEach(() => {
    bookingStore = {
      status: 'pending',
      customerId: 'cust-1',
      sourceType: 'parcel',
      driverId: null,
      notifiedDrivers: ['driver-offered-1']
    };
    lockStore = { exists: true, data: { driverId: 'other' } };
    ops = [];
  });

  test('reads booking and lock before writes', async () => {
    const db = buildDb();
    const result = await cancelPendingParcelInTransaction(db, {
      bookingId,
      reason: 'no_driver_timeout',
      cancelledBy: 'system:test'
    });

    expect(result.changed).toBe(true);
    expect(bookingStore.status).toBe('cancelled');
    expect(ops.filter((op) => op.type === 'get').length).toBeGreaterThanOrEqual(2);
    expect(ops.some((op) => op.type === 'update')).toBe(true);
    expect(ops.some((op) => op.type === 'delete' && op.path.includes('booking_locks'))).toBe(true);
    const firstWriteIndex = ops.findIndex((op) => op.type === 'update' || op.type === 'delete');
    const lastGetIndex = ops.map((op, i) => (op.type === 'get' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    expect(lastGetIndex).toBeLessThan(firstWriteIndex);
  });

  test('excludes marketplace regardless of flags', () => {
    expect(canSystemCancelPendingParcel({ status: 'pending', sourceType: 'marketplace' }).code)
      .toBe('MARKETPLACE');
  });

  test('idempotent when already cancelled', async () => {
    bookingStore.status = 'cancelled';
    const db = buildDb();
    const result = await cancelPendingParcelInTransaction(db, {
      bookingId,
      reason: 'no_driver_timeout',
      cancelledBy: 'system:test'
    });
    expect(result.changed).toBe(false);
    expect(result.code).toBe('ALREADY_CANCELLED');
  });
});
