const DRIVER_ASSIGNED_COMPAT_STATUSES = new Set([
  'driver_assigned',
  'accepted',
  'driver_enroute',
  'driver_arrived',
  'photo_captured',
  'picked_up',
  'in_transit',
  'at_dropoff',
  'money_collection',
  'delivered',
  'completed'
]);

const POST_PICKUP_BOOKING_STATUSES = new Set([
  'picked_up',
  'photo_captured',
  'in_transit',
  'at_dropoff',
  'money_collection',
  'delivered',
  'completed'
]);

function bookingStatusAllowsCompatHandedOver(status) {
  return typeof status === 'string' && DRIVER_ASSIGNED_COMPAT_STATUSES.has(status);
}

function orderNeedsHandoverCatchup(order, bookingStatus) {
  if (!order || order.orderStatus !== 'ready') {
    return false;
  }
  return POST_PICKUP_BOOKING_STATUSES.has(bookingStatus);
}

module.exports = {
  DRIVER_ASSIGNED_COMPAT_STATUSES,
  POST_PICKUP_BOOKING_STATUSES,
  bookingStatusAllowsCompatHandedOver,
  orderNeedsHandoverCatchup
};
