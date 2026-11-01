const { requireAdminRole } = require('../src/middleware/auth');
const { clearAdminRoleWarningsForTests } = require('../src/constants/adminRoles');

describe('admin booking mutation permissions', () => {
  beforeEach(() => {
    clearAdminRoleWarningsForTests();
  });

  function runMiddleware(role) {
    const middleware = requireAdminRole(['super_admin']);
    const req = {
      user: {
        userType: 'admin',
        role,
        uid: 'admin-1'
      }
    };
    const res = {
      status: jest.fn(function status() { return this; }),
      json: jest.fn()
    };
    const next = jest.fn();
    middleware(req, res, next);
    return { req, res, next };
  }

  test('super_admin passes super_admin gate', () => {
    const { next, res } = runMiddleware('super_admin');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  test('support role receives 403 INSUFFICIENT_ADMIN_ROLE', () => {
    const { next, res } = runMiddleware('support');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'INSUFFICIENT_ADMIN_ROLE'
      })
    }));
  });
});
