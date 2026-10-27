const {
  isShopOpenNow,
  nextOpensAt,
  inspectOpeningHours,
  validateOpeningHours,
  normalizeStoredDayEntry
} = require('../src/utils/shopOpeningHours');

const weekWithStaleSunday = {
  monday: { closed: false, open: '09:00', close: '21:00' },
  tuesday: { closed: false, open: '09:00', close: '21:00' },
  wednesday: { closed: false, open: '09:00', close: '21:00' },
  thursday: { closed: false, open: '09:00', close: '21:00' },
  friday: { closed: false, open: '09:00', close: '21:00' },
  saturday: { closed: false, open: '09:00', close: '21:00' },
  sunday: { closed: true, open: '09:00', close: '21:00' }
};

describe('opening hours stale closed-day keys', () => {
  test('closed:true wins over stale open/close for isShopOpenNow on Sunday', () => {
    const now = new Date('2026-06-14T12:00:00+05:30');
    const isOpen = isShopOpenNow({
      isOpen: true,
      openingHours: weekWithStaleSunday,
      now
    });
    expect(isOpen).toBe(false);
  });

  test('nextOpensAt ignores stale sunday window and uses monday', () => {
    const now = new Date('2026-06-14T12:00:00+05:30');
    const opensAt = nextOpensAt({
      openingHours: weekWithStaleSunday,
      now
    });
    expect(opensAt).toContain('2026-06-15');
    expect(opensAt).toContain('09:00:00+05:30');
  });

  test('inspectOpeningHours warns but reading still works', () => {
    const inspection = inspectOpeningHours(weekWithStaleSunday);
    expect(inspection.valid).toBe(false);
    expect(inspection.warnings.some((row) => /sunday/i.test(row))).toBe(true);
  });

  test('validateOpeningHours normalizes closed day to only closed', () => {
    const normalized = validateOpeningHours(weekWithStaleSunday);
    expect(normalized.sunday).toEqual({ closed: true });
  });

  test('normalizeStoredDayEntry strips stale keys', () => {
    expect(normalizeStoredDayEntry({ closed: true, open: '09:00', close: '21:00' }))
      .toEqual({ closed: true });
  });
});
