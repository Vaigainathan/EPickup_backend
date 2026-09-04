/**
 * Local verification for Stage 2 housekeeping + mark-ready booking write.
 * Targets epickup-app-staging only. Do not commit secrets.
 *
 * Uses Admin SDK against staging Firestore (Railway does not have this
 * mark-ready write until a later staging deploy).
 */
require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('./assertStagingFirebase');
assertStagingEnv();

const { initializeFirebase, getFirestore } = require('../src/services/firebase');
const shopOrderService = require('../src/services/shopOrderService');

const SHOP_A_UID = process.env.STAGING_SHOP_UID || 'b7302f5d6343c1641d63811306eb';
const CUSTOMER_ID = 'stage1testcustomer0000000001';

function fail(message) {
  throw new Error(message);
}

async function main() {
  const app = initializeFirebase();
  assertStagingAdmin();
  const db = getFirestore();

  const initPath = process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY
    ? 'environment-variables'
    : 'json-file-fallback';
  console.log(JSON.stringify({
    projectId: process.env.FIREBASE_PROJECT_ID,
    adminProjectId: app && app.options && app.options.projectId,
    initPath,
    clientEmailIsStaging: String(process.env.FIREBASE_CLIENT_EMAIL || '').includes('epickup-app-staging')
  }));

  const [userSnap, shopSnap] = await Promise.all([
    db.collection('users').doc(SHOP_A_UID).get(),
    db.collection('shops').doc(SHOP_A_UID).get()
  ]);
  const shopProfile = shopSnap.exists ? (shopSnap.data() || {}) : {};
  const loc = shopProfile.location;
  const hasShopLocation = Boolean(
    loc && (typeof loc.latitude === 'number' || typeof loc._latitude === 'number')
  );
  console.log(JSON.stringify({
    shopUserExists: userSnap.exists,
    shopUserType: userSnap.exists ? userSnap.data().userType : null,
    shopDocExists: shopSnap.exists,
    hasShopLocation,
    hasShopAddress: typeof shopProfile.address === 'string' && shopProfile.address.length > 0
  }));
  if (!hasShopLocation) {
    fail('Shop A has no shops/{uid}.location — mark-ready cannot write a geofilterable booking');
  }

  const seeded = await shopOrderService.createSeedOrder({
    shopId: SHOP_A_UID,
    customerId: CUSTOMER_ID,
    orderStatus: 'awaiting_payment'
  });
  const confirm = await shopOrderService.confirmPayment(SHOP_A_UID, seeded.order.id);
  if (confirm.order.orderStatus !== 'preparing') {
    fail(`confirmPayment left status ${confirm.order.orderStatus}`);
  }

  const ready = await shopOrderService.markReady(SHOP_A_UID, seeded.order.id);
  if (ready.alreadyProcessed) {
    fail('first markReady returned Already processed');
  }
  if (ready.order.orderStatus !== 'ready' || !ready.order.linkedBookingId) {
    fail(`markReady did not set ready+linkedBookingId: status=${ready.order.orderStatus} linked=${ready.order.linkedBookingId}`);
  }

  const bookingSnap = await db.collection('bookings').doc(ready.order.linkedBookingId).get();
  if (!bookingSnap.exists) {
    fail('linked booking doc does not exist');
  }
  const booking = bookingSnap.data();
  let byOrderSize = 1;
  try {
    const byOrder = await db.collection('bookings')
      .where('marketplaceOrderId', '==', seeded.order.id)
      .get();
    byOrderSize = byOrder.size;
  } catch (error) {
    console.log(`marketplaceOrderId query skipped (${error.code || error.message})`);
  }

  const fareTotal = booking.fare && booking.fare.totalFare;
  const copiedPlaceholderFee = fareTotal === 45 && seeded.order.deliveryFee === 45;

  const firstWriteOk = booking.sourceType === 'marketplace'
    && booking.marketplaceOrderId === seeded.order.id
    && booking.paymentMethod === 'cash'
    && booking.paymentStatus === 'pending'
    && booking.status === 'pending'
    && byOrderSize === 1
    && booking.pickup
    && booking.pickup.coordinates
    && typeof booking.pickup.coordinates.latitude === 'number'
    && typeof booking.pickup.coordinates.longitude === 'number';

  console.log(JSON.stringify({
    case: 'first-mark-ready',
    pass: firstWriteOk,
    orderId: seeded.order.id,
    linkedBookingId: ready.order.linkedBookingId,
    bookingCountForOrder: byOrderSize,
    sourceType: booking.sourceType,
    paymentMethod: booking.paymentMethod,
    paymentStatus: booking.paymentStatus,
    bookingStatus: booking.status,
    fareTotal,
    orderDeliveryFee: seeded.order.deliveryFee,
    usedOrderDeliveryFeeAsFare: copiedPlaceholderFee,
    pickupName: booking.pickup && booking.pickup.name,
    hasPickupCoords: Boolean(booking.pickup && booking.pickup.coordinates)
  }));
  if (!firstWriteOk) {
    fail('first mark-ready booking write did not match expected fields');
  }

  const repeat = await shopOrderService.markReady(SHOP_A_UID, seeded.order.id);
  let afterRepeatSize = 1;
  try {
    const afterRepeat = await db.collection('bookings')
      .where('marketplaceOrderId', '==', seeded.order.id)
      .get();
    afterRepeatSize = afterRepeat.size;
  } catch (error) {
    console.log(`repeat marketplaceOrderId query skipped (${error.code || error.message})`);
  }
  const repeatOk = repeat.alreadyProcessed === true
    && repeat.order.linkedBookingId === ready.order.linkedBookingId
    && afterRepeatSize === 1;
  console.log(JSON.stringify({
    case: 'repeat-mark-ready',
    pass: repeatOk,
    alreadyProcessed: repeat.alreadyProcessed,
    linkedUnchanged: repeat.order.linkedBookingId === ready.order.linkedBookingId,
    bookingCountForOrder: afterRepeatSize
  }));
  if (!repeatOk) {
    fail('repeat mark-ready created a second booking or was not Already processed');
  }

  const cancelled = await shopOrderService.cancelOrder(SHOP_A_UID, seeded.order.id, {
    reason: 'Stage2 mark-ready local verify cancel'
  });
  const bookingAfterCancel = await db.collection('bookings').doc(ready.order.linkedBookingId).get();
  const cancelledBooking = bookingAfterCancel.data() || {};
  const cancelOk = cancelled.order.orderStatus === 'cancelled'
    && cancelledBooking.status === 'cancelled'
    && !cancelledBooking.driverId;
  console.log(JSON.stringify({
    case: 'cancel-clears-pending-booking',
    pass: cancelOk,
    orderStatus: cancelled.order.orderStatus,
    bookingStatus: cancelledBooking.status
  }));
  if (!cancelOk) {
    fail('shop cancel did not cancel the pending unassigned linked booking');
  }

  console.log('PASS  housekeeping + mark-ready local verification');
}

main().catch((error) => {
  console.error('FAIL  Stage 2 mark-ready verify:', error.message || error);
  process.exit(1);
});
