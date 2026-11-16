const { getFirestore } = require('./firebase');

async function releaseBookingTrackingResources({
  bookingId,
  driverId = null,
  clearDriverLocation = true,
  db = getFirestore()
}) {
  try {
    await db.runTransaction(async (tx) => {
      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingSnap = await tx.get(bookingRef);
      if (!bookingSnap.exists) {
        return;
      }

      const booking = bookingSnap.data() || {};
      const assignedDriverId = booking.driverId || driverId || null;
      const trackingRef = db.collection('tripTracking').doc(bookingId);
      const lockRef = db.collection('booking_locks').doc(bookingId);
      const driverLocationRef = clearDriverLocation && assignedDriverId
        ? db.collection('driverLocations').doc(assignedDriverId)
        : null;

      const [trackingSnap, lockSnap, driverLocationSnap] = await Promise.all([
        tx.get(trackingRef),
        tx.get(lockRef),
        driverLocationRef ? tx.get(driverLocationRef) : Promise.resolve(null)
      ]);

      tx.update(bookingRef, { 'tracking.isActive': false });

      if (trackingSnap.exists) {
        tx.update(trackingRef, { isActive: false });
      }
      if (lockSnap.exists) {
        tx.delete(lockRef);
      }
      if (
        driverLocationSnap &&
        driverLocationSnap.exists &&
        driverLocationSnap.data()?.currentTripId === bookingId
      ) {
        tx.update(driverLocationRef, { currentTripId: null });
      }
    });

    return { success: true };
  } catch (error) {
    console.error(
      `❌ [BOOKING_CANCEL_CLEANUP] Failed to release tracking resources for booking ${bookingId}:`,
      error
    );
    return { success: false, error };
  }
}

module.exports = { releaseBookingTrackingResources };
