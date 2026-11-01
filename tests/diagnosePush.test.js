const {
  aggregateNotifications,
  dualDocTokenReport,
  runDiagnosePush,
  summarizeUserDoc
} = require('../scripts/support/lib/diagnosePushActions');

describe('diagnosePushActions', () => {
  test('summarizeUserDoc never includes token values', () => {
    const row = summarizeUserDoc('shop-1', {
      userType: 'shop',
      expoPushToken: 'ExponentPushToken[secret]',
      fcmToken: 'fcm-secret',
      phone: '9999999999',
      name: 'Secret Shop'
    });
    expect(row.hasExpoPushToken).toBe(true);
    expect(row.hasFcmToken).toBe(true);
    expect(JSON.stringify(row)).not.toContain('secret');
    expect(row.phone).toBeUndefined();
    expect(row.name).toBeUndefined();
  });

  test('dualDocTokenReport flags token on auth doc only', () => {
    const report = dualDocTokenReport(
      'role-shop',
      { userType: 'shop', originalFirebaseUID: 'auth-shop' },
      {
        exists: true,
        data: () => ({ expoPushToken: 'ExponentPushToken[x]' })
      }
    );
    expect(report.mismatchRisk).toBe(true);
    expect(report.tokensOnRoleDoc.hasAny).toBe(false);
    expect(report.tokensOnAuthDoc.hasExpoPushToken).toBe(true);
  });

  test('aggregateNotifications groups by user', () => {
    const byUser = aggregateNotifications([
      { data: () => ({ userId: 'u1', status: 'failed', errorMessage: 'NO_PUSH_TOKEN', type: 'x', sentAt: new Date() }) },
      { data: () => ({ userId: 'u1', status: 'sent', type: 'y', sentAt: new Date() }) }
    ]);
    expect(byUser.u1.counts.failed).toBe(1);
    expect(byUser.u1.counts.sent).toBe(1);
    expect(byUser.u1.errorMessages).toContain('NO_PUSH_TOKEN');
  });

  test('runDiagnosePush performs no Firestore writes', async () => {
    const writeMethods = ['set', 'update', 'delete', 'create', 'add'];
    const db = {
      collection(name) {
        return {
          where() {
            return this;
          },
          limit() {
            return this;
          },
          doc(id) {
            return {
              get: async () => ({
                exists: id === 'shop-1',
                data: () => ({
                  userType: 'shop',
                  expoPushToken: 'ExponentPushToken[a]'
                })
              })
            };
          },
          get: async () => ({
            docs: name === 'users'
              ? [{ id: 'shop-1', data: () => ({ userType: 'shop' }) }]
              : []
          })
        };
      }
    };

    writeMethods.forEach((method) => {
      db[method] = () => {
        throw new Error(`Unexpected write: ${method}`);
      };
    });

    const originalBatch = db.batch;
    db.batch = () => {
      const batch = {};
      writeMethods.forEach((m) => {
        batch[m] = () => {
          throw new Error(`Unexpected batch.${m}`);
        };
      });
      batch.commit = () => {
        throw new Error('Unexpected batch.commit');
      };
      return batch;
    };

    const report = await runDiagnosePush(db, { nowMs: Date.now() });
    expect(report.readOnly).toBe(true);
    expect(report.summary).toBeDefined();
    db.batch = originalBatch;
  });
});
