/**
 * Close one open payment review on staging. Dry run is the default.
 *
 *   node scripts/support/resolve-payment-review.js --list
 *   node scripts/support/resolve-payment-review.js --order <id> --outcome found|not_found|refund --reason <text> --operator <id>
 *   node scripts/support/resolve-payment-review.js --order <id> --outcome refund --reason <text> --operator <id> --apply
 *
 * --list writes nothing, including when --apply is also passed.
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { reviewScriptWrites } = require('./marketplaceStagingActions');

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

function toIso(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.toISOString() : null;
  }
  return null;
}

function presentOpenReview(id, data) {
  const payment = data.payment && typeof data.payment === 'object' ? data.payment : {};
  const review = payment.review && typeof payment.review === 'object' ? payment.review : {};
  const response = review.shopResponse && typeof review.shopResponse === 'object' ? review.shopResponse : null;
  return {
    id,
    displayId: data.displayId ?? null,
    trigger: review.trigger ?? null,
    status: review.status ?? null,
    openedAt: toIso(review.openedAt),
    shopResponse: response ? response.result ?? null : null
  };
}

async function main() {
  const list = process.argv.includes('--list');
  const apply = process.argv.includes('--apply');
  const writes = reviewScriptWrites({ list, apply });
  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  if (list) {
    const snap = await db.collection('marketplaceOrders').where('orderStatus', '==', 'payment_review').get();
    const reviews = [];
    snap.docs.forEach((doc) => {
      const data = doc.data() || {};
      const review = data.payment && data.payment.review;
      if (!review || review.status !== 'open') {
        return;
      }
      reviews.push(presentOpenReview(doc.id, data));
    });
    console.log(JSON.stringify({ list: true, wrote: false, count: reviews.length, reviews }, null, 2));
    return;
  }

  const orderId = argValue('--order');
  const outcome = argValue('--outcome');
  const reason = argValue('--reason');
  const operator = argValue('--operator');
  if (!orderId || !outcome || !reason || !operator) {
    console.error('Usage: node scripts/support/resolve-payment-review.js --list | --order <id> --outcome found|not_found|refund --reason <text> --operator <id> [--apply]');
    process.exit(1);
  }

  const orderSnap = await db.collection('marketplaceOrders').doc(orderId).get();
  const data = orderSnap.exists ? (orderSnap.data() || {}) : null;
  const review = data && data.payment && data.payment.review ? data.payment.review : null;
  const response = review && review.shopResponse ? review.shopResponse : null;
  console.log(JSON.stringify({
    resolve: true,
    apply: writes,
    wrote: false,
    orderId,
    exists: orderSnap.exists,
    orderStatus: data ? data.orderStatus ?? null : null,
    reviewStatus: review ? review.status ?? null : null,
    trigger: review ? review.trigger ?? null : null,
    shopResponse: response ? response.result ?? null : null,
    outcome,
    operator
  }, null, 2));

  if (review && review.shopResponse && review.shopResponse.result === 'short' && outcome === 'found') {
    console.error('A short review cannot be closed as found. Use --outcome refund. Nothing was written.');
    process.exitCode = 1;
    return;
  }
  if (outcome === 'found' && data && data.payment && !data.payment.customerUtr) {
    console.error('This order has no customer UTR. The shop must confirm-payment with a full UTR. Nothing was written.');
    process.exitCode = 1;
    return;
  }
  if (!writes) {
    console.log('Dry run. Re-run with --apply to close the review. Nothing was written.');
    return;
  }

  const shopOrderService = require('../../src/services/shopOrderService');
  try {
    const result = await shopOrderService.resolveReview({ orderId, outcome, reason, operator });
    console.log(JSON.stringify({
      wrote: result.alreadyProcessed !== true,
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
