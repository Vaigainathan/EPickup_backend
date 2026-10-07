const { getFirestore } = require('../firebase');

const ORDER_STATUSES = [
  'awaiting_payment',
  'payment_unconfirmed',
  'payment_review',
  'preparing',
  'ready',
  'handed_over',
  'completed',
  'cancelled',
  'delivery_failed'
];

const PAYMENT_STATUSES = [
  'pending',
  'customer_claimed',
  'short',
  'confirmed',
  'expired',
  'under_review',
  'not_verified',
  'cancelled',
  'refund_pending',
  'refunded'
];

const ALLOWED_TRANSITIONS = {
  awaiting_payment: ['preparing', 'cancelled', 'payment_review', 'payment_unconfirmed', 'awaiting_payment'],
  payment_unconfirmed: ['preparing', 'payment_review', 'cancelled'],
  payment_review: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['handed_over', 'cancelled'],
  handed_over: ['completed', 'delivery_failed']
};

const ENFORCEMENT_TTL_MS = 60 * 1000;
const DEFAULT_ENFORCEMENT = { newStatuses: false, utrBlocksReject: false };

let enforcementCache = null;
let enforcementCachedAt = 0;

class InvalidStateError extends Error {
  constructor(from, to) {
    super(`Invalid order transition from ${from} to ${to}`);
    this.name = 'InvalidStateError';
    this.status = 409;
    this.code = 'INVALID_STATE';
  }
}

function assertTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new InvalidStateError(from, to);
  }
}

function coerceFlag(value) {
  return value === true;
}

function parseEnforcement(data) {
  const raw = data && data.MARKETPLACE_ENFORCEMENT;
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_ENFORCEMENT };
  }
  return {
    newStatuses: coerceFlag(raw.newStatuses),
    utrBlocksReject: coerceFlag(raw.utrBlocksReject)
  };
}

function _resetEnforcementCache() {
  enforcementCache = null;
  enforcementCachedAt = 0;
}

async function getMarketplaceEnforcement() {
  const now = Date.now();
  if (enforcementCache && (now - enforcementCachedAt) < ENFORCEMENT_TTL_MS) {
    return enforcementCache;
  }

  try {
    const snap = await getFirestore().collection('appSettings').doc('marketplace').get();
    const parsed = snap.exists ? parseEnforcement(snap.data()) : { ...DEFAULT_ENFORCEMENT };
    enforcementCache = parsed;
    enforcementCachedAt = now;
    return parsed;
  } catch {
    return { ...DEFAULT_ENFORCEMENT };
  }
}

module.exports = {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  ALLOWED_TRANSITIONS,
  InvalidStateError,
  assertTransition,
  getMarketplaceEnforcement,
  _resetEnforcementCache
};
