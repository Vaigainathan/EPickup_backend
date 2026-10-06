/**
 * Backfill bookings.sourceType = 'parcel' where the field is missing.
 *
 * Usage:
 *   node scripts/backfill-booking-sourcetype.js            (dry run)
 *   node scripts/backfill-booking-sourcetype.js --apply    (writes)
 */

const PAGE_SIZE = 300;
const BATCH_SIZE = 400;

function classifyBookingSourceType(data) {
  if (!data || typeof data !== 'object' || !Object.prototype.hasOwnProperty.call(data, 'sourceType')) {
    return 'missing';
  }
  const value = data.sourceType;
  if (value === null || value === '') {
    return 'missing';
  }
  if (value === 'parcel') {
    return 'parcel';
  }
  if (value === 'marketplace') {
    return 'marketplace';
  }
  return 'other';
}

function isPreconditionFailure(error) {
  const code = error && error.code;
  if (code === 9 || code === '9' || code === 'failed-precondition' || code === 'FAILED_PRECONDITION') {
    return true;
  }
  const message = error && error.message ? String(error.message) : '';
  return /FAILED_PRECONDITION|failed-precondition/i.test(message);
}

function formatValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseMode(argv) {
  const args = argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--apply');
  if (unknown.length > 0) {
    return { error: `Unknown flag: ${unknown.join(' ')}` };
  }
  return { apply: args.includes('--apply') };
}

async function scanBookings(db) {
  const { FieldPath } = require('firebase-admin/firestore');
  const counts = {
    total: 0,
    parcel: 0,
    marketplace: 0,
    missing: 0,
    other: []
  };
  const missingDocs = [];
  let lastDoc = null;

  while (true) {
    let query = db.collection('bookings').orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }
    const snapshot = await query.get();
    if (snapshot.empty) {
      break;
    }

    snapshot.docs.forEach((doc) => {
      const data = doc.data() || {};
      const kind = classifyBookingSourceType(data);
      counts.total += 1;
      if (kind === 'other') {
        counts.other.push({ id: doc.id, value: data.sourceType });
      } else {
        counts[kind] += 1;
      }
      if (kind === 'missing') {
        missingDocs.push({
          id: doc.id,
          ref: doc.ref,
          updateTime: doc.updateTime
        });
      }
    });

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) {
      break;
    }
  }

  return { counts, missingDocs };
}

async function updateOne(db, id) {
  const ref = db.collection('bookings').doc(id);
  const fresh = await ref.get();
  if (!fresh.exists || classifyBookingSourceType(fresh.data() || {}) !== 'missing') {
    return { status: 'skipped' };
  }
  if (!fresh.updateTime) {
    return { status: 'failed', message: 'Document has no updateTime' };
  }
  try {
    await ref.update({ sourceType: 'parcel' }, { lastUpdateTime: fresh.updateTime });
    return { status: 'updated' };
  } catch (error) {
    if (isPreconditionFailure(error)) {
      return { status: 'skipped' };
    }
    return { status: 'failed', message: error.message || String(error) };
  }
}

async function applyMissing(db, missingDocs) {
  const result = {
    updated: 0,
    skipped: 0,
    failed: []
  };

  for (let index = 0; index < missingDocs.length; index += BATCH_SIZE) {
    const group = missingDocs.slice(index, index + BATCH_SIZE);
    const ready = [];
    group.forEach((doc) => {
      if (!doc.updateTime) {
        result.failed.push({ id: doc.id, message: 'Document has no updateTime' });
      } else {
        ready.push(doc);
      }
    });
    if (ready.length === 0) {
      continue;
    }

    const batch = db.batch();
    ready.forEach((doc) => {
      batch.update(doc.ref, { sourceType: 'parcel' }, { lastUpdateTime: doc.updateTime });
    });

    try {
      await batch.commit();
      result.updated += ready.length;
    } catch (error) {
      if (!isPreconditionFailure(error)) {
        const message = error.message || String(error);
        ready.forEach((doc) => {
          result.failed.push({ id: doc.id, message });
        });
        continue;
      }

      for (const doc of ready) {
        const outcome = await updateOne(db, doc.id);
        if (outcome.status === 'updated') {
          result.updated += 1;
        } else if (outcome.status === 'skipped') {
          result.skipped += 1;
        } else {
          result.failed.push({ id: doc.id, message: outcome.message });
        }
      }
    }
  }

  return result;
}

function printReport(apply, counts, writeResult) {
  console.log(`total scanned: ${counts.total}`);
  console.log(`parcel: ${counts.parcel}`);
  console.log(`marketplace: ${counts.marketplace}`);
  console.log(`missing: ${counts.missing}`);
  console.log(`other: ${counts.other.length}`);
  counts.other.forEach((entry) => {
    console.log(`  id=${entry.id} value=${formatValue(entry.value)}`);
  });
  if (apply) {
    console.log(`updated: ${writeResult.updated}`);
    console.log(`skipped (changed): ${writeResult.skipped}`);
    console.log(`failed: ${writeResult.failed.length}`);
    writeResult.failed.forEach((entry) => {
      console.log(`  id=${entry.id} error=${entry.message}`);
    });
  }
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

  const { counts, missingDocs } = await scanBookings(db);
  const writeResult = mode.apply
    ? await applyMissing(db, missingDocs)
    : { updated: 0, skipped: 0, failed: [] };

  printReport(mode.apply, counts, writeResult);
  process.exit(writeResult.failed.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  classifyBookingSourceType
};
