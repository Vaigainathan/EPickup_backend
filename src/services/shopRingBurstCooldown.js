const BURST_MS = 60 * 1000;
const RING_NOTIFICATION_TYPES = new Set(['incoming_payment', 'INCOMING_PAYMENT']);

/** In-process last ring time per shop (fail-open if unavailable). */
const lastRingAtByShop = new Map();

function markShopRingSent(shopId, nowMs = Date.now()) {
  if (!shopId) {
    return;
  }
  lastRingAtByShop.set(String(shopId), nowMs);
}

function recentRingInMemory(shopId, nowMs = Date.now()) {
  const at = lastRingAtByShop.get(String(shopId));
  if (!Number.isFinite(at)) {
    return false;
  }
  return nowMs - at < BURST_MS;
}

/**
 * Fail-open: true only when we are confident a ring was sent in the last 60s.
 * Primary: in-memory map. Backup: notifications query inside try/catch.
 */
async function shouldDowngradeShopIncomingRing(db, shopId, nowMs = Date.now()) {
  if (!shopId) {
    return false;
  }
  if (recentRingInMemory(shopId, nowMs)) {
    return true;
  }
  try {
    const since = new Date(nowMs - BURST_MS);
    const snap = await db.collection('notifications')
      .where('userId', '==', String(shopId))
      .where('status', '==', 'sent')
      .where('sentAt', '>=', since)
      .limit(20)
      .get();
    for (let index = 0; index < snap.docs.length; index += 1) {
      const data = snap.docs[index].data() || {};
      const type = data.type || (data.data && data.data.type);
      if (RING_NOTIFICATION_TYPES.has(type) || type === 'incoming_payment') {
        return true;
      }
    }
  } catch (error) {
    console.warn('[ShopRingBurst] Backup notifications query failed (fail-open):', error.message);
  }
  return false;
}

function resetShopRingBurstForTests() {
  lastRingAtByShop.clear();
}

module.exports = {
  BURST_MS,
  markShopRingSent,
  shouldDowngradeShopIncomingRing,
  resetShopRingBurstForTests
};
