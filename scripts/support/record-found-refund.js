/**
 * Record a support_decision refund after payment was not verified. Dry run is the default.
 * The order stays cancelled.
 *
 *   node scripts/support/record-found-refund.js --order <id> --amount <rupees> --reason <text> --operator <id>
 *   node scripts/support/record-found-refund.js --order <id> --amount <rupees> --reason <text> --operator <id> --apply
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
  const amount = Number(argValue('--amount'));
  const reason = argValue('--reason');
  const operator = argValue('--operator');
  if (!orderId || !reason || !operator || !Number.isFinite(amount)) {
    console.error('Needs --order, --amount, --reason, and --operator. Nothing was written.');
    process.exit(1);
  }
  const { getFirestore } = require('../../src/services/firebase');
  getFirestore();
  assertStagingAdmin();
  console.log(JSON.stringify({
    dryRun: !apply,
    orderId,
    amount,
    reasonLength: reason.length,
    operator
  }, null, 2));
  if (!apply) {
    console.log('Dry run. Re-run with --apply to record the refund.');
    return;
  }
  const { recordFoundRefund } = require('../../src/services/marketplace/refunds');
  const result = await recordFoundRefund({ orderId, amount, operator, reason });
  console.log(JSON.stringify({ applied: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
