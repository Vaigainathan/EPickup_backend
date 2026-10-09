/**
 * Read-only MP-14 browse smoke via service layer (no HTTP, no writes).
 *   node scripts/support/mp14-browse-staging-readonly.js
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { STAGING_CUSTOMER_ID } = require('./marketplaceStagingActions');
const customerMarketplaceService = require('../../src/services/customerMarketplaceService');

assertStagingEnv();

async function defaultCoords(db) {
  const user = await db.collection('users').doc(STAGING_CUSTOMER_ID).get();
  const data = user.data() || {};
  const addresses = data.customer && Array.isArray(data.customer.addresses) ? data.customer.addresses : [];
  const def = addresses.find((row) => row && row.isDefault) || addresses[0];
  if (!def) {
    throw new Error('Staging customer has no address');
  }
  const coords = def.coordinates || {};
  const lat = coords.latitude ?? def.lat;
  const lng = coords.longitude ?? def.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Staging default address has no coordinates');
  }
  return { lat, lng };
}

function shopSummary(shops) {
  return shops.map((s) => `${s.id} | ${s.shopName}`);
}

function vaigzzFields(shops) {
  const row = shops.find((s) => /vaigzz/i.test(s.shopName));
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    shopName: row.shopName,
    photoUrlPresent: Boolean(row.photoUrl),
    tagline: row.tagline,
    isOpenNow: row.isOpenNow,
    opensAt: row.opensAt,
    rating: row.rating,
    isNew: row.isNew,
    policyGroup: row.policyGroup
  };
}

async function runCase(label, fn) {
  try {
    const result = await fn();
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify({
      error: true,
      code: error.code || 'ERROR',
      message: error.message
    }, null, 2));
  }
}

async function main() {
  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();
  const origin = await defaultCoords(db);
  const base = { lat: origin.lat, lng: origin.lng };

  await runCase('listShops default', async () => {
    const data = await customerMarketplaceService.listShops({ ...base });
    return { shops: shopSummary(data.shops), vaigzz: vaigzzFields(data.shops) };
  });

  for (const sort of ['distance', 'rating', 'orders']) {
    await runCase(`listShops sort=${sort}`, async () => {
      const data = await customerMarketplaceService.listShops({ ...base, sort });
      return { shops: shopSummary(data.shops) };
    });
  }

  await runCase('listShops openNow=true', async () => {
    const data = await customerMarketplaceService.listShops({ ...base, openNow: 'true' });
    return { shops: shopSummary(data.shops) };
  });

  await runCase('listShops minRating=4', async () => {
    const data = await customerMarketplaceService.listShops({ ...base, minRating: '4' });
    return { shops: shopSummary(data.shops) };
  });

  await runCase('search q=va', async () => {
    const data = await customerMarketplaceService.search({ ...base, q: 'va' });
    return {
      shops: shopSummary(data.shops),
      products: data.products.map((p) => `${p.id} | ${p.name} | ${p.shopId}`),
      vaigzz: vaigzzFields(data.shops)
    };
  });

  await runCase('search q=51 chars', async () => {
    await customerMarketplaceService.search({ ...base, q: 'x'.repeat(51) });
    return { ok: true };
  });

  await runCase('listCategories', async () => {
    const data = await customerMarketplaceService.listCategories(base);
    const active = data.categories.filter((c) => c.shopCount > 0);
    return {
      activeCategories: active.map((c) => `${c.category}: ${c.shopCount}`),
      totalShopsInCategories: active.reduce((sum, c) => sum + c.shopCount, 0)
    };
  });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
