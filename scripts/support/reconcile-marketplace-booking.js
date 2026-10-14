/**
 * Staging-only: align a marketplace linked booking with its order (booking doc only).
 * Dry run is the default. Sync preflight must pass before any --apply write.
 *
 * Delivery test order (one command each; dry-run default):
 *   test-marketplace-create.js --customer … --shop … --items … --apply
 *   test-marketplace-create.js … --utr … --order ORDER --apply
 *   test-marketplace-create.js … --confirm --order ORDER --apply
 *   test-marketplace-create.js … --mark-ready --order ORDER --apply
 *   simulate-marketplace-driver.js --order ORDER --step assign
 *   simulate-marketplace-driver.js --order ORDER --step arrive
 *   test-marketplace-create.js … --handover --order ORDER --apply
 *   simulate-marketplace-driver.js --order ORDER --step pickup
 *   simulate-marketplace-driver.js --order ORDER --step transit
 *   simulate-marketplace-driver.js --order ORDER --step deliver
 *
 *   node scripts/support/reconcile-marketplace-booking.js --order <orderId> [--apply]
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { assertStagingPair } = require('./marketplaceStagingActions');
const {
  argValue,
  mergeBookingAfterPatch,
  evaluateSyncPreflight,
  planReconcileBooking,
  buildDriverReleasePatch
} = require('./lib/marketplaceStagingDriver');

assertStagingEnv();

async function resolveBooking(db, orderId, order) {
  if (order.linkedBookingId) {
    const snap = await db.collection('bookings').doc(order.linkedBookingId).get();
    if (!snap.exists) {
      return { ok: false, message: 'linkedBookingId points to a missing booking.' };
    }
    return { ok: true, id: snap.id, data: snap.data() || {} };
  }
  const query = await db.collection('bookings')
    .where('marketplaceOrderId', '==', orderId)
    .get();
  if (query.empty) {
    return { ok: false, message: 'No booking found for this order.' };
  }
  if (query.size > 1) {
    return { ok: false, message: 'Multiple bookings share marketplaceOrderId; pass a unique linkedBookingId on the order.' };
  }
  const doc = query.docs[0];
  return { ok: true, id: doc.id, data: doc.data() || {} };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const orderId = argValue(process.argv, '--order');
  if (!orderId) {
    console.error('Usage: node scripts/support/reconcile-marketplace-booking.js --order <orderId> [--apply]');
    process.exit(1);
  }

  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
  if (!orderSnap.exists) {
    console.error('Order not found. Nothing was written.');
    process.exit(1);
  }
  const order = orderSnap.data() || {};
  const pair = assertStagingPair(order.customerId, order.shopId);
  if (!pair.ok) {
    console.error(pair.message);
    process.exit(1);
  }

  const resolved = await resolveBooking(db, orderId, order);
  if (!resolved.ok) {
    console.error(resolved.message);
    process.exit(1);
  }

  const booking = resolved.data;
  if (booking.sourceType !== 'marketplace' || booking.marketplaceOrderId !== orderId) {
    console.error('Booking is not a marketplace booking for this order. Nothing was written.');
    process.exit(1);
  }

  const plan = planReconcileBooking(order, booking);
  if (plan.refused) {
    console.log(JSON.stringify({ reconcile: true, apply, refused: true, reason: plan.refuseReason }, null, 2));
    process.exit(1);
  }

  if (plan.noWrite) {
    console.log(JSON.stringify({
      reconcile: true,
      apply,
      wrote: false,
      noWrite: true,
      action: plan.action,
      reason: plan.refuseReason,
      orderId,
      bookingId: resolved.id,
      orderStatus: order.orderStatus ?? null,
      bookingStatus: booking.status ?? null,
      bookingPatch: null
    }, null, 2));
    return;
  }

  const marketplaceSyncService = require('../../src/services/marketplaceSyncService');
  const proposedBooking = mergeBookingAfterPatch(booking, plan.bookingPatch);
  const preflight = evaluateSyncPreflight(
    order,
    proposedBooking,
    marketplaceSyncService.planDeliverySync,
    marketplaceSyncService.planWrites
  );

  const payload = {
    reconcile: true,
    apply,
    wrote: false,
    orderId,
    bookingId: resolved.id,
    action: plan.action,
    orderStatus: order.orderStatus ?? null,
    bookingStatus: booking.status ?? null,
    bookingPatch: plan.bookingPatch,
    driverRelease: plan.driverRelease,
    syncPreflight: {
      ok: preflight.ok,
      writes: preflight.writes,
      push: preflight.push,
      complete: preflight.complete,
      plan: preflight.plan
    }
  };

  console.log(JSON.stringify(payload, null, 2));

  if (!apply) {
    console.log('Dry run. Re-run with --apply to write the booking patch. Nothing was written.');
    return;
  }

  if (!preflight.ok) {
    console.error('Sync preflight failed. Order would change or push/complete would fire. Nothing was written.');
    process.exit(1);
  }

  const batch = db.batch();
  const bookingRef = db.collection('bookings').doc(resolved.id);
  batch.update(bookingRef, plan.bookingPatch);

  if (plan.driverRelease && plan.driverRelease.driverId) {
    const driverRef = db.collection('users').doc(plan.driverRelease.driverId);
    const driverSnap = await driverRef.get();
    if (driverSnap.exists) {
      const releasePatch = buildDriverReleasePatch(driverSnap.data() || {});
      batch.update(driverRef, { ...releasePatch, updatedAt: new Date() });
    }
  }

  await batch.commit();
  console.log(JSON.stringify({ reconcile: true, apply: true, wrote: true, bookingId: resolved.id }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
