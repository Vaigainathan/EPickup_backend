const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('../firebase');
const {
  prepareRestrictSnapshot,
  loadMarketplaceSnapshot,
  deleteMarketplaceSnapshot
} = require('../../utils/marketplaceProfileSnapshot');

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  throw error;
}

async function restrictCustomerMarketplace(customerId, { reason, operator, force = false }) {
  if (!customerId || !reason || !operator) {
    httpError(400, 'MISSING_FIELDS', 'customerId, reason, and operator are required');
  }

  const db = getFirestore();
  const userRef = db.collection('users').doc(customerId);
  const snap = await userRef.get();
  if (!snap.exists) {
    httpError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
  }

  const data = snap.data() || {};
  if (data.userType !== 'customer') {
    httpError(400, 'NOT_A_CUSTOMER', 'User is not a customer');
  }

  const marketplace = data.customer && data.customer.marketplace
    ? data.customer.marketplace
    : {};

  const snapshotOutcome = await prepareRestrictSnapshot(customerId, marketplace, { force });
  if (!snapshotOutcome.ok) {
    httpError(409, snapshotOutcome.code || 'SNAPSHOT_EXISTS', 'Marketplace snapshot already exists; pass force to overwrite');
  }

  await userRef.update({
    'customer.marketplace.restriction': {
      active: true,
      reason,
      setBy: operator,
      setAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  });

  return {
    customerId,
    restricted: true,
    snapshotPath: snapshotOutcome.path || snapshotOutcome.file,
    overwritten: snapshotOutcome.overwritten === true
  };
}

async function unrestrictCustomerMarketplace(customerId, { operator }) {
  const snapshot = await loadMarketplaceSnapshot(customerId);
  if (!snapshot) {
    httpError(409, 'SNAPSHOT_MISSING', 'No marketplace snapshot found for restore');
  }

  const db = getFirestore();
  const userRef = db.collection('users').doc(customerId);
  const snap = await userRef.get();
  if (!snap.exists) {
    httpError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
  }

  const restored = snapshot.marketplace && typeof snapshot.marketplace === 'object'
    ? snapshot.marketplace
    : {};

  await userRef.update({
    'customer.marketplace': restored,
    updatedAt: FieldValue.serverTimestamp(),
    marketplaceUnrestrictedBy: operator || null
  });
  await deleteMarketplaceSnapshot(customerId);

  return { customerId, unrestricted: true, restoredKeys: Object.keys(restored) };
}

module.exports = {
  restrictCustomerMarketplace,
  unrestrictCustomerMarketplace
};
