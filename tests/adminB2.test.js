/**
 * ADMIN-B2 — support ticket reply/status, emergency alert status, auth user shapes.
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

const mockTicketUpdate = jest.fn().mockResolvedValue(undefined);
const mockTicketGet = jest.fn();
const mockAlertUpdate = jest.fn().mockResolvedValue(undefined);
const mockAlertGet = jest.fn();

const mockTicketDoc = jest.fn(() => ({
  get: mockTicketGet,
  update: mockTicketUpdate
}));
const mockAlertDoc = jest.fn(() => ({
  get: mockAlertGet,
  update: mockAlertUpdate
}));
const mockCollection = jest.fn((name) => {
  if (name === 'supportTickets') {
    return { doc: mockTicketDoc };
  }
  if (name === 'emergencyAlerts') {
    return { doc: mockAlertDoc };
  }
  return { doc: jest.fn(() => ({ get: jest.fn(), update: jest.fn() })) };
});

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => ({
    collection: mockCollection
  }),
  getFirebaseApp: () => null,
  getStorage: () => null
}));

const mockSendToUser = jest.fn().mockResolvedValue({ sent: true });
jest.mock('../src/services/notificationService', () => ({
  sendToUser: (...args) => mockSendToUser(...args)
}));

describe('adminSupportTicketService', () => {
  const {
    appendAdminReply,
    setTicketStatus,
    MARKETPLACE_ORDER_CATEGORY
  } = require('../src/services/admin/adminSupportTicketService');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 409 USE_MARKETPLACE_HELP for marketplace_order on reply', async () => {
    mockTicketGet.mockResolvedValue({
      exists: true,
      data: () => ({
        category: MARKETPLACE_ORDER_CATEGORY,
        status: 'open',
        messages: []
      })
    });

    await expect(
      appendAdminReply({ ticketId: 't1', adminId: 'admin-1', message: 'Hello' })
    ).rejects.toMatchObject({
      status: 409,
      code: 'USE_MARKETPLACE_HELP'
    });
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  it('returns 409 USE_MARKETPLACE_HELP for marketplace_order on status', async () => {
    mockTicketGet.mockResolvedValue({
      exists: true,
      data: () => ({ category: MARKETPLACE_ORDER_CATEGORY, status: 'open' })
    });

    await expect(
      setTicketStatus({ ticketId: 't1', status: 'resolved', adminId: 'admin-1' })
    ).rejects.toMatchObject({
      status: 409,
      code: 'USE_MARKETPLACE_HELP'
    });
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  it('appends admin message and sets in_progress', async () => {
    mockTicketGet.mockResolvedValue({
      exists: true,
      data: () => ({
        category: 'billing',
        status: 'open',
        userId: 'cust-1',
        messages: []
      })
    });

    const result = await appendAdminReply({
      ticketId: 't-parcel',
      adminId: 'admin-1',
      message: 'We are looking into this.'
    });

    expect(result.ticketId).toBe('t-parcel');
    expect(result.messageId).toMatch(/^msg_/);
    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'in_progress',
        messages: expect.arrayContaining([
          expect.objectContaining({
            senderType: 'admin',
            senderId: 'admin-1',
            message: 'We are looking into this.'
          })
        ])
      })
    );
    expect(mockSendToUser).toHaveBeenCalledWith(
      'cust-1',
      expect.objectContaining({ type: 'support_ticket_reply' })
    );
  });

  it('uses customerId when userId is missing', async () => {
    mockTicketGet.mockResolvedValue({
      exists: true,
      data: () => ({
        category: 'other',
        status: 'open',
        customerId: 'cust-raw',
        messages: []
      })
    });

    await appendAdminReply({
      ticketId: 't2',
      adminId: 'admin-1',
      message: 'Hi'
    });

    expect(mockSendToUser).toHaveBeenCalledWith('cust-raw', expect.any(Object));
  });

  it('setTicketStatus sets resolvedAt when resolved', async () => {
    mockTicketGet.mockResolvedValue({
      exists: true,
      data: () => ({ category: 'delivery', status: 'in_progress' })
    });

    const result = await setTicketStatus({
      ticketId: 't3',
      status: 'resolved',
      adminId: 'admin-2',
      adminNotes: 'Done'
    });

    expect(result.status).toBe('resolved');
    expect(mockTicketUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'resolved',
        lastUpdatedBy: 'admin-2',
        adminNotes: 'Done',
        resolvedBy: 'admin-2',
        resolvedAt: expect.any(Date)
      })
    );
  });
});

describe('adminEmergencyAlertService', () => {
  const { updateAlertStatus } = require('../src/services/admin/adminEmergencyAlertService');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('acknowledged sets status and metadata', async () => {
    mockAlertGet.mockResolvedValue({
      exists: true,
      data: () => ({ customerId: 'cust-1', status: 'active' })
    });

    const result = await updateAlertStatus({
      alertId: 'a1',
      status: 'acknowledged',
      adminId: 'admin-1',
      note: 'On it'
    });

    expect(result.status).toBe('acknowledged');
    expect(mockAlertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'acknowledged',
        acknowledgedBy: 'admin-1',
        adminNotes: 'On it'
      })
    );
    expect(mockSendToUser).toHaveBeenCalledWith(
      'cust-1',
      expect.objectContaining({ type: 'emergency_status_update' })
    );
  });

  it('resolved sets resolvedAt and resolvedBy', async () => {
    mockAlertGet.mockResolvedValue({
      exists: true,
      data: () => ({ userId: 'user-9', status: 'active' })
    });

    const result = await updateAlertStatus({
      alertId: 'a2',
      status: 'resolved',
      adminId: 'admin-1'
    });

    expect(result.status).toBe('resolved');
    expect(mockAlertUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'resolved',
        resolvedBy: 'admin-1',
        resolvedAt: expect.any(Date)
      })
    );
  });

  it('404 when alert missing', async () => {
    mockAlertGet.mockResolvedValue({ exists: false });

    await expect(
      updateAlertStatus({ alertId: 'missing', status: 'resolved', adminId: 'a' })
    ).rejects.toMatchObject({ status: 404, code: 'ALERT_NOT_FOUND' });
  });
});

describe('adminAuth user payload', () => {
  const jwt = require('jsonwebtoken');
  const mockVerifyIdToken = jest.fn();
  const mockGetUser = jest.fn();
  const mockSetCustomUserClaims = jest.fn().mockResolvedValue(undefined);
  const mockAdminUsersGet = jest.fn();
  const mockUsersGet = jest.fn();
  const mockAdminUsersSet = jest.fn().mockResolvedValue(undefined);
  const mockUsersSet = jest.fn().mockResolvedValue(undefined);

  let adminAuthRouter;

  beforeAll(() => {
    jest.isolateModules(() => {
      process.env.FIREBASE_PROJECT_ID = 'unit-test';
      process.env.JWT_SECRET = 'unit-test-jwt-secret';

      jest.doMock('firebase-admin/auth', () => ({
        getAuth: () => ({
          verifyIdToken: mockVerifyIdToken,
          getUser: mockGetUser,
          setCustomUserClaims: mockSetCustomUserClaims
        })
      }));

      jest.doMock('firebase-admin/firestore', () => ({
        getFirestore: () => ({
          collection: (name) => ({
            doc: () => ({
              get: name === 'adminUsers' ? mockAdminUsersGet : mockUsersGet,
              set: name === 'adminUsers' ? mockAdminUsersSet : mockUsersSet
            })
          })
        })
      }));

      adminAuthRouter = require('../src/routes/adminAuth');
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAdminUsersSet.mockResolvedValue(undefined);
    mockUsersSet.mockResolvedValue(undefined);
  });

  it('login returns isActive, emailVerified, accountStatus on user', async () => {
    const express = require('express');
    const request = require('supertest');
    const app = express();
    app.use(express.json());
    app.use('/auth', adminAuthRouter);

    mockVerifyIdToken.mockResolvedValue({
      uid: 'admin-uid',
      exp: Math.floor(Date.now() / 1000) + 3600,
      customClaims: {}
    });
    mockGetUser.mockResolvedValue({
      uid: 'admin-uid',
      email: 'admin@example.com',
      displayName: 'Admin'
    });
    mockAdminUsersGet.mockResolvedValue({
      exists: true,
      data: () => ({
        uid: 'admin-uid',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'support',
        isActive: true,
        isEmailVerified: true,
        accountStatus: 'active'
      })
    });
    mockUsersGet.mockResolvedValue({ exists: false });

    const res = await request(app)
      .post('/auth/login')
      .send({ idToken: 'valid-firebase-token' });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual({
      id: 'admin-uid',
      email: 'admin@example.com',
      name: 'Admin',
      role: 'support',
      isActive: true,
      emailVerified: true,
      accountStatus: 'active'
    });
    expect(res.body.data.token).toBeDefined();
  });

  it('verify-token returns same user fields', async () => {
    const express = require('express');
    const request = require('supertest');
    const app = express();
    app.use(express.json());
    app.use('/auth', adminAuthRouter);

    const token = jwt.sign(
      { userId: 'admin-uid', email: 'a@b.com', userType: 'admin', role: 'super_admin' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    mockAdminUsersGet.mockResolvedValue({
      exists: true,
      data: () => ({
        id: 'admin-uid',
        email: 'a@b.com',
        displayName: 'Super',
        role: 'super_admin',
        isActive: true,
        isEmailVerified: false,
        accountStatus: 'active'
      })
    });

    const res = await request(app)
      .post('/auth/verify-token')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      id: 'admin-uid',
      email: 'a@b.com',
      name: 'Super',
      role: 'super_admin',
      isActive: true,
      emailVerified: false,
      accountStatus: 'active'
    });
  });
});
