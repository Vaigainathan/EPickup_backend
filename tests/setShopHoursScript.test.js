const { spawnSync } = require('child_process');
const path = require('path');
const {
  DELETE_FIELD,
  parseSetShopHoursArgv,
  validateArgvPlan,
  parseTimeWindow,
  buildPlannedOpeningHours,
  buildFirestoreUpdate,
  computeMarketplacePreview
} = require('../scripts/support/setShopHoursActions');

const ROOT = path.join(__dirname, '..');
const STAGING_SHOP = 'b7302f5d6343c1641d63811306eb';

function runSetShopHours(args) {
  return spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'support', 'set-shop-hours.js'), ...args],
    {
      cwd: ROOT,
      env: { ...process.env },
      encoding: 'utf8'
    }
  );
}

function expectNoAdminInitCrash(result) {
  const combined = `${result.stdout || ''}${result.stderr || ''}`;
  expect(combined).not.toContain('Firebase Admin is not initialized');
}

describe('setShopHoursActions', () => {
  test('parseSetShopHoursArgv --all and --day', () => {
    const parsed = parseSetShopHoursArgv([
      'node', 'script',
      '--shop', STAGING_SHOP,
      '--all', '09:00-21:00',
      '--apply'
    ]);
    expect(parsed.shopId).toBe(STAGING_SHOP);
    expect(parsed.allWindow).toEqual({ open: '09:00', close: '21:00' });
    expect(parsed.apply).toBe(true);
  });

  test('parseSetShopHoursArgv multiple --day and closed sunday', () => {
    const parsed = parseSetShopHoursArgv([
      'node', 'script',
      '--shop', STAGING_SHOP,
      '--day', 'mon', '18:00-02:00',
      '--day', 'sun', 'closed'
    ]);
    expect(parsed.dayPatches).toEqual([
      { day: 'monday', closed: false, open: '18:00', close: '02:00' },
      { day: 'sunday', closed: true }
    ]);
  });

  test('parseSetShopHoursArgv --show', () => {
    const parsed = parseSetShopHoursArgv([
      'node', 'script',
      '--shop', STAGING_SHOP,
      '--show'
    ]);
    expect(parsed.show).toBe(true);
    expect(parsed.clear).toBe(false);
  });

  test('validateArgvPlan missing --shop', () => {
    const parsed = parseSetShopHoursArgv(['node', 'script', '--show']);
    const result = validateArgvPlan(parsed);
    expect(result.ok).toBe(false);
  });

  test('validateArgvPlan refuses wrong shop before Firestore', () => {
    const parsed = parseSetShopHoursArgv([
      'node', 'script',
      '--shop', 'other-shop-id',
      '--show'
    ]);
    const result = validateArgvPlan(parsed);
    expect(result.ok).toBe(false);
    expect(result.message).toContain(STAGING_SHOP);
  });

  test('invalid hours throw from buildPlannedOpeningHours', () => {
    const parsed = parseSetShopHoursArgv([
      'node', 'script',
      '--shop', STAGING_SHOP,
      '--all', '09:00-09:00'
    ]);
    expect(() => buildPlannedOpeningHours(parsed, null)).toThrow('close must be after open');
  });

  test('buildPlannedOpeningHours --day seeds missing days as closed', () => {
    const parsed = parseSetShopHoursArgv([
      'node', 'script',
      '--shop', STAGING_SHOP,
      '--day', 'mon', '09:00-21:00'
    ]);
    const plan = buildPlannedOpeningHours(parsed, null);
    expect(plan.daysDefaultedToClosed).toContain('tuesday');
    expect(plan.hoursAfter.monday).toEqual({
      closed: false,
      open: '09:00',
      close: '21:00'
    });
    expect(plan.hoursAfter.sunday).toEqual({ closed: true });
  });

  test('--clear plan removes only openingHours field', () => {
    const parsed = parseSetShopHoursArgv([
      'node', 'script',
      '--shop', STAGING_SHOP,
      '--clear'
    ]);
    const plan = buildPlannedOpeningHours(parsed, { monday: { closed: true } });
    expect(plan.clear).toBe(true);
    expect(plan.hoursAfter).toBeNull();
    const update = buildFirestoreUpdate({ clear: true, hoursAfter: null });
    expect(Object.keys(update)).toEqual(['storefront.openingHours']);
    expect(update['storefront.openingHours']).toBe(DELETE_FIELD);
  });

  test('parseTimeWindow normalizes single-digit hours', () => {
    expect(parseTimeWindow('9:00-21:00')).toEqual({ open: '09:00', close: '21:00' });
  });

  test('computeMarketplacePreview toggle-only when no hours', () => {
    const now = new Date('2026-06-15T12:00:00+05:30');
    const preview = computeMarketplacePreview({
      shopIdentity: { isOpen: true },
      openingHours: null,
      now
    });
    expect(preview.isOpenNow).toBe(true);
    expect(preview.opensAt).toBeNull();
    expect(preview.closesAt).toBeNull();
  });
});

describe('set-shop-hours.js smoke', () => {
  it('--show on staging shop does not throw admin-not-initialized', () => {
    const result = runSetShopHours(['--shop', STAGING_SHOP, '--show']);
    expectNoAdminInitCrash(result);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"previewBefore"');
    expect(result.stdout).toContain('"apply": false');
    expect(result.stdout).not.toContain('Updated shops/');
  });

  it('wrong --shop exits non-zero before Firestore', () => {
    const result = runSetShopHours(['--shop', 'not-the-staging-shop', '--show']);
    expect(result.status).not.toBe(0);
    expect(result.stderr || result.stdout).toContain(STAGING_SHOP);
    expectNoAdminInitCrash(result);
  });
});
