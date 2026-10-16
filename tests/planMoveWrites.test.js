const { planMoveWrites } = require('../scripts/support/lib/marketplaceStagingDriver');

const moveOrder = {
  delivery: { stage: 'on_the_way' },
  shopSnapshot: {
    coordinates: { latitude: 12.9716, longitude: 77.5946 }
  },
  deliveryAddress: {
    coordinates: { latitude: 12.9816, longitude: 77.6046 }
  }
};

describe('planMoveWrites', () => {
  it('assigns distinct staggered lastUpdated values (base + index × every seconds)', () => {
    const baseMs = 1_700_000_000_000;
    const every = 10;
    const result = planMoveWrites({
      order: moveOrder,
      bookingId: 'booking-1',
      seconds: 120,
      every,
      baseMs
    });
    expect(result.ok).toBe(true);
    expect(result.writes.length).toBe(12);
    const millis = result.writes.map((row) => row.lastUpdated.getTime());
    expect(new Set(millis).size).toBe(millis.length);
    for (let index = 1; index < millis.length; index += 1) {
      expect(millis[index] - millis[index - 1]).toBe(every * 1000);
    }
    expect(millis[0]).toBe(baseMs);
    expect(millis[millis.length - 1]).toBe(baseMs + (millis.length - 1) * every * 1000);
  });
});
