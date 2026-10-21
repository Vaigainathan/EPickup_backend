const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('../services/firebase');

/** Fixed doc under users/{customerId}/private — survives deploys (unlike tmp/ files). */
const SNAPSHOT_COLLECTION = 'private';
const SNAPSHOT_DOC_ID = 'marketplaceRestrictionSnapshot';

function snapshotRef(db, customerId) {
  return db
    .collection('users')
    .doc(customerId)
    .collection(SNAPSHOT_COLLECTION)
    .doc(SNAPSHOT_DOC_ID);
}

async function saveMarketplaceSnapshot(customerId, marketplace) {
  const db = getFirestore();
  const ref = snapshotRef(db, customerId);
  const payload = {
    customerId,
    savedAt: FieldValue.serverTimestamp(),
    marketplace: marketplace && typeof marketplace === 'object' ? marketplace : {}
  };
  await ref.set(payload);
  return ref.path;
}

async function loadMarketplaceSnapshot(customerId) {
  const db = getFirestore();
  const snap = await snapshotRef(db, customerId).get();
  if (!snap.exists) {
    return null;
  }
  const data = snap.data() || {};
  return {
    customerId: data.customerId || customerId,
    savedAt: data.savedAt,
    marketplace: data.marketplace && typeof data.marketplace === 'object' ? data.marketplace : {}
  };
}

async function deleteMarketplaceSnapshot(customerId) {
  const db = getFirestore();
  const ref = snapshotRef(db, customerId);
  const snap = await ref.get();
  if (!snap.exists) {
    return false;
  }
  await ref.delete();
  return true;
}

async function prepareRestrictSnapshot(customerId, marketplace, { force = false } = {}) {
  const existing = await loadMarketplaceSnapshot(customerId);
  if (existing && !force) {
    return { ok: false, code: 'SNAPSHOT_EXISTS' };
  }
  const path = await saveMarketplaceSnapshot(customerId, marketplace);
  return {
    ok: true,
    path,
    file: path,
    overwritten: Boolean(existing && force)
  };
}

module.exports = {
  SNAPSHOT_COLLECTION,
  SNAPSHOT_DOC_ID,
  snapshotRef,
  saveMarketplaceSnapshot,
  loadMarketplaceSnapshot,
  deleteMarketplaceSnapshot,
  prepareRestrictSnapshot
};
