/**
 * B-ADMIN-2 — permanent admin delete + role gates.
 */

const REAL_FIRESTORE_GUARD = process.env.JEST_ALLOW_REAL_FIRESTORE === '1';

function assertNoRealFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!REAL_FIRESTORE_GUARD && projectId && projectId !== 'unit-test') {
    throw new Error(
      `Refusing tests: FIREBASE_PROJECT_ID=${projectId}. Set JEST_ALLOW_REAL_FIRESTORE=1 to override.`
    );
  }
}

process.env.FIREBASE_PROJECT_ID = 'unit-test';
process.env.JWT_SECRET = 'unit-test-jwt-secret';
assertNoRealFirestore();

jest.mock('sanitize-html', () => jest.fn((value) => value));

jest.mock('firebase-admin', () => {
  const FieldValue = {
    serverTimestamp: jest.fn(() => ({ __ts: true })),
    increment: jest.fn((n) => n),
    delete: jest.fn(() => ({ __delete: true }))
  };
  const Timestamp = {
    now: jest.fn(() => ({ __ts: true })),
    fromDate: jest.fn(() => ({ __ts: true }))
  };
  return {
    apps: [{ name: 'mock' }],
    initializeApp: jest.fn(),
    app: jest.fn(),
    auth: jest.fn(() => ({})),
    messaging: jest.fn(() => ({})),
    credential: { cert: jest.fn() },
    firestore: Object.assign(jest.fn(), { FieldValue, Timestamp })
  };
});

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn(() => ({ doc: jest.fn(() => ({})) }))
  }))
}));

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn(() => ({ doc: jest.fn(() => ({})) }))
  })),
  getStorage: jest.fn(() => null),
  getFirebaseApp: jest.fn(() => null)
}));

jest.mock('../src/services/notificationService', () => ({
  sendToUser: jest.fn()
}));

jest.mock('../src/services/socket', () => ({
  getSocketIO: jest.fn(() => null)
}));

describe('DELETE /admins/:uid route', () => {
  const express = require('express');
  const request = require('supertest');
  const adminStaffService = require('../src/services/adminStaffService');
  let adminRouter;

  function appForRole(role, uid = 'caller-uid') {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { uid, userId: uid, userType: 'admin', role };
      next();
    });
    app.use(adminRouter);
    return app;
  }

  beforeAll(() => {
    adminRouter = require('../src/routes/admin');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(adminStaffService, 'deleteAdminStaff').mockResolvedValue({
      uid: 'support-target',
      deletedAt: '2026-01-01T00:00:00.000Z'
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 403 for support', async () => {
    const res = await request(appForRole('support')).delete('/admins/support-target');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ADMIN_ROLE');
    expect(adminStaffService.deleteAdminStaff).not.toHaveBeenCalled();
  });

  it('returns 400 CANNOT_DELETE_SELF for super_admin', async () => {
    const res = await request(appForRole('super_admin', 'super-1')).delete('/admins/super-1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_DELETE_SELF');
    expect(adminStaffService.deleteAdminStaff).not.toHaveBeenCalled();
  });

  it('returns 200 for super_admin deleting another admin', async () => {
    const res = await request(appForRole('super_admin', 'super-1')).delete('/admins/support-target');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Admin user deleted successfully');
    expect(adminStaffService.deleteAdminStaff).toHaveBeenCalledWith('support-target', {
      deletedBy: 'super-1'
    });
  });

  it('maps LAST_SUPER_ADMIN from service to 400', async () => {
    adminStaffService.deleteAdminStaff.mockRejectedValueOnce(
      Object.assign(new Error('Cannot delete the last active super admin'), {
        code: 'LAST_SUPER_ADMIN',
        status: 400
      })
    );
    const res = await request(appForRole('super_admin', 'super-1')).delete('/admins/super-2');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LAST_SUPER_ADMIN');
  });
});

describe('deleteAdminStaff service', () => {
  assertNoRealFirestore();

  const mockRevokeRefreshTokens = jest.fn().mockResolvedValue(undefined);
  const mockDeleteUser = jest.fn().mockResolvedValue(undefined);
  const mockBatchDelete = jest.fn();
  const mockBatchSet = jest.fn();
  const mockBatchUpdate = jest.fn();
  const mockBatchCommit = jest.fn().mockResolvedValue(undefined);
  const mockBatch = jest.fn(() => ({
    delete: mockBatchDelete,
    set: mockBatchSet,
    update: mockBatchUpdate,
    commit: mockBatchCommit
  }));

  const mockAdminUsersGet = jest.fn();
  const mockUsersGet = jest.fn();
  const mockAdminLogsDoc = jest.fn(() => ({}));
  const mockWhereGet = jest.fn();

  const mockAdminUsersDoc = jest.fn(() => ({
    get: mockAdminUsersGet,
    delete: jest.fn()
  }));
  const mockUsersDoc = jest.fn(() => ({
    get: mockUsersGet
  }));

  let deleteAdminStaff;
  let setCachedAdminVerification;
  let getCachedAdminVerification;
  let clearAdminVerificationCacheForTests;

  beforeAll(() => {
    jest.resetModules();
    process.env.FIREBASE_PROJECT_ID = 'unit-test';

    jest.doMock('firebase-admin/auth', () => ({
      getAuth: () => ({
        revokeRefreshTokens: mockRevokeRefreshTokens,
        deleteUser: mockDeleteUser
      })
    }));

    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: () => ({
        batch: mockBatch,
        collection: (name) => {
          if (name === 'adminUsers') {
            return {
              doc: mockAdminUsersDoc,
              where: jest.fn(() => ({
                where: jest.fn(() => ({
                  get: mockWhereGet
                }))
              }))
            };
          }
          if (name === 'users') {
            return { doc: mockUsersDoc };
          }
          if (name === 'adminLogs') {
            return { doc: mockAdminLogsDoc };
          }
          return { doc: jest.fn() };
        }
      }),
      FieldValue: { delete: () => '__DELETE__' }
    }));

    ({ deleteAdminStaff } = require('../src/services/adminStaffService'));
    ({
      setCachedAdminVerification,
      getCachedAdminVerification,
      clearAdminVerificationCacheForTests
    } = require('../src/middleware/auth'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearAdminVerificationCacheForTests();
    mockBatchCommit.mockResolvedValue(undefined);
    mockWhereGet.mockResolvedValue({ docs: [{ id: 'only-super' }] });
  });

  it('throws LAST_SUPER_ADMIN when deleting sole active super_admin', async () => {
    mockAdminUsersGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        role: 'super_admin',
        email: 'super@example.com',
        displayName: 'Super',
        isActive: true
      })
    });
    mockWhereGet.mockResolvedValueOnce({ docs: [{ id: 'only-super' }] });

    await expect(deleteAdminStaff('only-super', { deletedBy: 'other' })).rejects.toMatchObject({
      status: 400,
      code: 'LAST_SUPER_ADMIN'
    });
    expect(mockBatchCommit).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('deletes adminUsers and users docs, audits, revokes auth, clears cache', async () => {
    const targetUid = 'support-uid';
    mockAdminUsersGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        role: 'support',
        email: 'support@example.com',
        displayName: 'Support User'
      })
    });
    mockUsersGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ userType: 'admin', email: 'support@example.com' })
    });
    mockWhereGet.mockResolvedValue({ docs: [{ id: 'super-1' }, { id: targetUid }] });

    setCachedAdminVerification(targetUid, 'support');
    expect(getCachedAdminVerification(targetUid)).toEqual(
      expect.objectContaining({ role: 'support' })
    );

    const result = await deleteAdminStaff(targetUid, { deletedBy: 'super-1' });

    expect(result.uid).toBe(targetUid);
    expect(result.deletedAt).toBeDefined();
    expect(mockBatchDelete).toHaveBeenCalledTimes(2);
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'admin_deleted',
        adminId: 'super-1',
        targetUserId: targetUid,
        targetUserType: 'admin'
      })
    );
    expect(mockBatchCommit).toHaveBeenCalled();
    expect(mockRevokeRefreshTokens).toHaveBeenCalledWith(targetUid);
    expect(mockDeleteUser).toHaveBeenCalledWith(targetUid);
    expect(getCachedAdminVerification(targetUid)).toBeNull();
  });
});
