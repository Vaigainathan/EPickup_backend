const { isHandedOver } = require('./marketplaceHandoverGuard');
const { bookingStatusAllowsCompatHandedOver } = require('./marketplaceHandoverCompat');

function mapDriverMarketplaceItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((line) => line && line.unavailable !== true)
    .map((line) => ({
      name: typeof line.name === 'string' ? line.name : '',
      variantLabel: line.variantLabel ?? null,
      qty: Number(line.qty) || 0
    }));
}

async function loadAssignedMarketplaceContext(db, booking, driverId) {
  if (!booking || booking.sourceType !== 'marketplace') {
    return null;
  }
  if (booking.driverId !== driverId) {
    return null;
  }
  const orderId = booking.marketplaceOrderId;
  if (typeof orderId !== 'string' || orderId === '') {
    return null;
  }

  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const orderSnap = await orderRef.get();

  if (!orderSnap.exists) {
    return null;
  }

  const order = orderSnap.data() || {};
  const handedOver = isHandedOver(order.orderStatus)
    || bookingStatusAllowsCompatHandedOver(booking.status);
  const pickup = booking.pickup && typeof booking.pickup === 'object' ? booking.pickup : {};

  return {
    displayId: order.displayId ?? booking.displayId ?? null,
    handedOver,
    shopName: typeof pickup.name === 'string' ? pickup.name : (order.shopSnapshot && order.shopSnapshot.name) || null,
    shopPhone: typeof pickup.phone === 'string' ? pickup.phone : (order.shopSnapshot && order.shopSnapshot.phone) || null,
    items: mapDriverMarketplaceItems(order.items)
  };
}

function attachMarketplaceToDriverBooking(booking, marketplaceContext) {
  if (!marketplaceContext) {
    return booking;
  }
  return {
    ...booking,
    marketplace: marketplaceContext
  };
}

module.exports = {
  mapDriverMarketplaceItems,
  loadAssignedMarketplaceContext,
  attachMarketplaceToDriverBooking
};
