const {
  collectCandidateBookingIds,
  planReleaseStuckDriver,
  loadReleaseContext,
  applyReleaseStuckDriver,
  validateApplyPlanIds,
  DRY_RUN_APP_WARNING,
  getDriverActiveBookingStatuses,
  FieldValue
} = require('../scripts/support/lib/releaseStuckDriverActions');

function snap(exists, data) {
  return { exists, data: () => data };
}

function baseContext(overrides = {}) {
  return {
    driverId: 'driver-1',
    userSnap: snap(true, {
      userType: 'driver',
      driver: {
        isAvailable: false,
        isOnline: true,
        currentBookingId: 'orphan-1',
        status: 'enroute',
        activeBookings: 1
      }
    }),
    locationSnap: snap(true, {
      isAvailable: false,
      currentTripId: 'orphan-1',
      bookingId: 'orphan-1'
    }),
    candidateBookingIds: ['orphan-1'],
    bookingsById: {
      'orphan-1': { exists: false, data: null }
    },
    tripTrackingById: {
      'orphan-1': { isActive: true }
    },
    locksById: {
      'orphan-1': true
    },
    driverActiveBookings: [],
    ...overrides
  };
}

function createMockDb(plan) {
  const batchOps = [];
  const batch = {
    update: jest.fn((ref, patch) => {
      batchOps.push({ type: 'update', path: ref.path, patch });
    }),
    set: jest.fn((ref, patch, opts) => {
      batchOps.push({ type: 'set', path: ref.path, patch, opts });
    }),
    delete: jest.fn((ref) => {
      batchOps.push({ type: 'delete', path: ref.path });
    }),
    commit: jest.fn(async () => {})
  };

  const db = {
    batch: jest.fn(() => batch),
    collection: jest.fn((name) => ({
      doc: jest.fn((id) => ({ path: `${name}/${id}` }))
    })),
    _batchOps: batchOps,
    _batch: batch
  };

  return db;
}

describe('releaseStuckDriverActions', () => {
  test('getDriverActiveBookingStatuses matches GET /api/driver/bookings/active', () => {
    expect(getDriverActiveBookingStatuses()).toEqual([
      'driver_assigned',
      'accepted',
      'driver_enroute',
      'driver_arrived',
      'picked_up',
      'in_transit',
      'at_dropoff',
      'delivered',
      'money_collection'
    ]);
  });

  test('collectCandidateBookingIds gathers all distinct sources', () => {
    const ids = collectCandidateBookingIds({
      bookingIdOverride: 'override-1',
      userData: { driver: { currentBookingId: 'user-1' } },
      locationData: { currentTripId: 'loc-trip', bookingId: 'loc-book' }
    });
    expect(ids.sort()).toEqual(['loc-book', 'loc-trip', 'override-1', 'user-1'].sort());
  });

  test('booking missing → patch planned', () => {
    const plan = planReleaseStuckDriver(baseContext());
    expect(plan.refused).toBe(false);
    expect(plan.driverId).toBe('driver-1');
    expect(plan.cleanupBookingIds).toEqual(['orphan-1']);
    expect(plan.userPatch['driver.currentBookingId']).toBeNull();
    expect(plan.userPatch['driver.status']).toBe('available');
    expect(plan.userPatch['driver.isAvailable']).toBe(true);
    expect(plan.userPatch['driver.activeBookings']).toBe(0);
    expect(plan.locationPatch.currentTripId).toBeNull();
    expect(plan.locationPatch.bookingId).toBe(FieldValue.delete());
    expect(plan.tripTrackingUpdates).toHaveLength(1);
    expect(plan.lockDeletes).toEqual(['orphan-1']);
    expect(plan.after.user.currentBookingId).toBeNull();
  });

  test('booking terminal → patch planned', () => {
    const plan = planReleaseStuckDriver(baseContext({
      bookingsById: {
        'orphan-1': { exists: true, data: { status: 'cancelled' } }
      }
    }));
    expect(plan.refused).toBe(false);
    expect(plan.cleanupBookingIds).toEqual(['orphan-1']);
  });

  test('candidate booking active → refused', () => {
    const plan = planReleaseStuckDriver(baseContext({
      bookingsById: {
        'orphan-1': { exists: true, data: { status: 'driver_assigned' } }
      }
    }));
    expect(plan.refused).toBe(true);
    expect(plan.refuseReason).toContain('non-terminal');
  });

  test('other booking in money_collection → refused', () => {
    const plan = planReleaseStuckDriver(baseContext({
      driverActiveBookings: [{ id: 'live-1', status: 'money_collection' }]
    }));
    expect(plan.refused).toBe(true);
    expect(plan.refuseReason).toContain('money_collection');
  });

  test('currentBookingId missing but currentTripId points to active booking → refused', () => {
    const plan = planReleaseStuckDriver(baseContext({
      userSnap: snap(true, {
        userType: 'driver',
        driver: { isAvailable: false, currentBookingId: null }
      }),
      locationSnap: snap(true, {
        currentTripId: 'trip-active',
        bookingId: null
      }),
      candidateBookingIds: ['trip-active'],
      bookingsById: {
        'trip-active': { exists: true, data: { status: 'picked_up', driverId: 'driver-1' } }
      },
      tripTrackingById: { 'trip-active': { isActive: true } },
      locksById: { 'trip-active': false },
      driverActiveBookings: []
    }));
    expect(plan.refused).toBe(true);
    expect(plan.refuseReason).toContain('trip-active');
  });

  test('activeBookings not decremented when zero', () => {
    const plan = planReleaseStuckDriver(baseContext({
      userSnap: snap(true, {
        userType: 'driver',
        driver: {
          isAvailable: false,
          currentBookingId: 'orphan-1',
          activeBookings: 0
        }
      })
    }));
    expect(plan.userPatch['driver.activeBookings']).toBeUndefined();
  });

  test('applyReleaseStuckDriver commits batch', async () => {
    const plan = planReleaseStuckDriver(baseContext());
    const db = createMockDb(plan);
    const result = await applyReleaseStuckDriver(db, plan);
    expect(result.wrote).toBe(true);
    expect(db._batch.commit).toHaveBeenCalledTimes(1);
    expect(db._batch.update).toHaveBeenCalled();
    expect(db._batch.set).toHaveBeenCalled();
    expect(db._batch.delete).toHaveBeenCalled();
    const tripUpdate = db._batchOps.find((op) => op.path === 'tripTracking/orphan-1');
    expect(tripUpdate.patch.endReason).toBe('support_orphan_booking');
  });

  test('applyReleaseStuckDriver throws when driverId missing on plan', async () => {
    const plan = planReleaseStuckDriver(baseContext());
    delete plan.driverId;
    const db = createMockDb(plan);
    await expect(applyReleaseStuckDriver(db, plan)).rejects.toThrow(/driverId/);
    expect(db._batch.commit).not.toHaveBeenCalled();
  });

  test('dry-run warning string is defined for CLI', () => {
    expect(DRY_RUN_APP_WARNING).toContain('app is closed');
    expect(DRY_RUN_APP_WARNING).toContain('batch');
  });
});

describe('releaseStuckDriver CLI path load → plan → apply', () => {
  const DRIVER_ID = 'cef25deletedBookingDriver001';
  const BOOKING_ID = 'booking-deleted-orphan-001';

  function createFirestoreMockForOrphanTrip() {
    const store = {
      [`users/${DRIVER_ID}`]: {
        userType: 'driver',
        driver: {
          isAvailable: false,
          isOnline: true,
          currentBookingId: BOOKING_ID,
          status: 'enroute'
        }
      },
      [`driverLocations/${DRIVER_ID}`]: {
        isAvailable: false,
        currentTripId: BOOKING_ID,
        bookingId: BOOKING_ID
      },
      [`tripTracking/${BOOKING_ID}`]: { isActive: true, driverId: DRIVER_ID }
    };

    const batchOps = [];
    const batch = {
      update: jest.fn((ref, patch) => {
        batchOps.push({ type: 'update', path: ref.path, patch });
      }),
      set: jest.fn((ref, patch, opts) => {
        batchOps.push({ type: 'set', path: ref.path, patch, opts });
      }),
      delete: jest.fn((ref) => {
        batchOps.push({ type: 'delete', path: ref.path });
      }),
      commit: jest.fn(async () => {})
    };

    function docGet(collection, id) {
      const key = `${collection}/${id}`;
      if (collection === 'bookings' && id === BOOKING_ID) {
        return Promise.resolve({ exists: false, data: () => null });
      }
      if (collection === 'booking_locks') {
        return Promise.resolve({ exists: false, data: () => null });
      }
      if (store[key]) {
        return Promise.resolve({ exists: true, data: () => store[key] });
      }
      return Promise.resolve({ exists: false, data: () => null });
    }

    const db = {
      batch: jest.fn(() => batch),
      collection: jest.fn((name) => ({
        doc: jest.fn((id) => ({ path: `${name}/${id}` })),
        where: jest.fn(function whereField(field) {
          return {
            where: jest.fn(() => ({
              limit: jest.fn(() => ({
                get: jest.fn(async () => ({ docs: [], empty: true }))
              }))
            })),
            limit: jest.fn(() => ({
              get: jest.fn(async () => ({ docs: [], empty: true }))
            }))
          };
        })
      }))
    };

    db.collection.mockImplementation((name) => ({
      doc: (id) => ({
        path: `${name}/${id}`,
        get: () => docGet(name, id)
      }),
      where: (field, op, value) => {
        if (name === 'bookings' && field === 'driverId') {
          return {
            where: () => ({
              limit: () => ({
                get: async () => ({ docs: [], empty: true })
              })
            })
          };
        }
        return {
          limit: () => ({
            get: async () => ({ docs: [], empty: true })
          })
        };
      }
    }));

    return { db, batchOps, batch };
  }

  test('orphan booking deleted with tripTracking → batch writes users, driverLocations, tripTracking', async () => {
    const { db, batchOps, batch } = createFirestoreMockForOrphanTrip();
    const context = await loadReleaseContext(db, DRIVER_ID, '');
    const plan = planReleaseStuckDriver(context);
    expect(plan.refused).toBe(false);
    expect(plan.driverId).toBe(DRIVER_ID);
    expect(plan.tripTrackingBookingIds).toEqual([BOOKING_ID]);
    validateApplyPlanIds(plan);
    await applyReleaseStuckDriver(db, plan);
    expect(batch.commit).toHaveBeenCalledTimes(1);
    const paths = batchOps.map((op) => op.path);
    expect(paths).toContain(`users/${DRIVER_ID}`);
    expect(paths).toContain(`driverLocations/${DRIVER_ID}`);
    expect(paths).toContain(`tripTracking/${BOOKING_ID}`);
    expect(paths).not.toContain(`booking_locks/${BOOKING_ID}`);
  });
});

describe('releaseStuckDriver dry-run does not write', () => {
  test('applyReleaseStuckDriver throws when plan refused', async () => {
    const plan = planReleaseStuckDriver(baseContext({
      driverActiveBookings: [{ id: 'x', status: 'in_transit' }]
    }));
    const db = createMockDb(plan);
    await expect(applyReleaseStuckDriver(db, plan)).rejects.toThrow(/refused/);
    expect(db._batch.commit).not.toHaveBeenCalled();
  });
});
