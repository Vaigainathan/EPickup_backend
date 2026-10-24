/**
 * ADMIN-B1a tests — mocks Firebase Admin before service loads where needed.
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
assertNoRealFirestore();

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => {
    throw new Error('adminB1a REAL FIRESTORE guard: getFirestore must not be called in this file');
  },
  getFirebaseApp: () => null,
  getStorage: () => null
}));

describe('adminRoles', () => {
  const {
    normalizeAdminRole,
    clearAdminRoleWarningsForTests,
    ADMIN_ROLES
  } = require('../src/constants/adminRoles');

  beforeEach(() => {
    clearAdminRoleWarningsForTests();
  });

  it('defaults missing role to super_admin', () => {
    expect(normalizeAdminRole('uid-1', undefined)).toBe('super_admin');
    expect(normalizeAdminRole('uid-1', null)).toBe('super_admin');
  });

  it('accepts support and super_admin', () => {
    expect(ADMIN_ROLES).toContain('support');
    expect(normalizeAdminRole('uid-2', 'support')).toBe('support');
  });
});

describe('requireAdminRole middleware', () => {
  const { requireAdminRole } = require('../src/middleware/auth');

  function runMiddleware(role) {
    const mw = requireAdminRole(['super_admin']);
    const req = { user: { uid: 'a1', userType: 'admin', role } };
    let settled = false;
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      }
    };
    return new Promise((resolve, reject) => {
      const finish = (payload) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(payload);
      };
      mw(req, res, (err) => {
        if (err) {
          if (!settled) {
            settled = true;
            reject(err);
          }
          return;
        }
        finish({ req, res });
      });
      // requireAdminRole denies with res.status().json() and does not call next (auth.js:544-553)
      if (res.statusCode !== 200) {
        finish({ req, res });
      }
    });
  }

  it('allows super_admin', async () => {
    const { res } = await runMiddleware('super_admin');
    expect(res.statusCode).toBe(200);
  });

  it('blocks support from super_admin-only routes', async () => {
    const { res } = await runMiddleware('support');
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ADMIN_ROLE');
  });
});

describe('admin signup disabled', () => {
  const express = require('express');
  const request = require('supertest');
  const signupRoutes = require('../src/routes/adminSignup');

  it('returns 410 ADMIN_SIGNUP_DISABLED', async () => {
    const app = express();
    app.use('/api/admin/signup', signupRoutes);
    const res = await request(app).post('/api/admin/signup/').send({ displayName: 'x' });
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('ADMIN_SIGNUP_DISABLED');
  });
});

describe('adminLoginService', () => {
  const { evaluateAdminAccess } = require('../src/services/adminLoginService');

  it('denies customClaims.role without firestore admin record', () => {
    const result = evaluateAdminAccess({
      customClaims: { role: 'super_admin' },
      adminUsersDoc: { exists: false },
      usersDoc: { exists: false }
    });
    expect(result.allowed).toBe(false);
  });

  it('allows adminUsers doc and normalizes role', () => {
    const result = evaluateAdminAccess({
      customClaims: {},
      adminUsersDoc: {
        exists: true,
        data: () => ({
          uid: 'u1',
          email: 'a@b.com',
          isActive: true,
          role: 'support'
        })
      },
      usersDoc: { exists: false }
    });
    expect(result.allowed).toBe(true);
    expect(result.adminUserData.role).toBe('support');
  });

  it('defaults missing role to super_admin at login evaluation', () => {
    const result = evaluateAdminAccess({
      customClaims: {},
      adminUsersDoc: {
        exists: true,
        data: () => ({
          uid: 'u2',
          email: 'a@b.com',
          isActive: true
        })
      },
      usersDoc: { exists: false }
    });
    expect(result.allowed).toBe(true);
    expect(result.adminUserData.role).toBe('super_admin');
  });
});

describe('adminStaffService', () => {
  assertNoRealFirestore();

  const mockCreateUser = jest.fn();
  const mockGetUserByEmail = jest.fn();
  const mockSetCustomUserClaims = jest.fn().mockResolvedValue(undefined);
  const mockUpdateUser = jest.fn().mockResolvedValue(undefined);
  const mockSet = jest.fn().mockResolvedValue(undefined);
  const mockGet = jest.fn();
  const mockWhereGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });
  const mockDoc = jest.fn(() => ({
    set: mockSet,
    get: mockGet,
    update: jest.fn().mockResolvedValue(undefined)
  }));
  const mockCollection = jest.fn(() => ({
    doc: mockDoc,
    where: jest.fn(() => ({
      limit: jest.fn(() => ({
        get: mockWhereGet
      }))
    }))
  }));

  let createAdminStaff;
  let disableAdminStaff;

  beforeAll(() => {
    jest.resetModules();
    process.env.FIREBASE_PROJECT_ID = 'unit-test';

    jest.doMock('firebase-admin/auth', () => ({
      getAuth: () => ({
        createUser: mockCreateUser,
        getUserByEmail: mockGetUserByEmail,
        setCustomUserClaims: mockSetCustomUserClaims,
        updateUser: mockUpdateUser
      })
    }));

    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: () => ({
        collection: mockCollection
      })
    }));

    ({ createAdminStaff, disableAdminStaff } = require('../src/services/adminStaffService'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockWhereGet.mockResolvedValue({ empty: true, docs: [] });
    mockGetUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' });
    mockCreateUser.mockResolvedValue({ uid: 'new-uid', emailVerified: false });
  });

  it('createAdminStaff is idempotent when email exists', async () => {
    mockWhereGet.mockResolvedValueOnce({
      empty: false,
      docs: [{
        id: 'existing-uid',
        data: () => ({
          email: 'staff@example.com',
          displayName: 'Staff',
          role: 'support'
        })
      }]
    });

    const result = await createAdminStaff({
      email: 'staff@example.com',
      displayName: 'Staff',
      role: 'support',
      temporaryPassword: 'longpassword1',
      createdBy: 'super-1'
    });

    expect(result.created).toBe(false);
    expect(result.uid).toBe('existing-uid');
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('rejects temporaryPassword shorter than 8 characters', async () => {
    await expect(
      createAdminStaff({
        email: 'new@example.com',
        displayName: 'N',
        role: 'support',
        temporaryPassword: 'short'
      })
    ).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_PASSWORD'
    });
  });

  it('refuses create when Firebase user is a non-admin role', async () => {
    mockGetUserByEmail.mockResolvedValueOnce({ uid: 'driver-uid', emailVerified: false });
    mockGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ userType: 'driver' })
    });

    await expect(
      createAdminStaff({
        email: 'driver@example.com',
        displayName: 'D',
        role: 'support',
        temporaryPassword: 'longpassword1'
      })
    ).rejects.toMatchObject({
      status: 409,
      code: 'EMAIL_BELONGS_TO_OTHER_ROLE'
    });
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('disableAdminStaff disables auth and marks inactive', async () => {
    mockGet.mockResolvedValueOnce({ exists: true, data: () => ({ email: 'x@y.com' }) });

    const result = await disableAdminStaff('uid-x', { disabledBy: 'super-1' });
    expect(mockUpdateUser).toHaveBeenCalledWith('uid-x', { disabled: true });
    expect(result.isActive).toBe(false);
    expect(result.accountStatus).toBe('inactive');
  });
});

describe('bootstrap-staging-super-admin script args', () => {
  const { spawnSync } = require('child_process');
  const path = require('path');
  const ROOT = path.join(__dirname, '..');

  function expectNoAdminInitCrash(result) {
    const combined = `${result.stdout || ''}${result.stderr || ''}`;
    expect(combined).not.toContain('Firebase Admin is not initialized');
    expect(combined).not.toContain('The default Firebase app does not exist');
  }

  it('exits when required args missing', () => {
    const result = spawnSync(
      process.execPath,
      [path.join('scripts', 'support', 'bootstrap-staging-super-admin.js')],
      { cwd: ROOT, encoding: 'utf8' }
    );
    expect(result.status).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/Usage:/);
  });

  it('dry-run with valid args does not crash before Firebase init', () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join('scripts', 'support', 'bootstrap-staging-super-admin.js'),
        '--email', 'bootstrap-smoke@example.com',
        '--displayName', 'Smoke Admin',
        '--password', 'SmokePass12345'
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          FIREBASE_PROJECT_ID: 'epickup-app-staging'
        }
      }
    );
    expectNoAdminInitCrash(result);
  });
});
