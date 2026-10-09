/**
 * Approve the staging marketplace shop (users.shop.approvalStatus + shops.approvedAt).
 *
 * Usage:
 *   node scripts/support/approve-shop.js --shop <id>
 *   node scripts/support/approve-shop.js --shop <id> --apply
 *
 * Dry run is the default. --apply writes only on transition to approved.
 */

require('dotenv').config();

const { FieldValue } = require('firebase-admin/firestore');
const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { assertStagingShopId, planShopApproval } = require('./approveShopActions');

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
  const shopId = argValue('--shop');
  const apply = process.argv.includes('--apply');

  if (!shopId) {
    console.error('Usage: node scripts/support/approve-shop.js --shop <id> [--apply]');
    process.exit(1);
  }

  const lock = assertStagingShopId(shopId);
  if (!lock.ok) {
    console.error(lock.message);
    process.exit(1);
  }

  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  const userRef = db.collection('users').doc(shopId);
  const shopRef = db.collection('shops').doc(shopId);
  const [userSnap, shopSnap] = await Promise.all([userRef.get(), shopRef.get()]);

  if (!userSnap.exists || !shopSnap.exists) {
    console.error(`Shop user or profile not found: ${shopId}`);
    process.exit(1);
  }

  const userData = userSnap.data() || {};
  const shopData = shopSnap.data() || {};
  const shopIdentity = userData.shop && typeof userData.shop === 'object' ? userData.shop : {};
  const approvalStatus = typeof shopIdentity.approvalStatus === 'string' ? shopIdentity.approvalStatus : 'pending';
  const bank = shopData.bank && typeof shopData.bank === 'object' ? shopData.bank : {};

  const plan = planShopApproval({ approvalStatus, bank });
  if (!plan.ok) {
    console.error(plan.message);
    process.exit(1);
  }

  const preview = {
    shopId,
    apply,
    currentApprovalStatus: approvalStatus,
    currentApprovedAt: shopData.approvedAt ? 'set' : null,
    verifiedName: plan.verifiedName || (plan.noop ? 'unchanged' : null),
    noop: plan.noop === true
  };

  if (plan.noop) {
    preview.write = null;
  } else {
    preview.write = {
      'users/{id}.shop.approvalStatus': 'approved',
      'shops/{id}.approvedAt': 'server timestamp'
    };
  }

  console.log(JSON.stringify(preview, null, 2));

  if (!apply || plan.noop) {
    if (!apply) {
      console.log('Dry run. Re-run with --apply to write.');
    } else {
      console.log('Shop is already approved. No writes.');
    }
    return;
  }

  await userRef.update({
    'shop.approvalStatus': 'approved',
    updatedAt: FieldValue.serverTimestamp()
  });
  await shopRef.update({
    approvedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });
  console.log(`Approved shop ${shopId}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
