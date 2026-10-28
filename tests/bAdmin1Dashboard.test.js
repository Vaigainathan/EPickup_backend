jest.mock('../instrument.js', () => ({}));

const { ONGOING_ORDER_STATUSES } = require('../src/services/marketplace/orderStateMachine');
const {
  ADMIN_LIST_ACTIVE_BOOKING_STATUSES,
  fetchDashboardCounts,
  buildAdminDriversFilterQuery,
  buildAdminBookingsFilterQuery,
  firestoreCount
} = require('../src/services/admin/adminDashboardCountsService');
const { canExpressSourceTypeInFirestore } = require('../src/utils/bookingSourceType');

function createCountQuery(countValue) {
  const query = {
    where: jest.fn(function where() {
      return this;
    }),
    count: jest.fn(() => ({
      get: jest.fn(async () => ({
        data: () => ({ count: countValue })
      }))
    }))
  };
  return query;
}

function createMockDb(countValue = 1) {
  const countQuery = createCountQuery(countValue);
  return {
    collection: jest.fn(() => countQuery),
    _countQuery: countQuery
  };
}

describe('B-ADMIN-1 bookingSourceType Firestore expressibility', () => {
  test('parcel filter cannot be counted in Firestore', () => {
    expect(canExpressSourceTypeInFirestore('parcel')).toBe(false);
    expect(canExpressSourceTypeInFirestore('Parcel')).toBe(false);
  });

  test('marketplace and absent filters can be counted', () => {
    expect(canExpressSourceTypeInFirestore('marketplace')).toBe(true);
    expect(canExpressSourceTypeInFirestore(undefined)).toBe(true);
    expect(canExpressSourceTypeInFirestore('')).toBe(true);
  });

  test('unknown sourceType filter does not block Firestore count', () => {
    expect(canExpressSourceTypeInFirestore('other')).toBe(true);
  });
});

describe('B-ADMIN-1 adminDashboardCountsService', () => {
  test('ADMIN_LIST_ACTIVE_BOOKING_STATUSES matches admin bookings/active list', () => {
    expect(ADMIN_LIST_ACTIVE_BOOKING_STATUSES).toEqual([
      'pending',
      'driver_assigned',
      'accepted',
      'driver_enroute',
      'driver_arrived',
      'picked_up',
      'in_transit'
    ]);
  });

  test('fetchDashboardCounts uses single status in query for active bookings', async () => {
    const db = createMockDb(3);
    await fetchDashboardCounts({ db, now: new Date('2026-01-15T12:00:00.000Z') });
    const bookingsQuery = db.collection.mock.results.find(
      (r) => r.value === db._countQuery
    );
    expect(db.collection).toHaveBeenCalledWith('bookings');
    expect(db._countQuery.where).toHaveBeenCalledWith(
      'status',
      'in',
      ADMIN_LIST_ACTIVE_BOOKING_STATUSES
    );
  });

  test('fetchDashboardCounts queries marketplace active with ONGOING_ORDER_STATUSES', async () => {
    const db = createMockDb(2);
    await fetchDashboardCounts({ db, now: new Date('2026-01-15T12:00:00.000Z') });
    expect(db.collection).toHaveBeenCalledWith('marketplaceOrders');
    expect(db._countQuery.where).toHaveBeenCalledWith(
      'orderStatus',
      'in',
      ONGOING_ORDER_STATUSES
    );
  });

  test('buildAdminDriversFilterQuery adds driver.isOnline when online=true', () => {
    const chain = [];
    const db = {
      collection: jest.fn(() => ({
        where: jest.fn((field, op, value) => {
          chain.push([field, op, value]);
          return db.collection();
        })
      }))
    };
    buildAdminDriversFilterQuery(db, { online: 'true' });
    expect(chain).toContainEqual(['driver.isOnline', '==', true]);
  });

  test('buildAdminBookingsFilterQuery adds marketplace sourceType', () => {
    const chain = [];
    const db = {
      collection: jest.fn(() => ({
        where: jest.fn((field, op, value) => {
          chain.push([field, op, value]);
          return db.collection();
        })
      }))
    };
    buildAdminBookingsFilterQuery(db, { sourceType: 'marketplace' });
    expect(chain).toContainEqual(['sourceType', '==', 'marketplace']);
  });

  test('firestoreCount returns aggregate count', async () => {
    const count = await firestoreCount(createCountQuery(42));
    expect(count).toBe(42);
  });
});

describe('B-ADMIN-1 bookings pagination totalCount policy', () => {
  test('parcel sourceType implies totalCount null (not expressible in Firestore)', () => {
    const sourceType = 'parcel';
    const totalCount = canExpressSourceTypeInFirestore(sourceType)
      ? 99
      : null;
    expect(totalCount).toBeNull();
  });

  test('marketplace sourceType allows numeric totalCount', () => {
    const sourceType = 'marketplace';
    const totalCount = canExpressSourceTypeInFirestore(sourceType)
      ? 99
      : null;
    expect(totalCount).toBe(99);
  });
});
