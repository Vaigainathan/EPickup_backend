/**
 * Restore customer.marketplace from snapshot taken by restrict-customer.js.
 *
 *   node scripts/support/unrestrict-customer.js --customer <id>
 *   node scripts/support/unrestrict-customer.js --customer <id> --apply
 */

require('dotenv').config();

const { FieldValue } = require('firebase-admin/firestore');
const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { STAGING_CUSTOMER_ID } = require('./marketplaceStagingActions');
const { loadMarketplaceSnapshot, deleteMarketplaceSnapshot } = require('./userMarketplaceSnapshot');

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

function diffKeys(before, after) {
  const added = Object.keys(after).filter((key) => !(key in before));
  return { added };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const customerId = argValue('--customer');
  if (!customerId) {
    console.error('Usage: unrestrict-customer.js --customer <id> [--apply]');
    process.exit(1);
  }
  if (customerId !== STAGING_CUSTOMER_ID) {
    console.error(`This script only runs for staging customer ${STAGING_CUSTOMER_ID}.`);
    process.exit(1);
  }

  const snapshot = loadMarketplaceSnapshot(customerId);
  if (!snapshot) {
    console.error('No snapshot found. Run restrict-customer --apply first.');
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
  const current = snap.data().customer && snap.data().customer.marketplace
    ? snap.data().customer.marketplace
    : {};
  const restored = snapshot.marketplace && typeof snapshot.marketplace === 'object'
    ? snapshot.marketplace
    : {};

  const plan = {
    dryRun: !apply,
    customerId,
    restoreKeys: Object.keys(restored),
    deleteNewKeys: diffKeys(restored, current).added
  };

  if (!apply) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const { unrestrictCustomerMarketplace } = require('../../src/services/admin/customerMarketplaceRestrictionService');
  const result = await unrestrictCustomerMarketplace(customerId, { operator: 'script' });
  console.log(JSON.stringify({ applied: true, ...plan, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
