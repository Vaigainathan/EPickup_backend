const PARCEL_DEFAULTS = {
  PENDING_NO_DRIVER_TIMEOUT_MINUTES: 10,
  PENDING_TIMEOUT_NOTIFY_MAX_AGE_MINUTES: 120,
  MIDTRIP_STUCK_MINUTES: 30,
  DRIVER_LOCATION_SILENT_MINUTES: 10,
  STUCK_ALERT_DEDUP_MINUTES: 60
};

function parsePositiveInt(raw, fallback) {
  const value = Number(raw);
  if (Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return fallback;
}

function pendingTimeoutMs(envMinutes) {
  const minutes = parsePositiveInt(
    envMinutes,
    PARCEL_DEFAULTS.PENDING_NO_DRIVER_TIMEOUT_MINUTES
  );
  return minutes * 60 * 1000;
}

function midTripStuckMs(envMinutes) {
  const minutes = parsePositiveInt(
    envMinutes,
    PARCEL_DEFAULTS.MIDTRIP_STUCK_MINUTES
  );
  return minutes * 60 * 1000;
}

function driverSilentMs(envMinutes) {
  const minutes = parsePositiveInt(
    envMinutes,
    PARCEL_DEFAULTS.DRIVER_LOCATION_SILENT_MINUTES
  );
  return minutes * 60 * 1000;
}

function stuckDedupMs(envMinutes) {
  const minutes = parsePositiveInt(
    envMinutes,
    PARCEL_DEFAULTS.STUCK_ALERT_DEDUP_MINUTES
  );
  return minutes * 60 * 1000;
}

function pendingTimeoutNotifyMaxAgeMs(envMinutes) {
  const minutes = parsePositiveInt(
    envMinutes,
    PARCEL_DEFAULTS.PENDING_TIMEOUT_NOTIFY_MAX_AGE_MINUTES
  );
  return minutes * 60 * 1000;
}

function isEnvDryRun(name) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'on';
}

function isEnvEnabled(name, defaultEnabled = true) {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') {
    return defaultEnabled;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'false' || normalized === '0' || normalized === 'off') {
    return false;
  }
  return true;
}

module.exports = {
  PARCEL_DEFAULTS,
  pendingTimeoutMs,
  pendingTimeoutNotifyMaxAgeMs,
  midTripStuckMs,
  driverSilentMs,
  stuckDedupMs,
  isEnvDryRun,
  isEnvEnabled
};
