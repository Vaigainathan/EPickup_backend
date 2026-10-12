/**
 * M3: Register existing bookings.displayId and marketplaceOrders.displayId in orderNumbers.
 *
 * Usage:
 *   node scripts/register-order-numbers.js
 *   node scripts/register-order-numbers.js --apply
 *   node scripts/register-order-numbers.js --apply --confirm-production
 *   node scripts/register-order-numbers.js --limit 500 --start-after <docId>
 *   node scripts/register-order-numbers.js --phase marketplaceOrders --start-after <orderId>
 */

const { Timestamp, FieldPath } = require('firebase-admin/firestore');
const { assertMigrationEnv, assertMigrationAdmin, parseMigrationArgv } = require('./migrationEnv');
const {
  COUNTER_COLLECTION,
  COUNTER_DOC,
  REGISTRY_COLLECTION,
  LEGACY_SOURCE,
  normalizeDisplayId,
  planLegacyOrderNumberRegistration
} = require('../src/services/registerLegacyOrderNumbers');

const PAGE_SIZE = 300;
const BATCH_SIZE = 400;
const PHASE_BOOKINGS = 'bookings';
const PHASE_ORDERS = 'marketplaceOrders';

function parseRegisterArgv(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let phase = PHASE_BOOKINGS;
  const filtered = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--phase') {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) {
        return { error: 'Missing --phase bookings|marketplaceOrders' };
      }
      if (value !== PHASE_BOOKINGS && value !== PHASE_ORDERS) {
        return { error: '--phase must be bookings or marketplaceOrders' };
      }
      phase = value;
      i += 1;
    } else {
      filtered.push(args[i]);
    }
  }
  const base = parseMigrationArgv(filtered);
  if (base.error) {
    return base;
  }
  return { ...base, phase };
}

async function paginateCollection(db, collectionName, options) {
  const { startAfter, limit, selectFields, onDoc } = options;
  let lastId = startAfter || null;
  let processed = 0;
  let stoppedEarly = false;

  while (true) {
    const pageLimit = limit != null
      ? Math.min(PAGE_SIZE, limit - processed)
      : PAGE_SIZE;
    if (pageLimit <= 0) {
      stoppedEarly = true;
      break;
    }

    let query = db.collection(collectionName)
      .orderBy(FieldPath.documentId())
      .limit(pageLimit);
    if (selectFields) {
      query = query.select(...selectFields);
    }
    if (lastId) {
      const cursorSnap = await db.collection(collectionName).doc(lastId).get();
      if (cursorSnap.exists) {
        query = query.startAfter(cursorSnap);
      }
    }
    const snapshot = await query.get();
    if (snapshot.empty) {
      break;
    }

    for (const doc of snapshot.docs) {
      onDoc(doc);
      processed += 1;
      lastId = doc.id;
      if (limit != null && processed >= limit) {
        stoppedEarly = true;
        break;
      }
    }

    if (stoppedEarly || snapshot.size < pageLimit) {
      break;
    }
  }

  return { processed, lastProcessedId: lastId, stoppedEarly };
}

function collectClaimsFromDoc(doc, kind, claims) {
  const data = doc.data() || {};
  if (data.displayId != null) {
    claims.push({
      kind,
      refId: doc.id,
      number: data.displayId
    });
  }
}

async function loadRegistryForNumbers(db, numbers) {
  const map = new Map();
  const ids = [...new Set(numbers)];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const refs = chunk.map((n) => db.collection(REGISTRY_COLLECTION).doc(String(n)));
    const snaps = await db.getAll(...refs);
    snaps.forEach((snap) => {
      if (snap.exists) {
        map.set(Number(snap.id), snap.data() || {});
      }
    });
  }
  return map;
}

async function countLegacyRegistry(db) {
  const snap = await db.collection(REGISTRY_COLLECTION)
    .where('source', '==', LEGACY_SOURCE)
    .select()
    .get();
  return snap.size;
}

async function syncLegacyRegisteredOnCounter(db) {
  const legacyRegistered = await countLegacyRegistry(db);
  const counterRef = db.collection(COUNTER_COLLECTION).doc(COUNTER_DOC);
  await counterRef.set({ legacyRegistered }, { merge: true });
  return legacyRegistered;
}

async function applyCreates(db, toCreate) {
  let created = 0;
  let skippedExists = 0;

  for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
    const group = toCreate.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    let batchCount = 0;

    for (const claim of group) {
      const ref = db.collection(REGISTRY_COLLECTION).doc(String(claim.number));
      const snap = await ref.get();
      if (snap.exists) {
        skippedExists += 1;
        continue;
      }
      batch.set(ref, {
        number: claim.number,
        kind: claim.kind,
        refId: claim.refId,
        source: LEGACY_SOURCE,
        createdAt: Timestamp.now()
      });
      batchCount += 1;
    }

    if (batchCount > 0) {
      await batch.commit();
      created += batchCount;
    }
  }

  return { created, skippedExists };
}

async function main() {
  require('dotenv').config();
  const parsed = parseRegisterArgv(process.argv.slice(2));
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }

  const migration = assertMigrationEnv({ confirmProduction: parsed.confirmProduction });
  console.log(`target: ${migration.target}`);
  console.log(`projectId: ${process.env.FIREBASE_PROJECT_ID}`);
  console.log(`mode: ${parsed.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`phase: ${parsed.phase}`);

  const { getFirestore } = require('../src/services/firebase');
  const db = getFirestore();
  assertMigrationAdmin({ confirmProduction: parsed.confirmProduction });

  const claims = [];
  let resumePhase = parsed.phase;
  let lastProcessedId = parsed.startAfter || null;
  let stoppedEarly = false;

  if (parsed.phase === PHASE_BOOKINGS) {
    const bookingScan = await paginateCollection(db, 'bookings', {
      startAfter: parsed.startAfter,
      limit: parsed.limit,
      selectFields: ['displayId'],
      onDoc: (doc) => collectClaimsFromDoc(doc, 'parcel', claims)
    });
    lastProcessedId = bookingScan.lastProcessedId;
    stoppedEarly = bookingScan.stoppedEarly;
    console.log(`progress: bookings processed=${bookingScan.processed} lastId=${lastProcessedId || '(none)'}`);

    if (!stoppedEarly) {
      resumePhase = PHASE_ORDERS;
      const remaining = parsed.limit != null
        ? Math.max(0, parsed.limit - bookingScan.processed)
        : null;
      const orderScan = await paginateCollection(db, 'marketplaceOrders', {
        startAfter: null,
        limit: remaining,
        selectFields: ['displayId'],
        onDoc: (doc) => collectClaimsFromDoc(doc, 'shop_order', claims)
      });
      lastProcessedId = orderScan.lastProcessedId;
      stoppedEarly = orderScan.stoppedEarly;
      console.log(`progress: marketplaceOrders processed=${orderScan.processed} lastId=${lastProcessedId || '(none)'}`);
      if (!stoppedEarly) {
        resumePhase = 'done';
      }
    }
  } else {
    const orderScan = await paginateCollection(db, 'marketplaceOrders', {
      startAfter: parsed.startAfter,
      limit: parsed.limit,
      selectFields: ['displayId'],
      onDoc: (doc) => collectClaimsFromDoc(doc, 'shop_order', claims)
    });
    lastProcessedId = orderScan.lastProcessedId;
    stoppedEarly = orderScan.stoppedEarly;
    console.log(`progress: marketplaceOrders processed=${orderScan.processed} lastId=${lastProcessedId || '(none)'}`);
    if (!stoppedEarly) {
      resumePhase = 'done';
    }
  }

  const numbersForRegistry = claims
    .map((c) => normalizeDisplayId(c.number))
    .filter((n) => n != null);
  const registryByNumber = await loadRegistryForNumbers(db, numbersForRegistry);
  const plan = planLegacyOrderNumberRegistration(claims, registryByNumber);

  const report = {
    resumePhase,
    lastProcessedId,
    scannedClaims: claims.length,
    validNumbers: plan.validNumbers,
    invalidDisplayId: plan.invalidDisplayId.length,
    duplicateGroups: plan.duplicates.length,
    duplicates: plan.duplicates,
    toCreate: plan.toCreate.length,
    alreadyRegistered: plan.alreadyRegistered,
    conflicts: plan.conflicts
  };

  console.log(JSON.stringify(report, null, 2));

  if (plan.duplicates.length > 0) {
    console.error('O15: duplicate displayId claims detected — review before enabling pool');
  }
  if (plan.conflicts.length > 0) {
    console.error('Registry conflicts detected — resolve before apply');
  }

  if (!parsed.apply) {
    if (resumePhase !== 'done') {
      const phaseFlag = resumePhase === PHASE_ORDERS ? ' --phase marketplaceOrders' : '';
      console.log(`Resume: node scripts/register-order-numbers.js${phaseFlag} --start-after ${lastProcessedId}${parsed.limit ? ` --limit ${parsed.limit}` : ''}`);
    }
    process.exit(plan.duplicates.length > 0 || plan.conflicts.length > 0 ? 2 : 0);
  }

  if (plan.conflicts.length > 0) {
    console.error('Refusing --apply: registry conflicts');
    process.exit(1);
  }

  const write = await applyCreates(db, plan.toCreate);
  const legacyRegistered = await syncLegacyRegisteredOnCounter(db);
  console.log(JSON.stringify({
    created: write.created,
    skippedExists: write.skippedExists,
    legacyRegisteredOnCounter: legacyRegistered
  }));

  if (resumePhase !== 'done') {
    const phaseFlag = resumePhase === PHASE_ORDERS ? ' --phase marketplaceOrders' : '';
    console.log(`Partial apply. Re-run scan from: --start-after ${lastProcessedId}${phaseFlag}`);
  }

  process.exit(plan.duplicates.length > 0 ? 2 : 0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  paginateCollection,
  syncLegacyRegisteredOnCounter,
  parseRegisterArgv
};
