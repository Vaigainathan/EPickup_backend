const MANUAL_OVERRIDE_SOURCES = new Set(['driver', 'admin']);
const MANUAL_OVERRIDE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * @param {unknown} value
 * @returns {Date|null}
 */
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * @param {object|undefined|null} driver
 * @returns {boolean}
 */
function isManualAvailabilityOverrideActive(driver) {
  if (!driver) return false;

  const setBy = driver.availabilitySetBy;
  if (!MANUAL_OVERRIDE_SOURCES.has(setBy)) return false;

  const setAt = toDate(driver.availabilitySetAt);
  if (!setAt) return true;

  return Date.now() - setAt.getTime() < MANUAL_OVERRIDE_TTL_MS;
}

/**
 * Login may auto-repair isAvailable=true only when state looks stale, not when driver/admin chose unavailable.
 * @param {object|undefined|null} driver
 * @returns {boolean}
 */
function shouldAutoRepairAvailabilityOnLogin(driver) {
  if (!driver || driver.isOnline !== true) return false;
  if (driver.currentBookingId) return false;
  if (driver.isAvailable === true) return false;

  return !isManualAvailabilityOverrideActive(driver);
}

/**
 * @param {'driver'|'admin'|'system'} setBy
 * @returns {Record<string, unknown>}
 */
function driverAvailabilityMetadataFields(setBy) {
  return {
    'driver.availabilitySetBy': setBy,
    'driver.availabilitySetAt': new Date()
  };
}

/**
 * @param {boolean} isAvailable
 * @param {'system'} [setBy='system']
 * @returns {Record<string, unknown>}
 */
function buildSystemAvailabilityUpdate(isAvailable, setBy = 'system') {
  return {
    'driver.isAvailable': isAvailable,
    ...driverAvailabilityMetadataFields(setBy)
  };
}

module.exports = {
  MANUAL_OVERRIDE_SOURCES,
  MANUAL_OVERRIDE_TTL_MS,
  toDate,
  isManualAvailabilityOverrideActive,
  shouldAutoRepairAvailabilityOnLogin,
  driverAvailabilityMetadataFields,
  buildSystemAvailabilityUpdate
};
