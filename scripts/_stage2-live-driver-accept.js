/**
 * Live staging: mint a driver JWT and call the real driver accept endpoint
 * against a synthetic marketplace booking. Staging Firebase only.
 * Does not touch the Driver App codebase.
 */
require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('./assertStagingFirebase');
assertStagingEnv();

const crypto = require('crypto');
const dns = require('dns');
const https = require('https');
const axios = require('axios');
const admin = require('firebase-admin');
const { initializeFirebase, getFirestore } = require('../src/services/firebase');
const shopOrderService = require('../src/services/shopOrderService');

dns.setDefaultResultOrder('ipv4first');
const STAGING_HOST = 'epickupbackend-staging.up.railway.app';
const STAGING_IPV4 = process.env.STAGING_BACKEND_IPV4 || '69.46.46.102';
const stagingHttpsAgent = new https.Agent({
  family: 4,
  keepAlive: true,
  lookup: (hostname, options, callback) => {
    if (hostname === STAGING_HOST) {
      callback(null, STAGING_IPV4, 4);
      return;
    }
    dns.lookup(hostname, options, callback);
  }
});

const STAGING_URL = process.env.STAGING_BACKEND_URL || process.env.BACKEND_URL || 'https://epickupbackend-staging.up.railway.app';
const SHOP_A_UID = process.env.STAGING_SHOP_UID || 'b7302f5d6343c1641d63811306eb';
const SHOP_A_PHONE = process.env.STAGING_SHOP_PHONE || '+919148101698';
const CUSTOMER_ID = 'stage1testcustomer0000000001';
const DRIVER_UID = 'stage2testdriver00000000000001';
const DRIVER_PHONE = '+919000333801';
const DRIVER_NAME = 'Stage2 Test Driver';
const VEHICLE_NUMBER = 'TN20ST1234';
const VEHICLE_MODEL = 'Honda Activa';
const TIRUPATTUR = { latitude: 12.495, longitude: 78.5678 };
const WALLET_POINTS = 10000;

function fail(message) {
  throw new Error(message);
}

function mintJwt(uid, userType, phone) {
  const jwtService = require('../src/services/jwtService');
  return jwtService.generateAccessToken({
    userId: uid,
    userType,
    phone
  });
}

function decodeJwtPayload(token) {
  const jwt = require('jsonwebtoken');
  const payload = jwt.decode(token);
  return {
    userType: payload && payload.userType,
    userId: payload && payload.userId,
    type: payload && payload.type,
    hasPhone: Boolean(payload && payload.phone)
  };
}

async function httpJson(method, url, { headers, body, timeout = 25000 } = {}) {
  const res = await axios({
    method,
    url,
    headers,
    data: body,
    timeout,
    validateStatus: () => true,
    httpsAgent: url.includes(STAGING_HOST) ? stagingHttpsAgent : undefined
  });
  return { status: res.status, json: res.data };
}

async function api(token, method, urlPath, body, timeout = 45000, extraHeaders = {}) {
  return httpJson(method, `${STAGING_URL}${urlPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    body,
    timeout
  });
}

function report(step, pass, extra) {
  console.log(JSON.stringify({ step, pass, ...extra }));
  return pass;
}

async function findExistingApprovedDriver(db) {
  const queries = [
    db.collection('users').where('userType', '==', 'driver').limit(50).get(),
    db.collection('users').where('driver.verificationStatus', '==', 'approved').limit(20).get(),
    db.collection('users').where('driver.isVerified', '==', true).limit(20).get()
  ];
  const snaps = await Promise.all(queries.map((p) => p.catch(() => ({ docs: [], empty: true, size: 0 }))));
  const byId = new Map();
  for (const snap of snaps) {
    for (const doc of snap.docs || []) {
      byId.set(doc.id, { id: doc.id, ...(doc.data() || {}) });
    }
  }
  const candidates = [...byId.values()].filter((data) => {
    const driver = data.driver || {};
    const verified = driver.isVerified === true
      || data.isVerified === true
      || driver.verificationStatus === 'approved'
      || driver.verificationStatus === 'verified'
      || data.verificationStatus === 'approved'
      || data.verificationStatus === 'verified';
    const looksTest = /test|stage|dummy/i.test(`${data.name || ''} ${data.phone || ''} ${data.id || ''}`);
    return data.userType === 'driver' && verified && looksTest && data.isActive !== false;
  });
  return {
    totalSeen: byId.size,
    candidate: candidates[0] || null
  };
}

async function ensureDriverAccount(db) {
  const existing = await findExistingApprovedDriver(db);
  if (existing.candidate) {
    return {
      created: false,
      uid: existing.candidate.id,
      phone: existing.candidate.phone,
      name: existing.candidate.name,
      searched: existing.totalSeen
    };
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection('users').doc(DRIVER_UID).set({
    id: DRIVER_UID,
    userType: 'driver',
    name: DRIVER_NAME,
    phone: DRIVER_PHONE,
    isActive: true,
    isVerified: true,
    createdAt: now,
    updatedAt: now,
    driver: {
      isOnline: false,
      isAvailable: false,
      isVerified: true,
      verificationStatus: 'approved',
      rating: 4.8,
      currentBookingId: null,
      vehicleDetails: {
        vehicleNumber: VEHICLE_NUMBER,
        vehicleModel: VEHICLE_MODEL,
        vehicleType: '2_wheeler',
        vehicleColor: 'Black'
      }
    }
  }, { merge: true });

  return {
    created: true,
    uid: DRIVER_UID,
    phone: DRIVER_PHONE,
    name: DRIVER_NAME,
    searched: existing.totalSeen
  };
}

async function setDriverAvailable(db, uid) {
  const now = new Date();
  await db.collection('users').doc(uid).set({
    isActive: true,
    updatedAt: now,
    driver: {
      isOnline: true,
      isAvailable: true,
      isVerified: true,
      verificationStatus: 'approved',
      currentBookingId: null,
      currentLocation: {
        latitude: TIRUPATTUR.latitude,
        longitude: TIRUPATTUR.longitude,
        updatedAt: now
      },
      vehicleDetails: {
        vehicleNumber: VEHICLE_NUMBER,
        vehicleModel: VEHICLE_MODEL,
        vehicleType: '2_wheeler',
        vehicleColor: 'Black'
      }
    }
  }, { merge: true });

  await db.collection('driverPointsWallets').doc(uid).set({
    driverId: uid,
    pointsBalance: WALLET_POINTS,
    totalPointsEarned: WALLET_POINTS,
    totalPointsSpent: 0,
    status: 'active',
    requiresTopUp: false,
    lastUpdated: now
  }, { merge: true });

  const user = await db.collection('users').doc(uid).get();
  const wallet = await db.collection('driverPointsWallets').doc(uid).get();
  const data = user.data() || {};
  const driver = data.driver || {};
  const loc = driver.currentLocation || {};
  return {
    isOnline: driver.isOnline === true,
    isAvailable: driver.isAvailable === true,
    isVerified: driver.isVerified === true,
    verificationStatus: driver.verificationStatus,
    latitude: loc.latitude,
    longitude: loc.longitude,
    vehicleNumber: driver.vehicleDetails && driver.vehicleDetails.vehicleNumber,
    walletBalance: wallet.exists ? Number(wallet.data().pointsBalance || 0) : 0,
    currentBookingId: driver.currentBookingId || null
  };
}

async function countBookings(db, orderId) {
  const snap = await db.collection('bookings').where('marketplaceOrderId', '==', orderId).get();
  return snap.docs.map((d) => ({
    id: d.id,
    sourceType: d.data().sourceType,
    status: d.data().status,
    driverId: d.data().driverId || null
  }));
}

async function waitForDriverInfo(db, orderId, timeoutMs = 20000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const snap = await db.collection('marketplaceOrders').doc(orderId).get();
    last = snap.exists ? (snap.data() || {}) : null;
    const info = last && last.driverInfo;
    if (info && info.name && info.phone && info.vehicle) {
      return { synced: true, waitedMs: Date.now() - started, driverInfo: info, orderStatus: last.orderStatus };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return {
    synced: false,
    waitedMs: Date.now() - started,
    driverInfo: last && last.driverInfo,
    orderStatus: last && last.orderStatus
  };
}

async function main() {
  if (String(STAGING_URL).includes('epickupbackend-production')) {
    fail('Refusing production Railway URL');
  }

  initializeFirebase();
  assertStagingAdmin();
  const db = getFirestore();

  const health = await httpJson('GET', `${STAGING_URL}/health`);
  if (health.status !== 200 || !health.json || health.json.status !== 'OK') {
    fail(`staging health HTTP ${health.status}`);
  }

  // Step 1
  const driver = await ensureDriverAccount(db);
  const step1 = report('step1-staging-driver', Boolean(driver.uid && driver.phone), {
    created: driver.created,
    uid: driver.uid,
    phone: driver.phone,
    name: driver.name,
    existingDriversFound: driver.searched
  });
  if (!step1) {
    fail('Step 1 failed: no staging driver account');
  }

  // Step 2
  const driverToken = mintJwt(driver.uid, 'driver', driver.phone);
  const minted = decodeJwtPayload(driverToken);
  const profile = await api(driverToken, 'GET', '/api/driver/profile');
  const profileUser = profile.json && profile.json.data;
  const step2 = report('step2-mint-driver-jwt', minted.userType === 'driver' && profile.status === 200, {
    mintedUserType: minted.userType,
    mintedUserIdMatches: minted.userId === driver.uid,
    mintedTokenType: minted.type,
    profileHttp: profile.status,
    profileError: profile.status !== 200 ? (profile.json && profile.json.error) : undefined,
    profileName: profileUser && (profileUser.name || profileUser.driverName || null)
  });
  if (!step2) {
    fail(`Step 2 failed: driver JWT/profile HTTP ${profile.status}`);
  }

  // Step 3
  const availability = await setDriverAvailable(db, driver.uid);
  const nearTirupattur = Math.abs(availability.latitude - TIRUPATTUR.latitude) < 0.05
    && Math.abs(availability.longitude - TIRUPATTUR.longitude) < 0.05;
  const step3 = report('step3-set-driver-available', availability.isOnline
    && availability.isAvailable
    && availability.isVerified
    && availability.verificationStatus === 'approved'
    && nearTirupattur
    && availability.walletBalance >= WALLET_POINTS
    && !availability.currentBookingId, availability);
  if (!step3) {
    fail('Step 3 failed: driver availability fields were not set as required by accept');
  }

  // Step 4
  const shopToken = mintJwt(SHOP_A_UID, 'shop', SHOP_A_PHONE);
  const seeded = await shopOrderService.createSeedOrder({
    shopId: SHOP_A_UID,
    customerId: CUSTOMER_ID,
    orderStatus: 'awaiting_payment'
  });
  const confirm = await api(shopToken, 'POST', `/api/shop/orders/${seeded.order.id}/confirm-payment`);
  const confirmOrder = confirm.json && confirm.json.data && confirm.json.data.order;
  if (confirm.status !== 200 || !confirmOrder || confirmOrder.orderStatus !== 'preparing') {
    fail(`Step 4 confirm-payment failed: HTTP ${confirm.status}`);
  }
  const ready = await api(shopToken, 'POST', `/api/shop/orders/${seeded.order.id}/mark-ready`);
  const readyOrder = ready.json && ready.json.data && ready.json.data.order;
  const bookings = await countBookings(db, seeded.order.id);
  const booking = bookings[0] || null;
  const step4 = report('step4-fresh-marketplace-booking', ready.status === 200
    && readyOrder
    && readyOrder.orderStatus === 'ready'
    && Boolean(readyOrder.linkedBookingId)
    && bookings.length === 1
    && booking
    && booking.sourceType === 'marketplace'
    && booking.status === 'pending', {
    target: STAGING_URL,
    orderId: seeded.order.id,
    linkedBookingId: readyOrder && readyOrder.linkedBookingId,
    bookingCount: bookings.length,
    sourceType: booking && booking.sourceType,
    bookingStatus: booking && booking.status,
    markReadyHttp: ready.status,
    markReadyMessage: ready.json && ready.json.message
  });
  if (!step4) {
    fail('Step 4 failed: live mark-ready did not produce a pending marketplace booking');
  }

  // Step 5 — real accept on live staging
  const accept = await api(
    driverToken,
    'POST',
    `/api/driver/bookings/${readyOrder.linkedBookingId}/accept`,
    {},
    60000,
    { 'Idempotency-Key': crypto.randomUUID() }
  );
  const acceptData = accept.json && accept.json.data;
  const bookingAfter = await db.collection('bookings').doc(readyOrder.linkedBookingId).get();
  const bookingAfterData = bookingAfter.exists ? bookingAfter.data() : null;
  const step5 = report('step5-live-driver-accept', accept.status === 200
    && accept.json
    && accept.json.success === true
    && acceptData
    && acceptData.status === 'driver_assigned'
    && bookingAfterData
    && bookingAfterData.driverId === driver.uid
    && bookingAfterData.status === 'driver_assigned'
    && bookingAfterData.driverInfo
    && bookingAfterData.driverInfo.phone === driver.phone, {
    target: `${STAGING_URL}/api/driver/bookings/${readyOrder.linkedBookingId}/accept`,
    http: accept.status,
    success: accept.json && accept.json.success,
    message: accept.json && accept.json.message,
    error: accept.json && accept.json.error,
    acceptData,
    firestoreStatus: bookingAfterData && bookingAfterData.status,
    firestoreDriverId: bookingAfterData && bookingAfterData.driverId,
    firestoreDriverInfo: bookingAfterData && bookingAfterData.driverInfo
  });
  if (!step5) {
    fail(`Step 5 failed: live accept HTTP ${accept.status} ${JSON.stringify(accept.json && accept.json.error)}`);
  }

  // Step 6 — live listener mirror, not Console edit
  const sync = await waitForDriverInfo(db, seeded.order.id);
  const step6 = report('step6-live-sync-driverInfo', sync.synced
    && sync.driverInfo.name === DRIVER_NAME
    && sync.driverInfo.phone === driver.phone
    && sync.driverInfo.vehicle === VEHICLE_NUMBER
    && sync.orderStatus === 'ready', sync);
  if (!step6) {
    fail('Step 6 failed: marketplaceOrders.driverInfo was not mirrored by the live listener');
  }

  console.log('PASS  live staging driver accept of marketplace booking');
}

main().catch((error) => {
  console.error('FAIL  live driver accept:', error.message || error);
  process.exit(1);
});
