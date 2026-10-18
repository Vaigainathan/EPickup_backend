const express = require('express');
const request = require('supertest');

const userWrites = [];

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
  getFirestore: () => ({
    collection: () => ({
      doc: (userId) => ({
        set: (data, options) => {
          userWrites.push({ userId, data, options });
          return Promise.resolve();
        }
      })
    })
  })
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
