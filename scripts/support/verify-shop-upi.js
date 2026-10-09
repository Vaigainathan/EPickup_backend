/**
 * Set shops/{id}.bank.upiNameVerification on staging.
 *
 * Usage:
 *   node scripts/support/verify-shop-upi.js --shop <id> --name "<verified name>"
 *   node scripts/support/verify-shop-upi.js --shop <id> --name "<verified name>" --apply
 *
 * Dry run is the default. --apply writes only bank.upiNameVerification.
 */

require('dotenv').config();

const { FieldValue } = require('firebase-admin/firestore');
const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { assertStagingShopId } = require('./approveShopActions');

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
  const shopId = argValue('--shop');
  const verifiedName = argValue('--name');
  const apply = process.argv.includes('--apply');

  if (!shopId || !verifiedName) {
    console.error('Usage: node scripts/support/verify-shop-upi.js --shop <id> --name "<verified name>" [--apply]');
    process.exit(1);
  }

  const lock = assertStagingShopId(shopId);
  if (!lock.ok) {
    console.error(lock.message);
    process.exit(1);
  }

  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  const ref = db.collection('shops').doc(shopId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`Shop not found: ${shopId}`);
    process.exit(1);
  }

  const bank = (snap.data() || {}).bank || {};
  const next = {
    verifiedName,
    method: 'manual',
    verifiedBy: 'script',
    verifiedAt: apply ? 'server timestamp' : null
  };

  console.log(JSON.stringify({
    shopId,
    apply,
    current: bank.upiNameVerification || null,
    write: {
      'bank.upiNameVerification': {
        verifiedName,
        method: 'manual',
        verifiedBy: 'script',
        verifiedAt: 'server timestamp'
      }
    }
  }, null, 2));

  if (!apply) {
    console.log('Dry run. Re-run with --apply to write.');
    return;
  }

  await ref.update({
    'bank.upiNameVerification': {
      verifiedName: next.verifiedName,
      method: next.method,
      verifiedBy: next.verifiedBy,
      verifiedAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  });
  console.log(`Updated shops/${shopId}.bank.upiNameVerification`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
