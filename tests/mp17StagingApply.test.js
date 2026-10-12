const { planSlowDriverTickItem } = require('../src/services/marketplace/slowDriverJobDecisions');
const {
  STAGING_TEST_PAIR,
  orderMatchesStagingTestPair,
  SKIP_NOT_TEST_PAIR
} = require('../src/services/marketplace/mp17StagingPair');

const SLOW_MS = 15 * 60 * 1000;
const NOW = Date.parse('2026-10-12T10:00:00.000Z');

function readyOrder(customerId, shopId) {
  return {
    orderStatus: 'ready',
    customerId,
    shopId,
    readyAt: new Date(NOW - SLOW_MS - 1000),
    delivery: { stage: 'searching', slowNotifiedAt: null }
  };
}

describe('MP-17 staging apply lock', () => {
  test('staging pair constant matches expected ids', () => {
    expect(STAGING_TEST_PAIR.customerId).toBe('Ue51a7afbc981f1b92cf30be32ab');
    expect(STAGING_TEST_PAIR.shopId).toBe('b7302f5d6343c1641d63811306eb');
  });

  test('slow-tick apply skips non-pair eligible orders', () => {
    const other = readyOrder('other-customer', 'other-shop');
    const blocked = planSlowDriverTickItem({
      orderId: 'ord-other',
      data: other,
      nowMs: NOW,
      slowMs: SLOW_MS,
      stagingPair: STAGING_TEST_PAIR,
      stagingApplyLock: true,
      reportStagingSkips: false
    });
    expect(blocked).toEqual({
      id: 'ord-other',
      kind: 'slow_driver',
      skipped: true,
      reason: SKIP_NOT_TEST_PAIR
    });

    const pair = readyOrder(STAGING_TEST_PAIR.customerId, STAGING_TEST_PAIR.shopId);
    const allowed = planSlowDriverTickItem({
      orderId: 'ord-pair',
      data: pair,
      nowMs: NOW,
      slowMs: SLOW_MS,
      stagingPair: STAGING_TEST_PAIR,
      stagingApplyLock: true,
      reportStagingSkips: false
    });
    expect(allowed).toEqual({
      id: 'ord-pair',
      kind: 'slow_driver',
      wouldApply: true,
      skipped: false
    });
  });

  test('dry-run reports not_test_pair without applying', () => {
    const other = readyOrder('x', 'y');
    const row = planSlowDriverTickItem({
      orderId: 'ord-x',
      data: other,
      nowMs: NOW,
      slowMs: SLOW_MS,
      stagingPair: STAGING_TEST_PAIR,
      stagingApplyLock: false,
      reportStagingSkips: true
    });
    expect(row.reason).toBe(SKIP_NOT_TEST_PAIR);
    expect(row.wouldApply).toBe(false);
    expect(orderMatchesStagingTestPair(other, STAGING_TEST_PAIR)).toBe(false);
  });
});
