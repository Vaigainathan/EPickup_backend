/**
 * Read-only catalogue photo audit (staging only).
 *   node scripts/support/audit-catalogue-photos.js
 *   node scripts/support/audit-catalogue-photos.js --shop <shopId>
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { getFirestore, getStorage } = require('../../src/services/firebase');
const {
  photoSourceForProduct,
  photoSourceForShop,
  pathHashPrefix
} = require('../../src/utils/cataloguePhotoKey');
const {
  classifyFromSource,
  CLASSES
} = require('./lib/cataloguePhotoAudit');

assertStagingEnv();

function parseShopArg(argv) {
  const index = argv.indexOf('--shop');
  if (index < 0) {
    return null;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error('--shop requires a shop id');
  }
  return value.trim();
}

function emptyCounts() {
  const counts = {};
  CLASSES.forEach((key) => {
    counts[key] = 0;
  });
  return counts;
}

function recordIssue(bucket, cls, entry) {
  if (cls === 'PATH_OK' || cls === 'NO_PHOTO') {
    return;
  }
  if (!bucket[cls]) {
    bucket[cls] = [];
  }
  bucket[cls].push(entry);
}

async function objectExists(path) {
  const [exists] = await getStorage().bucket().file(path).exists();
  return exists;
}

async function classifyEntity(source) {
  if (!source) {
    return 'NO_PHOTO';
  }
  if (source.kind === 'path') {
    const exists = await objectExists(source.value);
    return classifyFromSource(source, exists);
  }
  return classifyFromSource(source, null);
}

async function auditProducts(db, shopFilter) {
  const counts = emptyCounts();
  const issues = {};
  let query = db.collection('products');
  if (shopFilter) {
    query = query.where('shopId', '==', shopFilter);
  }
  const snapshot = await query.get();
  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const source = photoSourceForProduct(data);
    const cls = await classifyEntity(source);
    counts[cls] += 1;
    const pathHint = source && source.kind === 'path' ? pathHashPrefix(source.value) : null;
    recordIssue(issues, cls, {
      productId: doc.id,
      shopId: data.shopId || null,
      pathHash: pathHint
    });
  }
  return { counts, issues, total: snapshot.size };
}

async function auditShops(db, shopFilter) {
  const counts = emptyCounts();
  const issues = {};
  if (shopFilter) {
    const snap = await db.collection('shops').doc(shopFilter).get();
    if (!snap.exists) {
      return { counts, issues, total: 0 };
    }
    const profile = snap.data() || {};
    const storefront = profile.storefront || {};
    const source = photoSourceForShop(storefront);
    const cls = await classifyEntity(source);
    counts[cls] += 1;
    const pathHint = source && source.kind === 'path' ? pathHashPrefix(source.value) : null;
    recordIssue(issues, cls, {
      shopId: snap.id,
      pathHash: pathHint
    });
    return { counts, issues, total: 1 };
  }

  const snapshot = await db.collection('shops').get();
  for (const doc of snapshot.docs) {
    const profile = doc.data() || {};
    const storefront = profile.storefront || {};
    const source = photoSourceForShop(storefront);
    const cls = await classifyEntity(source);
    counts[cls] += 1;
    const pathHint = source && source.kind === 'path' ? pathHashPrefix(source.value) : null;
    recordIssue(issues, cls, {
      shopId: doc.id,
      pathHash: pathHint
    });
  }
  return { counts, issues, total: snapshot.size };
}

function printCounts(label, counts, total) {
  console.log(`\n${label} (docs=${total})`);
  CLASSES.forEach((key) => {
    console.log(`  ${key}: ${counts[key]}`);
  });
}

function printIssues(label, issues) {
  const keys = Object.keys(issues).sort();
  if (keys.length === 0) {
    return;
  }
  console.log(`\n${label} issues:`);
  keys.forEach((cls) => {
    console.log(`  ${cls}:`);
    issues[cls].forEach((row) => {
      console.log(`    ${JSON.stringify(row)}`);
    });
  });
}

async function main() {
  const shopFilter = parseShopArg(process.argv.slice(2));
  getFirestore();
  assertStagingAdmin();
  const db = getFirestore();

  const products = await auditProducts(db, shopFilter);
  const shops = await auditShops(db, shopFilter);

  printCounts('Products', products.counts, products.total);
  printCounts('Shops', shops.counts, shops.total);
  printIssues('Product', products.issues);
  printIssues('Shop', shops.issues);
}

main().catch((error) => {
  console.error('❌ audit-catalogue-photos failed:', error.message);
  process.exit(1);
});
