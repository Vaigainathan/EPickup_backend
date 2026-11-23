const express = require('express');
const request = require('supertest');

const userWrites = [];
const userReads = [];
const mockUserDocuments = new Map();

function assertNoUndefinedDeep(value, path = 'payload') {
  if (value === undefined) {
    throw new Error(`undefined at ${path}`);
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (value instanceof Date) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      assertNoUndefinedDeep(entry, `${path}[${index}]`);
    });
    return;
  }
  Object.keys(value).forEach((key) => {
    assertNoUndefinedDeep(value[key], `${path}.${key}`);
  });
}

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => {
    const userRef = (userId) => ({
      get: async () => {
        userReads.push(userId);
        const data = mockUserDocuments.get(userId);
        return {
          exists: data !== undefined,
          data: () => data
        };
      },
      set: (data, options) => {
        userWrites.push({ userId, data, options });
        mockUserDocuments.set(userId, {
          ...(mockUserDocuments.get(userId) || {}),
          ...data
        });
        return Promise.resolve();
      }
    });

    return {
      collection: () => ({
        doc: userRef
      }),
      runTransaction: async (callback) => callback({
        get: (ref) => ref.get(),
        set: (ref, data, options) => ref.set(data, options)
      })
    };
  }
}));

const fcmTokenRoutes = require('../src/routes/fcmTokens');

function buildApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    next();
  });
  app.use(fcmTokenRoutes);
  return app;
}

const EXPO_TOKEN = 'ExponentPushToken[shop-test-token]';

describe('shop FCM token routes', () => {
  beforeEach(() => {
    userWrites.length = 0;
    userReads.length = 0;
    mockUserDocuments.clear();
  });

  test('shop user can register expo push token without deviceId', async () => {
    const shopUid = 'shop-role-uid';
    const res = await request(buildApp({ uid: shopUid, userType: 'shop' }))
      .post('/register')
      .send({ token: EXPO_TOKEN, platform: 'android', userType: 'shop' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(userWrites).toHaveLength(1);
    expect(userWrites[0].userId).toBe(shopUid);
    expect(userWrites[0].options).toEqual({ merge: true });
    expect(userWrites[0].data.expoPushToken).toBe(EXPO_TOKEN);
    expect(userWrites[0].data.deviceId).toBeNull();
    assertNoUndefinedDeep(userWrites[0].data);
  });

  test('unchanged recent expo token returns success without writing', async () => {
    const shopUid = 'shop-role-uid-recent';
    const recent = new Date(Date.now() - 5 * 60 * 1000);
    mockUserDocuments.set(shopUid, {
      expoPushToken: EXPO_TOKEN,
      lastSeen: recent,
      tokenUpdatedAt: recent
    });

    const res = await request(buildApp({ uid: shopUid, userType: 'shop' }))
      .post('/register')
      .send({ token: EXPO_TOKEN, platform: 'android', userType: 'shop' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokenType).toBe('expo');
    expect(userReads).toEqual([shopUid]);
    expect(userWrites).toHaveLength(0);
  });

  test('unchanged recent FCM token also returns success without writing', async () => {
    const driverUid = 'driver-role-uid-recent';
    const token = 'f'.repeat(160);
    const recent = new Date(Date.now() - 5 * 60 * 1000);
    mockUserDocuments.set(driverUid, {
      fcmToken: token,
      lastSeen: recent,
      tokenUpdatedAt: recent
    });

    const res = await request(buildApp({ uid: driverUid, userType: 'driver' }))
      .post('/register')
      .send({ token });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokenType).toBe('fcm');
    expect(userWrites).toHaveLength(0);
  });

  test('a changed token is written even when the previous registration is recent', async () => {
    const shopUid = 'shop-role-uid-rotated';
    const previousToken = 'ExponentPushToken[old-token]';
    const nextToken = 'ExponentPushToken[new-token]';
    const recent = new Date(Date.now() - 5 * 60 * 1000);
    mockUserDocuments.set(shopUid, {
      expoPushToken: previousToken,
      lastSeen: recent,
      tokenUpdatedAt: recent
    });

    const res = await request(buildApp({ uid: shopUid, userType: 'shop' }))
      .post('/register')
      .send({ token: nextToken });

    expect(res.status).toBe(200);
    expect(userWrites).toHaveLength(1);
    expect(userWrites[0].data.expoPushToken).toBe(nextToken);
  });

  test('unchanged token with stale activity timestamps refreshes the user document', async () => {
    const customerUid = 'customer-role-uid-stale';
    const stale = new Date(Date.now() - 11 * 60 * 1000);
    mockUserDocuments.set(customerUid, {
      expoPushToken: EXPO_TOKEN,
      lastSeen: stale,
      tokenUpdatedAt: stale
    });

    const res = await request(buildApp({ uid: customerUid, userType: 'customer' }))
      .post('/register')
      .send({ token: EXPO_TOKEN });

    expect(res.status).toBe(200);
    expect(userWrites).toHaveLength(1);
    expect(userWrites[0].data.expoPushToken).toBe(EXPO_TOKEN);
    expect(userWrites[0].data.tokenUpdatedAt).toBeInstanceOf(Date);
  });

  test('shop user can unregister tokens on users doc', async () => {
    const shopUid = 'shop-role-uid-2';
    const res = await request(buildApp({ uid: shopUid, userType: 'shop' }))
      .post('/unregister')
      .send({});

    expect(res.status).toBe(200);
    expect(userWrites).toHaveLength(1);
    expect(userWrites[0].data.expoPushToken).toBeNull();
    expect(userWrites[0].data.fcmToken).toBeNull();
    assertNoUndefinedDeep(userWrites[0].data);
  });

  test('role outside allow list receives 403', async () => {
    const res = await request(buildApp({ uid: 'admin-1', userType: 'admin' }))
      .post('/register')
      .send({ token: EXPO_TOKEN });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(userWrites).toHaveLength(0);
  });

  test('customer register behaviour unchanged', async () => {
    const customerUid = 'customer-uid';
    const res = await request(buildApp({ uid: customerUid, userType: 'customer' }))
      .post('/register')
      .send({ token: EXPO_TOKEN });

    expect(res.status).toBe(200);
    expect(userWrites[0].data.expoPushToken).toBe(EXPO_TOKEN);
    assertNoUndefinedDeep(userWrites[0].data);
  });

  test('driver register behaviour unchanged', async () => {
    const driverUid = 'driver-uid';
    const res = await request(buildApp({ uid: driverUid, userType: 'driver' }))
      .post('/register')
      .send({ token: EXPO_TOKEN });

    expect(res.status).toBe(200);
    expect(userWrites[0].data.expoPushToken).toBe(EXPO_TOKEN);
    assertNoUndefinedDeep(userWrites[0].data);
  });
});
