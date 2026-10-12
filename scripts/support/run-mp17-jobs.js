#!/usr/bin/env node
/**
 * Staging-only manual ticks for MP-17 jobs. Dry-run by default; pass --apply to write.
 * --apply is locked to the staging test customer/shop pair (server crons are unchanged).
 *
 *   node scripts/support/run-mp17-jobs.js --slow-tick --now <ISO>
 *   node scripts/support/run-mp17-jobs.js --slow-tick --now <ISO> --apply
 *   node scripts/support/run-mp17-jobs.js --cleanup-tick --apply
 *   node scripts/support/run-mp17-jobs.js --pool-tick --now 2026-10-12T10:00:00.000Z
 */
require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { STAGING_TEST_PAIR } = require('../../src/services/marketplace/mp17StagingPair');

assertStagingEnv();

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1 || index === process.argv.length - 1) {
    return null;
  }
  return process.argv[index + 1];
}

function parseNowMs(required) {
  const nowArg = argValue('--now');
  if (!nowArg) {
    if (required) {
      console.error('--now <ISO> is required for --slow-tick (simulated clock for readyAt only).');
      process.exit(1);
    }
    return null;
  }
  const nowMs = Date.parse(nowArg);
  if (!Number.isFinite(nowMs)) {
    console.error('--now must be an ISO time.');
    process.exit(1);
  }
  return nowMs;
}

function buildTickOptions(apply, nowMs) {
  const tickOptions = {
    dryRun: !apply,
    stagingPair: STAGING_TEST_PAIR
  };
  if (Number.isFinite(nowMs)) {
    tickOptions.nowMs = nowMs;
  }
  if (apply) {
    tickOptions.only = STAGING_TEST_PAIR;
    tickOptions.stagingApplyLock = true;
  } else {
    tickOptions.reportStagingSkips = true;
  }
  return tickOptions;
}

async function main() {
  const { getFirestore } = require('../../src/services/firebase');
  getFirestore();
  assertStagingAdmin();

  const apply = process.argv.includes('--apply');

  if (process.argv.includes('--slow-tick')) {
    const nowMs = parseNowMs(true);
    const tickOptions = buildTickOptions(apply, nowMs);
    const marketplaceSlowDriverJob = require('../../src/services/marketplaceSlowDriverJob');
    const result = await marketplaceSlowDriverJob.runTick(tickOptions);
    console.log(JSON.stringify({
      job: 'slow_driver',
      applied: apply,
      stagingPair: STAGING_TEST_PAIR,
      ...result
    }, null, 2));
    return;
  }

  if (process.argv.includes('--cleanup-tick')) {
    const tickOptions = buildTickOptions(apply, parseNowMs(false));
    const marketplaceCleanupJob = require('../../src/services/marketplaceCleanupJob');
    const result = await marketplaceCleanupJob.runTick(tickOptions);
    console.log(JSON.stringify({
      job: 'cleanup',
      applied: apply,
      stagingPair: STAGING_TEST_PAIR,
      ...result
    }, null, 2));
    return;
  }

  if (process.argv.includes('--pool-tick')) {
    const tickOptions = buildTickOptions(apply, parseNowMs(false));
    const marketplaceOrderNumberPoolJob = require('../../src/services/marketplaceOrderNumberPoolJob');
    const result = await marketplaceOrderNumberPoolJob.runTick(tickOptions);
    console.log(JSON.stringify({
      job: 'order_number_pool',
      applied: apply,
      stagingPair: STAGING_TEST_PAIR,
      ...result
    }, null, 2));
    return;
  }

  console.error('Usage: node scripts/support/run-mp17-jobs.js (--slow-tick | --cleanup-tick | --pool-tick) [--apply] [--now <ISO>]');
  console.error(`--apply always uses staging pair customer=${STAGING_TEST_PAIR.customerId} shop=${STAGING_TEST_PAIR.shopId}`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
