const { CUSTOMER_PARCEL_BLOCKING_STATUSES } = require('../constants/bookingStatuses');

function isParcelSide(sourceType) {
  return sourceType === 'parcel' || sourceType == null || sourceType === '';
}

function sameNonEmptyKey(requestKey, bookingKey) {
  return typeof requestKey === 'string'
    && requestKey.length > 0
    && typeof bookingKey === 'string'
    && bookingKey.length > 0
    && requestKey === bookingKey;
}

function decideParcelLock({ lock, booking, requestKey }) {
  if (!lock || !lock.bookingId || !booking) {
    return { action: 'free' };
  }
  if (!isParcelSide(booking.sourceType)) {
    return { action: 'free' };
  }
  if (!CUSTOMER_PARCEL_BLOCKING_STATUSES.includes(booking.status)) {
    return { action: 'free' };
  }
  if (sameNonEmptyKey(requestKey, booking.idempotencyKey)) {
    return { action: 'reuse' };
  }
  return { action: 'conflict' };
}

function presentLockedBooking(booking) {
  const stored = booking || {};
  return {
    ...stored,
    createdAt: stored.createdAt?.toDate ? stored.createdAt.toDate() : (stored.createdAt || new Date()),
    updatedAt: stored.updatedAt?.toDate ? stored.updatedAt.toDate() : (stored.updatedAt || new Date())
  };
}

module.exports = {
  decideParcelLock,
  presentLockedBooking
};
