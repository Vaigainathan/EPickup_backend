/**
 * Pure cleanup choices for the staging marketplace script.
 * A lock, or --order, is the only target. With neither, nothing is chosen.
 * Deleting a lock decrements unpaidCount whenever the count is above 0.
 */

function chooseCleanupTarget({ explicitOrderId, lockOrderId }) {
  if (explicitOrderId) {
    return { orderId: explicitOrderId, foundBy: 'order-flag' };
  }
  if (lockOrderId) {
    return { orderId: lockOrderId, foundBy: 'lock' };
  }
  return { orderId: null, foundBy: null };
}

function recentOrdersForCleanup(orders, shopId, limit = 5) {
  return (orders || [])
    .filter((order) => order && order.shopId === shopId)
    .slice()
    .sort((left, right) => {
      const leftMs = Number.isFinite(left.createdAtMs) ? left.createdAtMs : 0;
      const rightMs = Number.isFinite(right.createdAtMs) ? right.createdAtMs : 0;
      return rightMs - leftMs;
    })
    .slice(0, limit)
    .map((order) => ({
      id: order.id,
      displayId: order.displayId == null ? null : order.displayId,
      status: order.orderStatus || null,
      createdAt: order.createdAt || null
    }));
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
  recentOrdersForCleanup,
  shouldDecrementUnpaid
};
