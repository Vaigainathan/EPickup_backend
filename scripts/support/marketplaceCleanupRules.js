/**
 * Pure cleanup choices for the staging marketplace script.
 * Lock deletion decrements unpaidCount whenever the count is above 0,
 * including an already-cancelled order. With no lock and no cancelled
 * order, the newest order of any status is the target.
 */

function chooseCleanupTarget({ explicitOrderId, lockOrderId, shopId, orders }) {
  if (explicitOrderId) {
    return { orderId: explicitOrderId, foundBy: 'order-flag' };
  }
  if (lockOrderId) {
    return { orderId: lockOrderId, foundBy: 'lock' };
  }
  let cancelledId = null;
  let cancelledMs = -1;
  let newestId = null;
  let newestMs = -1;
  (orders || []).forEach((order) => {
    if (!order || order.shopId !== shopId) {
      return;
    }
    const createdAtMs = Number.isFinite(order.createdAtMs) ? order.createdAtMs : 0;
    if (!newestId || createdAtMs >= newestMs) {
      newestId = order.id;
      newestMs = createdAtMs;
    }
    if (order.orderStatus === 'cancelled' && (!cancelledId || createdAtMs >= cancelledMs)) {
      cancelledId = order.id;
      cancelledMs = createdAtMs;
    }
  });
  if (cancelledId) {
    return { orderId: cancelledId, foundBy: 'cancelled-order' };
  }
  if (newestId) {
    return { orderId: newestId, foundBy: 'newest-order' };
  }
  return { orderId: null, foundBy: null };
}

function shouldDecrementUnpaid(plan) {
  const count = Number(plan && plan.unpaidCount);
  if (!Number.isFinite(count) || count <= 0) {
    return false;
  }
  if (plan.deleteLock) {
    return true;
  }
  return plan.orderStatus === 'awaiting_payment';
}

module.exports = {
  chooseCleanupTarget,
  shouldDecrementUnpaid
};
