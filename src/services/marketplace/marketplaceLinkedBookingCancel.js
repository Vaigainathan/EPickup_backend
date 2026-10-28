const { buildSystemAvailabilityUpdate } = require('../../utils/driverAvailabilityMetadata');
const { evaluateAdminMarketplaceCancel } = require('./marketplaceAdminCancelPolicy');
const { httpError } = require('./httpError');

function assertMarketplaceOrderCancelAllowed(order, booking) {
  const cancelEval = evaluateAdminMarketplaceCancel(order, booking);
  if (!cancelEval.allowed) {
    throw httpError(409, 'CANCEL_NOT_ALLOWED', cancelEval.reason || 'This order cannot be cancelled');
  }
}

function shouldCancelLinkedBooking(booking) {
  if (!booking || typeof booking !== 'object') {
    return false;
  }
  const status = booking.status;
  if (status === 'cancelled' || status === 'completed') {
    return false;
  }
  return true;
}

/**
 * Read linked booking + assigned driver inside a transaction (reads only — call before any writes).
 */
async function readLinkedBookingForCancel(tx, db, { order, linkedBookingId }) {
  if (!linkedBookingId) {
    return null;
  }

  const bookingRef = db.collection('bookings').doc(linkedBookingId);
  const bookingSnap = await tx.get(bookingRef);
  if (!bookingSnap.exists) {
    return {
      bookingRef,
      bookingSnap,
      driverRef: null,
      driverSnap: null,
      booking: null,
      bookingId: linkedBookingId
    };
  }

  const booking = bookingSnap.data() || {};
  assertMarketplaceOrderCancelAllowed(order, booking);

  const driverId = booking.driverId || null;
  let driverRef = null;
  let driverSnap = null;
  if (driverId) {
    driverRef = db.collection('users').doc(driverId);
    driverSnap = await tx.get(driverRef);
  }

  return {
    bookingRef,
    bookingSnap,
    driverRef,
    driverSnap,
    booking,
    bookingId: linkedBookingId
  };
}

/**
 * Cancel linked booking and release driver (writes only — use after all transaction reads).
 * @returns {{ driverId: string|null, bookingId: string|null, cancelledBooking: boolean }}
 */
function applyLinkedBookingCancel(tx, readResult, { cancelledBy, reason }) {
  if (!readResult || !readResult.bookingSnap || !readResult.bookingSnap.exists) {
    return {
      driverId: null,
      bookingId: readResult && readResult.bookingId ? readResult.bookingId : null,
      cancelledBooking: false
    };
  }

  const { bookingRef, booking, driverSnap, driverRef } = readResult;
  if (!shouldCancelLinkedBooking(booking)) {
    return {
      driverId: booking && booking.driverId ? booking.driverId : null,
      bookingId: readResult.bookingId,
      cancelledBooking: false
    };
  }

  const at = new Date();
  const driverId = booking.driverId || null;

  tx.update(bookingRef, {
    status: 'cancelled',
    cancellationReason: reason || 'Marketplace order cancelled',
    cancelledBy: cancelledBy || 'system',
    cancelledAt: at,
    updatedAt: at
  });

  if (driverId && driverSnap && driverSnap.exists) {
    releaseDriverInTransaction(tx, driverSnap, driverRef, at);
  }

  return {
    driverId,
    bookingId: readResult.bookingId,
    cancelledBooking: true
  };
}

function releaseDriverInTransaction(tx, driverSnap, driverRef, at = new Date()) {
  if (!driverSnap || !driverSnap.exists) {
    return;
  }
  const ref = driverRef || (driverSnap && driverSnap.ref);
  if (!ref) {
    return;
  }
  const driverData = driverSnap.data() || {};
  const active = driverData.driver && driverData.driver.activeBookings;
  tx.update(ref, {
    ...buildSystemAvailabilityUpdate(true),
    'driver.currentBookingId': null,
    'driver.activeBookings': Math.max((active || 1) - 1, 0),
    updatedAt: at
  });
}

async function notifyAssignedDriverBookingCancelled({
  driverId,
  bookingId,
  reason,
  cancelledBy
}) {
  if (!driverId || !bookingId) {
    return;
  }
  const reasonLine = reason || 'Marketplace order cancelled';
  try {
    const notificationService = require('../notificationService');
    await notificationService.sendTemplateNotification(
      driverId,
      'DRIVER',
      'BOOKING_CANCELLED',
      {
        bookingId,
        reason: reasonLine
      }
    );
  } catch (error) {
    console.error('❌ [MARKETPLACE_LINKED_CANCEL] Driver cancel push failed:', error.message);
  }
  try {
    const { getSocketIO } = require('../socket');
    const { emitBookingCancelled } = require('../bookingCancelEvents');
    const io = getSocketIO();
    emitBookingCancelled(io, {
      driverId,
      bookingId,
      reason: reasonLine,
      cancelledBy: cancelledBy || 'system'
    });
  } catch (error) {
    console.error('❌ [MARKETPLACE_LINKED_CANCEL] Driver cancel socket failed:', error.message);
  }
}

module.exports = {
  assertMarketplaceOrderCancelAllowed,
  shouldCancelLinkedBooking,
  readLinkedBookingForCancel,
  applyLinkedBookingCancel,
  releaseDriverInTransaction,
  notifyAssignedDriverBookingCancelled
};
