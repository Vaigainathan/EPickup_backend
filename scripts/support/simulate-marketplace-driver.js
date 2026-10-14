/**
 * Staging-only: simulate marketplace driver booking steps and location writes.
 * Dry run is the default. Never sets isOnline/isAvailable true on users or driverLocations.
 *
 * Delivery test order (one command each; dry-run default):
 *   test-marketplace-create.js --customer … --shop … --items … --apply
 *   test-marketplace-create.js … --utr … --order ORDER --apply
 *   test-marketplace-create.js … --confirm --order ORDER --apply
 *   test-marketplace-create.js … --mark-ready --order ORDER --apply
 *   node scripts/support/simulate-marketplace-driver.js --order ORDER --step assign
 *   node scripts/support/simulate-marketplace-driver.js --order ORDER --step arrive
 *   test-marketplace-create.js … --handover --order ORDER --apply
 *   node scripts/support/simulate-marketplace-driver.js --order ORDER --step pickup
 *   node scripts/support/simulate-marketplace-driver.js --order ORDER --step transit
 *   node scripts/support/simulate-marketplace-driver.js --order ORDER --step deliver
 *
 *   node scripts/support/simulate-marketplace-driver.js --seed-driver [--apply]
 *   node scripts/support/simulate-marketplace-driver.js --order <id> --step assign|arrive|pickup|transit|deliver [--apply]
 *   node scripts/support/simulate-marketplace-driver.js --order <id> --move --seconds 120 --every 10 [--apply]
 */

require('dotenv').config();

const admin = require('firebase-admin');
const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { assertStagingPair } = require('./marketplaceStagingActions');
const {
  STAGING_TEST_DRIVER_UID,
  SIM_STEPS,
  argValue,
  assertTestDriverFixture,
  planSimStepPatch,
  flattenTimingPatch,
  planMoveWrites,
  planSeedDriverDoc,
  assertNoAvailabilityFlagsInWrite
} = require('./lib/marketplaceStagingDriver');

assertStagingEnv();

function maskPhone(value) {
  const text = value == null ? '' : String(value);
  if (text.length <= 4) {
    return '****';
  }
  return `${'*'.repeat(text.length - 4)}${text.slice(-4)}`;
}

function maskForLog(value, key) {
  if (value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (key === 'phone' || key === 'phoneNumber') {
    return maskPhone(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskForLog(item, key));
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).forEach((childKey) => {
      out[childKey] = maskForLog(value[childKey], childKey);
    });
    return out;
  }
  return value;
}

async function loadOrderContext(db, orderId) {
  const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
  if (!orderSnap.exists) {
    return { ok: false, message: 'Order not found.' };
  }
  const order = orderSnap.data() || {};
  const pair = assertStagingPair(order.customerId, order.shopId);
  if (!pair.ok) {
    return { ok: false, message: pair.message };
  }
  if (!order.linkedBookingId) {
    return { ok: false, message: 'Order has no linkedBookingId. Mark ready first.' };
  }
  const bookingSnap = await db.collection('bookings').doc(order.linkedBookingId).get();
  if (!bookingSnap.exists) {
    return { ok: false, message: 'Linked booking not found.' };
  }
  const booking = bookingSnap.data() || {};
  if (booking.sourceType !== 'marketplace' || booking.marketplaceOrderId !== orderId) {
    return { ok: false, message: 'Linked booking is not a marketplace booking for this order.' };
  }
  return {
    ok: true,
    order,
    orderId,
    booking,
    bookingId: bookingSnap.id
  };
}

async function ensureTestDriverReadable(db) {
  const snap = await db.collection('users').doc(STAGING_TEST_DRIVER_UID).get();
  if (!snap.exists) {
    return { ok: false, message: `Test driver users/${STAGING_TEST_DRIVER_UID} missing. Run --seed-driver --apply first.` };
  }
  const check = assertTestDriverFixture(snap.data() || {}, STAGING_TEST_DRIVER_UID);
  if (!check.ok) {
    return check;
  }
  return { ok: true, data: snap.data() || {} };
}

async function runSeedDriver(db, apply) {
  const doc = planSeedDriverDoc();
  const violations = assertNoAvailabilityFlagsInWrite(doc);
  if (violations.length > 0) {
    console.error('Seed plan would set availability flags:', violations.join(', '));
    process.exit(1);
  }
  console.log(JSON.stringify({
    seedDriver: true,
    apply,
    uid: STAGING_TEST_DRIVER_UID,
    doc: maskForLog(doc)
  }, null, 2));
  if (!apply) {
    console.log('Dry run. Re-run with --seed-driver --apply to merge the test driver users doc.');
    return;
  }
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('users').doc(STAGING_TEST_DRIVER_UID).set({
    ...doc,
    createdAt: now,
    updatedAt: now
  }, { merge: true });
  console.log(JSON.stringify({ seedDriver: true, apply: true, wrote: true, uid: STAGING_TEST_DRIVER_UID }, null, 2));
}

async function runStep(db, orderId, step, apply) {
  if (!SIM_STEPS.has(step)) {
    console.error(`--step must be one of: ${[...SIM_STEPS].join(', ')}`);
    process.exit(1);
  }
  const ctx = await loadOrderContext(db, orderId);
  if (!ctx.ok) {
    console.error(ctx.message);
    process.exit(1);
  }
  const driverUser = await ensureTestDriverReadable(db);
  if (!driverUser.ok) {
    console.error(driverUser.message);
    process.exit(1);
  }
  if (ctx.booking.driverId && ctx.booking.driverId !== STAGING_TEST_DRIVER_UID) {
    console.error('Refusing: booking is assigned to a non-test driver.');
    process.exit(1);
  }
  const planned = planSimStepPatch(step, ctx.booking, driverUser.data);
  if (!planned.ok) {
    console.error(planned.message);
    process.exit(1);
  }
  const patch = flattenTimingPatch(planned.patch);
  const violations = assertNoAvailabilityFlagsInWrite(patch);
  if (violations.length > 0) {
    console.error('Step patch would set availability flags:', violations.join(', '));
    process.exit(1);
  }
  console.log(JSON.stringify({
    simulate: true,
    apply,
    orderId,
    bookingId: ctx.bookingId,
    step,
    patch: maskForLog(patch)
  }, null, 2));
  if (!apply) {
    console.log('Dry run. Re-run with --apply to write the booking.');
    return;
  }
  await db.collection('bookings').doc(ctx.bookingId).update(patch);
  console.log(JSON.stringify({ simulate: true, apply: true, wrote: true, step, bookingId: ctx.bookingId }, null, 2));
}

async function runMove(db, orderId, seconds, every, apply) {
  const ctx = await loadOrderContext(db, orderId);
  if (!ctx.ok) {
    console.error(ctx.message);
    process.exit(1);
  }
  if (ctx.booking.driverId !== STAGING_TEST_DRIVER_UID) {
    console.error('Refusing --move: booking.driverId must be the staging test driver UID.');
    process.exit(1);
  }
  await ensureTestDriverReadable(db);

  const movePlan = planMoveWrites({
    order: ctx.order,
    bookingId: ctx.bookingId,
    seconds,
    every
  });
  if (!movePlan.ok) {
    console.error(movePlan.message);
    process.exit(1);
  }

  for (let index = 0; index < movePlan.writes.length; index += 1) {
    const write = movePlan.writes[index];
    const violations = assertNoAvailabilityFlagsInWrite(write);
    if (violations.length > 0) {
      console.error('Move write would set availability flags:', violations.join(', '));
      process.exit(1);
    }
  }

  console.log(JSON.stringify({
    move: true,
    apply,
    orderId,
    bookingId: ctx.bookingId,
    stage: movePlan.stage,
    writeCount: movePlan.writes.length,
    writes: movePlan.writes.map((row) => maskForLog(row))
  }, null, 2));

  if (!apply) {
    console.log('Dry run. Re-run with --apply to write driverLocations.');
    return;
  }

  const locationRef = db.collection('driverLocations').doc(STAGING_TEST_DRIVER_UID);
  for (let index = 0; index < movePlan.writes.length; index += 1) {
    const write = movePlan.writes[index];
    await locationRef.set(write, { merge: true });
  }
  console.log(JSON.stringify({
    move: true,
    apply: true,
    wrote: true,
    driverId: STAGING_TEST_DRIVER_UID,
    points: movePlan.writes.length
  }, null, 2));
}

async function main() {
  const apply = process.argv.includes('--apply');
  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  if (process.argv.includes('--seed-driver')) {
    await runSeedDriver(db, apply);
    return;
  }

  const orderId = argValue(process.argv, '--order');
  if (!orderId) {
    console.error('Usage: --order <id> with --step or --move, or --seed-driver');
    process.exit(1);
  }

  if (process.argv.includes('--move')) {
    const seconds = argValue(process.argv, '--seconds') || '120';
    const every = argValue(process.argv, '--every') || '10';
    await runMove(db, orderId, seconds, every, apply);
    return;
  }

  const step = argValue(process.argv, '--step');
  if (!step) {
    console.error('Pass --step assign|arrive|pickup|transit|deliver or --move with --seconds and --every');
    process.exit(1);
  }
  await runStep(db, orderId, step, apply);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
