function presentStoredBooking(id, data) {
  const stored = data || {};
  return {
    id,
    ...stored,
    createdAt: stored.createdAt?.toDate ? stored.createdAt.toDate() : (stored.createdAt || new Date()),
    updatedAt: stored.updatedAt?.toDate ? stored.updatedAt.toDate() : (stored.updatedAt || new Date())
  };
}

async function lookupCustomerBookingByIdempotencyKey(db, customerId, idempotencyKey) {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
    return { found: false };
  }

  try {
    const snapshot = await db.collection('bookings')
      .where('customerId', '==', customerId)
      .where('idempotencyKey', '==', idempotencyKey)
      .limit(1)
      .get();

    if (snapshot.empty) {
      console.log('[B63] idempotency miss');
      return { found: false };
    }

    const bookingDoc = snapshot.docs[0];
    const booking = presentStoredBooking(bookingDoc.id, bookingDoc.data());
    console.log(`[B63] idempotency hit bookingId=${booking.id}`);
    return { found: true, booking };
  } catch (error) {
    console.error('[B63] idempotency lookup failed', {
      message: error && error.message,
      code: error && error.code
    });
    return { found: false };
  }
}

module.exports = {
  lookupCustomerBookingByIdempotencyKey
};
