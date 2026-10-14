const {
  STAGING_TEST_DRIVER_UID,
  LIVE_STAGES,
  assertTestDriverFixture,
  interpolateRoute,
  planMoveWrites,
  planSeedDriverDoc,
  planSimStepPatch,
  assertNoAvailabilityFlagsInWrite,
  driverInfoFromUser
} = require('../scripts/support/lib/marketplaceStagingDriver');

describe('simulateMarketplaceDriver guards and helpers', () => {
  test('assertTestDriverFixture rejects missing testFixture', () => {
    const result = assertTestDriverFixture({ userType: 'driver' }, STAGING_TEST_DRIVER_UID);
    expect(result.ok).toBe(false);
  });

  test('assertTestDriverFixture accepts test fixture driver', () => {
    const result = assertTestDriverFixture({ testFixture: true }, STAGING_TEST_DRIVER_UID);
    expect(result.ok).toBe(true);
  });

  test('assertTestDriverFixture rejects wrong uid', () => {
    const result = assertTestDriverFixture({ testFixture: true }, 'other-driver');
    expect(result.ok).toBe(false);
  });

  test('interpolateRoute endpoints', () => {
    const start = { latitude: 12.5, longitude: 78.5 };
    const end = { latitude: 12.6, longitude: 78.6 };
    expect(interpolateRoute(start, end, 0)).toEqual({ latitude: 12.5, longitude: 78.5 });
    expect(interpolateRoute(start, end, 1)).toEqual({ latitude: 12.6, longitude: 78.6 });
    const mid = interpolateRoute(start, end, 0.5);
    expect(mid.latitude).toBeCloseTo(12.55);
    expect(mid.longitude).toBeCloseTo(78.55);
  });

  test('planMoveWrites refuses stage outside LIVE_STAGES', () => {
    const result = planMoveWrites({
      order: { delivery: { stage: 'searching' }, shopSnapshot: { coordinates: { latitude: 1, longitude: 2 } }, deliveryAddress: { coordinates: { latitude: 3, longitude: 4 } } },
      bookingId: 'b1',
      seconds: 10,
      every: 5
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/delivery.stage/);
  });

  test('planMoveWrites requires coordinates', () => {
    const result = planMoveWrites({
      order: { delivery: { stage: 'assigned' }, shopSnapshot: {}, deliveryAddress: { coordinates: { latitude: 3, longitude: 4 } } },
      bookingId: 'b1',
      seconds: 10,
      every: 5
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/shopSnapshot/);
  });

  test('planMoveWrites succeeds for live stage', () => {
    const result = planMoveWrites({
      order: {
        delivery: { stage: 'on_the_way' },
        shopSnapshot: { coordinates: { latitude: 0, longitude: 0 } },
        deliveryAddress: { coordinates: { latitude: 10, longitude: 10 } }
      },
      bookingId: 'b1',
      seconds: 20,
      every: 10
    });
    expect(result.ok).toBe(true);
    expect(result.writes.length).toBe(2);
    expect(LIVE_STAGES.has('on_the_way')).toBe(true);
  });

  test('assign step writes driverInfo name phone vehicle', () => {
    const user = {
      name: 'Test Driver',
      phone: '+910000000001',
      driver: { vehicleDetails: { vehicleNumber: 'TN01AB1234' } }
    };
    const planned = planSimStepPatch('assign', { status: 'pending' }, user);
    expect(planned.ok).toBe(true);
    expect(planned.patch.driverInfo).toEqual({
      name: 'Test Driver',
      phone: '+910000000001',
      vehicle: 'TN01AB1234'
    });
    expect(driverInfoFromUser(user).vehicle).toBe('TN01AB1234');
  });

  test('seed and move plans never set isOnline or isAvailable true', () => {
    const seed = planSeedDriverDoc();
    expect(assertNoAvailabilityFlagsInWrite(seed)).toHaveLength(0);
    const move = planMoveWrites({
      order: {
        delivery: { stage: 'assigned' },
        shopSnapshot: { coordinates: { latitude: 1, longitude: 2 } },
        deliveryAddress: { coordinates: { latitude: 3, longitude: 4 } }
      },
      bookingId: 'b1',
      seconds: 10,
      every: 10
    });
    expect(move.ok).toBe(true);
    move.writes.forEach((write) => {
      expect(assertNoAvailabilityFlagsInWrite(write)).toHaveLength(0);
    });
  });
});
