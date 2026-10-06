const { decideParcelLock } = require('../src/services/customerParcelLock');

function lockTo(booking, key) {
  return {
    lock: { bookingId: 'booking-1', idempotencyKey: key },
    booking: { id: 'booking-1', idempotencyKey: key, ...booking }
  };
}

describe('decideParcelLock', () => {
  test('no lock is free', () => {
    expect(decideParcelLock({ lock: null, booking: null, requestKey: 'key-a' })).toEqual({ action: 'free' });
  });

  test('a lock whose booking is missing is free', () => {
    expect(decideParcelLock({
      lock: { bookingId: 'booking-1' },
      booking: null,
      requestKey: 'key-a'
    })).toEqual({ action: 'free' });
  });

  test('a cancelled booking is free', () => {
    expect(decideParcelLock({
      ...lockTo({ status: 'cancelled', sourceType: 'parcel' }, 'key-a'),
      requestKey: 'key-b'
    })).toEqual({ action: 'free' });
  });

  test('a completed booking is free', () => {
    expect(decideParcelLock({
      ...lockTo({ status: 'completed', sourceType: 'parcel' }, 'key-a'),
      requestKey: 'key-b'
    })).toEqual({ action: 'free' });
  });

  test('a delivered booking is free', () => {
    expect(decideParcelLock({
      ...lockTo({ status: 'delivered', sourceType: 'parcel' }, 'key-a'),
      requestKey: 'key-b'
    })).toEqual({ action: 'free' });
  });

  test('a pending booking with the same key is reuse', () => {
    expect(decideParcelLock({
      ...lockTo({ status: 'pending', sourceType: 'parcel' }, 'key-a'),
      requestKey: 'key-a'
    })).toEqual({ action: 'reuse' });
  });

  test('a pending booking with another key is conflict', () => {
    expect(decideParcelLock({
      ...lockTo({ status: 'pending', sourceType: 'parcel' }, 'key-a'),
      requestKey: 'key-b'
    })).toEqual({ action: 'conflict' });
  });

  test('a pending booking with no sourceType is a conflict', () => {
    expect(decideParcelLock({
      ...lockTo({ status: 'pending' }, 'key-a'),
      requestKey: 'key-b'
    })).toEqual({ action: 'conflict' });
  });

  test('a marketplace booking is free', () => {
    expect(decideParcelLock({
      ...lockTo({ status: 'pending', sourceType: 'marketplace' }, 'key-a'),
      requestKey: 'key-b'
    })).toEqual({ action: 'free' });
  });
});
