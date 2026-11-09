const mockDocs = new Map();

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

jest.mock('../src/services/parcel/parcelBookingCancelledNotify', () => ({
  notifyParcelBookingCancelled: jest.fn(async () => {})
}));

const { getFirestore } = require('../src/services/firebase');
const { notifyParcelBookingCancelled } = require('../src/services/parcel/parcelBookingCancelledNotify');

function ts(ms) {
  return { toMillis: () => ms, toDate: () => new Date(ms) };
}

function seedBooking(id, data) {
  mockDocs.set(`bookings/${id}`, { ...data });
}

function buildDb() {
  return {
    collection(name) {
      const filters = [];
      const api = {
        where(field, op, value) {
          filters.push({ field, op, value });
          return api;
        },
        limit(n) {
          api._limit = n;
          return api;
        },
        doc(id) {
          const path = `${name}/${id}`;
          return { id, path };
        },
        async get() {
          const docs = [];
          mockDocs.forEach((data, path) => {
            if (!path.startsWith(`${name}/`)) {
              return;
            }
            const id = path.split('/')[1];
            const matches = filters.every((filter) => {
              const current = data[filter.field];
              if (filter.op === '==') {
                return current === filter.value;
              }
              return true;
            });
            if (!matches) {
              return;
            }
            docs.push({
              id,
              ref: { id, path },
              data: () => data
            });
          });
          const limited = docs.slice(0, api._limit || docs.length);
          return { docs: limited, size: limited.length, empty: limited.length === 0 };
        }
      };
      return api;
    },
    runTransaction: jest.fn(async (fn) => {
      const store = mockDocs;
      const tx = {
        get: async (ref) => {
          const data = store.get(ref.path);
          return {
            exists: data !== undefined,
            data: () => (data ? { ...data } : undefined)
          };
        },
        update: (ref, patch) => {
          const cur = store.get(ref.path) || {};
          store.set(ref.path, { ...cur, ...patch });
        },
        delete: (ref) => {
          store.delete(ref.path);
        }
      };
      return fn(tx);
    })
  };
}

describe('parcelPendingTimeoutJob', () => {
  let job;

  beforeEach(() => {
    mockDocs.clear();
    jest.clearAllMocks();
    getFirestore.mockReturnValue(buildDb());
    jest.isolateModules(() => {
      job = require('../src/services/parcelPendingTimeoutJob');
    });
  });

  test('cancels parcel pending older than timeout', async () => {
    const nowMs = 1_000_000;
    seedBooking('old-parcel', {
      status: 'pending',
      sourceType: 'parcel',
      customerId: 'cust-1',
      createdAt: ts(nowMs - 11 * 60 * 1000),
    });

    const result = await job.runTick({ nowMs, timeoutMs: 10 * 60 * 1000 });
    expect(result.actions.some((a) => a.id === 'old-parcel' && a.changed === true)).toBe(true);
    expect(mockDocs.get('bookings/old-parcel').status).toBe('cancelled');
    expect(notifyParcelBookingCancelled).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'old-parcel',
        reason: 'no_driver_timeout',
        notifyCustomerPush: true
      })
    );
  });

  test('skips marketplace in memory', async () => {
    const nowMs = 1_000_000;
    seedBooking('mp-1', {
      status: 'pending',
      sourceType: 'marketplace',
      createdAt: ts(nowMs - 60 * 60 * 1000)
    });

    const result = await job.runTick({ nowMs, timeoutMs: 10 * 60 * 1000 });
    expect(result.actions.length).toBe(0);
    expect(mockDocs.get('bookings/mp-1').status).toBe('pending');
  });

  test('skips young pending', async () => {
    const nowMs = 1_000_000;
    seedBooking('young', {
      status: 'pending',
      sourceType: 'parcel',
      createdAt: ts(nowMs - 5 * 60 * 1000)
    });

    const result = await job.runTick({ nowMs, timeoutMs: 10 * 60 * 1000 });
    expect(result.actions.length).toBe(0);
  });

  test('dry run logs only, no write or notify', async () => {
    const nowMs = 1_000_000;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    seedBooking('dry-parcel', {
      status: 'pending',
      sourceType: 'parcel',
      customerId: 'cust-1',
      createdAt: ts(nowMs - 11 * 60 * 1000)
    });

    const result = await job.runTick({ nowMs, timeoutMs: 10 * 60 * 1000, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(mockDocs.get('bookings/dry-parcel').status).toBe('pending');
    expect(notifyParcelBookingCancelled).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.some((call) => (
      String(call[0]).includes('[PARCEL_PENDING_TIMEOUT][DRY_RUN] would cancel')
      && call[1] && call[1].bookingId === 'dry-parcel'
    ))).toBe(true);
    logSpy.mockRestore();
  });

  test('cancels stale booking silently when older than notify max age', async () => {
    const nowMs = 1_000_000;
    seedBooking('ancient-parcel', {
      status: 'pending',
      sourceType: 'parcel',
      customerId: 'cust-1',
      createdAt: ts(nowMs - 150 * 60 * 1000)
    });

    const result = await job.runTick({
      nowMs,
      timeoutMs: 10 * 60 * 1000,
      notifyMaxAgeMs: 120 * 60 * 1000
    });
    expect(result.actions.some((a) => a.id === 'ancient-parcel' && a.changed === true)).toBe(true);
    expect(result.actions.find((a) => a.id === 'ancient-parcel').notified).toBe(false);
    expect(mockDocs.get('bookings/ancient-parcel').status).toBe('cancelled');
    expect(notifyParcelBookingCancelled).not.toHaveBeenCalled();
  });

  test('tick summary counts marketplace and scheduled skips', async () => {
    const nowMs = 1_000_000;
    seedBooking('mp-1', {
      status: 'pending',
      sourceType: 'marketplace',
      createdAt: ts(nowMs - 60 * 60 * 1000)
    });
    seedBooking('sched-1', {
      status: 'pending',
      sourceType: 'parcel',
      createdAt: ts(nowMs - 60 * 60 * 1000),
      estimatedPickupTime: ts(nowMs + 60 * 60 * 1000)
    });

    const result = await job.runTick({ nowMs, timeoutMs: 10 * 60 * 1000 });
    expect(result.summary.skipped_marketplace).toBe(1);
    expect(result.summary.skipped_scheduled).toBe(1);
    expect(result.summary.scanned).toBe(2);
  });

  test('already cancelled is no-op', async () => {
    const nowMs = 1_000_000;
    seedBooking('done', {
      status: 'cancelled',
      sourceType: 'parcel',
      createdAt: ts(nowMs - 60 * 60 * 1000)
    });

    const result = await job.runTick({ nowMs, timeoutMs: 10 * 60 * 1000 });
    expect(result.actions.length).toBe(0);
    expect(notifyParcelBookingCancelled).not.toHaveBeenCalled();
  });
});
