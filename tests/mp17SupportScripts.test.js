const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function runMp17(args) {
  return spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'support', 'run-mp17-jobs.js'), ...args],
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

describe('MP-17 support scripts smoke', () => {
  it('slow-tick dry-run with --now does not throw admin-not-initialized', () => {
    const result = runMp17([
      '--slow-tick',
      '--now', '2026-10-12T10:16:00.000Z'
    ]);
    expectNoAdminInitCrash(result);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"dryRun": true');
    expect(result.stdout).toContain('"job": "slow_driver"');
  });

  it('cleanup-tick dry-run does not throw admin-not-initialized', () => {
    const result = runMp17(['--cleanup-tick']);
    expectNoAdminInitCrash(result);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"dryRun": true');
    expect(result.stdout).toContain('"job": "cleanup"');
  });

  it('pool-tick dry-run does not throw admin-not-initialized', () => {
    const result = runMp17([
      '--pool-tick',
      '--now', '2026-10-12T10:00:00.000Z'
    ]);
    expectNoAdminInitCrash(result);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"dryRun": true');
    expect(result.stdout).toContain('"job": "order_number_pool"');
  });
});
