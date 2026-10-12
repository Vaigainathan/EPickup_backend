/**
 * Resolve or review a marketplace help ticket on staging. Dry run is the default.
 *
 *   node scripts/support/resolve-help.js --ticket <id> --status reviewing --operator <id>
 *   node scripts/support/resolve-help.js --ticket <id> --status resolved --outcome no_action --operator <id> --apply
 *   node scripts/support/resolve-help.js --ticket <id> --status resolved --outcome refund --amount 50 --operator <id> --apply
 *   node scripts/support/resolve-help.js --ticket <id> --show
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

async function main() {
  const show = process.argv.includes('--show');
  const apply = reviewScriptWrites({ list: false, apply: process.argv.includes('--apply') });
  const ticketId = argValue('--ticket');
  if (!ticketId) {
    console.error('--ticket is required. Nothing was written.');
    process.exit(1);
  }

  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();

  const ticketSnap = await db.collection('supportTickets').doc(ticketId).get();
  if (!ticketSnap.exists) {
    console.error('Ticket not found.');
    process.exit(1);
  }
  const ticket = ticketSnap.data() || {};
  if (show) {
    console.log(JSON.stringify({
      ticketId,
      orderId: ticket.orderId ?? null,
      displayId: ticket.displayId ?? null,
      status: ticket.status ?? null,
      problem: ticket.problem ?? null,
      priority: ticket.priority ?? null,
      evidenceCount: Array.isArray(ticket.evidenceIds) ? ticket.evidenceIds.length : 0,
      createdAt: toIso(ticket.createdAt)
    }, null, 2));
    return;
  }

  const status = argValue('--status');
  const outcome = argValue('--outcome');
  const operator = argValue('--operator');
  const supportNote = argValue('--note');
  const amountRaw = argValue('--amount');
  const amount = amountRaw ? Number(amountRaw) : undefined;

  if (!status || !operator) {
    console.error('Needs --status and --operator. Nothing was written.');
    process.exit(1);
  }

  console.log(JSON.stringify({
    dryRun: !apply,
    ticketId,
    status,
    outcome: outcome || null,
    amount: amount == null ? null : amount,
    operator
  }, null, 2));

  if (!apply) {
    console.log('Dry run. Re-run with --apply to write.');
    return;
  }

  const { resolveMarketplaceHelp } = require('../../src/services/marketplace/helpRequests');
  const result = await resolveMarketplaceHelp({
    ticketId,
    status,
    outcome: outcome || null,
    amount,
    operator,
    supportNote
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
