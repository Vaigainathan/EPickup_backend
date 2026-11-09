const { resolveBookingSourceType } = require('../../utils/bookingSourceType');
const { isDriverIdEmpty } = require('../../utils/bookingValidation');

function millisOfTimestamp(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value.toDate === 'function') {
    const asDate = value.toDate();
    return asDate instanceof Date ? asDate.getTime() : null;
  }
  return null;
}

const UNASSIGNED_CANCEL_STATUSES = ['pending', 'searching', 'confirmed'];

function canSystemCancelPendingParcel(data, options = {}) {
  if (!data || resolveBookingSourceType(data) === 'marketplace') {
    return { ok: false, code: 'MARKETPLACE' };
  }
  if (data.status === 'cancelled') {
    return { ok: false, code: 'ALREADY_CANCELLED' };
  }
  const allowedStatuses = options.legacyUnassigned === true
    ? UNASSIGNED_CANCEL_STATUSES
    : ['pending'];
  if (!allowedStatuses.includes(data.status)) {
    return { ok: false, code: 'NOT_PENDING' };
  }
  if (!isDriverIdEmpty(data.driverId)) {
    return { ok: false, code: 'HAS_DRIVER' };
  }
  return { ok: true };
}

/**
 * Cancel a parcel pending booking with no driver (transactional, idempotent).
 */
async function cancelPendingParcelInTransaction(db, {
  bookingId,
  reason,
  cancelledBy,
  now = new Date(),
  legacyUnassigned = false
}) {
  const bookingRef = db.collection('bookings').doc(bookingId);
  const lockRef = db.collection('booking_locks').doc(bookingId);

  return db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    const lockSnap = await tx.get(lockRef);
    if (!bookingSnap.exists) {
      return { changed: false, code: 'NOT_FOUND' };
    }

    const data = bookingSnap.data() || {};
    const gate = canSystemCancelPendingParcel(data, { legacyUnassigned });
    if (!gate.ok) {
      return { changed: false, code: gate.code };
    }

    tx.update(bookingRef, {
      status: 'cancelled',
      cancellationReason: reason,
      cancelledAt: now,
      updatedAt: now,
      'cancellation.cancelledBy': cancelledBy,
      'cancellation.reason': reason,
      'cancellation.cancelledAt': now
    });

    if (lockSnap.exists) {
      tx.delete(lockRef);
    }

    const notifiedDrivers = Array.isArray(data.notifiedDrivers)
      ? [...new Set(data.notifiedDrivers.filter((id) => typeof id === 'string' && id.trim() !== ''))]
      : [];

    return {
      changed: true,
      code: 'CANCELLED',
      bookingId,
      customerId: data.customerId || null,
      notifiedDrivers
    };
  });
}

function scheduledPickupMs(data) {
  const timing = data.timing && typeof data.timing === 'object' ? data.timing : {};
  const candidates = [
    data.scheduledFor,
    data.scheduledAt,
    data.estimatedPickupTime,
    data.pickupTime,
    timing.scheduledFor,
    timing.scheduledAt,
    timing.estimatedPickupTime,
    timing.pickupTime
  ];
  let best = null;
  for (let index = 0; index < candidates.length; index += 1) {
    const ms = millisOfTimestamp(candidates[index]);
    if (Number.isFinite(ms) && (best == null || ms > best)) {
      best = ms;
    }
  }
  return best;
}

function pendingTimeoutAnchorMs(data, nowMs) {
  const createdMs = millisOfTimestamp(data.createdAt);
  const pickupMs = scheduledPickupMs(data);
  if (Number.isFinite(pickupMs) && pickupMs > nowMs) {
    return { skip: true, reason: 'scheduled_future' };
  }
  if (!Number.isFinite(createdMs) && !Number.isFinite(pickupMs)) {
    return { skip: true, reason: 'no_timestamp' };
  }
  if (!Number.isFinite(createdMs)) {
    return { anchorMs: pickupMs, skip: false };
  }
  if (!Number.isFinite(pickupMs)) {
    return { anchorMs: createdMs, skip: false };
  }
  return { anchorMs: Math.max(createdMs, pickupMs), skip: false };
}

function dryRunCancelPayload(data, bookingId, nowMs) {
  const anchor = pendingTimeoutAnchorMs(data, nowMs);
  const createdMs = millisOfTimestamp(data.createdAt);
  const pickupMs = scheduledPickupMs(data);
  const anchorMs = anchor.skip ? createdMs : anchor.anchorMs;
  const ageMinutes = Number.isFinite(anchorMs)
    ? Math.round((nowMs - anchorMs) / 60000)
    : null;
  return {
    bookingId,
    ageMinutes,
    createdAt: Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : null,
    estimatedPickupTime: Number.isFinite(pickupMs) ? new Date(pickupMs).toISOString() : null
  };
}

function classifyPendingTimeoutScan(data, nowMs) {
  if (!data || data.status !== 'pending') {
    return 'ineligible';
  }
  if (resolveBookingSourceType(data) === 'marketplace') {
    return 'marketplace';
  }
  const anchor = pendingTimeoutAnchorMs(data, nowMs);
  if (anchor.skip && anchor.reason === 'scheduled_future') {
    return 'scheduled';
  }
  return 'parcel_pending';
}

function bookingYoungEnoughToNotify(data, nowMs, notifyMaxAgeMs) {
  const createdMs = millisOfTimestamp(data.createdAt);
  if (!Number.isFinite(createdMs)) {
    return false;
  }
  return nowMs - createdMs < notifyMaxAgeMs;
}

function planPendingTimeoutCandidate(data, bookingId, nowMs, timeoutMs) {
  if (!data) {
    return null;
  }
  if (resolveBookingSourceType(data) === 'marketplace') {
    return null;
  }
  if (data.status !== 'pending' || !isDriverIdEmpty(data.driverId)) {
    return null;
  }
  const anchor = pendingTimeoutAnchorMs(data, nowMs);
  if (anchor.skip) {
    return null;
  }
  if (!Number.isFinite(anchor.anchorMs) || nowMs - anchor.anchorMs < timeoutMs) {
    return null;
  }
  return { bookingId, customerId: data.customerId || null };
}

module.exports = {
  millisOfTimestamp,
  scheduledPickupMs,
  pendingTimeoutAnchorMs,
  dryRunCancelPayload,
  classifyPendingTimeoutScan,
  bookingYoungEnoughToNotify,
  canSystemCancelPendingParcel,
  cancelPendingParcelInTransaction,
  planPendingTimeoutCandidate
};
