/**
 * Persist driver new-booking offer push outcomes to notifications (diagnose-push visibility).
 * Best-effort only — callers must not await in the critical offer path unless tests require it.
 */

function removeUndefinedValues(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => removeUndefinedValues(item));
  }
  const cleaned = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = removeUndefinedValues(value);
    }
  }
  return cleaned;
}

function ticketErrorMessage(ticket) {
  if (!ticket || ticket.status === 'ok') {
    return null;
  }
  if (typeof ticket.message === 'string' && ticket.message.trim() !== '') {
    return ticket.message;
  }
  if (ticket.details && typeof ticket.details.error === 'string') {
    return ticket.details.error;
  }
  return 'Push failed';
}

function buildDriverOfferNotificationRecord({
  userId,
  bookingId,
  title,
  body,
  ticket
}) {
  const sentAt = new Date();
  const status = ticket && ticket.status === 'ok' ? 'sent' : 'failed';
  const data = removeUndefinedValues({
    type: 'new_booking',
    bookingId: bookingId || ''
  });
  return {
    userId,
    title: title || '',
    body: body || '',
    type: 'new_booking',
    data,
    bookingId: bookingId || null,
    driverId: null,
    paymentId: null,
    status,
    errorMessage: status === 'failed' ? ticketErrorMessage(ticket) : null,
    sentAt
  };
}

/**
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ driverIds: string[], tickets: Array, bookingId: string, title: string, body: string }} params
 */
async function logDriverNewBookingOfferPushResults(db, params) {
  const {
    driverIds = [],
    tickets = [],
    bookingId,
    title,
    body
  } = params;

  if (!db || driverIds.length === 0) {
    return { logged: 0 };
  }

  let logged = 0;
  for (let index = 0; index < driverIds.length; index += 1) {
    const userId = driverIds[index];
    const ticket = tickets[index] || { status: 'error', message: 'Missing Expo ticket' };
    try {
      const record = buildDriverOfferNotificationRecord({
        userId,
        bookingId,
        title,
        body,
        ticket
      });
      await db.collection('notifications').add(record);
      logged += 1;
    } catch (error) {
      console.warn('[DriverOfferPushLog] Failed to save notification log:', {
        userId,
        bookingId,
        message: error.message
      });
    }
  }
  return { logged };
}

function buildPushContextsForDrivers(driverIds, notificationType = 'new_booking') {
  return driverIds.map((userId) => ({
    userId,
    notificationType
  }));
}

module.exports = {
  buildDriverOfferNotificationRecord,
  logDriverNewBookingOfferPushResults,
  buildPushContextsForDrivers,
  ticketErrorMessage
};
