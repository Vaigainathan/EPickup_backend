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

async function assertHandoverComplete() {
  // Marketplace pickup = handover; shop OTP path removed (B-BATCH-2).
}

module.exports = {
  HANDOVER_GATED_STATUSES,
  isHandedOver,
  isHandoverGatedStatus,
  assertHandoverComplete
};
