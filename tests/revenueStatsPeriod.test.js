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

const topUps = [];
const pointsDebits = [];
const bookings = new Map();

const mockDb = {
  collection(name) {
    if (name === 'driverTopUps') {
      return {
        where(field, op, value) {
          const chain = { filters: [[field, op, value]] };
          const api = {
            where(f2, o2, v2) {
              chain.filters.push([f2, o2, v2]);
              return api;
            },
            async get() {
              let rows = topUps.filter((row) => row.status === 'completed');
              for (const [f, o, v] of chain.filters) {
                if (f === 'status' && o === '==') {
                  rows = rows.filter((r) => r.status === v);
                }
                if (f === 'createdAt' && o === '>=') {
                  rows = rows.filter((r) => r.createdAt >= v);
                }
                if (f === 'createdAt' && o === '<=') {
                  rows = rows.filter((r) => r.createdAt <= v);
                }
              }
              return {
                forEach(fn) {
                  rows.forEach((row) => fn({ data: () => row }));
                }
              };
            }
          };
          return api;
        }
      };
    }
    if (name === 'pointsTransactions') {
      return {
        where(field, op, value) {
          return {
            async get() {
              const rows = pointsDebits.filter((row) => row.type === value);
              return {
                forEach(fn) {
                  rows.forEach((row) => fn({ data: () => row }));
                }
              };
            }
          };
        }
      };
    }
    if (name === 'bookings') {
      return {
        doc(id) {
          return {
            async get() {
              const data = bookings.get(id);
              if (!data) {
                return { exists: false };
              }
              return { exists: true, data: () => data };
            }
          };
        }
      };
    }
    throw new Error(`Unexpected collection ${name}`);
  }
};

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => mockDb),
  getFirebaseApp: jest.fn(() => ({}))
}));

const revenueService = require('../src/services/revenueService');

describe('getRevenueStats period filters', () => {
  beforeEach(() => {
    topUps.length = 0;
    pointsDebits.length = 0;
    bookings.clear();
    revenueService.db = mockDb;
  });

  test('filters money-in and commission by startDate/endDate', async () => {
    topUps.push(
      { status: 'completed', amount: 100, createdAt: new Date('2025-06-01') },
      { status: 'completed', amount: 200, createdAt: new Date('2025-07-01') }
    );
    pointsDebits.push(
      { type: 'debit', bookingId: 'b-parcel', pointsAmount: 10, createdAt: new Date('2025-06-15') },
      { type: 'debit', bookingId: 'b-mkt', pointsAmount: 20, createdAt: new Date('2025-08-01') }
    );
    bookings.set('b-parcel', { sourceType: 'parcel' });
    bookings.set('b-mkt', { sourceType: 'marketplace' });

    const allTime = await revenueService.getRevenueStats();
    expect(allTime.stats.totalRevenue).toBe(300);
    expect(allTime.stats.parcelCommission).toBe(10);
    expect(allTime.stats.marketplaceCommission).toBe(20);

    const juneOnly = await revenueService.getRevenueStats({
      startDate: new Date('2025-06-01'),
      endDate: new Date('2025-06-30T23:59:59.999Z')
    });
    expect(juneOnly.stats.totalRevenue).toBe(100);
    expect(juneOnly.stats.transactionCount).toBe(1);
    expect(juneOnly.stats.parcelCommission).toBe(10);
    expect(juneOnly.stats.marketplaceCommission).toBe(0);
    expect(juneOnly.stats.period.startDate).toBeTruthy();
  });
});
