const {
  computePoolUsedRatio,
  claimPoolAlertDay
} = require('../src/services/marketplace/cleanupJobDecisions');

describe('order number pool monitor decisions', () => {
  test('computes used share against pool size', () => {
    expect(computePoolUsedRatio(72000, 90000)).toBeCloseTo(0.8, 5);
    expect(computePoolUsedRatio(45000, 90000)).toBe(0.5);
  });

  test('includes legacyRegistered in used share', () => {
    expect(computePoolUsedRatio(70000, 90000, 2000)).toBeCloseTo(0.8, 5);
    expect(computePoolUsedRatio(0, 90000, 45000)).toBe(0.5);
  });

  test('claims alert once per IST day (check-and-set semantics)', () => {
    const istDay = '2026-10-12';
    const first = claimPoolAlertDay({
      usedRatio: 0.82,
      threshold: 0.8,
      lastAlertIstDay: null,
      istDay
    });
    expect(first).toEqual({ claim: true, istDay });

    const second = claimPoolAlertDay({
      usedRatio: 0.82,
      threshold: 0.8,
      lastAlertIstDay: istDay,
      istDay
    });
    expect(second.claim).toBe(false);
    expect(second.reason).toBe('already_alerted_today');

    const nextDay = claimPoolAlertDay({
      usedRatio: 0.82,
      threshold: 0.8,
      lastAlertIstDay: '2026-10-11',
      istDay
    });
    expect(nextDay).toEqual({ claim: true, istDay });
  });
});
