/**
 * Staging-only: release a driver stuck after orphan booking / stale busy flags.
 * Dry run is the default.
 *
 *   node scripts/support/release-stuck-driver.js --driver <uid> [--booking <id>]
 *   node scripts/support/release-stuck-driver.js --driver <uid> [--booking <id>] --apply
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const {
  parseReleaseStuckDriverArgv,
  validateReleaseStuckDriverArgv,
  DRY_RUN_APP_WARNING,
  loadReleaseContext,
  planReleaseStuckDriver,
  applyReleaseStuckDriver
} = require('./lib/releaseStuckDriverActions');

assertStagingEnv();

async function main() {
  const parsed = parseReleaseStuckDriverArgv();
  const valid = validateReleaseStuckDriverArgv(parsed);
  if (!valid.ok) {
    console.error(valid.message);
    process.exit(1);
  }

  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  const context = await loadReleaseContext(db, parsed.driverId, parsed.bookingIdOverride);
  const plan = planReleaseStuckDriver(context);

  const payload = {
    releaseStuckDriver: true,
    apply: parsed.apply,
    refused: plan.refused,
    refuseReason: plan.refuseReason,
    candidateBookingIds: plan.candidateBookingIds,
    cleanupBookingIds: plan.cleanupBookingIds || [],
    before: plan.before,
    after: plan.after,
    patchesSummary: plan.patchesSummary || null
  };

  console.log(JSON.stringify(payload, null, 2));

  if (plan.refused) {
    process.exit(1);
  }

  if (!parsed.apply) {
    console.log('Dry run. Re-run with --apply to write. Nothing was written.');
    console.log(DRY_RUN_APP_WARNING);
    return;
  }

  await applyReleaseStuckDriver(db, plan);
  console.log(JSON.stringify({ releaseStuckDriver: true, apply: true, wrote: true }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
