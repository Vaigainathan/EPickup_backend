/**
 * Staging-only: set shops/{id}.storefront.openingHours for device-testing Customer App labels.
 * Dry run by default. Writes only with --apply. Never changes users/{id}.shop.isOpen.
 *
 *   node scripts/support/set-shop-hours.js --shop b7302f5d6343c1641d63811306eb --show
 *   node scripts/support/set-shop-hours.js --shop b7302f5d6343c1641d63811306eb --all 18:00-02:00
 *   node scripts/support/set-shop-hours.js --shop b7302f5d6343c1641d63811306eb --all 09:00-21:00 [--apply]
 *   node scripts/support/set-shop-hours.js --shop b7302f5d6343c1641d63811306eb --day mon 18:00-02:00 --day sun closed
 *   node scripts/support/set-shop-hours.js --shop b7302f5d6343c1641d63811306eb --clear [--apply]
 *
 * --day with no existing hours: days not listed are set to closed (see stdout note).
 */

require('dotenv').config();

const { FieldValue } = require('firebase-admin/firestore');
const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { openingHoursFromShopProfile } = require('../../src/utils/shopOpeningHours');
const {
  DELETE_FIELD,
  parseSetShopHoursArgv,
  validateArgvPlan,
  buildPlannedOpeningHours,
  buildFirestoreUpdate,
  serializeWritePayload,
  computeMarketplacePreview
} = require('./setShopHoursActions');

assertStagingEnv();

const parsed = parseSetShopHoursArgv(process.argv);
const planCheck = validateArgvPlan(parsed);
if (!planCheck.ok) {
  console.error(planCheck.message);
  process.exit(1);
}

function formatDefaultedDays(days) {
  if (!days.length) {
    return '';
  }
  return days.join(', ');
}

async function main() {
  const apply = parsed.apply && !parsed.show;

  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  const shopRef = db.collection('shops').doc(parsed.shopId);
  const userRef = db.collection('users').doc(parsed.shopId);
  const [shopSnap, userSnap] = await Promise.all([shopRef.get(), userRef.get()]);

  if (!shopSnap.exists) {
    console.error(`Shop not found: ${parsed.shopId}`);
    process.exit(1);
  }
  if (!userSnap.exists) {
    console.error(`User not found for shop: ${parsed.shopId}`);
    process.exit(1);
  }

  const shopProfile = shopSnap.data() || {};
  const userData = userSnap.data() || {};
  const shopIdentity = userData.shop || {};
  const hoursBefore = openingHoursFromShopProfile(shopProfile);
  const now = new Date();

  let plan;
  try {
    plan = buildPlannedOpeningHours(parsed, hoursBefore);
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }

  if (plan.daysDefaultedToClosed.length > 0) {
    const line = `Days not given are set to closed: ${formatDefaultedDays(plan.daysDefaultedToClosed)}`;
    console.log(line);
  }

  const hoursAfter = parsed.show ? hoursBefore : plan.hoursAfter;
  const firestoreUpdate = parsed.show
    ? null
    : buildFirestoreUpdate({ clear: plan.clear, hoursAfter: plan.hoursAfter });

  const previewBefore = computeMarketplacePreview({
    shopIdentity,
    openingHours: hoursBefore,
    now
  });
  const previewAfter = computeMarketplacePreview({
    shopIdentity,
    openingHours: hoursAfter,
    now
  });

  const payload = {
    shopId: parsed.shopId,
    apply,
    applyIgnored: parsed.apply && parsed.show,
    hoursBefore,
    hoursAfter,
    previewBefore,
    previewAfter,
    write: serializeWritePayload(firestoreUpdate)
  };

  console.log(JSON.stringify(payload, null, 2));

  if (parsed.show || !apply) {
    if (!parsed.show && !apply) {
      console.log('Dry run. Re-run with --apply to write.');
    }
    return;
  }

  const update = { ...firestoreUpdate };
  if (update['storefront.openingHours'] === DELETE_FIELD) {
    update['storefront.openingHours'] = FieldValue.delete();
  }
  await shopRef.update(update);
  console.log(`Updated shops/${parsed.shopId}.storefront.openingHours`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
