const { getFirestore } = require('./firebase');

function normalizeNotifiedDriverIds(notifiedDrivers) {
  if (!Array.isArray(notifiedDrivers)) {
    return [];
  }
  return [...new Set(
    notifiedDrivers.filter((id) => typeof id === 'string' && id.trim() !== '')
  )];
}

/**
 * Notify drivers who received a new-booking offer that the booking was cancelled before acceptance.
 * Socket + data-only push (stop_ringtone). Never throws — callers should not await in the cancel critical path.
 *
 * @param {string} bookingId
 * @param {string[]} notifiedDrivers
 * @param {string} [reason]
 * @param {string} [cancelledBy]
 * @param {{ db?: FirebaseFirestore.Firestore, skipDriverId?: string|null }} [options]
 */
async function notifyOfferedDriversBookingCancelled(
  bookingId,
  notifiedDrivers,
  reason,
  cancelledBy,
  options = {}
) {
  const driverIds = normalizeNotifiedDriverIds(notifiedDrivers);
  if (!bookingId || driverIds.length === 0) {
    return;
  }

  const skipDriverId = options.skipDriverId || null;
  const cancelledAtIso = new Date().toISOString();
  const cancelledEvent = {
    bookingId,
    reason: reason || 'Booking cancelled',
    cancelledBy: cancelledBy || 'system',
    timestamp: cancelledAtIso
  };

  try {
    const socketService = require('./socket');
    const io = socketService.getSocketIO();
    if (io) {
      for (const driverId of driverIds) {
        if (skipDriverId && driverId === skipDriverId) {
          continue;
        }
        io.to(`user:${driverId}`).emit('booking_cancelled', cancelledEvent);
      }
      console.log(
        `✅ [OFFER_CANCEL_NOTIFY] Socket booking_cancelled for booking ${bookingId} to ${driverIds.length} driver(s)`
      );
    }
  } catch (wsError) {
    console.error('❌ [OFFER_CANCEL_NOTIFY] WebSocket failed:', wsError.message);
  }

  try {
    const db = options.db || getFirestore();
    const expoPushService = require('./expoPushService');
    const { buildPushContextsForDrivers } = require('./driverOfferPushNotificationLog');
    const stopTokens = [];
    const tokenDriverIds = [];

    for (const driverId of driverIds) {
      if (skipDriverId && driverId === skipDriverId) {
        continue;
      }

      const notifiedDriverDoc = await db.collection('users').doc(driverId).get();
      if (!notifiedDriverDoc.exists) {
        console.warn(`⚠️ [OFFER_CANCEL_NOTIFY] Notified driver ${driverId} not found`);
        continue;
      }

      const notifiedDriverData = notifiedDriverDoc.data();
      const pushToken = notifiedDriverData.expoPushToken || notifiedDriverData.fcmToken;
      if (!pushToken) {
        console.warn(`⚠️ [OFFER_CANCEL_NOTIFY] Driver ${driverId} has no push token`);
        continue;
      }

      stopTokens.push(pushToken);
      tokenDriverIds.push(driverId);
    }

    if (stopTokens.length === 0) {
      console.log(`ℹ️ [OFFER_CANCEL_NOTIFY] No valid push tokens for booking ${bookingId}`);
      return;
    }

    const stopNotification = {
      type: 'booking_cancelled',
      bookingId,
      data: {
        type: 'booking_cancelled',
        bookingId,
        action: 'stop_ringtone'
      }
    };

    const pushContexts = buildPushContextsForDrivers(tokenDriverIds, 'booking_cancelled');
    const stopResult = await expoPushService.sendToTokens(stopTokens, stopNotification, {
      priority: 'high',
      dataOnly: true,
      pushContexts
    });

    console.log(
      `📢 [OFFER_CANCEL_NOTIFY] Stop signal sent for booking ${bookingId}: ` +
      `${stopResult.successCount} success, ${stopResult.failureCount} failed`
    );
  } catch (pushError) {
    console.error('⚠️ [OFFER_CANCEL_NOTIFY] Push stop signal error:', pushError?.message);
  }
}

module.exports = {
  normalizeNotifiedDriverIds,
  notifyOfferedDriversBookingCancelled
};