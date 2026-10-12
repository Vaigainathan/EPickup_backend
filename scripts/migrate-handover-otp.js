/**
 * M8 / M-B90: Copy legacy marketplaceOrders.handoverOtp to private/handover.
 *
 * Usage:
 *   node scripts/migrate-handover-otp.js
 *   node scripts/migrate-handover-otp.js --apply
 *   node scripts/migrate-handover-otp.js --apply --strip-legacy
 *   node scripts/migrate-handover-otp.js --limit 200 --start-after <orderId>
 */

const { FieldPath, FieldValue } = require('firebase-admin/firestore');
const { assertMigrationEnv, assertMigrationAdmin, parseMigrationArgv } = require('./migrationEnv');
const {
  planHandoverOtpMigration,
  summarizeHandoverPlans
} = require('../src/services/migrateHandoverOtp');

const PAGE_SIZE = 200;
const BATCH_SIZE = 200;

async function main() {
  require('dotenv').config();
  const parsed = parseMigrationArgv(process.argv.slice(2));
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }

  const migration = assertMigrationEnv({ confirmProduction: parsed.confirmProduction });
  console.log(`target: ${migration.target}`);
  console.log(`projectId: ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`mode: ${parsed.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`stripLegacy: ${parsed.stripLegacy ? 'yes' : 'no'}`);

  const { getFirestore } = require('../src/services/firebase');
  const db = getFirestore();
  assertMigrationAdmin({ confirmProduction: parsed.confirmProduction });

  const plans = [];
  let processed = 0;
  let lastId = parsed.startAfter || null;
  let stoppedEarly = false;

  while (true) {
    const pageLimit = parsed.limit != null
      ? Math.min(PAGE_SIZE, parsed.limit - processed)
      : PAGE_SIZE;
    if (parsed.limit != null && pageLimit <= 0) {
      stoppedEarly = true;
      break;
    }

    let query = db.collection('marketplaceOrders')
      .orderBy(FieldPath.documentId())
      .limit(pageLimit);
    if (lastId) {
      const cursorSnap = await db.collection('marketplaceOrders').doc(lastId).get();
      if (cursorSnap.exists) {
        query = query.startAfter(cursorSnap);
      }
    }
    const snapshot = await query.get();
    if (snapshot.empty) {
      break;
    }

    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      const privateSnap = await doc.ref.collection('private').doc('handover').get();
      const privateData = privateSnap.exists ? (privateSnap.data() || {}) : null;
      const plan = planHandoverOtpMigration(data, privateData, { stripLegacy: parsed.stripLegacy });
      plans.push({
        orderId: doc.id,
        ...plan
      });
      processed += 1;
      lastId = doc.id;
      if (parsed.limit != null && processed >= parsed.limit) {
        stoppedEarly = true;
        break;
      }
    }

    if (stoppedEarly || snapshot.size < pageLimit) {
      break;
    }
  }

  const summary = summarizeHandoverPlans(plans);
  summary.lastProcessedId = lastId;
  summary.stoppedEarly = stoppedEarly;
  console.log(JSON.stringify(summary, null, 2));
  console.log(`progress: processed=${processed} lastId=${lastId || '(none)'}`);

  if (!parsed.apply) {
    if (stoppedEarly) {
      console.log(`Resume: node scripts/migrate-handover-otp.js --start-after ${lastId}${parsed.limit ? ` --limit ${parsed.limit}` : ''}`);
    }
    return;
  }

  let written = 0;
  const pending = plans.filter((row) => row.action !== 'skip');

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const group = pending.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    group.forEach((row) => {
      const ref = db.collection('marketplaceOrders').doc(row.orderId);
      const handoverRef = ref.collection('private').doc('handover');
      if (row.action === 'copy' || row.action === 'copy_and_strip') {
        batch.set(handoverRef, { otp: row.otp }, { merge: true });
      }
      if (row.action === 'copy_and_strip' || row.action === 'strip_legacy') {
        batch.update(ref, { handoverOtp: FieldValue.delete() });
      }
    });
    await batch.commit();
    written += group.length;
  }

  console.log(JSON.stringify({ written }));
  if (stoppedEarly) {
    console.log(`Resume: node scripts/migrate-handover-otp.js --apply --start-after ${lastId}${parsed.stripLegacy ? ' --strip-legacy' : ''}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
