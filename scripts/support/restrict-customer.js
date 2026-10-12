/**
 * Restrict the staging test customer for marketplace create only.
 * Dry run by default. Snapshots customer.marketplace before first --apply.
 *
 *   node scripts/support/restrict-customer.js --customer <id> --reason <text> --operator <id>
 *   node scripts/support/restrict-customer.js --customer <id> --reason <text> --operator <id> --apply
 *   node scripts/support/restrict-customer.js ... --apply --force   (overwrite existing snapshot)
 */

require('dotenv').config();

const { FieldValue } = require('firebase-admin/firestore');
const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { STAGING_CUSTOMER_ID } = require('./marketplaceStagingActions');
const { prepareRestrictSnapshot } = require('./userMarketplaceSnapshot');

assertStagingEnv();

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) {
    return '';
  }
  return next;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const force = process.argv.includes('--force');
  const customerId = argValue('--customer');
  const reason = argValue('--reason');
  const operator = argValue('--operator');
  if (!customerId || !reason || !operator) {
    console.error('Usage: restrict-customer.js --customer <id> --reason <text> --operator <id> [--apply]');
    process.exit(1);
  }
  if (customerId !== STAGING_CUSTOMER_ID) {
    console.error(`This script only runs for staging customer ${STAGING_CUSTOMER_ID}.`);
    process.exit(1);
  }

  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();
  const userRef = db.collection('users').doc(customerId);
  const snap = await userRef.get();
  if (!snap.exists) {
    console.error('Customer not found.');
    process.exit(1);
  }
  const data = snap.data() || {};
  const marketplace = data.customer && data.customer.marketplace
    ? data.customer.marketplace
    : {};

  if (!apply) {
    console.log(JSON.stringify({
      dryRun: true,
      customerId,
      currentRestriction: marketplace.restriction || null,
      wouldSet: { active: true, reason, setBy: operator }
    }, null, 2));
    return;
  }

  const snapshotOutcome = prepareRestrictSnapshot(customerId, marketplace, { force });
  if (!snapshotOutcome.ok) {
    console.error('Snapshot already exists. Use --force to overwrite before restrict.');
    process.exit(1);
  }
  if (snapshotOutcome.overwritten) {
    console.log(`Overwrote marketplace snapshot: ${snapshotOutcome.file}`);
  } else {
    console.log(`Saved marketplace snapshot: ${snapshotOutcome.file}`);
  }

  await userRef.update({
    'customer.marketplace.restriction': {
      active: true,
      reason,
      setBy: operator,
      setAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  });
  console.log(JSON.stringify({ applied: true, customerId, restricted: true }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
