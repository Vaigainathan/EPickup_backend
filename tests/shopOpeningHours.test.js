const {
  WEEKDAYS,
  validateOpeningHours,
  isShopOpenNow,
  isShopOpenForMarketplaceOrder,
  nextOpensAt,
  currentClosesAt,
  istParts
} = require('../src/utils/shopOpeningHours');

function fullWeek(overrides = {}) {
  const hours = {};
  for (let index = 0; index < WEEKDAYS.length; index += 1) {
    const day = WEEKDAYS[index];
    hours[day] = Object.prototype.hasOwnProperty.call(overrides, day)
      ? overrides[day]
      : { closed: true };
  }
  return hours;
}

function mondayOvernightWeek() {
  return fullWeek({
    monday: { closed: false, open: '18:00', close: '02:00' }
  });
}

describe('shopOpeningHours overnight (IST)', () => {
  const openingHours = mondayOvernightWeek();

  test('Monday 17:59 closed with opensAt Monday 18:00', () => {
    const now = new Date('2026-06-15T17:59:00+05:30');
    expect(isShopOpenNow({ isOpen: true, openingHours, now })).toBe(false);
    expect(nextOpensAt({ openingHours, now })).toBe('2026-06-15T18:00:00+05:30');
  });

  test('Monday 23:00 open, closesAt Tuesday 02:00', () => {
    const now = new Date('2026-06-15T23:00:00+05:30');
    expect(isShopOpenNow({ isOpen: true, openingHours, now })).toBe(true);
    expect(currentClosesAt({ openingHours, now })).toBe('2026-06-16T02:00:00+05:30');
  });

  test('Tuesday 01:30 open via Monday overnight, closesAt Tuesday 02:00', () => {
    const now = new Date('2026-06-16T01:30:00+05:30');
    expect(isShopOpenNow({ isOpen: true, openingHours, now })).toBe(true);
    expect(currentClosesAt({ openingHours, now })).toBe('2026-06-16T02:00:00+05:30');
  });

  test('Tuesday 02:00 closed', () => {
    const now = new Date('2026-06-16T02:00:00+05:30');
    expect(isShopOpenNow({ isOpen: true, openingHours, now })).toBe(false);
  });

  test('Monday closed:true — no overnight carry to Tuesday 01:30', () => {
    const hours = fullWeek({ monday: { closed: true } });
    const now = new Date('2026-06-16T01:30:00+05:30');
    expect(isShopOpenNow({ isOpen: true, openingHours: hours, now })).toBe(false);
  });

  test('same-day 06:00–21:00 unchanged', () => {
    const hours = fullWeek({
      monday: { closed: false, open: '06:00', close: '21:00' }
    });
    const inside = new Date('2026-06-15T12:00:00+05:30');
    const outside = new Date('2026-06-15T05:00:00+05:30');
    expect(isShopOpenNow({ isOpen: true, openingHours: hours, now: inside })).toBe(true);
    expect(currentClosesAt({ openingHours: hours, now: inside })).toBe(
      '2026-06-15T21:00:00+05:30'
    );
    expect(isShopOpenNow({ isOpen: true, openingHours: hours, now: outside })).toBe(false);
  });

  test('same-day 12:00–23:00 unchanged', () => {
    const hours = fullWeek({
      monday: { closed: false, open: '12:00', close: '23:00' }
    });
    const inside = new Date('2026-06-15T15:00:00+05:30');
    expect(isShopOpenNow({ isOpen: true, openingHours: hours, now: inside })).toBe(true);
    expect(currentClosesAt({ openingHours: hours, now: inside })).toBe(
      '2026-06-15T23:00:00+05:30'
    );
  });

  test('legacy start/end overnight matches new shape', () => {
    const hours = fullWeek({
      monday: { start: '18:00', end: '02:00' }
    });
    const now = new Date('2026-06-16T01:30:00+05:30');
    expect(isShopOpenNow({ isOpen: true, openingHours: hours, now })).toBe(true);
    expect(currentClosesAt({ openingHours: hours, now })).toBe('2026-06-16T02:00:00+05:30');
  });

  test('toggle off forces closed', () => {
    const now = new Date('2026-06-15T23:00:00+05:30');
    expect(isShopOpenNow({ isOpen: false, openingHours, now })).toBe(false);
  });

  test('createOrder gate matches isShopOpenNow at Tuesday 01:30', () => {
    const now = new Date('2026-06-16T01:30:00+05:30');
    const shopProfile = { storefront: { openingHours } };
    const shopIdentity = { isOpen: true };
    expect(
      isShopOpenForMarketplaceOrder({ shopIdentity, shopProfile, now })
    ).toBe(true);
    expect(isShopOpenNow({ isOpen: true, openingHours, now })).toBe(true);
  });

  test('UTC server instant resolves to IST Tuesday 01:30', () => {
    const now = new Date('2026-06-15T20:00:00.000Z');
    expect(istParts(now).weekday).toBe('tuesday');
    expect(istParts(now).minutes).toBe(90);
    expect(isShopOpenNow({ isOpen: true, openingHours, now })).toBe(true);
    expect(currentClosesAt({ openingHours, now })).toBe('2026-06-16T02:00:00+05:30');
  });

  test('nextOpensAt at Tuesday 03:00 after Mon/Tue overnight windows', () => {
    const hours = fullWeek({
      monday: { closed: false, open: '18:00', close: '02:00' },
      tuesday: { closed: false, open: '18:00', close: '02:00' }
    });
    const now = new Date('2026-06-16T03:00:00+05:30');
    expect(isShopOpenNow({ isOpen: true, openingHours: hours, now })).toBe(false);
    expect(nextOpensAt({ openingHours: hours, now })).toBe('2026-06-16T18:00:00+05:30');
  });

  test('card-style opensAt is null while open via Monday overnight (Tuesday 01:30)', () => {
    const now = new Date('2026-06-16T01:30:00+05:30');
    const isOpenNow = isShopOpenNow({ isOpen: true, openingHours, now });
    const opensAt = isOpenNow ? null : nextOpensAt({ openingHours, now });
    expect(isOpenNow).toBe(true);
    expect(opensAt).toBeNull();
  });
});

describe('validateOpeningHours overnight', () => {
  function closedWeekExcept(mondayEntry) {
    const input = fullWeek({ monday: mondayEntry });
    return input;
  }

  test('accepts monday 18:00 to 02:00', () => {
    const input = closedWeekExcept({ closed: false, open: '18:00', close: '02:00' });
    const normalized = validateOpeningHours(input);
    expect(normalized.monday).toEqual({
      closed: false,
      open: '18:00',
      close: '02:00'
    });
  });

  test('rejects monday 12:00 to 12:00 with same error as before', () => {
    const input = closedWeekExcept({ closed: false, open: '12:00', close: '12:00' });
    try {
      validateOpeningHours(input);
      throw new Error('expected throw');
    } catch (error) {
      expect(error.code).toBe('INVALID_OPENING_HOURS');
      expect(error.message).toBe('monday close must be after open on the same day');
    }
  });

  test('rejects missing open/close when not closed', () => {
    const input = closedWeekExcept({ closed: false, open: '09:00' });
    try {
      validateOpeningHours(input);
      throw new Error('expected throw');
    } catch (error) {
      expect(error.code).toBe('INVALID_OPENING_HOURS');
      expect(error.message).toBe('monday requires open and close when not closed');
    }
  });

  test('rejects invalid clock strings', () => {
    const input = closedWeekExcept({ closed: false, open: '25:00', close: '02:00' });
    try {
      validateOpeningHours(input);
      throw new Error('expected throw');
    } catch (error) {
      expect(error.code).toBe('INVALID_OPENING_HOURS');
      expect(error.message).toBe('monday requires open and close when not closed');
    }
  });
});
