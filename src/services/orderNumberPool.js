const { Timestamp } = require('firebase-admin/firestore');

const RANGE_START = 10000;
const MODULUS = 90000;
const MULTIPLIER = 7919;
const OFFSET = 30011;
const MAX_CANDIDATES = 20;
const COUNTER_COLLECTION = 'system_counters';
const COUNTER_DOC = 'order_number_pool';
const REGISTRY_COLLECTION = 'orderNumbers';

class PoolNoFreeNumberError extends Error {
  constructor() {
    super('POOL_NO_FREE_NUMBER');
    this.name = 'PoolNoFreeNumberError';
    this.code = 'POOL_NO_FREE_NUMBER';
  }
}

function numberForIndex(i) {
  return RANGE_START + ((i * MULTIPLIER + OFFSET) % MODULUS);
}

function isPoolEnabled() {
  return process.env.FEATURE_ORDER_NUMBER_POOL === 'true';
}

async function allocateInTransaction(transaction, db, { kind, refId }) {
  const counterRef = db.collection(COUNTER_COLLECTION).doc(COUNTER_DOC);
  const counterSnap = await transaction.get(counterRef);
  const counterData = counterSnap.exists ? (counterSnap.data() || {}) : {};
  const nextIndex = counterSnap.exists ? (counterData.nextIndex || 0) : 0;
  const totalAllocated = counterSnap.exists ? (counterData.totalAllocated || 0) : 0;

  let chosen = null;
  for (let offset = 0; offset < MAX_CANDIDATES; offset += 1) {
    const index = nextIndex + offset;
    const number = numberForIndex(index);
    const registryRef = db.collection(REGISTRY_COLLECTION).doc(String(number));
    const registrySnap = await transaction.get(registryRef);
    if (!registrySnap.exists) {
      chosen = { index, number, registryRef };
      break;
    }
  }

  if (!chosen) {
    console.error(`[NumberPool] no free number in 20 candidates starting index=${nextIndex}`);
    throw new PoolNoFreeNumberError();
  }

  const skipped = chosen.index - nextIndex;
  console.log(`[NumberPool] allocated number=${chosen.number} index=${chosen.index} skipped=${skipped} kind=${kind} refId=${refId}`);

  transaction.set(chosen.registryRef, {
    number: chosen.number,
    kind,
    refId,
    source: 'pool',
    createdAt: Timestamp.now()
  });
  transaction.set(counterRef, {
    nextIndex: chosen.index + 1,
    totalAllocated: totalAllocated + 1
  });

  return chosen.number;
}

async function allocateOrderNumber(db, options) {
  return db.runTransaction((transaction) => allocateInTransaction(transaction, db, options));
}

module.exports = {
  numberForIndex,
  allocateInTransaction,
  allocateOrderNumber,
  isPoolEnabled,
  PoolNoFreeNumberError
};
