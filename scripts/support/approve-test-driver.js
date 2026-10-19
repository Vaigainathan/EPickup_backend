/**
 * Staging-only: verify present driver documents and approve via verificationService.
 * Optional wallet top-up via walletService.setSupportTestPointsBalance.
 *
 *   node scripts/support/approve-test-driver.js --driver <uid>
 *   node scripts/support/approve-test-driver.js --driver <uid> --points 500
 *   node scripts/support/approve-test-driver.js --driver <uid> --points 500 --apply
 *
 * Dry run is the default.
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const {
  parseApproveTestDriverArgv,
  validateApproveTestDriverArgv,
  buildApprovalPreview,
  SUPPORT_SCRIPT_ID,
  VERIFY_COMMENTS,
  USAGE
} = require('./approveTestDriverActions');

assertStagingEnv();

async function loadWalletSnapshot(db, driverId) {
  const walletDoc = await db.collection('driverPointsWallets').doc(driverId).get();
  if (!walletDoc.exists) {
    return { exists: false, pointsBalance: null };
  }
  const data = walletDoc.data() || {};
  return {
    exists: true,
    pointsBalance: Number(data.pointsBalance || 0)
  };
}

async function main() {
  const parsed = parseApproveTestDriverArgv();
  const validation = validateApproveTestDriverArgv(parsed);
  if (!validation.ok) {
    console.error(validation.message);
    process.exit(1);
  }

  const { driverId, points, apply } = parsed;

  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  const userRef = db.collection('users').doc(driverId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    console.error(`Driver user not found: ${driverId}`);
    process.exit(1);
  }

  const userData = userSnap.data() || {};
  const walletSnapshot = await loadWalletSnapshot(db, driverId);

  const preview = buildApprovalPreview({
    driverId,
    apply,
    userData,
    walletSnapshot,
    points
  });

  if (!preview.ok) {
    console.error(preview.message);
    process.exit(1);
  }

  console.log(JSON.stringify(preview, null, 2));

  if (!apply) {
    console.log('Dry run. Re-run with --apply to write.');
    return;
  }

  if (preview.noop) {
    console.log('No writes needed.');
    return;
  }

  const verificationService = require('../../src/services/verificationService');
  const walletService = require('../../src/services/walletService');

  for (const item of preview.actions.verifyDocuments) {
    const result = await verificationService.verifyDriverDocument(
      driverId,
      item.documentType,
      'verified',
      VERIFY_COMMENTS,
      null,
      SUPPORT_SCRIPT_ID
    );
    if (!result.success) {
      console.error(`verifyDriverDocument failed for ${item.documentType}: ${result.error || 'unknown error'}`);
      process.exit(1);
    }
  }

  if (preview.actions.approveDriver) {
    const approveResult = await verificationService.approveDriver(
      driverId,
      VERIFY_COMMENTS,
      SUPPORT_SCRIPT_ID
    );
    if (!approveResult.success) {
      console.error(`approveDriver failed: ${approveResult.error || 'unknown error'}`);
      process.exit(1);
    }
  }

  if (preview.actions.walletTopUp) {
    const walletResult = await walletService.setSupportTestPointsBalance(driverId, points, {
      reason: 'support/test top-up',
      script: 'approve-test-driver'
    });
    if (!walletResult.success) {
      console.error(`setSupportTestPointsBalance failed: ${walletResult.error || 'unknown error'}`);
      process.exit(1);
    }
  }

  const afterUser = (await userRef.get()).data() || {};
  const afterWallet = await loadWalletSnapshot(db, driverId);
  const afterPreview = buildApprovalPreview({
    driverId,
    apply: true,
    userData: afterUser,
    walletSnapshot: afterWallet,
    points
  });

  console.log(JSON.stringify({ applied: true, after: afterPreview.after }, null, 2));
  console.log(`Approved test driver ${driverId}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
