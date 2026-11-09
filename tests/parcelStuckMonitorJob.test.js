const mockDocs = new Map();
const mockLocations = new Map();

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

const { getFirestore } = require('../src/services/firebase');

function ts(ms) {
  return { toMillis: () => ms };
}

function buildDb() {
  return {
    collection(name) {
      const filters = [];
      return {
        where(field, op, value) {
          filters.push({ field, op, value });
          return this;
        },
        limit(n) {
          this._limit = n;
          return this;
        },
        async get() {
          const store = name === 'driverLocations' ? mockLocations : mockDocs;
          const prefix = `${name}/`;
          const docs = [];
          store.forEach((data, path) => {
            if (!path.startsWith(prefix)) {
              return;
            }
            const id = path.slice(prefix.length);
            const row = { ...data };
            const matches = filters.every((filter) => {
              if (filter.op === 'in') {
                return filter.value.includes(row[filter.field]);
              }
              return true;
            });
            if (!matches) {
              return;
            }
            docs.push({ id, data: () => row });
          });
          return { docs: docs.slice(0, this._limit || docs.length), size: docs.length };
        },
        doc(id) {
          const path = `${name}/${id}`;
          return {
            path,
            get: async () => ({
              exists: (name === 'driverLocations' ? mockLocations : mockDocs).has(path),
              data: () => (name === 'driverLocations' ? mockLocations : mockDocs).get(path)
            })
          };
        }
      };
    }
  };
}

describe('parcelStuckMonitorJob', () => {
  let job;

  beforeEach(() => {
    mockDocs.clear();
    mockLocations.clear();
    getFirestore.mockReturnValue(buildDb());
    jest.isolateModules(() => {
      job = require('../src/services/parcelStuckMonitorJob');
      job._resetDedupCache();
    });
  });

  test('alerts without changing booking status', async () => {
    const nowMs = 5_000_000;
    mockDocs.set('bookings/stuck-1', {
      status: 'driver_assigned',
      sourceType: 'parcel',
      driverId: 'driver-1',
      updatedAt: ts(nowMs - 40 * 60 * 1000)
    });
    mockLocations.set('driverLocations/driver-1', {
      lastUpdated: ts(nowMs - 15 * 60 * 1000)
    });

    const result = await job.runTick({
      nowMs,
      stuckMs: 30 * 60 * 1000,
      silentMs: 10 * 60 * 1000,
      dedupMs: 60 * 60 * 1000
    });

    expect(result.alerts.length).toBeGreaterThan(0);
    expect(mockDocs.get('bookings/stuck-1').status).toBe('driver_assigned');
  });

  test('skips marketplace bookings', async () => {
    const nowMs = 5_000_000;
    mockDocs.set('bookings/mp-stuck', {
      status: 'driver_assigned',
      sourceType: 'marketplace',
      updatedAt: ts(nowMs - 40 * 60 * 1000)
    });

    const result = await job.runTick({
      nowMs,
      stuckMs: 30 * 60 * 1000,
      silentMs: 10 * 60 * 1000
    });

    expect(result.alerts.length).toBe(0);
  });
});
