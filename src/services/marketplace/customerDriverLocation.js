const { httpError } = require('./createCustomerOrder');

const LIVE_STAGES = new Set(['assigned', 'at_shop', 'picked_up', 'on_the_way']);
const FRESH_MS = 60 * 1000;

function lastUpdatedMillis(value) {
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value && typeof value.toDate === 'function') {
    const date = value.toDate();
    if (!(date instanceof Date)) {
      return null;
    }
    const millis = date.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function coordinate(primary, fallback) {
  if (primary != null) {
    return typeof primary === 'number' && Number.isFinite(primary) ? primary : null;
  }
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : null;
}

function locationFromFix(fix, linkedBookingId, now) {
  if (!fix || fix.bookingId !== linkedBookingId) {
    return null;
  }
  const updatedMs = lastUpdatedMillis(fix.lastUpdated);
  if (updatedMs == null) {
    return null;
  }
  if (updatedMs > now + FRESH_MS || now - updatedMs > FRESH_MS) {
    return null;
  }
  const lat = coordinate(fix.latitude, fix.lat);
  const lng = coordinate(fix.longitude, fix.lng);
  if (lat == null || lng == null) {
    return null;
  }
  return {
    lat,
    lng,
    updatedAt: new Date(updatedMs).toISOString()
  };
}

async function getCustomerDriverLocation(db, customerId, orderId, now = Date.now()) {
  const snapshot = await db.collection('marketplaceOrders').doc(orderId).get();
  if (!snapshot.exists) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const data = snapshot.data() || {};
  if (data.customerId !== customerId) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const stage = data.delivery && typeof data.delivery.stage === 'string' ? data.delivery.stage : null;
  if (!LIVE_STAGES.has(stage)) {
    throw httpError(409, 'INVALID_STATE', 'Driver location is not available for this order');
  }

  const linkedBookingId = typeof data.linkedBookingId === 'string' ? data.linkedBookingId : '';
  if (!linkedBookingId) {
    return { location: null };
  }
  const bookingSnap = await db.collection('bookings').doc(linkedBookingId).get();
  if (!bookingSnap.exists) {
    return { location: null };
  }
  const driverId = bookingSnap.data() && bookingSnap.data().driverId;
  if (typeof driverId !== 'string' || driverId === '') {
    return { location: null };
  }
  const locationSnap = await db.collection('driverLocations').doc(driverId).get();
  if (!locationSnap.exists) {
    return { location: null };
  }
  return {
    location: locationFromFix(locationSnap.data(), linkedBookingId, now)
  };
}

module.exports = {
  getCustomerDriverLocation
};
