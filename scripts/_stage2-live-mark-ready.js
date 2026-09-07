/**
 * Live HTTP mark-ready against Railway staging.
 * Seed/confirm setup may use Admin; mark-ready itself is HTTP only.
 */
require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('./assertStagingFirebase');
assertStagingEnv();

const dns = require('dns');
const https = require('https');
const axios = require('axios');
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

function fail(message) {
  throw new Error(message);
}

function mintShopJwt(uid, phone) {
  const jwtService = require('../src/services/jwtService');
  return jwtService.generateAccessToken({
    userId: uid,
    userType: 'shop',
    phone
  });
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

async function api(token, method, urlPath, body, timeout = 45000) {
  return httpJson(method, `${STAGING_URL}${urlPath}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body,
    timeout
  });
}

async function countBookings(db, orderId) {
  try {
    const snap = await db.collection('bookings').where('marketplaceOrderId', '==', orderId).get();
    return snap.docs.map((d) => ({ id: d.id, sourceType: d.data().sourceType, status: d.data().status }));
  } catch (error) {
    throw new Error(`bookings query failed: ${error.message}`);
  }
}

async function main() {
  if (String(STAGING_URL).includes('epickupbackend-production')) {
    fail('Refusing production Railway URL');
  }

  initializeFirebase();
  assertStagingAdmin();
  const db = getFirestore();

  const health = await httpJson('GET', `${STAGING_URL}/health`);
  const healthUptime = health.json && typeof health.json.uptime === 'number' ? health.json.uptime : null;
  console.log(JSON.stringify({
    case: 'staging-health',
    url: STAGING_URL,
    http: health.status,
    environment: health.json && health.json.environment,
    uptimeSec: healthUptime,
    ok: health.status === 200 && health.json && health.json.status === 'OK'
  }));
  if (health.status !== 200 || !health.json || health.json.status !== 'OK') {
    fail(`staging health HTTP ${health.status}`);
  }

  const token = mintShopJwt(SHOP_A_UID, SHOP_A_PHONE);
  const profile = await api(token, 'GET', '/api/shop/profile');
  if (profile.status !== 200) {
    fail(`staging rejected shop JWT: HTTP ${profile.status}`);
  }

  const seeded = await shopOrderService.createSeedOrder({
    shopId: SHOP_A_UID,
    customerId: CUSTOMER_ID,
    orderStatus: 'awaiting_payment'
  });

  const confirm = await api(token, 'POST', `/api/shop/orders/${seeded.order.id}/confirm-payment`);
  const confirmOrder = confirm.json && confirm.json.data && confirm.json.data.order;
  if (confirm.status !== 200 || !confirmOrder || confirmOrder.orderStatus !== 'preparing') {
    fail(`confirm-payment failed: HTTP ${confirm.status} ${JSON.stringify(confirm.json && confirm.json.error)}`);
  }

  const before = await countBookings(db, seeded.order.id);
  const first = await api(token, 'POST', `/api/shop/orders/${seeded.order.id}/mark-ready`);
  const firstOrder = first.json && first.json.data && first.json.data.order;
  const afterFirst = await countBookings(db, seeded.order.id);
  const booking = afterFirst[0] || null;
  const firstPass = first.status === 200
    && first.json
    && first.json.message !== 'Already processed'
    && firstOrder
    && firstOrder.orderStatus === 'ready'
    && Boolean(firstOrder.linkedBookingId)
    && afterFirst.length === 1
    && booking
    && booking.sourceType === 'marketplace'
    && booking.id === firstOrder.linkedBookingId
    && before.length === 0;

  console.log(JSON.stringify({
    case: 'http-mark-ready-creates-one-booking',
    pass: firstPass,
    target: STAGING_URL,
    http: first.status,
    message: first.json && first.json.message,
    orderId: seeded.order.id,
    orderStatus: firstOrder && firstOrder.orderStatus,
    linkedBookingId: firstOrder && firstOrder.linkedBookingId,
    bookingCount: afterFirst.length,
    sourceType: booking && booking.sourceType
  }));
  if (!firstPass) {
    fail('live mark-ready did not create exactly one marketplace booking');
  }

  const second = await api(token, 'POST', `/api/shop/orders/${seeded.order.id}/mark-ready`);
  const afterSecond = await countBookings(db, seeded.order.id);
  const secondOrder = second.json && second.json.data && second.json.data.order;
  const secondPass = second.status === 200
    && second.json
    && second.json.message === 'Already processed'
    && secondOrder
    && secondOrder.linkedBookingId === firstOrder.linkedBookingId
    && afterSecond.length === 1;

  console.log(JSON.stringify({
    case: 'http-mark-ready-idempotent',
    pass: secondPass,
    http: second.status,
    message: second.json && second.json.message,
    linkedUnchanged: secondOrder && secondOrder.linkedBookingId === firstOrder.linkedBookingId,
    bookingCount: afterSecond.length
  }));
  if (!secondPass) {
    fail('repeat live mark-ready was not 200 Already processed with a single booking');
  }

  console.log('PASS  live staging HTTP mark-ready');
}

main().catch((error) => {
  console.error('FAIL  live mark-ready:', error.message || error);
  process.exit(1);
});
