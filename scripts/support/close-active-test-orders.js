/**
 * Staging-only: report (and optionally cancel) ongoing marketplace test orders,
 * active parcel/marketplace bookings, and release stuck drivers.
 * Dry run is the default.
 *
 *   node scripts/support/close-active-test-orders.js
 *   node scripts/support/close-active-test-orders.js --order <id>
 *   node scripts/support/close-active-test-orders.js --booking <id>
 *   node scripts/support/close-active-test-orders.js --apply
 *   node scripts/support/close-active-test-orders.js --order <id> --apply
 *
 * --apply: cancels scoped ongoing orders and non-terminal linked/active bookings
 * (payment fields untouched; no refunds, pushes, or stock changes), clears
 * customerParcelLocks pointing at those bookings, deactivates tripTracking,
 * deletes booking_locks, then releases drivers via the orphan-release helper
 * (never sets isOnline). Batches are capped at 400 ops per commit.
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const {
  USAGE,
  parseCloseActiveTestOrdersArgv,
  runCloseActiveTestOrders
} = require('./lib/closeActiveTestOrdersActions');

assertStagingEnv();

async function main() {
  const parsed = parseCloseActiveTestOrdersArgv();

  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  const result = await runCloseActiveTestOrders(db, {
    apply: parsed.apply,
    orderId: parsed.orderId,
    bookingId: parsed.bookingId
  });

  console.log(JSON.stringify(result, null, 2));

  if (!parsed.apply) {
    console.log('Dry run. Re-run with --apply to write. Nothing was written.');
    return;
  }

  const refusedDrivers = (result.driverResults || []).filter((row) => row.released === false);
  if (refusedDrivers.length > 0) {
    console.warn(JSON.stringify({ driverReleaseWarnings: refusedDrivers }, null, 2));
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

module.exports = { USAGE };
