const {
  planPendingTimeoutCandidate,
  pendingTimeoutAnchorMs
} = require('../src/services/parcel/parcelPendingCancelService');

function ts(ms) {
  return new Date(ms);
}

describe('planPendingTimeoutCandidate scheduled pickup', () => {
  const nowMs = 1_000_000;
  const timeoutMs = 10 * 60 * 1000;

  test('skips when estimated pickup is in the future', () => {
    const data = {
      status: 'pending',
      sourceType: 'parcel',
      driverId: null,
      createdAt: ts(nowMs - 60 * 60 * 1000),
      estimatedPickupTime: ts(nowMs + 30 * 60 * 1000)
    };
    expect(planPendingTimeoutCandidate(data, 'b1', nowMs, timeoutMs)).toBeNull();
    expect(pendingTimeoutAnchorMs(data, nowMs).skip).toBe(true);
  });

  test('ages from scheduled pickup when it is in the past', () => {
    const data = {
      status: 'pending',
      sourceType: 'parcel',
      driverId: null,
      createdAt: ts(nowMs - 60 * 60 * 1000),
      timing: { estimatedPickupTime: ts(nowMs - 5 * 60 * 1000) }
    };
    expect(planPendingTimeoutCandidate(data, 'b2', nowMs, timeoutMs)).toBeNull();

    const dataExpired = {
      ...data,
      timing: { estimatedPickupTime: ts(nowMs - 11 * 60 * 1000) }
    };
    expect(planPendingTimeoutCandidate(dataExpired, 'b2', nowMs, timeoutMs)).toMatchObject({
      bookingId: 'b2'
    });
  });
});
