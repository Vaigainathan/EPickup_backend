/**
 * System parcel cancel notifications (job + handleBookingTimeout only).
 * Socket shapes match src/routes/customer.js cancel handler (~L1204–1232).
 * Customer push: BOOKING_CANCELLED when notifyCustomerPush is true.
 */

async function notifyParcelBookingCancelled({
  bookingId,
  customerId,
  reason,
  cancelledBy,
  notifyCustomerPush = true
}) {
  const cancelledAtIso = new Date().toISOString();

  try {
    const socketService = require('../socket');
    const io = socketService.getSocketIO();

    if (io && customerId) {
      const bookingRoom = `booking:${bookingId}`;
      const userRoom = `user:${customerId}`;

      const statusUpdateEvent = {
        bookingId,
        status: 'cancelled',
        cancellationReason: reason,
        cancelledAt: cancelledAtIso,
        timestamp: cancelledAtIso,
        updatedBy: cancelledBy
      };

      const cancelledEvent = {
        bookingId,
        reason,
        cancelledBy,
        timestamp: cancelledAtIso
      };

      io.to(bookingRoom).emit('booking_status_update', statusUpdateEvent);
      io.to(userRoom).emit('booking_status_update', statusUpdateEvent);
      io.to(bookingRoom).emit('booking_cancelled', cancelledEvent);
      io.to(userRoom).emit('booking_cancelled', cancelledEvent);

      console.log(
        `✅ [PARCEL_CANCEL_NOTIFY] Socket cancel for booking ${bookingId} (customer ${customerId})`
      );
    }
  } catch (wsError) {
    console.error('❌ [PARCEL_CANCEL_NOTIFY] WebSocket failed:', wsError.message);
  }

  if (notifyCustomerPush && customerId) {
    try {
      const notificationService = require('../notificationService');
      const result = await notificationService.sendTemplateNotification(
        customerId,
        'CUSTOMER',
        'BOOKING_CANCELLED',
        {
          bookingId,
          reason: reason || 'Booking cancelled'
        }
      );
      if (result && result.success === false) {
        console.error('❌ [PARCEL_CANCEL_NOTIFY] Customer push failed:', result.error || result);
      }
    } catch (pushError) {
      console.error('❌ [PARCEL_CANCEL_NOTIFY] Customer push failed:', pushError.message);
    }
  }
}

module.exports = {
  notifyParcelBookingCancelled
};
