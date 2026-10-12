const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const {
  STAGING_CUSTOMER_ID,
  STAGING_SHOP_ID
} = require('../scripts/support/marketplaceStagingActions');

function runSupportScript(scriptName, args) {
  return spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'support', scriptName), ...args],
    {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8'
    }
  );
}

function expectNoAdminInitCrash(result) {
  const combined = `${result.stdout || ''}${result.stderr || ''}`;
  expect(combined).not.toContain('Firebase Admin is not initialized');
}

describe('MP-16 support scripts smoke', () => {
  it('restrict-customer dry-run does not throw admin-not-initialized', () => {
    const result = runSupportScript('restrict-customer.js', [
      '--customer', STAGING_CUSTOMER_ID,
      '--reason', 'jest-smoke',
      '--operator', 'jest'
    ]);
    expectNoAdminInitCrash(result);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"dryRun": true');
  });

  it('unrestrict-customer without snapshot exits cleanly', () => {
    const result = runSupportScript('unrestrict-customer.js', [
      '--customer', STAGING_CUSTOMER_ID
    ]);
    expectNoAdminInitCrash(result);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No snapshot found');
  });

  it('suspend-shop dry-run does not throw admin-not-initialized', () => {
    const result = runSupportScript('suspend-shop.js', [
      '--shop', STAGING_SHOP_ID,
      '--reason', 'jest-smoke',
      '--operator', 'jest'
    ]);
    expectNoAdminInitCrash(result);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"dryRun": true');
  });

  it('resolve-paid-check dry-run does not throw admin-not-initialized', () => {
    const result = runSupportScript('resolve-paid-check.js', [
      '--order', 'nonexistent-order-smoke',
      '--outcome', 'received',
      '--operator', 'jest'
    ]);
    expectNoAdminInitCrash(result);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Order not found');
  });
});
