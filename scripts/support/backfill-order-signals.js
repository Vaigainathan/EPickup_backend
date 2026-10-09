/**
 * Write signal/latest for open marketplace orders.
 * Dry-run is the default. Prints counts only.
 *
 * Staging (default) is locked to customer Ue51a7afbc981f1b92cf30be32ab.
 * --all-customers is refused unless FIREBASE_PROJECT_ID is epickup-app
 * and --confirm-production is passed.
 *
 *   node scripts/support/backfill-order-signals.js
 *   node scripts/support/backfill-order-signals.js --apply
 */

require('dotenv').config();

const { FieldValue } = require('firebase-admin/firestore');
const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { STAGING_CUSTOMER_ID } = require('./marketplaceStagingActions');

const TERMINAL = new Set(['completed', 'cancelled', 'delivery_failed']);
const PRODUCTION_PROJECT = 'epickup-app';

function refuse(message) {
  console.error(message);
  process.exit(1);
}

const allCustomers = process.argv.includes('--all-customers');
const apply = process.argv.includes('--apply');
const project = process.env.FIREBASE_PROJECT_ID;

if (allCustomers) {
  if (project !== PRODUCTION_PROJECT) {
    refuse('Refusing --all-customers: only the production project epickup-app can backfill every customer. Nothing was written.');
  }
  if (!process.argv.includes('--confirm-production')) {
    refuse('Refusing --all-customers without --confirm-production. Nothing was written.');
  }
} else {
  assertStagingEnv();
}

async function main() {
  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  if (!allCustomers) {
    assertStagingAdmin();
  }

  let query = db.collection('marketplaceOrders');
  if (!allCustomers) {
    query = query.where('customerId', '==', STAGING_CUSTOMER_ID);
  }
  const snap = await query.select('customerId', 'orderStatus').get();
  let skippedTerminal = 0;
  let skippedCustomer = 0;
  const pending = [];
  snap.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (!allCustomers && data.customerId !== STAGING_CUSTOMER_ID) {
      refuse('Refusing: a document is not the locked staging customer. Nothing was written.');
    }
    if (typeof data.customerId !== 'string' || data.customerId === '') {
      skippedCustomer += 1;
      return;
    }
    if (TERMINAL.has(data.orderStatus)) {
      skippedTerminal += 1;
      return;
    }
    pending.push({ ref: doc.ref, customerId: data.customerId });
  });

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    scope: allCustomers ? 'all-customers' : 'locked-customer',
    scanned: snap.size,
    skippedTerminal,
    skippedCustomer,
    wouldWrite: pending.length
  }));

  if (!apply) {
    return;
  }

  let written = 0;
  for (let index = 0; index < pending.length; index += 400) {
    const batch = db.batch();
    pending.slice(index, index + 400).forEach((item) => {
      batch.set(item.ref.collection('signal').doc('latest'), {
        customerId: item.customerId,
        updatedAt: FieldValue.serverTimestamp(),
        type: 'backfill'
      });
    });
    await batch.commit();
    written += Math.min(400, pending.length - index);
  }
  console.log(JSON.stringify({ written }));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
