const { isBookingPastPickup } = require('../../constants/bookingStatuses');

const TERMINAL_ORDER_STATUSES = new Set(['cancelled', 'completed']);

/**
 * Booking-centric admin marketplace cancel eligibility (stuck handed_over allowed when booking pre-pickup).
 * @returns {{ allowed: boolean, reason: string | null }}
 */
function evaluateAdminMarketplaceCancel(order, booking) {
  const data = order && typeof order === 'object' ? order : {};
  if (TERMINAL_ORDER_STATUSES.has(data.orderStatus)) {
    return {
      allowed: false,
      reason: data.orderStatus === 'cancelled'
        ? 'This order is already cancelled.'
        : 'This order is already completed.'
    };
  }

  if (!booking) {
    return { allowed: true, reason: null };
  }

  if (isBookingPastPickup(booking.status)) {
    return {
      allowed: false,
      reason: 'Cannot cancel after pickup has started on the linked booking.'
    };
  }

  return { allowed: true, reason: null };
}

function canAdminCancelMarketplaceOrder(order, booking) {
  return evaluateAdminMarketplaceCancel(order, booking).allowed;
}

module.exports = {
  evaluateAdminMarketplaceCancel,
  canAdminCancelMarketplaceOrder
};
