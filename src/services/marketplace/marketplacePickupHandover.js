const admin = require('firebase-admin');
const { getFirestore } = require('../firebase');
const { appendEvent } = require('./orderEvents');
const { assertTransition } = require('./orderStateMachine');
const { presentMarketplaceDriverInfo } = require('./presentMarketplaceDriverInfo');
const { marketplacePushVariables } = require('./marketplacePush');
const { emitMarketplaceHandoverConfirmed } = require('../bookingCancelEvents');

const MARKETPLACE_PICKUP_BOOKING_STATUSES = new Set(['driver_arrived', 'photo_captured']);

const { bookingStatusAllowsCompatHandedOver, orderNeedsHandoverCatchup } = require('./marketplaceHandoverCompat');

function assertMarketplacePickupAllowed({ booking, driverId, order }) {
  const { DriverStatusError } = require('../driverStatusWorkflowService');

  if (!booking || booking.sourceType !== 'marketplace') {
    return;
  }

  if (booking.driverId !== driverId) {
    throw new DriverStatusError(
      403,
      'FORBIDDEN',
      'Only the assigned driver can confirm pickup for this order'
    );
  }

  const status = booking.status;
  if (!MARKETPLACE_PICKUP_BOOKING_STATUSES.has(status)) {
    throw new DriverStatusError(
      409,
      'INVALID_STATE_TRANSITION',
      'Confirm pickup when you have arrived at the shop and captured pickup photo if required'
    );
  }

  if (!order || typeof order !== 'object') {
    throw new DriverStatusError(409, 'ORDER_NOT_READY', 'Marketplace order is not ready for pickup');
  }

  if (order.orderStatus !== 'ready') {
    if (order.orderStatus === 'handed_over' || order.orderStatus === 'completed') {
      return;
    }
    throw new DriverStatusError(
      409,
      'ORDER_NOT_READY',
      'Marketplace order must be ready before pickup'
    );
  }
}

function snapshotDriverInfo(booking) {
  const fromBooking = presentMarketplaceDriverInfo(booking && booking.driverInfo);
  if (fromBooking) {
    return fromBooking;
  }
  return null;
}

async function recordMarketplaceHandoverAfterPickup({
  bookingId,
  booking,
  driverId,
  marketplaceOrderId
}) {
  if (!marketplaceOrderId || booking.sourceType !== 'marketplace') {
    return { alreadyHandedOver: false };
  }

  const db = getFirestore();
  const orderRef = db.collection('marketplaceOrders').doc(marketplaceOrderId);

  const outcome = await db.runTransaction(async (tx) => {
    const orderSnap = await tx.get(orderRef);
    if (!orderSnap.exists) {
      return { alreadyHandedOver: false, skipped: true };
    }
    const order = orderSnap.data() || {};
    if (order.orderStatus === 'handed_over' || order.orderStatus === 'completed') {
      return { alreadyHandedOver: true, order, orderId: marketplaceOrderId };
    }
    if (order.orderStatus !== 'ready') {
      return { alreadyHandedOver: false, skipped: true };
    }

    assertTransition('ready', 'handed_over', { actor: { type: 'driver', id: driverId } });

    const driverInfo = snapshotDriverInfo(booking) || order.driverInfo || null;
    const updates = {
      orderStatus: 'handed_over',
      handedOverAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (driverInfo) {
      updates.driverInfo = driverInfo;
    }
    tx.update(orderRef, updates);
    appendEvent(tx, orderRef, {
      type: 'handed_over',
      actor: { type: 'driver', id: driverId },
      data: { bookingId }
    }, order.customerId);

    return {
      alreadyHandedOver: false,
      order: { ...order, ...updates, driverInfo: driverInfo || order.driverInfo },
      orderId: marketplaceOrderId,
      shopId: order.shopId,
      customerId: order.customerId
    };
  });

  if (outcome.skipped || outcome.alreadyHandedOver) {
    return outcome;
  }

  await notifyShopOrderPickedUp(outcome.order, outcome.orderId, booking);
  emitPickupHandoverSocket({ driverId, bookingId, marketplaceOrderId: outcome.orderId, displayId: outcome.order.displayId });

  return outcome;
}

async function notifyShopOrderPickedUp(order, orderId, booking) {
  const shopId = order && order.shopId;
  if (!shopId) {
    return;
  }
  const driverInfo = presentMarketplaceDriverInfo(
    (booking && booking.driverInfo) || (order && order.driverInfo)
  );
  const driverName = driverInfo && driverInfo.name ? driverInfo.name : 'Driver';
  try {
    const notificationService = require('../notificationService');
    await notificationService.sendTemplateNotification(shopId, 'MARKETPLACE', 'ORDER_PICKED_UP_SHOP', {
      ...marketplacePushVariables(order, orderId),
      driverName
    });
  } catch (error) {
    console.error('❌ [MARKETPLACE_PICKUP] Shop pickup notification failed:', error.message);
  }
}

function emitPickupHandoverSocket({ driverId, bookingId, marketplaceOrderId, displayId }) {
  try {
    const { getSocketIO } = require('../socket');
    const io = getSocketIO();
    emitMarketplaceHandoverConfirmed(io, {
      driverId,
      bookingId,
      marketplaceOrderId,
      displayId: displayId ?? null
    });
  } catch (error) {
    console.error('❌ [MARKETPLACE_PICKUP] Handover socket failed:', error.message);
  }
}

module.exports = {
  MARKETPLACE_PICKUP_BOOKING_STATUSES,
  bookingStatusAllowsCompatHandedOver,
  assertMarketplacePickupAllowed,
  recordMarketplaceHandoverAfterPickup,
  notifyShopOrderPickedUp,
  orderNeedsHandoverCatchup,
  snapshotDriverInfo
};
