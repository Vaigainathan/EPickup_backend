/**
 * Staging-only: set appSettings/marketplace.MARKETPLACE_ENFORCEMENT.newStatuses.
 * Dry run by default; pass --apply to write.
 *
 *   node scripts/support/set-marketplace-enforcement.js --new-statuses true
 *   node scripts/support/set-marketplace-enforcement.js --new-statuses false --apply
 *
 * utrBlocksReject is left unchanged unless both flags are passed (optional).
 */
require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');

assertStagingEnv();

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return null;
  }
  return process.argv[index + 1];
}

function parseBool(raw, label) {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  throw new Error(`${label} must be true or false`);
}

function presentEnforcement(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    newStatuses: source.newStatuses === true,
    utrBlocksReject: source.utrBlocksReject === true
  };
}

async function main() {
  const newStatusesRaw = argValue('--new-statuses');
  if (newStatusesRaw == null) {
    console.error('Usage: node scripts/support/set-marketplace-enforcement.js --new-statuses true|false [--utr-blocks-reject true|false] [--apply]');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const newStatuses = parseBool(newStatusesRaw, '--new-statuses');
  const utrRaw = argValue('--utr-blocks-reject');
  const utrBlocksReject = utrRaw == null ? undefined : parseBool(utrRaw, '--utr-blocks-reject');

  const { getFirestore } = require('../../src/services/firebase');
  getFirestore();
  assertStagingAdmin();

  const { FieldValue } = require('firebase-admin/firestore');
  const { _resetEnforcementCache } = require('../../src/services/marketplace/orderStateMachine');
  const db = getFirestore();
  const ref = db.collection('appSettings').doc('marketplace');
  const beforeSnap = await ref.get();
  const beforeData = beforeSnap.exists ? (beforeSnap.data() || {}) : {};
  const before = presentEnforcement(beforeData.MARKETPLACE_ENFORCEMENT);

  const after = {
    newStatuses,
    utrBlocksReject: utrBlocksReject !== undefined ? utrBlocksReject : before.utrBlocksReject
  };

  console.log(JSON.stringify({
    dryRun: !apply,
    projectId: process.env.FIREBASE_PROJECT_ID,
    before,
    after
  }, null, 2));

  if (!apply) {
    console.log('Dry run. Re-run with --apply to write MARKETPLACE_ENFORCEMENT.');
    return;
  }

  await ref.set({
    MARKETPLACE_ENFORCEMENT: after,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  _resetEnforcementCache();

  const afterSnap = await ref.get();
  const afterData = afterSnap.exists ? (afterSnap.data() || {}) : {};
  console.log(JSON.stringify({
    applied: true,
    enforcement: presentEnforcement(afterData.MARKETPLACE_ENFORCEMENT)
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
