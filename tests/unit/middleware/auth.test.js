const { authMiddleware, adminAuthMiddleware, requireRole, optionalAuth } = require('../../src/middleware/auth');
const { createTestRequest, createTestResponse, createTestNext, generateTestToken, createTestUser, createTestAdmin, mockFirebase } = require('../setup');

// Mock Firebase
jest.mock('../../src/services/firebase', () => {
  const { mockDb } = require('../setup');
  return {
    getFirestore: () => mockDb
  };
});

describe('Authentication Middleware', () => {
  let mockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    const { mockDb: db } = mockFirebase();
    mockDb = db;
  });

  describe('authMiddleware', () => {
    it('should authenticate valid token', async () => {
      const user = createTestUser();
      const token = generateTestToken(user);
      const req = createTestRequest(null, {}, {}, {});
      req.headers.authorization = `Bearer ${token}`;
      const res = createTestResponse();
      const next = createTestNext();

      // Mock Firestore response
      mockDb.collection().doc().get.mockResolvedValue({
        exists: true,
        data: () => user
      });

      await authMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual(expect.objectContaining({
        uid: user.uid,
        userType: user.userType
      }));
    });

    it('should reject request without token', async () => {
      const req = createTestRequest(null, {}, {}, {});
      const res = createTestResponse();
      const next = createTestNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'UNAUTHORIZED'
          })
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject invalid token', async () => {
      const req = createTestRequest(null, {}, {}, {});
      req.headers.authorization = 'Bearer invalid-token';
      const res = createTestResponse();
      const next = createTestNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'AUTHENTICATION_FAILED'
          })
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject expired token', async () => {
      const user = createTestUser();
      const expiredToken = generateTestToken(user, { exp: Math.floor(Date.now() / 1000) - 3600 });
      const req = createTestRequest(null, {}, {}, {});
      req.headers.authorization = `Bearer ${expiredToken}`;
      const res = createTestResponse();
      const next = createTestNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'TOKEN_EXPIRED'
          })
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject inactive user', async () => {
      const user = createTestUser({ isActive: false });
      const token = generateTestToken(user);
      const req = createTestRequest(null, {}, {}, {});
      req.headers.authorization = `Bearer ${token}`;
      const res = createTestResponse();
      const next = createTestNext();

      // Mock Firestore response
      mockDb.collection().doc().get.mockResolvedValue({
        exists: true,
        data: () => user
      });

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'USER_INACTIVE'
          })
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should handle missing JWT_SECRET', async () => {
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      const req = createTestRequest(null, {}, {}, {});
      req.headers.authorization = 'Bearer some-token';
      const res = createTestResponse();
      const next = createTestNext();

      await authMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'CONFIGURATION_ERROR'
          })
        })
      );

      // Restore original secret
      process.env.JWT_SECRET = originalSecret;
    });
  });

  describe('adminAuthMiddleware', () => {
    it('should authenticate admin user', async () => {
      const admin = createTestAdmin();
      const token = generateTestToken(admin);
      const req = createTestRequest(null, {}, {}, {});
      req.headers.authorization = `Bearer ${token}`;
      const res = createTestResponse();
      const next = createTestNext();

      await adminAuthMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual(expect.objectContaining({
        uid: admin.uid,
        userType: 'admin'
      }));
    });

    it('should reject non-admin user', async () => {
      const user = createTestUser();
      const token = generateTestToken(user);
      const req = createTestRequest(null, {}, {}, {});
      req.headers.authorization = `Bearer ${token}`;
      const res = createTestResponse();
      const next = createTestNext();

      await adminAuthMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'FORBIDDEN'
          })
        })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireRole', () => {
    it('should allow access for authorized role', () => {
      const user = createTestUser();
      const req = createTestRequest(user);
      const res = createTestResponse();
      const next = createTestNext();

      const middleware = requireRole(['customer']);
      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('should deny access for unauthorized role', () => {
      const user = createTestUser();
      const req = createTestRequest(user);
      const res = createTestResponse();
      const next = createTestNext();

      const middleware = requireRole(['admin']);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'FORBIDDEN'
          })
        })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should deny access for unauthenticated user', () => {
      const req = createTestRequest(null);
      const res = createTestResponse();
      const next = createTestNext();

      const middleware = requireRole(['customer']);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'UNAUTHORIZED'
          })
        })
      );
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuth', () => {
    it('should authenticate user with valid token', async () => {
      const user = createTestUser();
      const token = generateTestToken(user);
      const req = createTestRequest(null, {}, {}, {});
      req.headers.authorization = `Bearer ${token}`;
      const res = createTestResponse();
      const next = createTestNext();

      // Mock Firestore response
      mockDb.collection().doc().get.mockResolvedValue({
        exists: true,
        data: () => user
      });

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toEqual(expect.objectContaining({
        uid: user.uid,
        userType: user.userType
      }));
    });

    it('should continue without authentication if no token', async () => {
      const req = createTestRequest(null, {}, {}, {});
      const res = createTestResponse();
      const next = createTestNext();

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeNull();
      expect(req.token).toBeNull();
    });

    it('should continue without authentication if token is invalid', async () => {
      const req = createTestRequest(null, {}, {}, {});
      req.headers.authorization = 'Bearer invalid-token';
      const res = createTestResponse();
      const next = createTestNext();

      await optionalAuth(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.user).toBeNull();
      expect(req.token).toBeNull();
    });
  });
});
