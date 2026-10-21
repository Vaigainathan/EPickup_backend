function resolveBookingSourceType(booking = {}) {
  if (booking && booking.sourceType === 'marketplace') {
    return 'marketplace';
  }
  return 'parcel';
}

function matchesSourceTypeFilter(booking, filter) {
  if (!filter) {
    return true;
  }
  const normalized = String(filter).toLowerCase();
  if (normalized !== 'parcel' && normalized !== 'marketplace') {
    return true;
  }
  return resolveBookingSourceType(booking) === normalized;
}

function resolveBookingFareTotal(booking = {}) {
  const fare = booking.fare;
  if (typeof fare === 'number' && Number.isFinite(fare)) {
    return fare;
  }
  if (fare && typeof fare === 'object') {
    const total = Number(
      fare.total ?? fare.totalFare ?? fare.grossFare ?? fare.totalAmount ?? 0
    );
    return Number.isFinite(total) ? total : 0;
  }
  const pricing = booking.pricing;
  if (pricing && typeof pricing === 'object') {
    const total = Number(pricing.total ?? pricing.totalAmount ?? pricing.totalFare ?? 0);
    return Number.isFinite(total) ? total : 0;
  }
  return 0;
}

module.exports = {
  resolveBookingSourceType,
  matchesSourceTypeFilter,
  resolveBookingFareTotal
};
