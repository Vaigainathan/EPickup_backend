/**
 * Backfill marketplaceOrders.customerRefundAction from refunds subcollections.
 *
 * Usage:
 *   node scripts/backfill-customer-refund-action.js
 *   node scripts/backfill-customer-refund-action.js --apply
 *   node scripts/backfill-customer-refund-action.js --order <orderId>
 *   node scripts/backfill-customer-refund-action.js --apply --confirm-production
 */

const { FieldPath } = require('firebase-admin/firestore');
const { computeCustomerRefundAction } = require('../src/services/marketplace/refunds');

const PAGE_SIZE = 200;

function parseArgv(argv) {
  const { parseMigrationArgv } = require('./migrationEnv');
  const base = parseMigrationArgv(argv);
  if (base.error) {
    return base;
  }
  let orderId = null;
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--order') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        return { error: 'Missing --order <orderId>' };
      }
      orderId = value;
      i += 1;
    }
  }
  return { ...base, orderId };
}

function refundRowsFromSnap(snap) {
  return snap.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() || {}
  }));
}

function computeForOrder(refundRows) {
  return computeCustomerRefundAction(refundRows);
}

async function loadRefunds(db, orderRef) {
  const snap = await orderRef.collection('refunds').get();
  return refundRowsFromSnap(snap);
}

async function processOrder(db, orderId, apply) {
  const orderRef = db.collection('marketplaceOrders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) {
    return { orderId, skipped: true, reason: 'missing' };
  }
  const before = orderSnap.data().customerRefundAction ?? null;
  const refundRows = await loadRefunds(db, orderRef);
  const after = computeForOrder(refundRows);
  const changed = before !== after;
  console.log(`order=${orderId} before=${JSON.stringify(before)} after=${JSON.stringify(after)} changed=${changed}`);
  if (apply && changed) {
    await orderRef.update({ customerRefundAction: after });
  }
  return { orderId, before, after, changed, updated: apply && changed };
}

async function scanOrderIds(db, options) {
  if (options.orderId) {
    return [options.orderId];
  }
  const ids = [];
  let lastDoc = null;
  let processed = 0;
  while (true) {
    const pageLimit = options.limit != null
      ? Math.min(PAGE_SIZE, options.limit - processed)
      : PAGE_SIZE;
    if (options.limit != null && pageLimit <= 0) {
      break;
    }
    let query = db.collection('marketplaceOrders').orderBy(FieldPath.documentId()).limit(pageLimit);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    } else if (options.startAfter) {
      const cursor = await db.collection('marketplaceOrders').doc(options.startAfter).get();
      if (cursor.exists) {
        query = query.startAfter(cursor);
      }
    }
    const snap = await query.get();
    if (snap.empty) {
      break;
    }
    snap.docs.forEach((doc) => ids.push(doc.id));
    lastDoc = snap.docs[snap.docs.length - 1];
    processed += snap.size;
    if (snap.size < pageLimit) {
      break;
    }
  }
  return ids;
}

async function runBackfill(db, options) {
  const orderIds = await scanOrderIds(db, options);
  const summary = { scanned: 0, changed: 0, updated: 0, skipped: 0 };
  for (let index = 0; index < orderIds.length; index += 1) {
    const result = await processOrder(db, orderIds[index], options.apply);
    if (result.skipped) {
      summary.skipped += 1;
      continue;
    }
    summary.scanned += 1;
    if (result.changed) {
      summary.changed += 1;
    }
    if (result.updated) {
      summary.updated += 1;
    }
  }
  return summary;
}

async function main() {
  require('dotenv').config();
  const mode = parseArgv(process.argv.slice(2));
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }

  const { assertMigrationEnv, assertMigrationAdmin } = require('./migrationEnv');
  assertMigrationEnv({ confirmProduction: mode.confirmProduction });

  console.log(`projectId: ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`clientEmail: ${process.env.FIREBASE_CLIENT_EMAIL}`);
  console.log(`mode: ${mode.apply ? 'APPLY' : 'DRY RUN'}`);
  if (mode.orderId) {
    console.log(`order: ${mode.orderId}`);
  }

  const { getFirestore } = require('../src/services/firebase');
  const db = getFirestore();
  assertMigrationAdmin({ confirmProduction: mode.confirmProduction });

  const summary = await runBackfill(db, {
    apply: mode.apply,
    orderId: mode.orderId,
    limit: mode.limit,
    startAfter: mode.startAfter
  });
  console.log(`scanned: ${summary.scanned} changed: ${summary.changed} updated: ${summary.updated} skipped: ${summary.skipped}`);
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  parseArgv,
  computeForOrder,
  runBackfill,
  processOrder
};
