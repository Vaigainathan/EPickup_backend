/**
 * Deactivate the staging test shop (dry run by default).
 * Not part of normal Vaigzz staging flows. Use --undo to reactivate.
 *
 *   node scripts/support/suspend-shop.js --shop <id> --reason <text> --operator <id>
 *   node scripts/support/suspend-shop.js --shop <id> --undo --apply
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { STAGING_SHOP_ID } = require('./marketplaceStagingActions');

assertStagingEnv();

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  const next = process.argv[index + 1];
  if (!next || next.startsWith('--')) {
    return '';
  }
  return next;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const undo = process.argv.includes('--undo');
  const shopId = argValue('--shop');
  const reason = argValue('--reason');
  const operator = argValue('--operator');
  if (!shopId) {
    console.error('Usage: suspend-shop.js --shop <id> [--reason text] [--operator id] [--undo] [--apply]');
    process.exit(1);
  }
  if (shopId !== STAGING_SHOP_ID) {
    console.error(`This script only runs for staging shop ${STAGING_SHOP_ID}.`);
    process.exit(1);
  }

  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();
  const userRef = db.collection('users').doc(shopId);
  const snap = await userRef.get();
  if (!snap.exists) {
    console.error('Shop user not found.');
    process.exit(1);
  }
  const data = snap.data() || {};

  if (!apply) {
    console.log(JSON.stringify({
      dryRun: true,
      shopId,
      undo,
      isActive: data.isActive !== false,
      would: undo ? 'set isActive true, shop.isOpen true' : 'deactivate via shopSettingsService'
    }, null, 2));
    return;
  }

  const adminShopService = require('../../src/services/admin/adminShopService');

  if (undo) {
    const result = await adminShopService.unsuspend(shopId, operator || 'script');
    console.log(JSON.stringify({ applied: true, shopId, reactivated: true, result }, null, 2));
    return;
  }

  if (!reason || !operator) {
    console.error('--reason and --operator are required to suspend (without --undo).');
    process.exit(1);
  }

  const result = await adminShopService.suspend(shopId, { reason, operator });
  console.log(JSON.stringify({ applied: true, shopId, reason, operator, result }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
