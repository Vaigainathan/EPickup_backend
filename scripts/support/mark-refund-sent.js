/**
 * Record a refund UTR on the shop's behalf. Dry run is the default.
 *
 *   node scripts/support/mark-refund-sent.js --order <id> --refund <id> --utr <12> --reason <text> --operator <id>
 *   node scripts/support/mark-refund-sent.js --order <id> --refund <id> --utr <12> --reason <text> --operator <id> --apply
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

async function main() {
  const apply = reviewScriptWrites({ list: false, apply: process.argv.includes('--apply') });
  const orderId = argValue('--order');
  const refundId = argValue('--refund');
  const refundUtr = argValue('--utr');
  const reason = argValue('--reason');
  const operator = argValue('--operator');
  if (!orderId || !refundId || !refundUtr || !reason || !operator) {
    console.error('Needs --order, --refund, --utr, --reason, and --operator. Nothing was written.');
    process.exit(1);
  }
  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();
  const refundSnap = await db.collection('marketplaceOrders').doc(orderId).collection('refunds').doc(refundId).get();
  const refund = refundSnap.exists ? (refundSnap.data() || {}) : null;
  console.log(JSON.stringify({
    dryRun: !apply,
    orderId,
    refundId,
    utrLast4: refundUtr.slice(-4),
    reasonLength: reason.length,
    operator,
    customerUpiId: refund ? refund.customerUpiId || null : null,
    amount: refund ? refund.amount ?? null : null,
    status: refund ? refund.status || null : null
  }, null, 2));
  if (!apply) {
    console.log('Dry run. Re-run with --apply to record the refund UTR.');
    return;
  }
  const { markRefundSent } = require('../../src/services/marketplace/refunds');
  const result = await markRefundSent({
    orderId,
    refundId,
    refundUtr,
    amount: refund ? refund.amount : null,
    actor: { type: 'support', id: operator },
    eventReason: reason
  });
  console.log(JSON.stringify({ applied: true, alreadyProcessed: result.alreadyProcessed, refund: result.refund }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
