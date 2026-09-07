/**
 * Broader staging search for driver-shaped users (userType may be missing).
 */
require('dotenv').config();
const { assertStagingEnv, assertStagingAdmin } = require('./assertStagingFirebase');
assertStagingEnv();
const { initializeFirebase, getFirestore } = require('../src/services/firebase');

async function safeQuery(label, fn) {
  try {
    const snap = await fn();
    return {
      label,
      count: snap.size,
      ids: snap.docs.slice(0, 20).map((d) => {
        const data = d.data() || {};
        const driver = data.driver || {};
        return {
          uid: d.id,
          userType: data.userType || null,
          name: data.name || null,
          phone: data.phone || null,
          verificationStatus: driver.verificationStatus || data.verificationStatus || null,
          isVerified: driver.isVerified === true || data.isVerified === true
        };
      })
    };
  } catch (error) {
    return { label, error: error.message };
  }
}

async function main() {
  initializeFirebase();
  assertStagingAdmin();
  const db = getFirestore();

  const results = [];
  results.push(await safeQuery('userType=driver', () => db.collection('users').where('userType', '==', 'driver').limit(20).get()));
  results.push(await safeQuery('driver.isVerified=true', () => db.collection('users').where('driver.isVerified', '==', true).limit(20).get()));
  results.push(await safeQuery('driver.verificationStatus=approved', () => db.collection('users').where('driver.verificationStatus', '==', 'approved').limit(20).get()));
  results.push(await safeQuery('verificationStatus=approved', () => db.collection('users').where('verificationStatus', '==', 'approved').limit(20).get()));

  const locSnap = await db.collection('driverLocations').limit(20).get();
  results.push({
    label: 'driverLocations',
    count: locSnap.size,
    ids: locSnap.docs.map((d) => d.id)
  });

  const wallets = await db.collection('driverPointsWallets').limit(20).get();
  results.push({
    label: 'driverPointsWallets',
    count: wallets.size,
    ids: wallets.docs.map((d) => d.id)
  });

  console.log(JSON.stringify({ projectId: process.env.FIREBASE_PROJECT_ID, results }, null, 2));
}

main().catch((error) => {
  console.error('FAIL search:', error.message || error);
  process.exit(1);
});
