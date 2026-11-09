const admin = require('firebase-admin');
const { getFirestore } = require('../firebase');
const bookingStateMachine = require('../bookingStateMachine');
const { resolveBookingSourceType } = require('../../utils/bookingSourceType');
const {
  ADMIN_STATUS_EDIT_BLOCKED_TARGETS,
  isBookingPastPickup
} = require('../../constants/bookingStatuses');
const shopOrderService = require('../shopOrderService');
const notificationService = require('../notificationService');
const { emitBookingCancelled, emitBookingReassigned } = require('../bookingCancelEvents');
const { buildSystemAvailabilityUpdate } = require('../../utils/driverAvailabilityMetadata');

class AdminInterventionError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function httpError(status, code, message, details) {
  throw new AdminInterventionError(status, code, message, details);
}

function getAllowedAdminTransitions(status) {
  const raw = bookingStateMachine.getAllowedTransitions(status || '');
  return raw.filter((target) => !ADMIN_STATUS_EDIT_BLOCKED_TARGETS.has(target));
}

function parcelAdminCancelRequiresRefund(booking) {
  if (!booking || resolveBookingSourceType(booking) === 'marketplace') {
    return false;
  }
  if (booking.paymentConfirmed === true) {
    return true;
  }
  const paymentStatus = String(booking.paymentStatus || '').toLowerCase();
  if (paymentStatus === 'paid' || paymentStatus === 'confirmed') {
    return true;
  }
  const payment = booking.payment;
  if (payment && typeof payment === 'object') {
    if (payment.confirmed === true || payment.status === 'confirmed') {
      return true;
    }
    if (payment.razorpayPaymentId || payment.phonepeTransactionId) {
      return true;
    }
  }
  if (booking.razorpayPaymentId || booking.razorpayOrderId || booking.phonepeTransactionId) {
    return true;
  }
  return false;
}

async function writeAdminLog(db, payload) {
  const ref = db.collection('adminLogs').doc();
  await ref.set({
    ...payload,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });
  return ref.id;
}

async function emitCancelledSideEffects(booking, bookingId, adminId, reason) {
  try {
    const { getSocketIO } = require('../socket');
    const io = getSocketIO();
    if (io) {
      const statusUpdateEvent = {
        bookingId,
        status: 'cancelled',
        cancellationReason: reason,
        cancelledAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        updatedBy: adminId
      };
      const rooms = [
        `booking:${bookingId}`,
        `user:${booking.customerId}`
      ];
      if (booking.driverId) {
        rooms.push(`user:${booking.driverId}`);
      }
      rooms.forEach((room) => {
        io.to(room).emit('booking_status_update', statusUpdateEvent);
      });
      emitBookingCancelled(io, {
        driverId: booking.driverId,
        bookingId,
        reason,
        cancelledBy: adminId
      });
    }
  } catch (error) {
    console.error('❌ [ADMIN_INTERVENE] Cancel socket failed:', error.message);
  }

  try {
    if (booking.customerId) {
      await notificationService.sendTemplateNotification(
        booking.customerId,
        'CUSTOMER',
        'BOOKING_CANCELLED',
        { bookingId, reason: reason || 'Cancelled by support' }
      );
    }
    if (booking.driverId) {
      await notificationService.sendTemplateNotification(
        booking.driverId,
        'DRIVER',
        'BOOKING_CANCELLED',
        { bookingId, reason: 'Booking cancelled by admin' }
      );
    }
  } catch (error) {
    console.error('❌ [ADMIN_INTERVENE] Cancel notification failed:', error.message);
  }
}

async function adminUpdateBookingStatus({ bookingId, status, adminId, reason, skipAuditLog = false }) {
  if (ADMIN_STATUS_EDIT_BLOCKED_TARGETS.has(status)) {
    httpError(
      409,
      'USE_COMPLETION_FLOW',
      'Use the normal delivery and payment completion flow for this status',
      { status }
    );
  }

  const db = getFirestore();
  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) {
    httpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }

  const booking = bookingDoc.data() || {};
  const previousStatus = booking.status;

  if (resolveBookingSourceType(booking) === 'marketplace') {
    httpError(
      409,
      'USE_ORDER_ACTIONS',
      'Marketplace bookings must be updated via marketplace order actions',
      { marketplaceOrderId: booking.marketplaceOrderId || null }
    );
  }

  const allowed = getAllowedAdminTransitions(previousStatus);
  if (!allowed.includes(status)) {
    httpError(409, 'INVALID_TRANSITION', `Cannot transition from ${previousStatus} to ${status}`, {
      validTransitions: allowed
    });
  }

  const updateData = {};
  if (status === 'cancelled') {
    updateData.cancellationReason = reason || 'Admin status update';
  }

  try {
    await bookingStateMachine.transitionBooking(
      bookingId,
      status,
      updateData,
      {
        userId: adminId,
        userType: 'admin',
        driverId: booking.driverId || null
      }
    );
  } catch (error) {
    const message = error.message || 'Transition failed';
    if (message.includes('Cannot transition') || message.includes('INVALID')) {
      httpError(409, 'INVALID_TRANSITION', message, {
        validTransitions: allowed
      });
    }
    throw error;
  }

  if (!skipAuditLog) {
    await writeAdminLog(db, {
      action: 'booking_status_update',
      adminId,
      targetBookingId: bookingId,
      details: {
        bookingId,
        previousStatus,
        newStatus: status,
        reason: reason || null
      }
    });
  }

  if (status === 'cancelled') {
    await emitCancelledSideEffects(booking, bookingId, adminId, reason || 'Admin status update');
  }

  return {
    bookingId,
    previousStatus,
    status
  };
}

async function adminInterveneCancel({ bookingId, adminId, reason }) {
  const db = getFirestore();
  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) {
    httpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }
  const booking = bookingDoc.data() || {};
  const note = reason || 'Admin intervention';

  if (resolveBookingSourceType(booking) === 'marketplace') {
    const orderId = booking.marketplaceOrderId;
    if (!orderId) {
      httpError(409, 'USE_ORDER_ACTIONS', 'Marketplace booking has no linked order id');
    }
    const result = await shopOrderService.supportCancelBeforeHandover({
      orderId,
      operator: adminId,
      note
    });
    await writeAdminLog(db, {
      action: 'booking_cancel',
      adminId,
      targetBookingId: bookingId,
      targetOrderId: orderId,
      details: {
        bookingId,
        orderId,
        action: 'cancel',
        reason: note,
        previousStatus: booking.status,
        marketplace: true,
        wrote: result.wrote === true,
        alreadyProcessed: result.alreadyProcessed === true
      }
    });
    return {
      bookingId,
      action: 'cancel',
      marketplaceOrderId: orderId,
      ...result
    };
  }

  if (parcelAdminCancelRequiresRefund(booking)) {
    httpError(
      409,
      'REFUND_REQUIRED',
      'This booking has confirmed or online-captured payment; use the refund flow before cancelling',
      { paymentStatus: booking.paymentStatus || null }
    );
  }

  const outcome = await adminUpdateBookingStatus({
    bookingId,
    status: 'cancelled',
    adminId,
    reason: note,
    skipAuditLog: true
  });

  await writeAdminLog(db, {
    action: 'booking_cancel',
    adminId,
    targetBookingId: bookingId,
    details: {
      bookingId,
      action: 'cancel',
      reason: note,
      previousStatus: outcome.previousStatus,
      newStatus: 'cancelled'
    }
  });

  return {
    bookingId,
    action: 'cancel',
    status: 'cancelled'
  };
}

async function notifyReassignParties({ booking, bookingId, removedDriverId, adminId, reason, isMarketplace }) {
  const note = reason || 'Admin reassignment';

  try {
    if (removedDriverId) {
      await notificationService.sendTemplateNotification(
        removedDriverId,
        'DRIVER',
        'BOOKING_CANCELLED',
        { bookingId, reason: 'reassigned' }
      );
      await notificationService.sendTemplateNotification(
        removedDriverId,
        'DRIVER',
        'BOOKING_REASSIGNED',
        { bookingId, reason: note }
      );
    }
    if (booking.customerId) {
      if (isMarketplace && booking.marketplaceOrderId) {
        const db = getFirestore();
        const orderSnap = await db.collection('marketplaceOrders').doc(booking.marketplaceOrderId).get();
        const orderData = orderSnap.exists ? (orderSnap.data() || {}) : {};
        const { marketplacePushVariables } = require('../marketplace/marketplacePush');
        await notificationService.sendTemplateNotification(
          booking.customerId,
          'MARKETPLACE',
          'FINDING_NEW_DRIVER',
          marketplacePushVariables(orderData, booking.marketplaceOrderId)
        );
      } else {
        await notificationService.sendTemplateNotification(
          booking.customerId,
          'CUSTOMER',
          'FINDING_NEW_DRIVER',
          { bookingId }
        );
      }
    }
  } catch (error) {
    console.error('❌ [ADMIN_INTERVENE] Reassign notification failed:', error.message);
  }

  try {
    const { getSocketIO } = require('../socket');
    const io = getSocketIO();
    emitBookingReassigned(io, {
      driverId: removedDriverId,
      customerId: booking.customerId,
      bookingId,
      reason: note
    });
  } catch (error) {
    console.error('❌ [ADMIN_INTERVENE] Reassign socket failed:', error.message);
  }
}

async function adminInterveneReassign({ bookingId, adminId, reason }) {
  const db = getFirestore();
  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) {
    httpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }
  const booking = bookingDoc.data() || {};
  const previousStatus = booking.status;

  if (isBookingPastPickup(previousStatus)) {
    httpError(
      409,
      'REASSIGN_NOT_ALLOWED',
      'Cannot reassign after pickup has started on this booking'
    );
  }

  const removedDriverId = booking.driverId || null;
  const now = new Date();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(bookingRef);
    if (!snap.exists) {
      httpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
    }
    const current = snap.data() || {};
    if (isBookingPastPickup(current.status)) {
      httpError(
        409,
        'REASSIGN_NOT_ALLOWED',
        'Cannot reassign after pickup has started on this booking'
      );
    }
    if (current.driverId) {
      const driverRef = db.collection('users').doc(current.driverId);
      const driverSnap = await tx.get(driverRef);
      if (driverSnap.exists) {
        const driverData = driverSnap.data() || {};
        const active = driverData.driver && driverData.driver.activeBookings;
        const { buildDriverReleaseUpdate } = require('../releaseDriverOnBookingCancel');
        const releasePatch = buildDriverReleaseUpdate(driverData, bookingId) || {};
        tx.update(driverRef, {
          ...releasePatch,
          'driver.activeBookings': Math.max((active || 1) - 1, 0),
          updatedAt: now
        });
      }
      const driverLocationRef = db.collection('driverLocations').doc(current.driverId);
      tx.set(driverLocationRef, {
        isAvailable: true,
        currentTripId: null,
        lastUpdated: now
      }, { merge: true });
    }
    tx.update(bookingRef, {
      status: 'pending',
      driverId: admin.firestore.FieldValue.delete(),
      driverName: admin.firestore.FieldValue.delete(),
      reassignedAt: now,
      reassignmentReason: reason || 'Admin reassignment',
      reassignedBy: adminId,
      updatedAt: now
    });
  });

  const isMarketplace = resolveBookingSourceType(booking) === 'marketplace';
  if (isMarketplace && booking.marketplaceOrderId) {
    const marketplaceSyncService = require('../marketplaceSyncService');
    const freshSnap = await bookingRef.get();
    await marketplaceSyncService.syncBooking({
      bookingId,
      booking: freshSnap.data() || {}
    });
  }

  try {
    const WebSocketEventHandler = require('../websocketEventHandler');
    const handler = new WebSocketEventHandler();
    await handler.initialize();
    const freshSnap = await bookingRef.get();
    await handler.notifyDriversOfNewBooking({
      ...(freshSnap.data() || {}),
      id: bookingId
    });
  } catch (error) {
    console.error('❌ [ADMIN_INTERVENE] Driver search notify failed:', error.message);
  }

  await notifyReassignParties({
    booking,
    bookingId,
    removedDriverId,
    adminId,
    reason,
    isMarketplace
  });

  await writeAdminLog(db, {
    action: 'booking_reassign',
    adminId,
    targetBookingId: bookingId,
    targetOrderId: booking.marketplaceOrderId || null,
    details: {
      bookingId,
      action: 'reassign',
      reason: reason || null,
      previousStatus,
      newStatus: 'pending',
      removedDriverId
    }
  });

  return {
    bookingId,
    action: 'reassign',
    status: 'pending',
    removedDriverId
  };
}

async function adminInterveneEscalate({ bookingId, adminId, reason }) {
  const db = getFirestore();
  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) {
    httpError(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }
  const booking = bookingDoc.data() || {};
  const now = new Date();

  await bookingRef.update({
    escalatedAt: now,
    escalationReason: reason || 'Admin escalation',
    updatedAt: now
  });

  await writeAdminLog(db, {
    action: 'booking_escalate',
    adminId,
    targetBookingId: bookingId,
    details: {
      bookingId,
      action: 'escalate',
      reason: reason || null,
      previousStatus: booking.status
    }
  });

  return {
    bookingId,
    action: 'escalate',
    status: booking.status
  };
}

const UNSUPPORTED_INTERVENE_ACTIONS = new Set([
  'refund',
  'update_fare',
  'send_notification'
]);

const ACTION_ALIASES = {
  cancel_booking: 'cancel',
  reassign_driver: 'reassign'
};

function normalizeInterveneAction(action) {
  const raw = String(action || '').trim();
  const aliased = ACTION_ALIASES[raw] || raw;
  if (UNSUPPORTED_INTERVENE_ACTIONS.has(aliased)) {
    httpError(400, 'NOT_SUPPORTED', `Intervention action "${raw}" is not supported`);
  }
  return aliased;
}

async function adminIntervene({ bookingId, action, adminId, reason }) {
  const normalized = normalizeInterveneAction(action);
  switch (normalized) {
    case 'cancel':
      return adminInterveneCancel({ bookingId, adminId, reason });
    case 'reassign':
      return adminInterveneReassign({ bookingId, adminId, reason });
    case 'escalate':
      return adminInterveneEscalate({ bookingId, adminId, reason });
    default:
      httpError(400, 'INVALID_ACTION', 'Invalid intervention action', {
        validActions: ['cancel', 'reassign', 'escalate', 'cancel_booking', 'reassign_driver']
      });
  }
}

module.exports = {
  AdminInterventionError,
  getAllowedAdminTransitions,
  parcelAdminCancelRequiresRefund,
  writeAdminLog,
  adminUpdateBookingStatus,
  adminIntervene,
  adminInterveneCancel,
  adminInterveneReassign,
  adminInterveneEscalate,
  normalizeInterveneAction
};
