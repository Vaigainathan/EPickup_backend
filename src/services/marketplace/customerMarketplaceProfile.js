const { FieldValue } = require('firebase-admin/firestore');
const { getFirestore } = require('../firebase');
const { isValidUpiId } = require('../../validators/marketplace');
const { httpError } = require('./httpError');

const PAYER_NAME_MIN = 2;
const PAYER_NAME_MAX = 60;

function toIso(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.toISOString() : null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return null;
}

function presentMarketplaceProfile(marketplace) {
  const source = marketplace && typeof marketplace === 'object' ? marketplace : {};
  const stats = source.stats && typeof source.stats === 'object' ? source.stats : {};
  const restriction = source.restriction && typeof source.restriction === 'object'
    ? source.restriction
    : null;
  const out = {
    unpaidCount: Number(source.unpaidCount) || 0,
    payerUpiName: typeof source.payerUpiName === 'string' ? source.payerUpiName : null,
    refundUpiId: typeof source.refundUpiId === 'string' ? source.refundUpiId : null,
    stats: {
      unpaidCancels: Number(stats.unpaidCancels) || 0,
      reportsNotVerified: Number(stats.reportsNotVerified) || 0,
      utrCorrections: Number(stats.utrCorrections) || 0,
      ordersCompleted: Number(stats.ordersCompleted) || 0
    }
  };
  if (restriction) {
    out.restriction = {
      active: restriction.active === true,
      reason: typeof restriction.reason === 'string' ? restriction.reason : null,
      setAt: toIso(restriction.setAt),
      setBy: typeof restriction.setBy === 'string' ? restriction.setBy : null
    };
  } else {
    out.restriction = null;
  }
  return out;
}

function validatePayerUpiName(value) {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return { ok: false, message: 'payerUpiName must be a string' };
  }
  const trimmed = value.trim();
  if (trimmed.length < PAYER_NAME_MIN || trimmed.length > PAYER_NAME_MAX) {
    return { ok: false, message: `payerUpiName must be ${PAYER_NAME_MIN}-${PAYER_NAME_MAX} characters` };
  }
  return { ok: true, value: trimmed };
}

function validateRefundUpiId(value) {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return { ok: false, message: 'refundUpiId must be a string' };
  }
  const trimmed = value.trim();
  if (!isValidUpiId(trimmed)) {
    return { ok: false, message: 'refundUpiId is not a valid UPI ID' };
  }
  return { ok: true, value: trimmed };
}

async function readMarketplaceProfile(customerId) {
  const db = getFirestore();
  const snap = await db.collection('users').doc(customerId).get();
  if (!snap.exists) {
    throw httpError(404, 'NOT_FOUND', 'Customer not found');
  }
  const data = snap.data() || {};
  const marketplace = data.customer && data.customer.marketplace
    ? data.customer.marketplace
    : {};
  return presentMarketplaceProfile(marketplace);
}

async function updateMarketplaceProfile(customerId, body) {
  const payload = body && typeof body === 'object' ? body : {};
  const payer = validatePayerUpiName(payload.payerUpiName);
  if (!payer.ok) {
    throw httpError(400, 'VALIDATION', payer.message);
  }
  const refund = validateRefundUpiId(payload.refundUpiId);
  if (!refund.ok) {
    throw httpError(400, 'VALIDATION', refund.message);
  }
  if (payer.value === undefined && refund.value === undefined) {
    throw httpError(400, 'VALIDATION', 'At least one of payerUpiName or refundUpiId is required');
  }

  const db = getFirestore();
  const userRef = db.collection('users').doc(customerId);
  const snap = await userRef.get();
  if (!snap.exists) {
    throw httpError(404, 'NOT_FOUND', 'Customer not found');
  }

  const patch = { updatedAt: FieldValue.serverTimestamp() };
  if (payer.value !== undefined) {
    patch['customer.marketplace.payerUpiName'] = payer.value;
  }
  if (refund.value !== undefined) {
    patch['customer.marketplace.refundUpiId'] = refund.value;
  }
  await userRef.update(patch);

  const after = await userRef.get();
  const marketplace = after.data().customer && after.data().customer.marketplace
    ? after.data().customer.marketplace
    : {};
  return presentMarketplaceProfile(marketplace);
}

module.exports = {
  presentMarketplaceProfile,
  readMarketplaceProfile,
  updateMarketplaceProfile
};
