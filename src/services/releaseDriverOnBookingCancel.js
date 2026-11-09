/**
 * Conditionally release a driver after a booking cancel when their pointer still matches.
 * Never sets driver.isOnline. Sets isAvailable true only when driver is currently online.
 */

/**
 * @param {object|null|undefined} userData
 * @param {string} bookingId
 * @returns {Record<string, unknown>|null}
 */
function buildDriverReleaseUpdate(userData, bookingId) {
  const driver = userData && userData.driver && typeof userData.driver === 'object'
    ? userData.driver
    : {};
  const currentId = driver.currentBookingId;
  if (typeof currentId !== 'string' || currentId.trim() === '' || currentId !== bookingId) {
    return null;
  }

  const patch = {
    'driver.currentBookingId': null,
    updatedAt: new Date()
  };

  if (driver.isOnline === true) {
    patch['driver.isAvailable'] = true;
  }

  return patch;
}

/**
 * @returns {{ released: boolean, reason?: string }}
 */
function applyDriverReleaseInTransaction(tx, driverRef, driverSnap, bookingId) {
  if (!driverSnap || !driverSnap.exists) {
    return { released: false, reason: 'driver_missing' };
  }

  const patch = buildDriverReleaseUpdate(driverSnap.data(), bookingId);
  if (!patch) {
    const current = driverSnap.data()?.driver?.currentBookingId;
    if (typeof current === 'string' && current.trim() !== '' && current !== bookingId) {
      return { released: false, reason: 'pointer_mismatch' };
    }
    return { released: false, reason: 'no_pointer' };
  }

  tx.update(driverRef, patch);
  return { released: true };
}

module.exports = {
  buildDriverReleaseUpdate,
  applyDriverReleaseInTransaction
};
