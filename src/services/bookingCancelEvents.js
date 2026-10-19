function emitBookingCancelled(io, { driverId, bookingId, reason, cancelledBy }) {
  if (!io || !bookingId) {
    return;
  }
  const payload = {
    bookingId,
    reason: reason || 'Booking cancelled',
    cancelledBy: cancelledBy || 'support',
    timestamp: new Date().toISOString()
  };
  const bookingRoom = `booking:${bookingId}`;
  if (driverId) {
    io.to(`user:${driverId}`).emit('booking_cancelled', payload);
  }
  io.to(bookingRoom).emit('booking_cancelled', payload);
}

function emitMarketplaceHandoverConfirmed(io, {
  driverId,
  bookingId,
  marketplaceOrderId,
  displayId
}) {
  if (!io || !driverId) {
    return;
  }
  io.to(`user:${driverId}`).emit('marketplace_handover_confirmed', {
    bookingId,
    marketplaceOrderId,
    displayId
  });
}

module.exports = {
  emitBookingCancelled,
  emitMarketplaceHandoverConfirmed
};
