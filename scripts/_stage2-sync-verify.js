/**
 * Local verification for marketplaceSyncService against epickup-app-staging.
 * Does not deploy to Railway. Do not commit secrets.
 *
 * Simulates a Console edit: Admin-updates driverInfo on the synthetic booking,
 * then status=delivered, and asserts the listener mirrored onto marketplaceOrders.
 */
require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('./assertStagingFirebase');
assertStagingEnv();

const { initializeFirebase, getFirestore } = require('../src/services/firebase');
const shopOrderService = require('../src/services/shopOrderService');
const marketplaceSyncService = require('../src/services/marketplaceSyncService');

const SHOP_A_UID = process.env.STAGING_SHOP_UID || 'b7302f5d6343c1641d63811306eb';
const CUSTOMER_ID = 'stage1testcustomer0000000001';

function fail(message) {
  throw new Error(message);
}

async function waitFor(label, timeoutMs, check) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await check();
    if (last && last.ok) {
      return last;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  fail(`${label} timed out: ${last && last.detail ? last.detail : 'no match'}`);
}

async function main() {
  initializeFirebase();
  assertStagingAdmin();
  const db = getFirestore();

  marketplaceSyncService.start();

  const seeded = await shopOrderService.createSeedOrder({
    shopId: SHOP_A_UID,
    customerId: CUSTOMER_ID,
    orderStatus: 'awaiting_payment'
  });
  await shopOrderService.confirmPayment(SHOP_A_UID, seeded.order.id);
  const ready = await shopOrderService.markReady(SHOP_A_UID, seeded.order.id);
  if (!ready.order.linkedBookingId) {
    fail('markReady did not set linkedBookingId');
  }

  await new Promise((r) => setTimeout(r, 1500));
  const afterCreate = await db.collection('marketplaceOrders').doc(seeded.order.id).get();
  const afterCreateData = afterCreate.data() || {};
  const pendingIgnored = afterCreateData.orderStatus === 'ready'
    && afterCreateData.driverInfo == null;
  console.log(JSON.stringify({
    case: 'pending-create-ignored',
    pass: pendingIgnored,
    orderStatus: afterCreateData.orderStatus,
    driverInfo: afterCreateData.driverInfo || null,
    linkedBookingId: ready.order.linkedBookingId
  }));
  if (!pendingIgnored) {
    fail('listener raced mark-ready: order was not still ready with null driverInfo');
  }

  const bookingRef = db.collection('bookings').doc(ready.order.linkedBookingId);
  await bookingRef.update({
    driverInfo: {
      name: 'Stage2 Test Driver',
      phone: '+910000000001',
      vehicleNumber: 'TN50TEST1',
      vehicleModel: 'Test Bike'
    },
    updatedAt: new Date()
  });

  const driverMirrored = await waitFor('driverInfo mirror', 15000, async () => {
    const snap = await db.collection('marketplaceOrders').doc(seeded.order.id).get();
    const data = snap.data() || {};
    const info = data.driverInfo || {};
    const ok = data.orderStatus === 'ready'
      && info.name === 'Stage2 Test Driver'
      && info.phone === '+910000000001'
      && info.vehicle === 'TN50TEST1';
    return {
      ok,
      detail: `status=${data.orderStatus} driver=${JSON.stringify(data.driverInfo || null)}`
    };
  });
  console.log(JSON.stringify({
    case: 'driverInfo-mirrored-status-unchanged',
    pass: true,
    detail: driverMirrored.detail
  }));

  await bookingRef.update({
    status: 'delivered',
    updatedAt: new Date()
  });

  const completed = await waitFor('delivered → completed', 15000, async () => {
    const snap = await db.collection('marketplaceOrders').doc(seeded.order.id).get();
    const data = snap.data() || {};
    const ok = data.orderStatus === 'completed'
      && data.driverInfo
      && data.driverInfo.name === 'Stage2 Test Driver';
    return {
      ok,
      detail: `status=${data.orderStatus} driver=${data.driverInfo && data.driverInfo.name}`
    };
  });
  console.log(JSON.stringify({
    case: 'delivered-maps-to-completed',
    pass: true,
    detail: completed.detail
  }));

  marketplaceSyncService.stop();
  console.log('PASS  marketplaceSyncService local listener verification');
}

main().catch((error) => {
  try {
    marketplaceSyncService.stop();
  } catch {
    // ignore
  }
  console.error('FAIL  marketplaceSyncService verify:', error.message || error);
  process.exit(1);
});
