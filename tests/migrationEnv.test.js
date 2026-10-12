const { parseMigrationArgv, migrationTargetFromEnv } = require('../scripts/migrationEnv');

describe('parseMigrationArgv', () => {
  test('defaults to dry run', () => {
    expect(parseMigrationArgv([])).toEqual({
      apply: false,
      confirmProduction: false,
      stripLegacy: false,
      limit: null,
      startAfter: null
    });
  });

  test('parses resume flags', () => {
    expect(parseMigrationArgv(['--apply', '--limit', '50', '--start-after', 'abc123'])).toEqual({
      apply: true,
      confirmProduction: false,
      stripLegacy: false,
      limit: 50,
      startAfter: 'abc123'
    });
  });

  test('rejects unknown flags', () => {
    expect(parseMigrationArgv(['--nope']).error).toMatch(/Unknown argument/);
  });
});

describe('migrationTargetFromEnv', () => {
  const original = process.env.FIREBASE_PROJECT_ID;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FIREBASE_PROJECT_ID;
    } else {
      process.env.FIREBASE_PROJECT_ID = original;
    }
  });

  test('detects staging and production', () => {
    process.env.FIREBASE_PROJECT_ID = 'epickup-app-staging';
    expect(migrationTargetFromEnv()).toBe('staging');
    process.env.FIREBASE_PROJECT_ID = 'epickup-app';
    expect(migrationTargetFromEnv()).toBe('production');
  });
});
