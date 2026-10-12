const {
  COUNTER_COLLECTION,
  COUNTER_DOC,
  REGISTRY_COLLECTION
} = require('./orderNumberPool');
const DISPLAY_ID_MIN = 10000;
const DISPLAY_ID_MAX = 99999;
const LEGACY_SOURCE = 'legacy';

function normalizeDisplayId(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.trunc(raw);
    if (n >= DISPLAY_ID_MIN && n <= DISPLAY_ID_MAX) {
      return n;
    }
    return null;
  }
  if (typeof raw === 'string') {
    const digits = raw.trim().replace(/^#/, '');
    if (!/^\d+$/.test(digits)) {
      return null;
    }
    const n = parseInt(digits, 10);
    if (n >= DISPLAY_ID_MIN && n <= DISPLAY_ID_MAX) {
      return n;
    }
  }
  return null;
}

function registryMatches(existing, expected) {
  if (!existing || typeof existing !== 'object') {
    return false;
  }
  return existing.kind === expected.kind
    && existing.refId === expected.refId
    && (existing.source === LEGACY_SOURCE || existing.source === 'pool' || existing.source == null);
}

/**
 * Build registration plan from scanned claims and optional registry snapshots.
 * @param {Array<{ kind: 'parcel'|'shop_order', refId: string, number: number }>} claims
 * @param {Map<number, object>|Record<number, object>} registryByNumber
 */
function planLegacyOrderNumberRegistration(claims, registryByNumber) {
  const byNumber = registryByNumber instanceof Map
    ? registryByNumber
    : new Map(Object.entries(registryByNumber || {}).map(([k, v]) => [Number(k), v]));

  const invalidDisplayId = [];
  const duplicates = [];
  const numberToClaims = new Map();

  claims.forEach((claim) => {
    const number = normalizeDisplayId(claim.number);
    if (number === null) {
      invalidDisplayId.push({
        kind: claim.kind,
        refId: claim.refId,
        raw: claim.number
      });
      return;
    }
    const normalized = { kind: claim.kind, refId: claim.refId, number };
    if (!numberToClaims.has(number)) {
      numberToClaims.set(number, []);
    }
    numberToClaims.get(number).push(normalized);
  });

  numberToClaims.forEach((list, number) => {
    if (list.length <= 1) {
      return;
    }
    duplicates.push({
      number,
      claims: list.map((entry) => ({ kind: entry.kind, refId: entry.refId }))
    });
  });

  const toCreate = [];
  let alreadyRegistered = 0;
  const conflicts = [];

  numberToClaims.forEach((list, number) => {
    if (list.length !== 1) {
      return;
    }
    const claim = list[0];
    const existing = byNumber.get(number);
    if (!existing) {
      toCreate.push(claim);
      return;
    }
    if (registryMatches(existing, claim)) {
      alreadyRegistered += 1;
      return;
    }
    conflicts.push({
      number,
      claim: { kind: claim.kind, refId: claim.refId },
      existing: {
        kind: existing.kind,
        refId: existing.refId,
        source: existing.source
      }
    });
  });

  return {
    validNumbers: numberToClaims.size - duplicates.length,
    invalidDisplayId,
    duplicates,
    toCreate,
    alreadyRegistered,
    conflicts
  };
}

function countLegacyRegisteredInRegistry(registryDocs) {
  let count = 0;
  (registryDocs || []).forEach((doc) => {
    const data = doc && typeof doc.data === 'function' ? doc.data() : doc;
    if (data && data.source === LEGACY_SOURCE) {
      count += 1;
    }
  });
  return count;
}

module.exports = {
  COUNTER_COLLECTION,
  COUNTER_DOC,
  REGISTRY_COLLECTION,
  DISPLAY_ID_MIN,
  DISPLAY_ID_MAX,
  LEGACY_SOURCE,
  normalizeDisplayId,
  planLegacyOrderNumberRegistration,
  countLegacyRegisteredInRegistry,
  registryMatches
};
