const {
  validateOpeningHours,
  isShopOpenNow,
  shopOpenToggleIsOn,
  isShopOpenForMarketplaceOrder,
  WEEKDAYS
} = require('../src/utils/shopOpeningHours');
const {
  mergeBankAfterUpiRegisteredName,
  mergeBankAfterUpiVerify,
  mergeBankAfterSaveDetails,
  isVerified
} = require('../src/utils/shopBankMerge');
const {
  assertStagingShopId,
  planShopApproval,
  STAGING_SHOP_ID
} = require('../scripts/support/approveShopActions');
const {
  storefrontPhotoExt,
  MAX_STOREFRONT_PHOTO_BYTES
} = require('../src/services/shopStorefrontService');

function fullWeek(overrides = {}) {
  const base = {};
  WEEKDAYS.forEach((day) => {
    base[day] = { closed: false, open: '09:00', close: '21:00' };
  });
  return { ...base, ...overrides };
}

function istDate(weekday, hour, minute) {
  const targetMinutes = (hour * 60) + minute;
  const candidate = new Date('2026-01-05T00:00:00.000Z');
  for (let step = 0; step < 14 * 24 * 60; step += 30) {
    const probe = new Date(candidate.getTime() + (step * 60 * 1000));
    const open = isShopOpenNow({
      isOpen: true,
      openingHours: fullWeek({ [weekday]: { closed: false, open: '00:00', close: '23:59' } }),
      now: probe
    });
    if (!open) {
      continue;
    }
    const parts = require('../src/utils/shopOpeningHours').istParts(probe);
    if (parts.weekday === weekday && parts.minutes === targetMinutes) {
      return probe;
    }
  }
  throw new Error(`Could not build IST date for ${weekday} ${hour}:${minute}`);
}

describe('MP-12 shop profile', () => {
  describe('opening hours validation', () => {
    it('accepts monday through sunday with open and close', () => {
      const normalized = validateOpeningHours(fullWeek());
      expect(normalized.monday).toEqual({ closed: false, open: '09:00', close: '21:00' });
    });

    it('rejects overnight ranges', () => {
      expect(() => validateOpeningHours(fullWeek({
        tuesday: { closed: false, open: '22:00', close: '06:00' }
      }))).toThrow(/after open/);
    });

    it('rejects extra keys on a day', () => {
      expect(() => validateOpeningHours(fullWeek({
        wednesday: { closed: false, open: '09:00', close: '17:00', start: '08:00' }
      }))).toThrow(/invalid field/);
    });

    it('rejects legacy start/end field names', () => {
      expect(() => validateOpeningHours({
        monday: { closed: false, start: '09:00', end: '17:00' },
        tuesday: { closed: true },
        wednesday: { closed: true },
        thursday: { closed: true },
        friday: { closed: true },
        saturday: { closed: true },
        sunday: { closed: true }
      })).toThrow(/invalid field/);
    });
  });

  describe('shop open toggle source', () => {
    it('reads users.shop.isOpen only, not shops profile top-level isOpen', () => {
      expect(shopOpenToggleIsOn({ isOpen: true })).toBe(true);
      expect(shopOpenToggleIsOn({ isOpen: false })).toBe(false);
      expect(shopOpenToggleIsOn({})).toBe(false);
      const hours = fullWeek({ monday: { closed: false, open: '00:00', close: '23:59' } });
      const now = istDate('monday', 12, 0);
      expect(isShopOpenForMarketplaceOrder({
        shopIdentity: { isOpen: true },
        shopProfile: { storefront: { openingHours: hours } },
        now
      })).toBe(true);
      expect(isShopOpenForMarketplaceOrder({
        shopIdentity: { isOpen: false },
        shopProfile: { isOpen: true, storefront: { openingHours: hours } },
        now
      })).toBe(false);
    });
  });

  describe('isShopOpenNow', () => {
    const hours = fullWeek({
      monday: { closed: false, open: '10:00', close: '18:00' }
    });

    it('is open when toggle is on and openingHours is null', () => {
      expect(isShopOpenNow({ isOpen: true, openingHours: null })).toBe(true);
    });

    it('is closed when toggle is off', () => {
      expect(isShopOpenNow({ isOpen: false, openingHours: hours })).toBe(false);
    });

    it('is closed on a closed day', () => {
      const now = istDate('monday', 12, 0);
      const closedMonday = fullWeek({ monday: { closed: true } });
      expect(isShopOpenNow({ isOpen: true, openingHours: closedMonday, now })).toBe(false);
    });

    it('is open inside open-close window in IST', () => {
      const now = istDate('monday', 12, 0);
      expect(isShopOpenNow({ isOpen: true, openingHours: hours, now })).toBe(true);
    });

    it('is closed before open and at or after close', () => {
      const before = istDate('monday', 9, 30);
      const atClose = istDate('monday', 18, 0);
      expect(isShopOpenNow({ isOpen: true, openingHours: hours, now: before })).toBe(false);
      expect(isShopOpenNow({ isOpen: true, openingHours: hours, now: atClose })).toBe(false);
    });

    it('reads legacy start/end shape on the same day', () => {
      const legacyHours = { monday: { start: '10:00', end: '18:00' }, tuesday: {}, wednesday: {}, thursday: {}, friday: {}, saturday: {}, sunday: {} };
      const now = istDate('monday', 12, 0);
      expect(isShopOpenNow({ isOpen: true, openingHours: legacyHours, now })).toBe(true);
      const before = istDate('monday', 9, 0);
      const atEnd = istDate('monday', 18, 0);
      expect(isShopOpenNow({ isOpen: true, openingHours: legacyHours, now: before })).toBe(false);
      expect(isShopOpenNow({ isOpen: true, openingHours: legacyHours, now: atEnd })).toBe(false);
    });

    it('rejects legacy overnight ranges (no wrap)', () => {
      const legacyOvernight = { monday: { start: '22:00', end: '06:00' }, tuesday: {}, wednesday: {}, thursday: {}, friday: {}, saturday: {}, sunday: {} };
      const now = istDate('monday', 23, 0);
      expect(isShopOpenNow({ isOpen: true, openingHours: legacyOvernight, now })).toBe(false);
    });

    it('validates close > open when times are present', () => {
      expect(() => validateOpeningHours(fullWeek({
        monday: { closed: false, open: '22:00', close: '06:00' }
      }))).toThrow(/after open/);
    });
  });

  describe('storefront photo bytes', () => {
    it('accepts JPEG and PNG magic bytes', () => {
      const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00]);
      const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D]);
      expect(storefrontPhotoExt(jpeg)).toBe('jpg');
      expect(storefrontPhotoExt(png)).toBe('png');
    });

    it('rejects non-image buffers', () => {
      expect(() => storefrontPhotoExt(Buffer.from('not-an-image'))).toThrow(/JPEG or PNG/);
    });

    it('enforces 5MB limit constant', () => {
      expect(MAX_STOREFRONT_PHOTO_BYTES).toBe(5 * 1024 * 1024);
      const big = Buffer.alloc(MAX_STOREFRONT_PHOTO_BYTES + 1);
      big[0] = 0xFF;
      big[1] = 0xD8;
      big[2] = 0xFF;
      expect(big.length).toBeGreaterThan(MAX_STOREFRONT_PHOTO_BYTES);
    });
  });

  describe('UPI registered name and bank merge', () => {
    const verification = {
      verifiedName: 'Acme Payee',
      method: 'manual',
      verifiedBy: 'script',
      verifiedAt: new Date()
    };

    it('clears verification when the registered name changes', () => {
      const bank = mergeBankAfterUpiRegisteredName(
        { upiRegisteredName: 'Old Name', upiNameVerification: verification },
        'New Name'
      );
      expect(bank.upiRegisteredName).toBe('New Name');
      expect(bank.upiNameVerification).toBeUndefined();
    });

    it('keeps verification when the trimmed name is unchanged', () => {
      const bank = mergeBankAfterUpiRegisteredName(
        { upiRegisteredName: 'Same', upiNameVerification: verification },
        'Same'
      );
      expect(bank.upiNameVerification).toEqual(verification);
      expect(isVerified(bank)).toBe(true);
    });

    it('drops verification when upiId changes but keeps upiRegisteredName on save', () => {
      const bank = mergeBankAfterSaveDetails(
        {
          upiId: 'old@upi',
          upiRegisteredName: 'Shop Payee',
          upiNameVerification: verification
        },
        {
          accountHolderName: 'A',
          bankName: 'B',
          accountNumberEncrypted: 'x',
          accountNumberLast4: '1234',
          ifsc: 'HDFC0001234',
          upiId: 'new@upi',
          upiVerifiedAt: new Date()
        }
      );
      expect(bank.upiRegisteredName).toBe('Shop Payee');
      expect(bank.upiNameVerification).toBeUndefined();
    });

    it('drops verification on UPI verify when the id changes', () => {
      const bank = mergeBankAfterUpiVerify(
        { upiId: 'a@upi', upiNameVerification: verification, upiRegisteredName: 'Payee' },
        'b@upi',
        new Date()
      );
      expect(bank.upiRegisteredName).toBe('Payee');
      expect(bank.upiNameVerification).toBeUndefined();
    });
  });

  describe('approve-shop helpers', () => {
    it('refuses approval without a verified name', () => {
      const plan = planShopApproval({ approvalStatus: 'pending', bank: {} });
      expect(plan.ok).toBe(false);
    });

    it('writes only on transition to approved', () => {
      const plan = planShopApproval({
        approvalStatus: 'pending',
        bank: { upiNameVerification: { verifiedName: 'Verified Shop' } }
      });
      expect(plan.ok).toBe(true);
      expect(plan.noop).toBe(false);
    });

    it('is a no-op when already approved', () => {
      const plan = planShopApproval({
        approvalStatus: 'approved',
        bank: { upiNameVerification: { verifiedName: 'Verified Shop' } }
      });
      expect(plan.ok).toBe(true);
      expect(plan.noop).toBe(true);
    });
  });

  describe('staging shop lock', () => {
    it('allows only the staging shop id', () => {
      expect(assertStagingShopId(STAGING_SHOP_ID).ok).toBe(true);
      expect(assertStagingShopId('other-shop').ok).toBe(false);
    });
  });
});
