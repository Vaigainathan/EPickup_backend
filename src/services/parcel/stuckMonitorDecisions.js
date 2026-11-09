const { resolveBookingSourceType } = require('../../utils/bookingSourceType');
const { PARCEL_MIDTRIP_MONITOR_STATUSES } = require('../../constants/parcelMonitorStatuses');
const { millisOfTimestamp } = require('./parcelPendingCancelService');

function statusTimestampMs(data) {
  const timing = data.timing && typeof data.timing === 'object' ? data.timing : {};
  const byStatus = {
    driver_assigned: timing.assignedAt,
    accepted: timing.acceptedAt,
    driver_enroute: timing.enrouteAt,
    driver_arrived: timing.arrivedAt,
    photo_captured: timing.photoCapturedAt,
    picked_up: timing.pickedUpAt,
    in_transit: timing.inTransitAt,
    at_dropoff: timing.arrivedDropoffAt
  };
  return millisOfTimestamp(byStatus[data.status] || data.updatedAt || data.createdAt);
}

function planStatusStuck(data, bookingId, nowMs, thresholdMs) {
  if (!data || resolveBookingSourceType(data) === 'marketplace') {
    return null;
  }
  if (!PARCEL_MIDTRIP_MONITOR_STATUSES.includes(data.status)) {
    return null;
  }
  const enteredMs = statusTimestampMs(data);
  if (!Number.isFinite(enteredMs) || nowMs - enteredMs < thresholdMs) {
    return null;
  }
  return {
    alertType: 'status_stuck',
    bookingId,
    status: data.status,
    driverId: data.driverId || null,
    ageMinutes: Math.round((nowMs - enteredMs) / 60000)
  };
}

function planDriverSilent(data, location, bookingId, nowMs, silentMs) {
  if (!data || resolveBookingSourceType(data) === 'marketplace') {
    return null;
  }
  if (!data.driverId || !PARCEL_MIDTRIP_MONITOR_STATUSES.includes(data.status)) {
    return null;
  }
  const lastMs = millisOfTimestamp(location && location.lastUpdated);
  if (!Number.isFinite(lastMs) || nowMs - lastMs < silentMs) {
    return null;
  }
  return {
    alertType: 'driver_silent',
    bookingId,
    status: data.status,
    driverId: data.driverId,
    silentMinutes: Math.round((nowMs - lastMs) / 60000)
  };
}

module.exports = {
  planStatusStuck,
  planDriverSilent,
  statusTimestampMs
};
