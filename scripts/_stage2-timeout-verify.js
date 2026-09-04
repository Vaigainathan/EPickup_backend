/**
 * Local verification for marketplace payment-timeout cron.
 * Targets epickup-app-staging only. Calls runTick() directly (no 60s wait).
 * Does not deploy to Railway.
 */
require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('./assertStagingFirebase');
assertStagingEnv();

const admin = require('firebase-admin');
const { initializeFirebase, getFirestore } = require('../src/services/firebase');
const shopOrderService = require('../src/services/shopOrderService');
const timeoutJob = require('../src/services/marketplacePaymentTimeoutJob');

const SHOP_A_UID = process.env.STAGING_SHOP_UID || 'b7302f5d6343c1641d63811306eb';
const CUSTOMER_ID = 'stage1testcustomer0000000001';
const DEFAULT_TIMEOUT_MS = 900000;

function fail(message) {
  throw new Error(message);
}

async function ensureMarketplaceSettings(db) {
  const ref = db.collection('appSettings').doc('marketplace');
  const snap = await ref.get();
  if (!snap.exists || !Number(snap.data() && snap.data().PAYMENT_TIMEOUT_MS)) {
    await ref.set({
      PAYMENT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: 'stage2-timeout-verify'
    }, { merge: true });
    console.log('Created appSettings/marketplace with PAYMENT_TIMEOUT_MS=900000');
    return DEFAULT_TIMEOUT_MS;
  }
  const timeoutMs = Number(snap.data().PAYMENT_TIMEOUT_MS);
  console.log(`Using existing appSettings/marketplace.PAYMENT_TIMEOUT_MS=${timeoutMs}`);
  return timeoutMs;
}

async function backdate(db, orderId, createdAt) {
  await db.collection('marketplaceOrders').doc(orderId).update({ createdAt });
}

async function recentPaymentExpired(db, customerId, orderId, sinceMs) {
  const snap = await db.collection('notifications')
    .where('userId', '==', customerId)
    .limit(50)
    .get();
  const since = new Date(sinceMs - 2000);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((n) => {
      const type = (n.data && n.data.type) || n.type || '';
      const forOrder = n.data && n.data.variables && n.data.variables.orderId === orderId;
      const raw = n.createdAt || n.sentAt;
      const created = raw && raw.toDate ? raw.toDate() : raw;
      const inWindow = !created || new Date(created) >= since;
      return String(type).toLowerCase() === 'payment_expired' && forOrder && inWindow;
    });
}

async function waitForTimeoutIndex(db, timeoutMs = 8 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await db.collection('marketplaceOrders')
        .where('payment.status', 'in', ['pending', 'initiated'])
        .where('createdAt', '<', admin.firestore.Timestamp.fromMillis(Date.now()))
        .limit(1)
        .get();
      console.log('payment.status + createdAt index READY');
      return;
    } catch (error) {
      const msg = String(error.message || '');
      if (!msg.includes('FAILED_PRECONDITION')) {
        throw error;
      }
      console.log('Waiting for marketplaceOrders payment.status+createdAt index...');
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  fail('marketplaceOrders payment.status+createdAt index did not become READY in time');
}

async function main() {
  initializeFirebase();
  assertStagingAdmin();
  const db = getFirestore();

  const timeoutMs = await ensureMarketplaceSettings(db);
  await waitForTimeoutIndex(db);
  const oldCreatedAt = admin.firestore.Timestamp.fromMillis(Date.now() - timeoutMs - 60 * 1000);

  const pendingSeed = await shopOrderService.createSeedOrder({
    shopId: SHOP_A_UID,
    customerId: CUSTOMER_ID,
    orderStatus: 'awaiting_payment'
  });
  await backdate(db, pendingSeed.order.id, oldCreatedAt);

  const confirmedSeed = await shopOrderService.createSeedOrder({
    shopId: SHOP_A_UID,
    customerId: CUSTOMER_ID,
    orderStatus: 'preparing'
  });
  await backdate(db, confirmedSeed.order.id, oldCreatedAt);

  const beforePending = await db.collection('marketplaceOrders').doc(pendingSeed.order.id).get();
  const beforeConfirmed = await db.collection('marketplaceOrders').doc(confirmedSeed.order.id).get();
  if ((beforePending.data().payment || {}).status !== 'pending') {
    fail(`pending seed payment.status=${(beforePending.data().payment || {}).status}`);
  }
  if ((beforeConfirmed.data().payment || {}).status !== 'confirmed') {
    fail(`confirmed seed payment.status=${(beforeConfirmed.data().payment || {}).status}`);
  }

  const notifySince = Date.now();
  const tick = await timeoutJob.runTick();
  if (tick.skipped) {
    fail(`tick skipped: ${tick.reason}`);
  }

  const afterPending = await db.collection('marketplaceOrders').doc(pendingSeed.order.id).get();
  const afterConfirmed = await db.collection('marketplaceOrders').doc(confirmedSeed.order.id).get();
  const pendingData = afterPending.data() || {};
  const confirmedData = afterConfirmed.data() || {};

  await new Promise((r) => setTimeout(r, 1500));
  const expiredNotices = await recentPaymentExpired(db, CUSTOMER_ID, pendingSeed.order.id, notifySince);

  const pendingExpired = pendingData.orderStatus === 'cancelled'
    && pendingData.payment
    && pendingData.payment.status === 'expired'
    && Boolean(pendingData.payment.expiredAt)
    && tick.expired.includes(pendingSeed.order.id)
    && expiredNotices.length >= 1;

  const confirmedUntouched = confirmedData.orderStatus === 'preparing'
    && confirmedData.payment
    && confirmedData.payment.status === 'confirmed'
    && !tick.expired.includes(confirmedSeed.order.id);

  console.log(JSON.stringify({
    case: 'old-pending-expires',
    pass: pendingExpired,
    orderId: pendingSeed.order.id,
    orderStatus: pendingData.orderStatus,
    paymentStatus: pendingData.payment && pendingData.payment.status,
    hasExpiredAt: Boolean(pendingData.payment && pendingData.payment.expiredAt),
    notices: expiredNotices.length,
    tickExpiredCount: tick.expired.length,
    timeoutMs: tick.timeoutMs
  }));
  console.log(JSON.stringify({
    case: 'old-confirmed-untouched',
    pass: confirmedUntouched,
    orderId: confirmedSeed.order.id,
    orderStatus: confirmedData.orderStatus,
    paymentStatus: confirmedData.payment && confirmedData.payment.status,
    inExpiredList: tick.expired.includes(confirmedSeed.order.id)
  }));

  if (!pendingExpired) {
    fail('old pending order was not expired with PAYMENT_EXPIRED notification');
  }
  if (!confirmedUntouched) {
    fail('old confirmed order was touched by the timeout cron');
  }

  console.log('PASS  marketplace payment-timeout local verification');
}

main().catch((error) => {
  console.error('FAIL  marketplace payment-timeout verify:', error.message || error);
  if (error.stack) {
    console.error(error.stack.split('\n').slice(0, 8).join('\n'));
  }
  process.exit(1);
});
