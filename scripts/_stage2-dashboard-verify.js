/**
 * Local verification for dashboard stats + hasInProgressOrders.
 * epickup-app-staging only. Does not call deactivate() on the live shop.
 * Uses before/after deltas so leftover staging orders cannot fail the check.
 */
require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('./assertStagingFirebase');
assertStagingEnv();

const admin = require('firebase-admin');
const { initializeFirebase, getFirestore } = require('../src/services/firebase');
const shopOrderService = require('../src/services/shopOrderService');
const shopDashboardService = require('../src/services/shopDashboardService');
const shopSettingsService = require('../src/services/shopSettingsService');

const SHOP_A_UID = process.env.STAGING_SHOP_UID || 'b7302f5d6343c1641d63811306eb';
const CUSTOMER_ID = 'stage1testcustomer0000000001';

function fail(message) {
  throw new Error(message);
}

function delta(after, before) {
  return {
    todayEarnings: after.todayEarnings - before.todayEarnings,
    totalOrders: after.totalOrders - before.totalOrders,
    awaitingPayment: after.awaitingPayment - before.awaitingPayment,
    preparing: after.preparing - before.preparing,
    ready: after.ready - before.ready
  };
}

async function main() {
  initializeFirebase();
  assertStagingAdmin();
  const db = getFirestore();

  const beforeStats = await shopDashboardService.getStats(SHOP_A_UID);
  const beforeInProgress = await shopSettingsService.hasInProgressOrders(SHOP_A_UID);

  const awaiting = await shopOrderService.createSeedOrder({
    shopId: SHOP_A_UID,
    customerId: CUSTOMER_ID,
    orderStatus: 'awaiting_payment'
  });
  const preparing = await shopOrderService.createSeedOrder({
    shopId: SHOP_A_UID,
    customerId: CUSTOMER_ID,
    orderStatus: 'preparing'
  });
  const ready = await shopOrderService.createSeedOrder({
    shopId: SHOP_A_UID,
    customerId: CUSTOMER_ID,
    orderStatus: 'ready'
  });

  await db.collection('marketplaceOrders').doc(ready.order.id).update({
    'payment.confirmedAt': admin.firestore.Timestamp.fromMillis(Date.now() - 36 * 60 * 60 * 1000)
  });

  const afterSeedStats = await shopDashboardService.getStats(SHOP_A_UID);
  const afterSeedInProgress = await shopSettingsService.hasInProgressOrders(SHOP_A_UID);
  const seededDelta = delta(afterSeedStats, beforeStats);

  const statsPass = seededDelta.awaitingPayment === 1
    && seededDelta.preparing === 1
    && seededDelta.ready === 1
    && seededDelta.totalOrders === 3
    && seededDelta.todayEarnings === 250
    && afterSeedStats.totalOrders > 0;

  console.log(JSON.stringify({
    case: 'getStats-delta-after-seeds',
    pass: statsPass,
    before: beforeStats,
    after: afterSeedStats,
    delta: seededDelta,
    awaitingId: awaiting.order.id,
    preparingId: preparing.order.id,
    readyId: ready.order.id
  }));
  if (!statsPass) {
    fail('getStats deltas did not match the three seeded orders / todayEarnings 250');
  }

  const inProgressAfterSeedPass = afterSeedInProgress === true;
  console.log(JSON.stringify({
    case: 'hasInProgress-true-after-seeds',
    pass: inProgressAfterSeedPass,
    beforeInProgress,
    afterSeedInProgress
  }));
  if (!inProgressAfterSeedPass) {
    fail('hasInProgressOrders was false after seeding preparing+ready');
  }

  await db.collection('marketplaceOrders').doc(ready.order.id).update({
    orderStatus: 'cancelled',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  const afterReadyCancelStats = await shopDashboardService.getStats(SHOP_A_UID);
  const afterReadyCancelInProgress = await shopSettingsService.hasInProgressOrders(SHOP_A_UID);
  const readyCancelDelta = delta(afterReadyCancelStats, afterSeedStats);
  const readyCancelPass = readyCancelDelta.ready === -1
    && afterReadyCancelInProgress === true;
  console.log(JSON.stringify({
    case: 'ready-cancelled-still-in-progress-via-preparing',
    pass: readyCancelPass,
    readyDelta: readyCancelDelta.ready,
    afterReadyCancelInProgress
  }));
  if (!readyCancelPass) {
    fail('cancelling ready should drop ready count by 1 and leave hasInProgress true (preparing remains)');
  }

  await db.collection('marketplaceOrders').doc(preparing.order.id).update({
    orderStatus: 'cancelled',
    'payment.status': 'refund_pending',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  const afterBothCancelStats = await shopDashboardService.getStats(SHOP_A_UID);
  const afterBothCancelInProgress = await shopSettingsService.hasInProgressOrders(SHOP_A_UID);
  const bothCancelDelta = delta(afterBothCancelStats, afterReadyCancelStats);
  const restoredInProgress = afterBothCancelInProgress === beforeInProgress;
  const preparingCancelPass = bothCancelDelta.preparing === -1
    && bothCancelDelta.todayEarnings === -250
    && restoredInProgress;

  console.log(JSON.stringify({
    case: 'preparing-cancelled-inprogress-matches-before',
    pass: preparingCancelPass,
    preparingDelta: bothCancelDelta.preparing,
    earningsDelta: bothCancelDelta.todayEarnings,
    beforeInProgress,
    afterBothCancelInProgress
  }));
  if (!preparingCancelPass) {
    fail('after cancelling this run\'s in-progress seeds, hasInProgress should match the before snapshot');
  }

  console.log('PASS  dashboard stats + hasInProgressOrders local verification');
}

main().catch((error) => {
  console.error('FAIL  dashboard verify:', error.message || error);
  process.exit(1);
});
