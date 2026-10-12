/**
 * Support resolution for customer-cancel paid check (staging pair only).
 *
 *   node scripts/support/resolve-paid-check.js --order <id> --outcome received|not_received --operator <id>
 *   node scripts/support/resolve-paid-check.js --order <id> --outcome received --operator <id> --apply
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

function last4(value) {
  return typeof value === 'string' && value.length >= 4 ? value.slice(-4) : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const orderId = argValue('--order');
  const outcome = argValue('--outcome');
  const operator = argValue('--operator');
  if (!orderId || !outcome || !operator) {
    console.error('Usage: resolve-paid-check.js --order <id> --outcome received|not_received --operator <id> [--apply]');
    process.exit(1);
  }
  if (outcome !== 'received' && outcome !== 'not_received') {
    console.error('--outcome must be received or not_received');
    process.exit(1);
  }

  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();
  const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
  if (!orderSnap.exists) {
    console.error('Order not found.');
    process.exit(1);
  }
  const data = orderSnap.data() || {};
  const pair = assertStagingPair(data.customerId, data.shopId);
  if (!pair.ok) {
    console.error(pair.message);
    process.exit(1);
  }

  const cancellation = data.cancellation || {};
  const payment = data.payment || {};
  const preview = {
    dryRun: !apply,
    orderId,
    orderStatus: data.orderStatus,
    paidCheck: cancellation.paidCheck ?? null,
    paidCheckAt: cancellation.paidCheckAt && cancellation.paidCheckAt.toDate
      ? cancellation.paidCheckAt.toDate().toISOString()
      : null,
    paidCheckEscalatedAt: cancellation.paidCheckEscalatedAt && cancellation.paidCheckEscalatedAt.toDate
      ? cancellation.paidCheckEscalatedAt.toDate().toISOString()
      : null,
    customerUtrLast4: last4(payment.customerUtr),
    outcome
  };

  if (!apply) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  const { resolvePaidCheckSupport } = require('../../src/services/marketplace/shopPaymentVerification');
  const received = outcome === 'received';
  const body = {};
  if (received && typeof payment.customerUtr === 'string') {
    body.fullUtr = payment.customerUtr;
  }
  const result = await resolvePaidCheckSupport({
    orderId,
    received,
    operator,
    body
  });
  console.log(JSON.stringify({ ...preview, applied: true, result }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
