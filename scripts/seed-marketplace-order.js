/**
 * Seed a marketplaceOrders document for shop-side Stage 1 testing.
 * There is no customer create endpoint yet.
 *
 * Usage:
 *   node scripts/seed-marketplace-order.js --shopId=<uid>
 *   node scripts/seed-marketplace-order.js --shopId=<uid> --customerId=<uid>
 *   node scripts/seed-marketplace-order.js --shopId=<uid> --status=awaiting_payment
 *
 * payment.amount is always itemsTotal (250), never itemsTotal + deliveryFee (295).
 *
 * Manual Console equivalent:
 *   Collection: marketplaceOrders
 *   shopId: <shop uid>
 *   customerId: <customer uid or null>
 *   items: [{ productId, variantId: null, name, price: 250, qty: 1 }]
 *   itemsTotal: 250
 *   deliveryFee: 45
 *   payment.amount: 250
 *   payment.status: pending
 *   orderStatus: awaiting_payment
 *   payment.transactionReference: <same as document id>
 *   linkedBookingId: null
 *   displayId: unique 5-digit (do not copy another order's)
 *   handoverOtp: 6-digit string
 */

require('dotenv').config();

const shopOrderService = require('../src/services/shopOrderService');
const displayIdService = require('../src/services/displayIdService');

function argValue(flag) {
  const prefix = `${flag}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : '';
}

async function main() {
  const shopId = argValue('--shopId');
  const customerId = argValue('--customerId') || null;
  const orderStatus = argValue('--status') || 'awaiting_payment';

  if (!shopId) {
    console.error('Usage: node scripts/seed-marketplace-order.js --shopId=<uid> [--customerId=<uid>] [--status=awaiting_payment]');
    process.exit(1);
  }

  const seeded = await shopOrderService.createSeedOrder({
    shopId,
    customerId,
    orderStatus
  });

  const order = seeded.order;
  console.log('Seeded marketplace order');
  console.log(JSON.stringify({
    id: order.id,
    shopId: order.shopId,
    customerId: order.customerId,
    orderStatus: order.orderStatus,
    itemsTotal: order.itemsTotal,
    deliveryFee: order.deliveryFee,
    paymentAmount: order.payment.amount,
    amountEqualsItemsTotal: order.payment.amount === order.itemsTotal,
    amountIncludesDeliveryFee: order.payment.amount === order.itemsTotal + order.deliveryFee,
    displayId: seeded.displayId,
    displayIdFormatted: displayIdService.formatDisplayId(seeded.displayId),
    handoverOtp: seeded.handoverOtp,
    linkedBookingId: order.linkedBookingId
  }, null, 2));
}

main().catch((error) => {
  console.error('Seed failed:', error.message || error);
  process.exit(1);
});
