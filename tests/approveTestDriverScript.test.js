const { spawnSync } = require('child_process');
const path = require('path');
const {
  parseApproveTestDriverArgv,
  validateApproveTestDriverArgv,
  assertDriverUser,
  planDocumentVerifications,
  planDriverApproval,
  planWalletTopUp,
  buildApprovalPreview,
  isDriverDocumentPresent
} = require('../scripts/support/approveTestDriverActions');

const ROOT = path.join(__dirname, '..');

function runApproveTestDriver(args, envExtra = {}) {
  return spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'support', 'approve-test-driver.js'), ...args],
    {
      cwd: ROOT,
      env: { ...process.env, ...envExtra },
      encoding: 'utf8'
    }
  );
}

describe('approveTestDriverActions', () => {
  test('parseApproveTestDriverArgv reads driver, points, and apply', () => {
    const parsed = parseApproveTestDriverArgv([
      'node', 'script',
      '--driver', 'driver-1',
      '--points', '500',
      '--apply'
    ]);
    expect(parsed.driverId).toBe('driver-1');
    expect(parsed.points).toBe(500);
    expect(parsed.apply).toBe(true);
  });

  test('validateApproveTestDriverArgv rejects missing driver', () => {
    const result = validateApproveTestDriverArgv(parseApproveTestDriverArgv(['node', 'script']));
    expect(result.ok).toBe(false);
  });

  test('validateApproveTestDriverArgv rejects invalid points', () => {
    const result = validateApproveTestDriverArgv(parseApproveTestDriverArgv([
      'node', 'script',
      '--driver', 'driver-1',
      '--points', 'abc'
    ]));
    expect(result.ok).toBe(false);
    expect(result.message).toContain('--points');
  });

  test('assertDriverUser refuses non-driver', () => {
    expect(assertDriverUser({ userType: 'customer' }).ok).toBe(false);
    expect(assertDriverUser({ userType: 'driver' }).ok).toBe(true);
  });

  test('planDocumentVerifications only includes present unverified docs', () => {
    const documents = {
      driving_license: { url: 'https://example.com/dl.jpg', status: 'pending' },
      profile_photo: { url: 'https://example.com/photo.jpg', verified: true }
    };
    const plan = planDocumentVerifications(documents);
    expect(plan).toHaveLength(1);
    expect(plan[0].documentType).toBe('drivingLicense');
    expect(isDriverDocumentPresent(documents.driving_license)).toBe(true);
  });

  test('planDriverApproval is noop when approved and all present docs verified', () => {
    const userData = {
      userType: 'driver',
      driver: {
        verificationStatus: 'approved',
        documents: {
          driving_license: { url: 'https://example.com/dl.jpg', verified: true },
          aadhaar_card: { url: 'https://example.com/a.jpg', verified: true },
          bike_insurance: { url: 'https://example.com/b.jpg', verified: true },
          rc_book: { url: 'https://example.com/r.jpg', verified: true },
          profile_photo: { url: 'https://example.com/p.jpg', verified: true }
        }
      }
    };
    const plan = planDriverApproval(userData);
    expect(plan.approvalNoop).toBe(true);
    expect(plan.documentsToVerify).toHaveLength(0);
  });

  test('planWalletTopUp noop when balance already matches', () => {
    const wallet = planWalletTopUp({ exists: true, pointsBalance: 500 }, 500);
    expect(wallet.noop).toBe(true);
    expect(wallet.delta).toBe(0);
  });

  test('buildApprovalPreview includes before and after', () => {
    const preview = buildApprovalPreview({
      driverId: 'driver-1',
      apply: false,
      userData: {
        userType: 'driver',
        driver: {
          verificationStatus: 'pending_verification',
          documents: {
            driving_license: { url: 'https://example.com/dl.jpg' }
          }
        }
      },
      walletSnapshot: { exists: true, pointsBalance: 100 },
      points: 500
    });
    expect(preview.ok).toBe(true);
    expect(preview.before.verificationStatus).toBe('pending_verification');
    expect(preview.after.wallet.pointsBalance).toBe(500);
    expect(preview.actions.verifyDocuments).toHaveLength(1);
  });
});

describe('approve-test-driver.js smoke (no Firestore)', () => {
  it('missing --driver prints usage and exits non-zero', () => {
    const result = runApproveTestDriver([]);
    expect(result.status).not.toBe(0);
    expect(result.stderr || result.stdout).toContain('--driver');
  });

  it('invalid --points exits before Admin init', () => {
    const result = runApproveTestDriver(['--driver', 'driver-1', '--points', 'not-a-number']);
    expect(result.status).not.toBe(0);
    const combined = `${result.stdout || ''}${result.stderr || ''}`;
    expect(combined).toContain('--points');
    expect(combined).not.toContain('Firebase Admin is not initialized');
  });

  it('production FIREBASE_PROJECT_ID is refused before Admin init', () => {
    const result = runApproveTestDriver(
      ['--driver', 'driver-1'],
      { FIREBASE_PROJECT_ID: 'epickup-app' }
    );
    expect(result.status).not.toBe(0);
    const combined = `${result.stdout || ''}${result.stderr || ''}`;
    expect(combined).toMatch(/Refusing to run/i);
    expect(combined).toContain('epickup-app-staging');
    expect(combined).not.toContain('Firebase Admin is not initialized');
  });
});
