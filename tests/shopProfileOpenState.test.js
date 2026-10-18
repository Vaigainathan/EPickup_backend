const shopSettingsService = require('../src/services/shopSettingsService');
const { presentShopOpenState, presentBank } = shopSettingsService;

const ALL_DAYS = {
  monday: { closed: false, open: '09:00', close: '18:00' },
  tuesday: { closed: false, open: '09:00', close: '18:00' },
  wednesday: { closed: false, open: '09:00', close: '18:00' },
  thursday: { closed: false, open: '09:00', close: '18:00' },
  friday: { closed: false, open: '09:00', close: '18:00' },
  saturday: { closed: false, open: '09:00', close: '18:00' },
  sunday: { closed: false, open: '09:00', close: '18:00' }
};

function overnightHours() {
  const hours = { ...ALL_DAYS };
  hours.monday = { closed: false, open: '22:00', close: '06:00' };
  return hours;
}

describe('shop profile open state and bank presentation', () => {
  test('toggle off yields isOpenNow false', () => {
    const now = new Date('2026-06-15T06:30:00+05:30');
    const state = presentShopOpenState({ isOpen: false }, { storefront: { openingHours: ALL_DAYS } }, now);
    expect(state.isOpenNow).toBe(false);
    expect(state.opensAt).not.toBeNull();
    expect(state.closesAt).toBeNull();
  });

  test('no opening hours follows toggle on', () => {
    const now = new Date('2026-06-15T12:00:00+05:30');
    const state = presentShopOpenState({ isOpen: true }, { storefront: {} }, now);
    expect(state.isOpenNow).toBe(true);
    expect(state.opensAt).toBeNull();
    expect(state.closesAt).toBeNull();
  });

  test('same-day hours open inside window', () => {
    const now = new Date('2026-06-15T10:00:00+05:30');
    const state = presentShopOpenState(
      { isOpen: true },
      { storefront: { openingHours: ALL_DAYS } },
      now
    );
    expect(state.isOpenNow).toBe(true);
    expect(state.closesAt).toMatch(/\+05:30$/);
  });

  test('same-day hours closed outside window', () => {
    const now = new Date('2026-06-15T20:00:00+05:30');
    const state = presentShopOpenState(
      { isOpen: true },
      { storefront: { openingHours: ALL_DAYS } },
      now
    );
    expect(state.isOpenNow).toBe(false);
    expect(state.opensAt).toMatch(/\+05:30$/);
  });

  test('overnight window open after midnight segment', () => {
    const now = new Date('2026-06-16T01:00:00+05:30');
    const state = presentShopOpenState(
      { isOpen: true },
      { storefront: { openingHours: overnightHours() } },
      now
    );
    expect(state.isOpenNow).toBe(true);
    expect(state.closesAt).toMatch(/\+05:30$/);
  });

  test('presentBank upiRegisteredName null when empty and verified flag', () => {
    expect(presentBank({}).upiRegisteredName).toBeNull();
    expect(presentBank({ upiRegisteredName: '   ' }).upiRegisteredName).toBeNull();
    expect(presentBank({ upiRegisteredName: ' Shop Name ' }).upiRegisteredName).toBe('Shop Name');
    expect(presentBank({
      upiNameVerification: { verifiedName: 'Verified Shop' }
    }).upiNameVerified).toBe(true);
    expect(presentBank({}).upiNameVerified).toBe(false);
  });

  test('getProfile returns open fields and bank enrichment', async () => {
    const shopOnboardingService = require('../src/services/shopOnboardingService');
    jest.spyOn(shopOnboardingService, 'loadShopContext').mockResolvedValue({
      shop: { isOpen: true, shopName: 'T', shopType: 'grocery' },
      shopProfile: {
        address: 'Addr',
        bank: { upiId: 'a@b', upiRegisteredName: 'Reg' },
        storefront: { openingHours: ALL_DAYS }
      },
      userData: { name: 'Owner', email: 'o@e.com', phone: '9' }
    });
    const profile = await shopSettingsService.getProfile('shop-1');
    expect(profile).toHaveProperty('isOpenNow');
    expect(profile).toHaveProperty('opensAt');
    expect(profile).toHaveProperty('closesAt');
    expect(profile.bank.upiRegisteredName).toBe('Reg');
    expect(typeof profile.bank.upiNameVerified).toBe('boolean');
    jest.restoreAllMocks();
  });
});
