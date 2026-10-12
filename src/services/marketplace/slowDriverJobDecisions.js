const { millisOf } = require('./evidenceCommon');
const { orderMatchesStagingTestPair, SKIP_NOT_TEST_PAIR } = require('./mp17StagingPair');

function shouldNotifySlowDriver(data, nowMs, slowMs) {
  if (!data || data.orderStatus !== 'ready') {
    return false;
  }
  const delivery = data.delivery && typeof data.delivery === 'object' ? data.delivery : null;
  if (!delivery || delivery.stage !== 'searching') {
    return false;
  }
  if (delivery.slowNotifiedAt != null) {
    return false;
  }
  const readyMs = millisOf(data.readyAt);
  if (!Number.isFinite(readyMs) || !Number.isFinite(slowMs) || slowMs <= 0) {
    return false;
  }
  return nowMs - readyMs > slowMs;
}

function claimSlowDriverInTransaction(data, nowMs, slowMs) {
  if (!shouldNotifySlowDriver(data, nowMs, slowMs)) {
    return { claim: false, notify: false };
  }
  return { claim: true, notify: true };
}

function planSlowDriverTickItem({
  orderId,
  data,
  nowMs,
  slowMs,
  stagingPair,
  stagingApplyLock,
  reportStagingSkips
}) {
  const eligible = shouldNotifySlowDriver(data, nowMs, slowMs);
  if (!eligible) {
    return null;
  }
  const matches = orderMatchesStagingTestPair(data, stagingPair);
  if (stagingApplyLock && !matches) {
    return { id: orderId, kind: 'slow_driver', skipped: true, reason: SKIP_NOT_TEST_PAIR };
  }
  if (reportStagingSkips && !matches) {
    return { id: orderId, kind: 'slow_driver', wouldApply: false, skipped: true, reason: SKIP_NOT_TEST_PAIR };
  }
  return { id: orderId, kind: 'slow_driver', wouldApply: true, skipped: false };
}

module.exports = {
  shouldNotifySlowDriver,
  claimSlowDriverInTransaction,
  planSlowDriverTickItem
};
