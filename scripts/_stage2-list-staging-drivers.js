/**
 * Read-only: list staging driver users for Stage 2 accept test.
 */
require('dotenv').config();
const { assertStagingEnv, assertStagingAdmin } = require('./assertStagingFirebase');
assertStagingEnv();
const { initializeFirebase, getFirestore } = require('../src/services/firebase');

function summarize(id, data) {
  const driver = data.driver || {};
  const vd = driver.vehicleDetails || {};
  return {
    uid: id,
    name: data.name || null,
    phone: data.phone || null,
    userType: data.userType || null,
    isActive: data.isActive !== false,
    isOnline: driver.isOnline === true,
    isAvailable: driver.isAvailable === true,
    isVerified: driver.isVerified === true || data.isVerified === true,
    verificationStatus: driver.verificationStatus || data.verificationStatus || null,
    vehicleNumber: vd.vehicleNumber || driver.vehicleNumber || null,
    hasLocation: Boolean(driver.currentLocation && (driver.currentLocation.latitude || driver.currentLocation._latitude)),
    currentBookingId: driver.currentBookingId || null
  };
}

async function main() {
  initializeFirebase();
  assertStagingAdmin();
  const db = getFirestore();
  const snap = await db.collection('users').where('userType', '==', 'driver').limit(50).get();
  const rows = snap.docs.map((d) => summarize(d.id, d.data() || {}));
  console.log(JSON.stringify({
    projectId: process.env.FIREBASE_PROJECT_ID,
    count: rows.length,
    drivers: rows
  }, null, 2));
}

main().catch((error) => {
  console.error('FAIL list drivers:', error.message || error);
  process.exit(1);
});
