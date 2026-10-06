/**
 * Seed missing appSettings/marketplace keys. Existing keys are left unchanged.
 * PAYMENT_TIMEOUT_MS is held: it is never written by this script.
 *
 * Usage:
 *   node scripts/seed-marketplace-settings.js            (dry run)
 *   node scripts/seed-marketplace-settings.js --apply    (writes)
 */

const {
  HELD_KEYS,
  planMarketplaceSettingsMerge
} = require('../src/config/marketplaceDefaults');

function parseMode(argv) {
  const args = argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--apply');
  if (unknown.length > 0) {
    return { error: `Unknown flag: ${unknown.join(' ')}` };
  }
  return { apply: args.includes('--apply') };
}

function printPlan(docExists, plan) {
  console.log(`doc exists: ${docExists ? 'yes' : 'no'}`);
  const held = plan.actions.filter((entry) => entry.action === 'held');
  const rest = plan.actions.filter((entry) => entry.action !== 'held');
  held.forEach((entry) => {
    console.log(`HELD ${entry.key}: ${entry.line}`);
  });
  rest.forEach((entry) => {
    console.log(`${entry.key}: ${entry.line}`);
  });
  console.log(`apply payload keys: ${Object.keys(plan.payload).join(', ') || '(none)'}`);
  HELD_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(plan.payload, key)) {
      throw new Error(`Refusing to write held key ${key}`);
    }
  });
}

async function main() {
  require('dotenv').config();
  const { assertStagingEnv, assertStagingAdmin } = require('./assertStagingFirebase');
  assertStagingEnv();

  const mode = parseMode(process.argv);
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }

  console.log(`projectId: ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`clientEmail: ${process.env.FIREBASE_CLIENT_EMAIL}`);
  console.log(`mode: ${mode.apply ? 'APPLY' : 'DRY RUN'}`);

  const { getFirestore } = require('../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  const ref = db.collection('appSettings').doc('marketplace');
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : null;
  const plan = planMarketplaceSettingsMerge(existing);
  printPlan(snap.exists, plan);

  if (!mode.apply) {
    process.exit(0);
  }

  const { FieldValue } = require('firebase-admin/firestore');
  await ref.set({
    ...plan.payload,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true });
  console.log(`updatedAt: set`);
  console.log(`added: ${Object.keys(plan.payload).length}`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  parseMode,
  printPlan
};
