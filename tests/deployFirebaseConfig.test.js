const { spawnSync } = require('child_process');
const path = require('path');
const { planConfigDeploy } = require('../scripts/deploy-firebase-config');
const { USAGE_MESSAGE } = require('../scripts/print-guarded-deploy-usage');

describe('planConfigDeploy', () => {
  test('no --apply does not deploy', () => {
    const plan = planConfigDeploy(['--project', 'epickup-app-staging']);
    expect(plan.error).toBeUndefined();
    expect(plan.apply).toBe(false);
    expect(plan.acceptDiff).toBe(false);
    expect(plan.commands).toEqual([
      'firebase deploy --only firestore:rules --project epickup-app-staging --non-interactive',
      'firebase deploy --only storage --project epickup-app-staging --non-interactive',
      'firebase deploy --only firestore:indexes --project epickup-app-staging --non-interactive'
    ]);
    expect(plan.commands.some((command) => command.includes('--force'))).toBe(false);
  });

  test('--apply with staging returns the three commands', () => {
    const plan = planConfigDeploy(['--project', 'epickup-app-staging', '--apply']);
    expect(plan.apply).toBe(true);
    expect(plan.project).toBe('epickup-app-staging');
    expect(plan.commands).toHaveLength(3);
    expect(plan.commands[0]).toContain('--only firestore:rules');
    expect(plan.commands[1]).toContain('--only storage');
    expect(plan.commands[2]).toContain('--only firestore:indexes');
    expect(plan.commands.every((command) => command.includes('--project epickup-app-staging'))).toBe(true);
    expect(plan.commands.every((command) => command.includes('--non-interactive'))).toBe(true);
    expect(plan.commands.some((command) => command.includes('--force'))).toBe(false);
    expect(plan.acceptDiff).toBe(false);
  });

  test('--accept-diff is recorded and is not passed to firebase', () => {
    const plan = planConfigDeploy(['--project', 'epickup-app-staging', '--apply', '--accept-diff']);
    expect(plan.error).toBeUndefined();
    expect(plan.acceptDiff).toBe(true);
    expect(plan.apply).toBe(true);
    expect(plan.commands.some((command) => command.includes('accept-diff'))).toBe(false);
    expect(plan.commands.some((command) => command.includes('--force'))).toBe(false);
  });

  test('epickup-app without --confirm-production is refused', () => {
    const plan = planConfigDeploy(['--project', 'epickup-app', '--apply']);
    expect(plan.error).toBe('Refusing project epickup-app without --confirm-production');
    expect(plan.commands).toBeUndefined();
    expect(plan.apply).toBeUndefined();
  });
});

describe('print-guarded-deploy-usage', () => {
  test('prints the config-script usage and exits 1', () => {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '..', 'scripts', 'print-guarded-deploy-usage.js')
    ], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe(USAGE_MESSAGE);
    expect(USAGE_MESSAGE).toBe('Use node scripts/deploy-firebase-config.js --project <id> --apply');
  });
});
