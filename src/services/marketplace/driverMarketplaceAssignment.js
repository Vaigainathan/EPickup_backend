const { isHandedOver } = require('./marketplaceHandoverGuard');

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

function otpToHandoverCode(privateData) {
  if (!privateData || privateData.otp == null) {
    return null;
  }
  const raw = privateData.otp;
  return typeof raw === 'string' ? raw : String(raw);
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
  const privateRef = orderRef.collection('private').doc('handover');
  const [orderSnap, privateSnap] = await Promise.all([
    orderRef.get(),
    privateRef.get()
  ]);

  if (!orderSnap.exists) {
    return null;
  }

  const order = orderSnap.data() || {};
  const handoverCode = privateSnap.exists
    ? otpToHandoverCode(privateSnap.data())
    : null;

  return {
    displayId: order.displayId ?? booking.displayId ?? null,
    handoverCode,
    handedOver: isHandedOver(order.orderStatus),
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
