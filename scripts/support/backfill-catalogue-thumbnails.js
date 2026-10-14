/**
 * Backfill catalogue thumbnails (staging only).
 * Dry-run by default; writes only with --apply (operator).
 *
 *   node scripts/support/backfill-catalogue-thumbnails.js
 *   node scripts/support/backfill-catalogue-thumbnails.js --shop <shopId> --limit 20
 *   node scripts/support/backfill-catalogue-thumbnails.js --apply
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { getFirestore, getStorage } = require('../../src/services/firebase');
const { thumbPathForOriginal } = require('../../src/utils/catalogueThumbPath');
const { generateCatalogueThumbBuffer } = require('../../src/services/catalogueThumbnail');
const { parseBackfillArgv } = require('./lib/backfillCatalogueThumbnailsArgs');

assertStagingEnv();

async function objectExists(path) {
  const [exists] = await getStorage().bucket().file(path).exists();
  return exists;
}

async function downloadBuffer(path) {
  const [buffer] = await getStorage().bucket().file(path).download();
  return buffer;
}

async function uploadThumb(path, buffer) {
  await getStorage().bucket().file(path).save(buffer, {
    metadata: {
      contentType: 'image/jpeg',
      customMetadata: {
        uploadedAt: new Date().toISOString(),
        uploadedBy: 'backfill-catalogue-thumbnails'
      }
    }
  });
}

async function collectProductCandidates(db, shopId, limit) {
  let query = db.collection('products');
  if (shopId) {
    query = query.where('shopId', '==', shopId);
  }
  const snapshot = await query.get();
  const candidates = [];
  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const photoFilePath = typeof data.photoFilePath === 'string' ? data.photoFilePath.trim() : '';
    if (!photoFilePath) {
      continue;
    }
    const thumbFilePath = thumbPathForOriginal(photoFilePath);
    if (await objectExists(thumbFilePath)) {
      continue;
    }
    candidates.push({
      kind: 'product',
      id: doc.id,
      shopId: data.shopId,
      originalPath: photoFilePath,
      thumbPath: thumbFilePath,
      ref: doc.ref
    });
    if (candidates.length >= limit) {
      break;
    }
  }
  return candidates;
}

async function collectStorefrontCandidates(db, shopId, limit) {
  let snapshot;
  if (shopId) {
    const doc = await db.collection('shops').doc(shopId).get();
    snapshot = { docs: doc.exists ? [doc] : [] };
  } else {
    snapshot = await db.collection('shops').get();
  }
  const candidates = [];
  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const storefront = data.storefront || {};
    const photoPath = typeof storefront.photoPath === 'string' ? storefront.photoPath.trim() : '';
    if (!photoPath) {
      continue;
    }
    const thumbPath = thumbPathForOriginal(photoPath);
    if (await objectExists(thumbPath)) {
      continue;
    }
    candidates.push({
      kind: 'storefront',
      id: doc.id,
      shopId: doc.id,
      originalPath: photoPath,
      thumbPath,
      ref: doc.ref
    });
    if (candidates.length >= limit) {
      break;
    }
  }
  return candidates;
}

async function runBackfill(options) {
  getFirestore();
  assertStagingAdmin();
  const db = getFirestore();

  const remaining = options.limit;
  const plan = [];

  if (options.includeProducts && remaining > 0) {
    const products = await collectProductCandidates(db, options.shopId, remaining);
    plan.push(...products);
  }

  const slotsLeft = Math.max(0, options.limit - plan.length);
  if (options.includeStorefronts && slotsLeft > 0) {
    const storefronts = await collectStorefrontCandidates(db, options.shopId, slotsLeft);
    plan.push(...storefronts);
  }

  console.log(`Mode: ${options.apply ? 'APPLY' : 'dry-run'}`);
  console.log(`Candidates: ${plan.length}`);

  for (const row of plan) {
    console.log(
      `[${row.kind}] ${row.id} original=${row.originalPath} thumb=${row.thumbPath}`
    );
    if (!options.apply) {
      continue;
    }
    const originalBuffer = await downloadBuffer(row.originalPath);
    const thumbBuffer = await generateCatalogueThumbBuffer(originalBuffer);
    await uploadThumb(row.thumbPath, thumbBuffer);
    if (row.kind === 'product') {
      await row.ref.update({ thumbFilePath: row.thumbPath });
    } else {
      await row.ref.update({ 'storefront.thumbPath': row.thumbPath });
    }
    console.log(`  applied thumb for ${row.kind} ${row.id}`);
  }

  return { count: plan.length };
}

async function main() {
  const options = parseBackfillArgv(process.argv.slice(2));
  await runBackfill(options);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ backfill-catalogue-thumbnails failed:', error.message);
    process.exit(1);
  });
}

module.exports = {
  parseBackfillArgv,
  runBackfill
};
