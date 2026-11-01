const {
  collectCandidateBookingIds,
  loadReleaseContext,
  planReleaseStuckDriver,
  applyReleaseStuckDriver
} = require('../../scripts/support/lib/releaseStuckDriverActions');

function hasStaleBookingPointer(userData, locationData) {
  const driver = userData && userData.driver && typeof userData.driver === 'object'
    ? userData.driver
    : {};
  if (typeof driver.currentBookingId === 'string' && driver.currentBookingId.trim() !== '') {
    return true;
  }
  const loc = locationData && typeof locationData === 'object' ? locationData : {};
  if (typeof loc.currentTripId === 'string' && loc.currentTripId.trim() !== '') {
    return true;
  }
  if (typeof loc.bookingId === 'string' && loc.bookingId.trim() !== '') {
    return true;
  }
  return false;
}

/**
 * Clear stale currentBookingId / currentTripId when no active booking exists.
 * Never sets isOnline. Same guards as release-stuck-driver support script.
 */
async function trySelfHealDriverOrphanRelease(db, driverId) {
  const userRef = db.collection('users').doc(driverId);
  const locationRef = db.collection('driverLocations').doc(driverId);
  const [userSnap, locationSnap] = await Promise.all([
    userRef.get(),
    locationRef.get()
  ]);

  if (!userSnap.exists) {
    return { healed: false, reason: 'user_missing' };
  }

  const userData = userSnap.data() || {};
  const locationData = locationSnap.exists ? locationSnap.data() : null;

  if (!hasStaleBookingPointer(userData, locationData)) {
    return { healed: false, reason: 'no_pointer' };
  }

  const context = await loadReleaseContext(db, driverId, '');
  const plan = planReleaseStuckDriver(context);

  if (plan.refused) {
    return { healed: false, reason: 'refused', refuseReason: plan.refuseReason };
  }

  await applyReleaseStuckDriver(db, plan);
  return { healed: true, cleanupBookingIds: plan.cleanupBookingIds || [] };
}

module.exports = {
  hasStaleBookingPointer,
  trySelfHealDriverOrphanRelease
};
