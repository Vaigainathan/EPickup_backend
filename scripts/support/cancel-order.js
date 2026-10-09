/**
 * Cancel one marketplace order on staging before the driver picks it up.
 * Dry run is the default.
 *
 *   node scripts/support/cancel-order.js --order <id> --reason <text> --operator <id>
 *   node scripts/support/cancel-order.js --order <id> --reason <text> --operator <id> --apply
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { assertStagingPair } = require('./marketplaceStagingActions');

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
  const orderId = argValue('--order');
  const reason = argValue('--reason');
  const operator = argValue('--operator');
  if (!orderId || !reason || !operator) {
    console.error('Usage: node scripts/support/cancel-order.js --order <id> --reason <text> --operator <id> [--apply]');
    process.exit(1);
  }

  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
  if (!orderSnap.exists) {
    console.error('Order not found. Nothing was written.');
    process.exit(1);
  }
  const data = orderSnap.data() || {};
  const pair = assertStagingPair(data.customerId, data.shopId);
  if (!pair.ok) {
    console.error(pair.message);
    process.exit(1);
  }

  const stage = data.delivery && data.delivery.stage ? data.delivery.stage : null;
  let bookingStatus = null;
  if (data.linkedBookingId) {
    const bookingSnap = await db.collection('bookings').doc(data.linkedBookingId).get();
    if (bookingSnap.exists) {
      bookingStatus = (bookingSnap.data() || {}).status || null;
    }
  }

  console.log(JSON.stringify({
    cancel: true,
    apply,
    wrote: false,
    orderId,
    orderStatus: data.orderStatus ?? null,
    closedReason: data.closedReason ?? null,
    stage,
    linkedBookingId: data.linkedBookingId ?? null,
    bookingStatus,
    operator
  }, null, 2));

  if (!apply) {
    console.log('Dry run. Re-run with --apply to cancel the order. Nothing was written.');
    return;
  }

  const shopOrderService = require('../../src/services/shopOrderService');
  try {
    const result = await shopOrderService.supportCancelBeforeHandover({
      orderId,
      operator,
      note: reason
    });
    console.log(JSON.stringify({
      wrote: result.wrote === true,
      alreadyProcessed: result.alreadyProcessed === true
    }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      wrote: false,
      status: error.status || 500,
      code: error.code || null,
      message: error.message
    }, null, 2));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
