const { FieldValue } = require('firebase-admin/firestore');
const { buildSystemAvailabilityUpdate } = require('../../../src/utils/driverAvailabilityMetadata');

const USAGE = 'Usage: node scripts/support/release-stuck-driver.js --driver <uid> [--booking <id>] [--apply]';

const TERMINAL_CANDIDATE_STATUSES = new Set(['completed', 'cancelled', 'rejected']);

/** Same list as GET /api/driver/bookings/active (src/routes/driver.js). */
const DRIVER_ACTIVE_BOOKING_STATUSES = [
  'driver_assigned',
  'accepted',
  'driver_enroute',
  'driver_arrived',
  'picked_up',
  'in_transit',
  'at_dropoff',
  'delivered',
  'money_collection'
];

const DRY_RUN_APP_WARNING =
  "Make sure the driver's app is closed before --apply (batch, not a transaction).";

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  const next = argv[index + 1];
  if (!next || next.startsWith('--')) {
    return '';
  }
  return next;
}

function parseReleaseStuckDriverArgv(argv = process.argv) {
  return {
    driverId: argValue(argv, '--driver'),
    bookingIdOverride: argValue(argv, '--booking'),
    apply: argv.includes('--apply')
  };
}

function validateReleaseStuckDriverArgv(parsed) {
  if (!parsed.driverId) {
    return { ok: false, message: USAGE };
  }
  return { ok: true };
}

function getDriverActiveBookingStatuses() {
  return [...DRIVER_ACTIVE_BOOKING_STATUSES];
}

function collectCandidateBookingIds({ bookingIdOverride, userData, locationData }) {
  const ids = new Set();
  if (typeof bookingIdOverride === 'string' && bookingIdOverride.trim() !== '') {
    ids.add(bookingIdOverride.trim());
  }
  const driver = userData && userData.driver && typeof userData.driver === 'object'
    ? userData.driver
    : {};
  if (typeof driver.currentBookingId === 'string' && driver.currentBookingId.trim() !== '') {
    ids.add(driver.currentBookingId.trim());
  }
  const loc = locationData && typeof locationData === 'object' ? locationData : {};
  if (typeof loc.currentTripId === 'string' && loc.currentTripId.trim() !== '') {
    ids.add(loc.currentTripId.trim());
  }
  if (typeof loc.bookingId === 'string' && loc.bookingId.trim() !== '') {
    ids.add(loc.bookingId.trim());
  }
  return [...ids];
}

function sanitizeReleaseSnapshot({
  driverId,
  userData,
  locationData,
  tripTrackingByBookingId,
  locksByBookingId
}) {
  const driver = userData && userData.driver && typeof userData.driver === 'object'
    ? userData.driver
    : {};
  const loc = locationData && typeof locationData === 'object' ? locationData : {};
  const tripTracking = {};
  const locks = {};
  const tripMap = tripTrackingByBookingId && typeof tripTrackingByBookingId === 'object'
    ? tripTrackingByBookingId
    : {};
  const lockMap = locksByBookingId && typeof locksByBookingId === 'object'
    ? locksByBookingId
    : {};
  for (const [id, data] of Object.entries(tripMap)) {
    tripTracking[id] = {
      exists: data != null,
      isActive: data && data.isActive,
      endReason: data && data.endReason ? data.endReason : null
    };
  }
  for (const [id, exists] of Object.entries(lockMap)) {
    locks[id] = { exists: exists === true };
  }
  return {
    driverId,
    user: {
      isAvailable: driver.isAvailable,
      isOnline: driver.isOnline,
      currentBookingId: driver.currentBookingId ?? null,
      status: driver.status ?? null,
      activeBookings: driver.activeBookings ?? null
    },
    driverLocations: {
      isAvailable: loc.isAvailable,
      isOnline: loc.isOnline,
      currentTripId: loc.currentTripId ?? null,
      bookingId: loc.bookingId ?? null
    },
    tripTracking,
    locks
  };
}

function isTerminalBookingStatus(status) {
  return typeof status === 'string' && TERMINAL_CANDIDATE_STATUSES.has(status);
}

function assertValidDocumentId(label, id) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error(`Invalid ${label}: document id is missing or empty.`);
  }
}

function validateApplyPlanIds(plan) {
  assertValidDocumentId('driverId', plan.driverId);
  for (const id of plan.cleanupBookingIds || []) {
    assertValidDocumentId('cleanupBookingId', id);
  }
  for (const entry of plan.tripTrackingUpdates || []) {
    assertValidDocumentId('tripTrackingBookingId', entry.bookingId);
  }
  for (const id of plan.lockDeletes || []) {
    assertValidDocumentId('lockBookingId', id);
  }
}

function planReleaseStuckDriver(context) {
  const {
    driverId,
    userSnap,
    locationSnap,
    candidateBookingIds,
    bookingsById,
    tripTrackingById,
    locksById,
    driverActiveBookings
  } = context;

  const beforeTrip = {};
  const beforeLocks = {};
  for (const id of candidateBookingIds) {
    beforeTrip[id] = tripTrackingById[id] || null;
    beforeLocks[id] = locksById[id] === true;
  }

  const before = sanitizeReleaseSnapshot({
    driverId,
    userData: userSnap.exists ? userSnap.data() : null,
    locationData: locationSnap.exists ? locationSnap.data() : null,
    tripTrackingByBookingId: beforeTrip,
    locksByBookingId: beforeLocks
  });

  if (!userSnap.exists) {
    return {
      refused: true,
      refuseReason: 'Driver user document not found.',
      driverId,
      candidateBookingIds,
      before,
      after: before
    };
  }

  const userData = userSnap.data() || {};
  if (userData.userType !== 'driver') {
    return {
      refused: true,
      refuseReason: 'User is not userType driver.',
      driverId,
      candidateBookingIds,
      before,
      after: before
    };
  }

  if (driverActiveBookings && driverActiveBookings.length > 0) {
    const row = driverActiveBookings[0];
    return {
      refused: true,
      refuseReason:
        `Driver has an active booking (${row.id}, status ${row.status}). `
        + 'Complete or cancel it before release.',
      driverId,
      candidateBookingIds,
      before,
      after: before,
      blockingActiveBooking: row
    };
  }

  for (const id of candidateBookingIds) {
    const booking = bookingsById[id];
    if (booking && booking.exists) {
      const status = (booking.data && booking.data.status) || null;
      if (!isTerminalBookingStatus(status)) {
        return {
          refused: true,
          refuseReason:
            `Candidate booking ${id} exists with non-terminal status "${status}".`,
          driverId,
          candidateBookingIds,
          before,
          after: before,
          blockingCandidateId: id,
          blockingCandidateStatus: status
        };
      }
    }
  }

  const cleanupBookingIds = candidateBookingIds.filter((id) => {
    const booking = bookingsById[id];
    if (!booking || !booking.exists) {
      return true;
    }
    const status = (booking.data && booking.data.status) || null;
    return isTerminalBookingStatus(status);
  });

  const endedAt = new Date();
  const userPatch = {
    ...buildSystemAvailabilityUpdate(true),
    'driver.currentBookingId': null,
    'driver.status': 'available',
    updatedAt: endedAt
  };
  const activeCount = userData.driver && typeof userData.driver.activeBookings === 'number'
    ? userData.driver.activeBookings
    : 0;
  if (activeCount > 0) {
    userPatch['driver.activeBookings'] = Math.max(activeCount - 1, 0);
  }

  const locationPatch = {
    isAvailable: true,
    currentTripId: null,
    bookingId: FieldValue.delete(),
    lastUpdated: endedAt
  };

  const tripTrackingUpdates = [];
  for (const id of cleanupBookingIds) {
    if (tripTrackingById[id]) {
      tripTrackingUpdates.push({
        bookingId: id,
        patch: {
          isActive: false,
          endedAt,
          endReason: 'support_orphan_booking',
          lastUpdated: endedAt,
          updatedAt: endedAt
        }
      });
    }
  }

  const lockDeletes = cleanupBookingIds.filter((id) => locksById[id] === true);
  const tripTrackingBookingIds = tripTrackingUpdates.map((entry) => entry.bookingId);

  const afterUserData = {
    ...userData,
    driver: {
      ...(userData.driver || {}),
      isAvailable: true,
      availabilitySetBy: 'system',
      availabilitySetAt: endedAt,
      currentBookingId: null,
      status: 'available',
      activeBookings: activeCount > 0
        ? Math.max(activeCount - 1, 0)
        : (userData.driver || {}).activeBookings
    },
    updatedAt: endedAt
  };

  const afterLocationData = locationSnap.exists
    ? {
      ...(locationSnap.data() || {}),
      isAvailable: true,
      currentTripId: null,
      bookingId: null,
      lastUpdated: endedAt
    }
    : {
      isAvailable: true,
      currentTripId: null,
      bookingId: null,
      lastUpdated: endedAt
    };

  const afterTrip = { ...beforeTrip };
  for (const entry of tripTrackingUpdates) {
    afterTrip[entry.bookingId] = {
      ...(afterTrip[entry.bookingId] || {}),
      isActive: false,
      endReason: 'support_orphan_booking'
    };
  }
  const afterLocks = { ...beforeLocks };
  for (const id of lockDeletes) {
    afterLocks[id] = false;
  }

  const after = sanitizeReleaseSnapshot({
    driverId,
    userData: afterUserData,
    locationData: afterLocationData,
    tripTrackingByBookingId: afterTrip,
    locksByBookingId: afterLocks
  });

  return {
    refused: false,
    refuseReason: null,
    driverId,
    candidateBookingIds,
    cleanupBookingIds,
    tripTrackingBookingIds,
    lockBookingIds: lockDeletes,
    before,
    after,
    userPatch,
    locationPatch,
    tripTrackingUpdates,
    lockDeletes,
    patchesSummary: {
      users: true,
      driverLocations: true,
      tripTrackingBookingIds,
      lockBookingIds: lockDeletes
    }
  };
}

async function loadReleaseContext(db, driverId, bookingIdOverride) {
  const userRef = db.collection('users').doc(driverId);
  const locationRef = db.collection('driverLocations').doc(driverId);

  const [userSnap, locationSnap] = await Promise.all([
    userRef.get(),
    locationRef.get()
  ]);

  const userData = userSnap.exists ? userSnap.data() : null;
  const locationData = locationSnap.exists ? locationSnap.data() : null;
  const candidateBookingIds = collectCandidateBookingIds({
    bookingIdOverride,
    userData,
    locationData
  });

  const bookingsById = {};
  const tripTrackingById = {};
  const locksById = {};

  await Promise.all(candidateBookingIds.map(async (id) => {
    const [bookingSnap, tripSnap, lockSnap] = await Promise.all([
      db.collection('bookings').doc(id).get(),
      db.collection('tripTracking').doc(id).get(),
      db.collection('booking_locks').doc(id).get()
    ]);
    bookingsById[id] = {
      exists: bookingSnap.exists,
      data: bookingSnap.exists ? bookingSnap.data() : null
    };
    tripTrackingById[id] = tripSnap.exists ? tripSnap.data() : null;
    locksById[id] = lockSnap.exists;
  }));

  const activeQuery = db.collection('bookings')
    .where('driverId', '==', driverId)
    .where('status', 'in', DRIVER_ACTIVE_BOOKING_STATUSES)
    .limit(5);

  const activeSnap = await activeQuery.get();
  const driverActiveBookings = activeSnap.docs.map((doc) => ({
    id: doc.id,
    status: (doc.data() || {}).status
  }));

  return {
    driverId,
    userSnap,
    locationSnap,
    candidateBookingIds,
    bookingsById,
    tripTrackingById,
    locksById,
    driverActiveBookings
  };
}

async function applyReleaseStuckDriver(db, plan) {
  if (plan.refused) {
    throw new Error('Refusing apply: plan was refused');
  }

  validateApplyPlanIds(plan);

  const batch = db.batch();
  const driverId = plan.driverId;

  batch.update(db.collection('users').doc(driverId), plan.userPatch);
  batch.set(
    db.collection('driverLocations').doc(driverId),
    plan.locationPatch,
    { merge: true }
  );

  for (const entry of plan.tripTrackingUpdates || []) {
    batch.update(
      db.collection('tripTracking').doc(entry.bookingId),
      entry.patch
    );
  }
  for (const id of plan.lockDeletes || []) {
    batch.delete(db.collection('booking_locks').doc(id));
  }

  await batch.commit();
  return { wrote: true };
}

module.exports = {
  USAGE,
  DRY_RUN_APP_WARNING,
  TERMINAL_CANDIDATE_STATUSES,
  DRIVER_ACTIVE_BOOKING_STATUSES,
  parseReleaseStuckDriverArgv,
  validateReleaseStuckDriverArgv,
  getDriverActiveBookingStatuses,
  collectCandidateBookingIds,
  sanitizeReleaseSnapshot,
  planReleaseStuckDriver,
  loadReleaseContext,
  applyReleaseStuckDriver,
  validateApplyPlanIds,
  assertValidDocumentId,
  FieldValue
};
