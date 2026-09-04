/**
 * Live Stage 1 test runner against staging Railway + epickup-app-staging Firestore.
 * Not for production. Do not commit tokens or print secrets.
 */
require('dotenv').config();
require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env.staging' });

const { assertStagingEnv, assertStagingAdmin } = require('./assertStagingFirebase');
assertStagingEnv();

const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const { spawn } = require('child_process');
const axios = require('axios');
const https = require('https');

const stagingHttpsAgent = new https.Agent({ family: 4, keepAlive: true });

dns.setDefaultResultOrder('ipv4first');
const { GoogleAuth } = require('google-auth-library');
const admin = require('firebase-admin');
const { getFirestore } = require('../src/services/firebase');
const shopOrderService = require('../src/services/shopOrderService');
const roleBasedAuthService = require('../src/services/roleBasedAuthService');

let BASE_URL = process.env.STAGING_BACKEND_URL || 'https://epickupbackend-staging.up.railway.app';
const STAGING_URL = BASE_URL;
const PROJECT = process.env.FIREBASE_PROJECT_ID || 'epickup-app-staging';
const KEY_FILE = path.resolve(__dirname, '..', 'firebase-service-account.json');
const SHOP_A_UID = process.env.STAGING_SHOP_UID || 'b7302f5d6343c1641d63811306eb';
const SHOP_A_PHONE = process.env.STAGING_SHOP_PHONE || '+919148101698';
const SHOP_B_PHONE = '+919000111802';
const DUMMY_EXPO = 'ExponentPushToken[stage1testdummy000000]';

let localServer = null;

function startLocalServer(secret, port) {
  localServer = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      JWT_SECRET: secret,
      PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  localServer.stdout.on('data', (chunk) => {
    const line = chunk.toString();
    if (line.includes('running on port') || line.includes('EADDRINUSE')) {
      console.log(line.trim().slice(0, 180));
    }
  });
  localServer.stderr.on('data', (chunk) => {
    const line = chunk.toString();
    if (line.toLowerCase().includes('error') || line.includes('EADDRINUSE')) {
      console.log(line.trim().slice(0, 240));
    }
  });
}

function stopLocalServer() {
  if (!localServer || !localServer.pid) {
    return;
  }
  try {
    spawn('taskkill', ['/PID', String(localServer.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (error) {
    localServer.kill();
  }
  localServer = null;
}

async function waitHealth(url, timeoutMs = 90000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Local server did not become healthy: ${lastError}`);
}

async function httpJson(method, url, { headers, body, timeout = 25000 } = {}) {
  try {
    const res = await axios({
      method,
      url,
      headers,
      data: body,
      timeout,
      validateStatus: () => true,
      httpsAgent: url.startsWith('https://epickupbackend-staging') ? stagingHttpsAgent : undefined,
      family: 4
    });
    return { status: res.status, json: res.data };
  } catch (error) {
    throw new Error(`${method} ${url} failed: ${error.message}`);
  }
}

async function probeStagingRoutes() {
  const res = await httpJson('GET', `${STAGING_URL}/api/shop/orders`);
  return { status: res.status, code: res.json && res.json.error && res.json.error.code };
}

const results = [];
let failed = false;

function record(name, pass, detail) {
  const row = { name, result: pass ? 'PASS' : 'FAIL', detail };
  results.push(row);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!pass) {
    failed = true;
  }
}

function stopIfFailed() {
  if (failed) {
    console.log('\nStopped on first failure. Remaining Stage 1 items were not run.');
    printSummary();
    process.exit(1);
  }
}

function printSummary() {
  console.log('\n=== Stage 1 live results ===');
  for (const row of results) {
    console.log(`${row.result}\t${row.name}${row.detail ? ` — ${row.detail}` : ''}`);
  }
}

async function waitIndexesReadyViaStaging(token, timeoutMs = 8 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await httpJson('GET', `${STAGING_URL}/api/shop/orders`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 200) {
      return { method: 'staging-GET-/', state: 'READY', count: ((res.json && res.json.data && res.json.data.orders) || []).length };
    }
    const code = res.json && res.json.error && res.json.error.code;
    const msg = (res.json && res.json.error && res.json.error.message) || '';
    console.log(`Staging list index probe: HTTP ${res.status} ${code || ''} ${String(msg).slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error('marketplaceOrders composite indexes did not become READY in time (staging GET /)');
}

async function listPlatformApiKeys(client) {
  const keys = [];
  const kinds = ['webApps', 'androidApps', 'iosApps'];
  for (const kind of kinds) {
    try {
      const listed = await client.request({
        url: `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/${kind}`
      });
      for (const app of listed.data.apps || []) {
        const cfg = await client.request({
          url: `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/${kind}/${app.appId}/config`
        });
        if (cfg.data && cfg.data.apiKey) {
          keys.push({ kind, apiKey: cfg.data.apiKey, appId: app.appId });
        }
      }
    } catch (error) {
      const detail = (error.response && error.response.status) || error.message;
      console.log(`${kind} config lookup skipped: ${detail}`);
    }
  }
  return keys;
}

async function signInWithCustomToken(apiKey, customToken, appCheckToken) {
  const headers = { 'Content-Type': 'application/json' };
  if (appCheckToken) {
    headers['X-Firebase-AppCheck'] = appCheckToken;
  }
  const signIn = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ token: customToken, returnSecureToken: true })
    }
  );
  const signInBody = await signIn.json();
  return { ok: signIn.ok && Boolean(signInBody.idToken), idToken: signInBody.idToken, error: signInBody.error };
}

async function signInWithPassword(apiKey, authUid, label) {
  const email = `stage1-${authUid.slice(0, 10)}@epickup-stage-test.invalid`;
  const password = `St1!${authUid.slice(0, 16)}Aa`;
  try {
    await admin.auth().updateUser(authUid, { email, password, emailVerified: true });
  } catch (error) {
    console.log(`Password user update failed: ${error.message}`);
    return { ok: false, error: { message: error.message } };
  }
  const signIn = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );
  const signInBody = await signIn.json();
  return { ok: signIn.ok && Boolean(signInBody.idToken), idToken: signInBody.idToken, error: signInBody.error };
}

async function mintAppCheckToken(appId) {
  if (!appId) {
    return null;
  }
  try {
    const created = await admin.appCheck().createToken(appId);
    return created && created.token ? created.token : null;
  } catch (error) {
    console.log(`App Check createToken failed for ${appId}: ${error.message}`);
    return null;
  }
}

async function ensureAuthUser(phone, label) {
  try {
    return await admin.auth().getUserByPhoneNumber(phone);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      throw error;
    }
    return admin.auth().createUser({
      phoneNumber: phone,
      displayName: label
    });
  }
}

async function ensureShopUser(phone, label) {
  const uid = roleBasedAuthService.generateRoleSpecificUID(phone, 'shop');
  const db = getFirestore();
  await db.collection('users').doc(uid).set({
    userType: 'shop',
    phone,
    name: label,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return uid;
}

function mintShopJwt(uid, phone) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set locally');
  }
  const jwtService = require('../src/services/jwtService');
  return jwtService.generateAccessToken({
    userId: uid,
    userType: 'shop',
    phone
  });
}

async function verifyOnStaging(idToken, label) {
  const verify = await httpJson('POST', `${BASE_URL}/api/auth/firebase/verify-token`, {
    headers: { 'Content-Type': 'application/json' },
    body: { idToken, userType: 'shop', name: label }
  });
  const verifyBody = verify.json;
  if (verify.status >= 200 && verify.status < 300 && verifyBody && verifyBody.success) {
    return {
      token: verifyBody.data.token,
      uid: verifyBody.data.user.uid
    };
  }
  return null;
}

async function signInWithGoogleAuth(client, customToken) {
  const urls = [
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken',
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:signInWithCustomToken`
  ];
  for (const url of urls) {
    try {
      const res = await client.request({
        url,
        method: 'POST',
        data: { token: customToken, returnSecureToken: true }
      });
      if (res.data && res.data.idToken) {
        return res.data.idToken;
      }
    } catch (error) {
      const msg = (error.response && error.response.data && JSON.stringify(error.response.data)) || error.message;
      console.log(`OAuth Identity Toolkit attempt failed: ${msg}`);
    }
  }
  return null;
}

async function exchangeShopToken(client, apiKeys, authUid, phone, label) {
  const customToken = await admin.auth().createCustomToken(authUid, { role: 'shop' });
  let lastError = null;

  const oauthIdToken = await signInWithGoogleAuth(client, customToken);
  if (oauthIdToken) {
    const exchanged = await verifyOnStaging(oauthIdToken, label);
    if (exchanged) {
      console.log('Got staging JWT via OAuth Identity Toolkit + verify-token');
      return exchanged;
    }
    lastError = 'verify-token rejected OAuth-exchanged ID token';
  }

  for (const entry of apiKeys) {
    const appCheckToken = await mintAppCheckToken(entry.appId);
    const exchanged = await signInWithCustomToken(entry.apiKey, customToken, appCheckToken);
    if (!exchanged.ok) {
      lastError = exchanged.error && exchanged.error.message;
      console.log(`API-key custom-token exchange failed (${entry.kind}, appCheck=${Boolean(appCheckToken)}): ${lastError}`);
      continue;
    }
    const verified = await verifyOnStaging(exchanged.idToken, label);
    if (verified) {
      console.log(`Got staging JWT via verify-token (${entry.kind})`);
      return verified;
    }
    lastError = 'verify-token rejected API-key ID token';
  }

  if (apiKeys.length) {
    const passwordSignIn = await signInWithPassword(apiKeys[0].apiKey, authUid, label);
    if (passwordSignIn.ok) {
      const verified = await verifyOnStaging(passwordSignIn.idToken, label);
      if (verified) {
        console.log('Got staging JWT via password sign-in + verify-token');
        return verified;
      }
      lastError = 'verify-token rejected password ID token';
    } else {
      lastError = (passwordSignIn.error && passwordSignIn.error.message) || lastError;
      console.log(`Password sign-in failed: ${lastError}`);
    }
  }

  throw new Error(
    `Could not obtain a staging shop JWT. Identity Toolkit last error: ${lastError || 'unknown'}. Local mint was not accepted by staging.`
  );
}

async function mintForExistingShop(uid) {
  if (!process.env.JWT_SECRET) {
    console.log('Local mint skipped: JWT_SECRET is not loaded');
    return null;
  }
  let phone = null;
  let userType = 'shop';
  try {
    const snap = await getFirestore().collection('users').doc(uid).get();
    if (snap.exists) {
      const data = snap.data() || {};
      phone = data.phone || null;
      userType = data.userType || 'shop';
    } else {
      console.log('Shop uid not readable via local Admin (likely staging IAM). Minting from known login uid.');
    }
  } catch (error) {
    console.log(`Shop lookup skipped (${error.code || error.message}). Minting from known login uid.`);
  }
  if (userType !== 'shop') {
    throw new Error(`User ${uid} userType is ${userType}, expected shop`);
  }
  const token = mintShopJwt(uid, phone || SHOP_A_PHONE);
  const probe = await httpJson('GET', `${STAGING_URL}/api/shop/profile`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const code = probe.json && probe.json.error && probe.json.error.code;
  if (probe.status !== 200) {
    console.log(`Staging rejected shop JWT for confirmed uid: HTTP ${probe.status} ${code || ''} ${JSON.stringify(probe.json && probe.json.error)}`);
    return null;
  }
  console.log('Staging accepted shop JWT for confirmed test shop uid (GET /api/shop/profile = 200)');
  return { token, uid };
}

async function tryLocalMintAgainstStaging(phone, label) {
  if (!process.env.JWT_SECRET) {
    console.log('Local mint skipped: signing secret is not loaded');
    return null;
  }
  const uid = await ensureShopUser(phone, label);
  const token = mintShopJwt(uid, phone);
  const probe = await httpJson('GET', `${STAGING_URL}/api/shop/profile`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const code = probe.json && probe.json.error && probe.json.error.code;
  if (probe.status === 200) {
    console.log('Staging accepted a shop JWT (locally signed, probe GET /api/shop/orders = 200)');
    return { token, uid };
  }
  console.log(`Staging rejected locally signed shop JWT: HTTP ${probe.status} ${code || ''}`);
  return null;
}

async function api(token, method, urlPath, body) {
  return httpJson(method, `${BASE_URL}${urlPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body
  });
}

async function pickCustomer(db) {
  const testCustomerId = 'stage1testcustomer0000000001';
  await db.collection('users').doc(testCustomerId).set({
    userType: 'customer',
    name: 'Stage1 Test Customer',
    expoPushToken: DUMMY_EXPO,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { id: testCustomerId, hasPush: true };
}

async function recentNotifications(db, customerId, sinceMs) {
  const snap = await db.collection('notifications')
    .where('userId', '==', customerId)
    .limit(50)
    .get();
  const since = new Date(sinceMs - 2000);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((n) => {
      const raw = n.createdAt || n.sentAt;
      const created = raw && raw.toDate ? raw.toDate() : raw;
      if (!created) {
        return true;
      }
      return new Date(created) >= since;
    });
}

function dataType(n) {
  return (n.data && n.data.type) || n.type || '';
}

function noticesForOrder(notices, orderId) {
  return notices.filter((n) => n.data && n.data.variables && n.data.variables.orderId === orderId);
}

async function seed(shopId, customerId) {
  return shopOrderService.createSeedOrder({
    shopId,
    customerId,
    orderStatus: 'awaiting_payment'
  });
}

async function bookingWrites(db, orderId, shopId) {
  const byId = await db.collection('bookings').doc(orderId).get();
  const hits = { bookingDocSameId: byId.exists, marketplaceOrderId: 0, linkedOrderId: 0 };
  try {
    const a = await db.collection('bookings').where('marketplaceOrderId', '==', orderId).limit(5).get();
    hits.marketplaceOrderId = a.size;
  } catch (error) {
    hits.marketplaceOrderIdQueryError = error.message;
  }
  try {
    const b = await db.collection('bookings').where('linkedOrderId', '==', orderId).limit(5).get();
    hits.linkedOrderId = b.size;
  } catch (error) {
    hits.linkedOrderIdQueryError = error.message;
  }
  return hits;
}

async function main() {
  console.log(`Target: ${BASE_URL}`);
  const db = getFirestore();
  assertStagingAdmin();

  console.log(`Firebase project: ${process.env.FIREBASE_PROJECT_ID}`);
  try {
    const shopSnap = await db.collection('users').doc(SHOP_A_UID).get();
    const shopData = shopSnap.exists ? shopSnap.data() || {} : {};
    console.log(`Shop A Firestore read: exists=${shopSnap.exists} userType=${shopData.userType || 'n/a'}`);
  } catch (error) {
    console.log(`Shop A Firestore read failed: ${error.code || error.message}`);
  }
  const stagingProbe = await probeStagingRoutes();
  console.log(`Staging Railway /api/shop/orders → HTTP ${stagingProbe.status} ${stagingProbe.code || ''}`);
  if (stagingProbe.status === 404) {
    throw new Error('Staging Railway does not have /api/shop/orders mounted yet');
  }

  BASE_URL = STAGING_URL;
  console.log(`JWT_SECRET loaded: ${process.env.JWT_SECRET ? 'yes' : 'no'}`);
  let shopA = await mintForExistingShop(SHOP_A_UID);
  if (!shopA) {
    throw new Error('Could not mint a staging shop JWT for the confirmed shop uid');
  }

  console.log('Waiting for marketplaceOrders composite indexes to be READY on epickup-app-staging...');
  const indexInfo = await waitIndexesReadyViaStaging(shopA.token);
  console.log('Indexes READY:', JSON.stringify(indexInfo));

  let shopB = await tryLocalMintAgainstStaging(SHOP_B_PHONE, 'Stage1 Shop B');
  if (!shopB) {
    throw new Error('Could not mint a second shop JWT for IDOR checks');
  }
  const jwtProbe = await api(shopA.token, 'GET', '/api/shop/profile');
  if (jwtProbe.status !== 200) {
    throw new Error(`Shop JWT probe against staging failed: HTTP ${jwtProbe.status}`);
  }
  console.log('Working shop JWT confirmed against live staging (GET /api/shop/profile = 200)');
  if (shopA.uid === shopB.uid) {
    throw new Error('Shop A and Shop B resolved to the same uid');
  }
  const customer = await pickCustomer(db);
  console.log(`Using shopA uid length ${shopA.uid.length}, shopB uid length ${shopB.uid.length}, customer ${customer.id}`);

  // 1. Seed awaiting-payment, amount 250 not 295
  const seed1 = await seed(shopA.uid, customer.id);
  const amountPass = seed1.order.payment.amount === 250
    && seed1.order.itemsTotal === 250
    && seed1.order.deliveryFee === 45
    && seed1.order.payment.amount !== 295;
  record(
    'Seed awaiting-payment: payment.amount is 250, not 295',
    amountPass,
    `amount=${seed1.order.payment.amount} itemsTotal=${seed1.order.itemsTotal} deliveryFee=${seed1.order.deliveryFee}`
  );
  stopIfFailed();

  // 2. GET / and GET /:id as owner; other shop 404 ORDER_NOT_FOUND
  const listRes = await api(shopA.token, 'GET', '/api/shop/orders');
  const listOrders = (listRes.json && listRes.json.data && listRes.json.data.orders) || [];
  const listed = listOrders.find((o) => o.id === seed1.order.id);
  record(
    'GET / as owning shop returns real seeded order',
    listRes.status === 200 && Boolean(listed) && listed.payment && listed.payment.amount === 250,
    `http=${listRes.status} listed=${Boolean(listed)} count=${listOrders.length}`
  );
  stopIfFailed();

  const getRes = await api(shopA.token, 'GET', `/api/shop/orders/${seed1.order.id}`);
  const got = getRes.json && getRes.json.data && getRes.json.data.order;
  record(
    'GET /:id as owning shop returns real data',
    getRes.status === 200 && got && got.id === seed1.order.id && got.orderStatus === 'awaiting_payment',
    `http=${getRes.status} status=${got && got.orderStatus}`
  );
  stopIfFailed();

  const idorList = await api(shopB.token, 'GET', '/api/shop/orders');
  const idorOrders = (idorList.json && idorList.json.data && idorList.json.data.orders) || [];
  const leakedInList = idorOrders.some((o) => o.id === seed1.order.id);
  const idorGet = await api(shopB.token, 'GET', `/api/shop/orders/${seed1.order.id}`);
  const idorCode = idorGet.json && idorGet.json.error && idorGet.json.error.code;
  record(
    'Different shop GET /:id is 404 ORDER_NOT_FOUND, not 403; list does not leak',
    idorGet.status === 404 && idorCode === 'ORDER_NOT_FOUND' && !leakedInList,
    `http=${idorGet.status} code=${idorCode} leakedInList=${leakedInList}`
  );
  stopIfFailed();

  // 3+11. confirm-payment twice, first with amount 99999
  const confirm1 = await api(shopA.token, 'POST', `/api/shop/orders/${seed1.order.id}/confirm-payment`, { amount: 99999 });
  const c1order = confirm1.json && confirm1.json.data && confirm1.json.data.order;
  record(
    'confirm-payment with { amount: 99999 } stores payment.amount 250 and moves to preparing',
    confirm1.status === 200
      && c1order
      && c1order.orderStatus === 'preparing'
      && c1order.payment.amount === 250
      && c1order.payment.amount !== 99999,
    `http=${confirm1.status} status=${c1order && c1order.orderStatus} amount=${c1order && c1order.payment && c1order.payment.amount}`
  );
  stopIfFailed();

  const confirm2 = await api(shopA.token, 'POST', `/api/shop/orders/${seed1.order.id}/confirm-payment`, { amount: 1 });
  record(
    'Second confirm-payment returns 200 Already processed and orderStatus preparing',
    confirm2.status === 200
      && confirm2.json
      && confirm2.json.message === 'Already processed'
      && confirm2.json.data
      && confirm2.json.data.order
      && confirm2.json.data.order.orderStatus === 'preparing',
    `http=${confirm2.status} message=${confirm2.json && confirm2.json.message} status=${confirm2.json && confirm2.json.data && confirm2.json.data.order && confirm2.json.data.order.orderStatus}`
  );
  stopIfFailed();

  // 4. reject unpaid + real ORDER_CANCELLED notification
  const seedReject = await seed(shopA.uid, customer.id);
  const rejectSince = Date.now();
  const rejectRes = await api(shopA.token, 'POST', `/api/shop/orders/${seedReject.order.id}/reject`);
  const rejectOrder = rejectRes.json && rejectRes.json.data && rejectRes.json.data.order;
  await new Promise((r) => setTimeout(r, 1500));
  const afterReject = await recentNotifications(db, customer.id, rejectSince);
  const cancelNotices = afterReject.filter((n) => String(dataType(n)).toLowerCase().includes('order_cancelled') || n.title === 'Order cancelled');
  record(
    'reject on unpaid seed: cancelled + real ORDER_CANCELLED notification record',
    rejectRes.status === 200 && rejectOrder && rejectOrder.orderStatus === 'cancelled' && cancelNotices.length >= 1,
    `http=${rejectRes.status} status=${rejectOrder && rejectOrder.orderStatus} notices=${cancelNotices.length} recent=${afterReject.map(dataType).join('|') || 'none'}`
  );
  stopIfFailed();

  // 5. reject after confirmed payment → 409
  const seedPaidReject = await seed(shopA.uid, customer.id);
  const paidConfirm = await api(shopA.token, 'POST', `/api/shop/orders/${seedPaidReject.order.id}/confirm-payment`);
  const paidReject = await api(shopA.token, 'POST', `/api/shop/orders/${seedPaidReject.order.id}/reject`);
  record(
    'reject after confirmed payment returns 409, not silent success',
    paidConfirm.status === 200 && paidReject.status === 409,
    `confirmHttp=${paidConfirm.status} rejectHttp=${paidReject.status} code=${paidReject.json && paidReject.json.error && paidReject.json.error.code}`
  );
  stopIfFailed();

  // 6. two seeds, different displayIds
  const seedD1 = await seed(shopA.uid, customer.id);
  const seedD2 = await seed(shopA.uid, customer.id);
  record(
    'Two separate seeds have different displayId values',
    Boolean(seedD1.displayId) && Boolean(seedD2.displayId) && seedD1.displayId !== seedD2.displayId,
    `displayIdA=${seedD1.displayId} displayIdB=${seedD2.displayId}`
  );
  stopIfFailed();

  // 7. mark-ready → ready, no bookings write
  const seedReady = await seed(shopA.uid, customer.id);
  await api(shopA.token, 'POST', `/api/shop/orders/${seedReady.order.id}/confirm-payment`);
  const readyRes = await api(shopA.token, 'POST', `/api/shop/orders/${seedReady.order.id}/mark-ready`);
  const readyOrder = readyRes.json && readyRes.json.data && readyRes.json.data.order;
  const bookingHits = await bookingWrites(db, seedReady.order.id, shopA.uid);
  const noBooking = readyOrder
    && readyOrder.linkedBookingId == null
    && !bookingHits.bookingDocSameId
    && bookingHits.marketplaceOrderId === 0
    && bookingHits.linkedOrderId === 0;
  record(
    'mark-ready moves to ready and writes no bookings document',
    readyRes.status === 200 && readyOrder && readyOrder.orderStatus === 'ready' && noBooking,
    `http=${readyRes.status} status=${readyOrder && readyOrder.orderStatus} linkedBookingId=${readyOrder && readyOrder.linkedBookingId} bookings=${JSON.stringify(bookingHits)}`
  );
  stopIfFailed();

  // 8. handover wrong OTP 409, correct OTP handed_over, repeat Already processed
  const wrongOtp = await api(shopA.token, 'POST', `/api/shop/orders/${seedReady.order.id}/confirm-handover`, {
    otp: '000000',
    displayId: seedReady.displayId
  });
  record(
    'confirm-handover with wrong OTP returns 409',
    wrongOtp.status === 409,
    `http=${wrongOtp.status} code=${wrongOtp.json && wrongOtp.json.error && wrongOtp.json.error.code}`
  );
  stopIfFailed();

  const goodHandover = await api(shopA.token, 'POST', `/api/shop/orders/${seedReady.order.id}/confirm-handover`, {
    otp: seedReady.handoverOtp,
    displayId: seedReady.displayId
  });
  const ho = goodHandover.json && goodHandover.json.data && goodHandover.json.data.order;
  record(
    'confirm-handover with correct OTP + displayId → handed_over',
    goodHandover.status === 200 && ho && ho.orderStatus === 'handed_over',
    `http=${goodHandover.status} status=${ho && ho.orderStatus}`
  );
  stopIfFailed();

  const repeatHandover = await api(shopA.token, 'POST', `/api/shop/orders/${seedReady.order.id}/confirm-handover`, {
    otp: seedReady.handoverOtp,
    displayId: seedReady.displayId
  });
  record(
    'Repeat confirm-handover returns 200 Already processed',
    repeatHandover.status === 200 && repeatHandover.json && repeatHandover.json.message === 'Already processed',
    `http=${repeatHandover.status} message=${repeatHandover.json && repeatHandover.json.message}`
  );
  stopIfFailed();

  // 9. cancel unpaid refundRequired false; cancel after confirm refund_pending + only REFUND_INITIATED; refund-sent refunded
  const seedUnpaidCancel = await seed(shopA.uid, customer.id);
  const unpaidCancel = await api(shopA.token, 'POST', `/api/shop/orders/${seedUnpaidCancel.order.id}/cancel`, {
    reason: 'Stage1 unpaid cancel test'
  });
  record(
    'cancel on unpaid returns refundRequired: false',
    unpaidCancel.status === 200
      && unpaidCancel.json
      && unpaidCancel.json.data
      && unpaidCancel.json.data.refundRequired === false
      && unpaidCancel.json.data.order
      && unpaidCancel.json.data.order.orderStatus === 'cancelled',
    `http=${unpaidCancel.status} refundRequired=${unpaidCancel.json && unpaidCancel.json.data && unpaidCancel.json.data.refundRequired}`
  );
  stopIfFailed();

  const seedPaidCancel = await seed(shopA.uid, customer.id);
  await api(shopA.token, 'POST', `/api/shop/orders/${seedPaidCancel.order.id}/confirm-payment`);
  const paidCancelSince = Date.now();
  const paidCancel = await api(shopA.token, 'POST', `/api/shop/orders/${seedPaidCancel.order.id}/cancel`, {
    reason: 'Stage1 paid cancel test'
  });
  await new Promise((r) => setTimeout(r, 1500));
  const afterPaidCancel = await recentNotifications(db, customer.id, paidCancelSince);
  const forThisCancel = noticesForOrder(afterPaidCancel, seedPaidCancel.order.id);
  const refundNotices = forThisCancel.filter((n) => String(dataType(n)).toLowerCase().includes('refund_initiated') || n.title === 'Refund pending');
  const cancelDupes = forThisCancel.filter((n) => String(dataType(n)).toLowerCase().includes('order_cancelled') || n.title === 'Order cancelled');
  const paidCancelOrder = paidCancel.json && paidCancel.json.data && paidCancel.json.data.order;
  record(
    'cancel after confirm → refund_pending + only REFUND_INITIATED (no duplicate cancel notice)',
    paidCancel.status === 200
      && paidCancelOrder
      && paidCancelOrder.orderStatus === 'cancelled'
      && paidCancelOrder.payment.status === 'refund_pending'
      && refundNotices.length >= 1
      && cancelDupes.length === 0,
    `http=${paidCancel.status} payment=${paidCancelOrder && paidCancelOrder.payment && paidCancelOrder.payment.status} refundNotices=${refundNotices.length} cancelNotices=${cancelDupes.length} recent=${afterPaidCancel.map(dataType).join('|') || 'none'}`
  );
  stopIfFailed();

  const refundSent = await api(shopA.token, 'POST', `/api/shop/orders/${seedPaidCancel.order.id}/refund-sent`);
  const refunded = refundSent.json && refundSent.json.data && refundSent.json.data.order;
  record(
    'refund-sent → refunded',
    refundSent.status === 200 && refunded && refunded.payment && refunded.payment.status === 'refunded',
    `http=${refundSent.status} payment=${refunded && refunded.payment && refunded.payment.status}`
  );
  stopIfFailed();

  printSummary();
  console.log('\nAll Stage 1 live checks passed.');
}

main()
  .then(() => {
    stopLocalServer();
  })
  .catch((error) => {
    console.error('Stage 1 live test crashed:', error.message || error);
    if (error.stack) {
      console.error(error.stack);
    }
    stopLocalServer();
    process.exit(1);
  });
