const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const {
  STAGING_CUSTOMER_ID,
  STAGING_SHOP_ID
} = require('../scripts/support/marketplaceStagingActions');

let tempSnapshotDir;

function runSupportScript(scriptName, args, envExtra = {}) {
  return spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'support', scriptName), ...args],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        MARKETPLACE_SNAPSHOT_DIR: tempSnapshotDir,
        ...envExtra
      },
      encoding: 'utf8'
    }
  );
}

function expectNoAdminInitCrash(result) {
  const combined = `${result.stdout || ''}${result.stderr || ''}`;
  expect(combined).not.toContain('Firebase Admin is not initialized');
}

describe('MP-16 support scripts smoke', () => {
  beforeAll(() => {
    tempSnapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp16-support-snap-'));
  });

  afterAll(() => {
    if (tempSnapshotDir && fs.existsSync(tempSnapshotDir)) {
      fs.rmSync(tempSnapshotDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    if (fs.existsSync(tempSnapshotDir)) {
      for (const name of fs.readdirSync(tempSnapshotDir)) {
        fs.unlinkSync(path.join(tempSnapshotDir, name));
      }
    }
  });

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

  it('restrict-customer --apply refuses when snapshot exists without --force', () => {
    const snapFile = path.join(tempSnapshotDir, `${STAGING_CUSTOMER_ID}.json`);
    fs.writeFileSync(snapFile, JSON.stringify({
      customerId: STAGING_CUSTOMER_ID,
      savedAt: new Date().toISOString(),
      marketplace: {}
    }), 'utf8');

    const result = runSupportScript('restrict-customer.js', [
      '--customer', STAGING_CUSTOMER_ID,
      '--reason', 'jest-smoke',
      '--operator', 'jest',
      '--apply'
    ]);
    expectNoAdminInitCrash(result);
    expect(result.status).toBe(1);
    const combined = `${result.stdout || ''}${result.stderr || ''}`;
    expect(combined.toLowerCase()).toContain('snapshot already exists');
    expect(fs.existsSync(snapFile)).toBe(true);
  });

  it('unrestrict-customer dry-run keeps snapshot file on disk', () => {
    const snapFile = path.join(tempSnapshotDir, `${STAGING_CUSTOMER_ID}.json`);
    fs.writeFileSync(snapFile, JSON.stringify({
      customerId: STAGING_CUSTOMER_ID,
      savedAt: new Date().toISOString(),
      marketplace: { restriction: { active: true } }
    }), 'utf8');

    const result = runSupportScript('unrestrict-customer.js', [
      '--customer', STAGING_CUSTOMER_ID
    ]);
    expectNoAdminInitCrash(result);
    expect(fs.existsSync(snapFile)).toBe(true);
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
