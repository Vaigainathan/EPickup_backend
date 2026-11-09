const {
  buildDriverReleaseUpdate,
  applyDriverReleaseInTransaction
} = require('../src/services/releaseDriverOnBookingCancel');

describe('releaseDriverOnBookingCancel', () => {
  test('buildDriverReleaseUpdate clears pointer and sets isAvailable only when online', () => {
    const patch = buildDriverReleaseUpdate(
      {
        driver: { currentBookingId: 'b1', isOnline: true, isAvailable: false }
      },
      'b1'
    );
    expect(patch).toEqual({
      'driver.currentBookingId': null,
      'driver.isAvailable': true,
      updatedAt: expect.any(Date)
    });
  });

  test('buildDriverReleaseUpdate skips isAvailable when offline', () => {
    const patch = buildDriverReleaseUpdate(
      {
        driver: { currentBookingId: 'b1', isOnline: false }
      },
      'b1'
    );
    expect(patch).toEqual({
      'driver.currentBookingId': null,
      updatedAt: expect.any(Date)
    });
    expect(patch['driver.isAvailable']).toBeUndefined();
  });

  test('buildDriverReleaseUpdate returns null on pointer mismatch', () => {
    expect(
      buildDriverReleaseUpdate(
        { driver: { currentBookingId: 'other' } },
        'b1'
      )
    ).toBeNull();
  });

  test('applyDriverReleaseInTransaction updates when patch applies', () => {
    const tx = { update: jest.fn() };
    const ref = {};
    const snap = {
      exists: true,
      data: () => ({ driver: { currentBookingId: 'b1', isOnline: true } })
    };
    const result = applyDriverReleaseInTransaction(tx, ref, snap, 'b1');
    expect(result).toEqual({ released: true });
    expect(tx.update).toHaveBeenCalledWith(ref, expect.objectContaining({
      'driver.currentBookingId': null,
      'driver.isAvailable': true
    }));
  });
});
