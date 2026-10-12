const {
  shouldNotifySlowDriver,
  claimSlowDriverInTransaction
} = require('../src/services/marketplace/slowDriverJobDecisions');

const SLOW_MS = 15 * 60 * 1000;
const NOW = Date.parse('2026-10-12T10:00:00.000Z');

function readyOrder(overrides = {}) {
  return {
    orderStatus: 'ready',
    readyAt: new Date(NOW - SLOW_MS - 1000),
    delivery: {
      stage: 'searching',
      slowNotifiedAt: null
    },
    ...overrides
  };
}

describe('marketplace slow-driver decisions', () => {
  test('notifies when ready, searching, and past slow window', () => {
    expect(shouldNotifySlowDriver(readyOrder(), NOW, SLOW_MS)).toBe(true);
  });

  test('skips when stage is not searching', () => {
    expect(shouldNotifySlowDriver(readyOrder({
      delivery: { stage: 'assigned', slowNotifiedAt: null }
    }), NOW, SLOW_MS)).toBe(false);
  });

  test('skips when already notified', () => {
    expect(shouldNotifySlowDriver(readyOrder({
      delivery: { stage: 'searching', slowNotifiedAt: new Date(NOW - 1000) }
    }), NOW, SLOW_MS)).toBe(false);
  });

  test('transaction claim is idempotent after slowNotifiedAt is set', () => {
    const first = claimSlowDriverInTransaction(readyOrder(), NOW, SLOW_MS);
    expect(first).toEqual({ claim: true, notify: true });

    const after = readyOrder({
      delivery: { stage: 'searching', slowNotifiedAt: new Date(NOW) }
    });
    const second = claimSlowDriverInTransaction(after, NOW, SLOW_MS);
    expect(second).toEqual({ claim: false, notify: false });
  });
});
