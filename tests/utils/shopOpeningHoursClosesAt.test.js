const {
  isShopOpenNow,
  currentClosesAt,
  isInsideOpenWindow
} = require('../../src/utils/shopOpeningHours');

const weekdayHours = {
  monday: { closed: false, open: '09:00', close: '21:00' },
  tuesday: { closed: false, open: '09:00', close: '21:00' },
  wednesday: { closed: false, open: '09:00', close: '21:00' },
  thursday: { closed: false, open: '09:00', close: '21:00' },
  friday: { closed: false, open: '09:00', close: '21:00' },
  saturday: { closed: false, open: '09:00', close: '21:00' },
  sunday: { closed: false, open: '09:00', close: '21:00' }
};

describe('currentClosesAt (B3 / C3)', () => {
  test('null when no opening hours', () => {
    const now = new Date('2026-06-15T12:00:00+05:30');
    expect(currentClosesAt({ openingHours: null, now })).toBeNull();
    expect(
      isShopOpenNow({ isOpen: true, openingHours: null, now })
    ).toBe(true);
  });

  test('null when outside window', () => {
    const now = new Date('2026-06-15T07:00:00+05:30');
    expect(
      isShopOpenNow({ isOpen: true, openingHours: weekdayHours, now })
    ).toBe(false);
    expect(currentClosesAt({ openingHours: weekdayHours, now })).toBeNull();
  });

  test('returns today close ISO when open inside window', () => {
    const now = new Date('2026-06-15T12:00:00+05:30');
    expect(
      isShopOpenNow({ isOpen: true, openingHours: weekdayHours, now })
    ).toBe(true);
    expect(currentClosesAt({ openingHours: weekdayHours, now })).toBe(
      '2026-06-15T21:00:00+05:30'
    );
  });

  test('legacy start/end shape', () => {
    const legacy = {
      monday: { start: '10:00', end: '18:00' },
      tuesday: { start: '10:00', end: '18:00' },
      wednesday: { start: '10:00', end: '18:00' },
      thursday: { start: '10:00', end: '18:00' },
      friday: { start: '10:00', end: '18:00' },
      saturday: { start: '10:00', end: '18:00' },
      sunday: { start: '10:00', end: '18:00' }
    };
    const now = new Date('2026-06-15T14:00:00+05:30');
    expect(currentClosesAt({ openingHours: legacy, now })).toBe(
      '2026-06-15T18:00:00+05:30'
    );
  });

  test('overnight window (close before open on same day) is not supported', () => {
    const overnight = {
      monday: { closed: false, open: '18:00', close: '02:00' },
      tuesday: { closed: false, open: '18:00', close: '02:00' },
      wednesday: { closed: false, open: '18:00', close: '02:00' },
      thursday: { closed: false, open: '18:00', close: '02:00' },
      friday: { closed: false, open: '18:00', close: '02:00' },
      saturday: { closed: false, open: '18:00', close: '02:00' },
      sunday: { closed: false, open: '18:00', close: '02:00' }
    };
    const evening = new Date('2026-06-15T20:00:00+05:30');
    expect(isInsideOpenWindow(overnight.monday, 20 * 60)).toBe(false);
    expect(
      isShopOpenNow({ isOpen: true, openingHours: overnight, now: evening })
    ).toBe(false);
    expect(currentClosesAt({ openingHours: overnight, now: evening })).toBeNull();
  });
});
