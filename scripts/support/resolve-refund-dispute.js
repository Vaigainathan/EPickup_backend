/**
 * Resolve a disputed refund. Dry run is the default.
 *
 *   node scripts/support/resolve-refund-dispute.js --order <id> --refund <id> --outcome received --operator <id>
 *   node scripts/support/resolve-refund-dispute.js --order <id> --refund <id> --outcome resend --to due|upi_needed --operator <id> --apply
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
  const outcome = argValue('--outcome');
  const to = argValue('--to');
  const operator = argValue('--operator');
  if (!orderId || !refundId || !outcome || !operator) {
    console.error('Needs --order, --refund, --outcome, and --operator. Nothing was written.');
    process.exit(1);
  }
  const { getFirestore } = require('../../src/services/firebase');
  getFirestore();
  assertStagingAdmin();
  console.log(JSON.stringify({
    dryRun: !apply,
    orderId,
    refundId,
    outcome,
    to: to || null,
    operator
  }, null, 2));
  if (!apply) {
    console.log('Dry run. Re-run with --apply to resolve the dispute.');
    return;
  }
  const { resolveRefundDispute } = require('../../src/services/marketplace/refunds');
  const result = await resolveRefundDispute({
    orderId,
    refundId,
    outcome,
    to: to || null,
    operator
  });
  console.log(JSON.stringify({ applied: true, wrote: result.wrote, refund: result.refund }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
