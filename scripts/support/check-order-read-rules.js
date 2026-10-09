/**
 * Staging-only check of the live Firestore ruleset via the Rules Test API.
 * Loads projects/epickup-app-staging/releases/cloud.firestore and evaluates
 * marketplace order, refund, and signal access. No sign-in, no API key,
 * no client reads, and no writes.
 *
 *   node scripts/support/check-order-read-rules.js
 */

require('dotenv').config();

const { assertStagingEnv, assertStagingAdmin } = require('../assertStagingFirebase');
const { STAGING_CUSTOMER_ID, STAGING_SHOP_ID } = require('./marketplaceStagingActions');

assertStagingEnv();

const STAGING_PROJECT = 'epickup-app-staging';
const CUSTOMER_AUTH_UID = 'JEsRxaNjE9Ox1aU9KnKpJfWd0I12';
const ORDER_ID = 'sec7-rules-check';
const REFUND_ID = 'sec7-refund';
const OTHER_CUSTOMER_ID = 'other-customer';
const ADMIN_UID = 'sec7-admin';

function documentPath(segments) {
  return `/databases/(default)/documents/${segments.join('/')}`;
}

function mockExists(docPath, value) {
  return {
    function: 'exists',
    args: [{ exactValue: docPath }],
    result: { value }
  };
}

function mockGet(docPath, data) {
  return {
    function: 'get',
    args: [{ exactValue: docPath }],
    result: { value: { data } }
  };
}

function uniqueMocks(mocks) {
  const seen = new Set();
  return mocks.filter((mock) => {
    const key = `${mock.function}:${mock.args[0].exactValue}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function ownerMocks(shopAuthUid) {
  const customerUser = documentPath(['users', STAGING_CUSTOMER_ID]);
  const shopUser = documentPath(['users', STAGING_SHOP_ID]);
  const otherUser = documentPath(['users', OTHER_CUSTOMER_ID]);
  return uniqueMocks([
    mockExists(customerUser, true),
    mockGet(customerUser, { originalFirebaseUID: CUSTOMER_AUTH_UID }),
    mockExists(shopUser, true),
    mockGet(shopUser, { originalFirebaseUID: shopAuthUid, userType: 'shop' }),
    mockExists(otherUser, false),
    mockExists(documentPath(['adminUsers', CUSTOMER_AUTH_UID]), false),
    mockExists(documentPath(['users', CUSTOMER_AUTH_UID]), false),
    mockExists(documentPath(['adminUsers', shopAuthUid]), false),
    mockExists(documentPath(['users', shopAuthUid]), false)
  ]);
}

function buildCases(shopAuthUid) {
  const orderPath = documentPath(['marketplaceOrders', ORDER_ID]);
  const orderResource = {
    data: {
      customerId: STAGING_CUSTOMER_ID,
      shopId: STAGING_SHOP_ID
    }
  };
  const signalPath = documentPath(['marketplaceOrders', ORDER_ID, 'signal', 'latest']);
  const refundPath = documentPath(['marketplaceOrders', ORDER_ID, 'refunds', REFUND_ID]);
  const functionMocks = ownerMocks(shopAuthUid);
  const customerAuth = { uid: CUSTOMER_AUTH_UID };
  const shopAuth = { uid: shopAuthUid };

  return [
    {
      name: 'a customer get order',
      expectation: 'DENY',
      request: { auth: customerAuth, method: 'get', path: orderPath },
      resource: orderResource,
      functionMocks
    },
    {
      name: 'b shop get order',
      expectation: 'DENY',
      request: { auth: shopAuth, method: 'get', path: orderPath },
      resource: orderResource,
      functionMocks
    },
    {
      name: 'c customer get refund',
      expectation: 'DENY',
      request: { auth: customerAuth, method: 'get', path: refundPath },
      resource: { data: { status: 'pending' } },
      functionMocks
    },
    {
      name: 'd customer get own signal',
      expectation: 'ALLOW',
      request: { auth: customerAuth, method: 'get', path: signalPath },
      resource: { data: { customerId: STAGING_CUSTOMER_ID } },
      functionMocks
    },
    {
      name: 'e customer get other signal',
      expectation: 'DENY',
      request: { auth: customerAuth, method: 'get', path: signalPath },
      resource: { data: { customerId: OTHER_CUSTOMER_ID } },
      functionMocks
    },
    {
      name: 'f authenticated write signal',
      expectation: 'DENY',
      request: { auth: customerAuth, method: 'create', path: signalPath },
      resource: { data: { customerId: STAGING_CUSTOMER_ID } },
      functionMocks
    },
    {
      name: 'g admin get order',
      expectation: 'ALLOW',
      request: {
        auth: { uid: ADMIN_UID, token: { role: 'super_admin' } },
        method: 'get',
        path: orderPath
      },
      resource: orderResource,
      functionMocks
    }
  ];
}

async function accessToken() {
  const admin = require('firebase-admin');
  const tokenResult = await admin.app().options.credential.getAccessToken();
  const token = tokenResult && (tokenResult.access_token || tokenResult.accessToken);
  if (!token) {
    throw new Error('Could not get an access token');
  }
  return token;
}

async function loadLiveRuleset(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const releaseUrl = `https://firebaserules.googleapis.com/v1/projects/${STAGING_PROJECT}/releases/cloud.firestore`;
  const releaseResponse = await fetch(releaseUrl, { headers });
  if (!releaseResponse.ok) {
    throw new Error(`Rules release lookup failed (${releaseResponse.status})`);
  }
  const release = await releaseResponse.json();
  if (!release.rulesetName) {
    throw new Error('Rules release has no ruleset');
  }
  const rulesetResponse = await fetch(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`, { headers });
  if (!rulesetResponse.ok) {
    throw new Error(`Ruleset lookup failed (${rulesetResponse.status})`);
  }
  const ruleset = await rulesetResponse.json();
  if (!ruleset.source || !Array.isArray(ruleset.source.files) || ruleset.source.files.length === 0) {
    throw new Error('Ruleset has no source files');
  }
  return { rulesetName: release.rulesetName, source: ruleset.source };
}

async function resolveShopAuthUid(db) {
  const snap = await db.collection('users').doc(STAGING_SHOP_ID).get();
  const stored = snap.exists ? snap.data().originalFirebaseUID : null;
  if (typeof stored === 'string' && stored.trim() !== '') {
    return { authUid: stored.trim(), source: 'originalFirebaseUID' };
  }
  return { authUid: STAGING_SHOP_ID, source: 'role-id' };
}

async function assertCustomerAuthUid(db) {
  const snap = await db.collection('users').doc(STAGING_CUSTOMER_ID).get();
  const stored = snap.exists ? snap.data().originalFirebaseUID : null;
  if (stored !== CUSTOMER_AUTH_UID) {
    throw new Error('Locked customer originalFirebaseUID does not match the expected auth uid');
  }
}

function actualFrom(result, expectation) {
  if (!result || result.state === 'SUCCESS') {
    return result && result.state === 'SUCCESS' ? expectation : 'ERROR';
  }
  if (result.state === 'FAILURE') {
    return expectation === 'ALLOW' ? 'DENY' : 'ALLOW';
  }
  return result.state || 'ERROR';
}

function printTable(rows) {
  const header = ['case', 'expected', 'actual', 'result'];
  const widths = header.map((column, index) => Math.max(
    column.length,
    ...rows.map((row) => String(row[index]).length)
  ));
  const line = (cells) => cells.map((cell, index) => String(cell).padEnd(widths[index])).join(' | ');
  console.log(line(header));
  rows.forEach((row) => console.log(line(row)));
}

async function main() {
  const { getFirestore } = require('../../src/services/firebase');
  const db = getFirestore();
  assertStagingAdmin();
  await assertCustomerAuthUid(db);
  const shop = await resolveShopAuthUid(db);
  const token = await accessToken();
  const live = await loadLiveRuleset(token);
  const cases = buildCases(shop.authUid);
  const response = await fetch(`https://firebaserules.googleapis.com/v1/projects/${STAGING_PROJECT}:test`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': STAGING_PROJECT
    },
    body: JSON.stringify({
      source: live.source,
      testSuite: {
        testCases: cases.map((item) => ({
          expectation: item.expectation,
          request: item.request,
          resource: item.resource,
          functionMocks: item.functionMocks,
          pathEncoding: 'PLAIN'
        }))
      }
    })
  });
  const body = await response.json();
  if (!response.ok) {
    const message = body && body.error && body.error.message ? body.error.message : `Rules test failed (${response.status})`;
    throw new Error(message);
  }
  const issues = Array.isArray(body.issues) ? body.issues.filter((issue) => issue.severity === 'ERROR') : [];
  if (issues.length > 0) {
    throw new Error(issues.map((issue) => issue.description).join('; '));
  }
  const results = Array.isArray(body.testResults) ? body.testResults : [];
  const rows = cases.map((item, index) => {
    const result = results[index];
    const actual = actualFrom(result, item.expectation);
    const mark = actual === item.expectation ? '✅' : '❌';
    return [item.name, item.expectation, actual, mark];
  });
  console.log(`ruleset ${live.rulesetName}`);
  console.log(`shop auth source ${shop.source}`);
  printTable(rows);
  const failed = rows.some((row) => row[3] === '❌');
  if (failed) {
    results.forEach((result, index) => {
      if (!result || rows[index][3] !== '❌') {
        return;
      }
      const messages = Array.isArray(result.debugMessages) ? result.debugMessages : [];
      if (messages.length > 0) {
        console.error(`${cases[index].name}: ${messages.join(' | ')}`);
      }
    });
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  buildCases,
  actualFrom
};
