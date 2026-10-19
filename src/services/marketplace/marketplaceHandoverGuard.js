const HANDOVER_GATED_STATUSES = new Set([
  'photo_captured',
  'picked_up',
  'in_transit',
  'at_dropoff',
  'money_collection',
  'delivered'
]);

function isHandedOver(orderStatus) {
  return orderStatus === 'handed_over' || orderStatus === 'completed';
}

function isHandoverGatedStatus(status) {
  return HANDOVER_GATED_STATUSES.has(status);
}

function handoverPendingError() {
  const { DriverStatusError } = require('../driverStatusWorkflowService');
  return new DriverStatusError(
    409,
    'HANDOVER_PENDING',
    'Shop handover must be completed before continuing'
  );
}

async function assertHandoverComplete(db, bookingData, nextStatus) {
  if (!bookingData || bookingData.sourceType !== 'marketplace') {
    return;
  }
  if (!isHandoverGatedStatus(nextStatus)) {
    return;
  }

  const orderId = bookingData.marketplaceOrderId;
  if (typeof orderId !== 'string' || orderId === '') {
    throw handoverPendingError();
  }

  const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
  if (!orderSnap.exists) {
    throw handoverPendingError();
  }

  const orderStatus = (orderSnap.data() || {}).orderStatus;
  if (!isHandedOver(orderStatus)) {
    throw handoverPendingError();
  }
}

module.exports = {
  HANDOVER_GATED_STATUSES,
  isHandedOver,
  isHandoverGatedStatus,
  assertHandoverComplete
};
