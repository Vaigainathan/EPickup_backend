const {
  planHandoverOtpMigration,
  summarizeHandoverPlans
} = require('../src/services/migrateHandoverOtp');

describe('planHandoverOtpMigration', () => {
  test('copies when only legacy field is set', () => {
    const plan = planHandoverOtpMigration({ handoverOtp: '123456' }, null);
    expect(plan).toEqual({ action: 'copy', otp: '123456' });
  });

  test('skips when private already has otp', () => {
    const plan = planHandoverOtpMigration({ handoverOtp: '123456' }, { otp: '654321' });
    expect(plan).toEqual({ action: 'skip', reason: 'private_ok' });
  });

  test('strip legacy when private exists and flag set', () => {
    const plan = planHandoverOtpMigration(
      { handoverOtp: '123456' },
      { otp: '654321' },
      { stripLegacy: true }
    );
    expect(plan).toEqual({ action: 'strip_legacy', otp: '654321' });
  });

  test('copy and strip when only legacy and strip flag', () => {
    const plan = planHandoverOtpMigration(
      { handoverOtp: '123456' },
      null,
      { stripLegacy: true }
    );
    expect(plan).toEqual({ action: 'copy_and_strip', otp: '123456' });
  });
});

describe('summarizeHandoverPlans', () => {
  test('aggregates counts', () => {
    const summary = summarizeHandoverPlans([
      { action: 'copy', otp: '1' },
      { action: 'skip', reason: 'private_ok' },
      { action: 'strip_legacy', otp: '2' }
    ]);
    expect(summary.wouldCopy).toBe(1);
    expect(summary.wouldStripLegacy).toBe(1);
    expect(summary.legacyOnDoc).toBe(2);
  });
});
