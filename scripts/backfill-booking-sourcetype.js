/**
 * Backfill bookings.sourceType = 'parcel' where the field is missing.
 *
 * Usage:
 *   node scripts/backfill-booking-sourcetype.js            (dry run)
 *   node scripts/backfill-booking-sourcetype.js --apply    (writes)
 *   node scripts/backfill-booking-sourcetype.js --apply --confirm-production
 *   node scripts/backfill-booking-sourcetype.js --limit 500 --start-after <bookingId>
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
  const { parseMigrationArgv } = require('./migrationEnv');
  const parsed = parseMigrationArgv(argv.slice(2));
  if (parsed.error) {
    return parsed;
  }
  return parsed;
}

async function scanBookings(db, options = {}) {
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
  let processed = 0;
  let stoppedEarly = false;
  const startAfterId = options.startAfter || null;
  const limit = options.limit;

  while (true) {
    const pageLimit = limit != null
      ? Math.min(PAGE_SIZE, limit - processed)
      : PAGE_SIZE;
    if (limit != null && pageLimit <= 0) {
      stoppedEarly = true;
      break;
    }

    let query = db.collection('bookings').orderBy(FieldPath.documentId()).limit(pageLimit);
    if (lastDoc) {
      query = query.startAfter(lastDoc);
    } else if (startAfterId) {
      const cursorSnap = await db.collection('bookings').doc(startAfterId).get();
      if (cursorSnap.exists) {
        query = query.startAfter(cursorSnap);
      }
    }
    const snapshot = await query.get();
    if (snapshot.empty) {
      break;
    }

    snapshot.docs.forEach((doc) => {
      const data = doc.data() || {};
      const kind = classifyBookingSourceType(data);
      counts.total += 1;
      processed += 1;
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
      lastDoc = doc;
    });

    if (limit != null && processed >= limit) {
      stoppedEarly = true;
      break;
    }
    if (snapshot.size < pageLimit) {
      break;
    }
  }

  return {
    counts,
    missingDocs,
    lastProcessedId: lastDoc ? lastDoc.id : startAfterId,
    stoppedEarly
  };
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

function printReport(apply, counts, writeResult, progress) {
  console.log(`total scanned: ${counts.total}`);
  console.log(`parcel: ${counts.parcel}`);
  console.log(`marketplace: ${counts.marketplace}`);
  console.log(`missing: ${counts.missing}`);
  console.log(`other: ${counts.other.length}`);
  counts.other.forEach((entry) => {
    console.log(`  id=${entry.id} value=${formatValue(entry.value)}`);
  });
  if (progress) {
    console.log(`progress: lastId=${progress.lastProcessedId || '(none)'} stoppedEarly=${progress.stoppedEarly}`);
  }
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
  const { assertMigrationEnv, assertMigrationAdmin } = require('./migrationEnv');
  const mode = parseMode(process.argv);
  if (mode.error) {
    console.error(mode.error);
    process.exit(1);
  }

  assertMigrationEnv({ confirmProduction: mode.confirmProduction });

  console.log(`projectId: ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`clientEmail: ${process.env.FIREBASE_CLIENT_EMAIL}`);
  console.log(`mode: ${mode.apply ? 'APPLY' : 'DRY RUN'}`);

  const { getFirestore } = require('../src/services/firebase');
  const db = getFirestore();
  assertMigrationAdmin({ confirmProduction: mode.confirmProduction });

  const scan = await scanBookings(db, {
    startAfter: mode.startAfter,
    limit: mode.limit
  });
  const writeResult = mode.apply
    ? await applyMissing(db, scan.missingDocs)
    : { updated: 0, skipped: 0, failed: [] };

  printReport(mode.apply, scan.counts, writeResult, {
    lastProcessedId: scan.lastProcessedId,
    stoppedEarly: scan.stoppedEarly
  });

  if (scan.stoppedEarly) {
    console.log(`Resume: node scripts/backfill-booking-sourcetype.js --start-after ${scan.lastProcessedId}${mode.limit ? ` --limit ${mode.limit}` : ''}`);
  }

  process.exit(writeResult.failed.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  classifyBookingSourceType,
  scanBookings
};
