const { getFirestore } = require('../firebase');
const { toPaise, fromPaise } = require('../../validators/marketplace');
const { loadRefundDocs, millisOf } = require('./refunds');

const TIMEZONE = 'Asia/Kolkata';
const PERIOD_KEYS = ['today', 'yesterday', 'thisMonth', 'lastMonth', 'allTime'];
const REFUNDED_STATUSES = new Set(['sent', 'disputed', 'confirmed', 'closed']);
const REFUND_DUE_STATUSES = new Set(['upi_needed', 'due']);
const PAYMENT_SIGNAL_STATUSES = new Set(['confirmed', 'refund_pending', 'refunded']);

function kolkataDateKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function kolkataYearMonth(date) {
  const key = kolkataDateKey(date);
  return key.slice(0, 7);
}

function emptyPeriodBucket() {
  return {
    receivedPaise: 0,
    refundedPaise: 0,
    paidOrders: 0,
    completedOrders: 0,
    cancelledOrders: 0,
    refundsSent: 0
  };
}

function emptyPeriodsState() {
  const periods = {};
  PERIOD_KEYS.forEach((key) => {
    periods[key] = emptyPeriodBucket();
  });
  return {
    periods,
    refundsDuePaise: 0,
    refundsDueCount: 0
  };
}

function formatRupees(paise) {
  return Number(fromPaise(paise).toFixed(2));
}

function paymentOf(order) {
  return (order && order.payment && typeof order.payment === 'object') ? order.payment : {};
}

function moneyReceivedPaise(order) {
  const payment = paymentOf(order);
  if (payment.receivedAmountPaise != null && Number.isFinite(Number(payment.receivedAmountPaise))) {
    const paise = Number(payment.receivedAmountPaise);
    if (paise > 0) {
      return paise;
    }
  }
  if (payment.receivedAmount != null) {
    const paise = toPaise(payment.receivedAmount);
    if (paise > 0) {
      return paise;
    }
  }
  if (payment.status === 'confirmed' && payment.amount != null) {
    const legacy = toPaise(payment.amount);
    return legacy > 0 ? legacy : 0;
  }
  return 0;
}

function hasMoneyReceived(order) {
  return moneyReceivedPaise(order) > 0;
}

/**
 * When payment.confirmedAt is missing, fallbacks used when money was recorded in code:
 * payment.late.receivedAt (late payment paths), payment.review.shopResponse.at (short / review).
 */
function moneyReceivedAtMs(order) {
  const payment = paymentOf(order);
  const confirmed = millisOf(payment.confirmedAt);
  if (Number.isFinite(confirmed)) {
    return confirmed;
  }
  const late = payment.late && typeof payment.late === 'object'
    ? millisOf(payment.late.receivedAt)
    : null;
  if (Number.isFinite(late)) {
    return late;
  }
  const review = payment.review && typeof payment.review === 'object'
    ? payment.review.shopResponse
    : null;
  if (review && typeof review === 'object') {
    const at = millisOf(review.at);
    if (Number.isFinite(at)) {
      return at;
    }
  }
  return null;
}

function cancelledAtMs(order) {
  const cancellation = order.cancellation && typeof order.cancellation === 'object'
    ? order.cancellation
    : null;
  const fromNested = cancellation ? millisOf(cancellation.cancelledAt) : null;
  if (Number.isFinite(fromNested)) {
    return fromNested;
  }
  return null;
}

function completedAtMs(order) {
  const completed = millisOf(order.completedAt);
  if (Number.isFinite(completed)) {
    return completed;
  }
  const delivery = order.delivery && typeof order.delivery === 'object' ? order.delivery : null;
  const delivered = delivery ? millisOf(delivery.deliveredAt) : null;
  if (Number.isFinite(delivered)) {
    return delivered;
  }
  return null;
}

function shouldLoadRefunds(order) {
  if (!order || typeof order !== 'object') {
    return false;
  }
  if (hasMoneyReceived(order)) {
    return true;
  }
  const payment = paymentOf(order);
  if (PAYMENT_SIGNAL_STATUSES.has(payment.status)) {
    return true;
  }
  if (order.hasOpenRefund === true) {
    return true;
  }
  if (order.customerRefundAction != null && String(order.customerRefundAction).trim() !== '') {
    return true;
  }
  return false;
}

function periodMatchers(now) {
  const todayKey = kolkataDateKey(now);
  const yesterdayDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = kolkataDateKey(yesterdayDate);
  const thisMonthKey = kolkataYearMonth(now);
  const [yearPart, monthPart] = thisMonthKey.split('-').map(Number);
  let lastYear = yearPart;
  let lastMonthNum = monthPart - 1;
  if (lastMonthNum < 1) {
    lastMonthNum = 12;
    lastYear -= 1;
  }
  const lastMonthKey = `${lastYear}-${String(lastMonthNum).padStart(2, '0')}`;

  return {
    todayKey,
    yesterdayKey,
    thisMonthKey,
    lastMonthKey,
    matches(periodKey, instantMs) {
      if (!Number.isFinite(instantMs)) {
        return false;
      }
      if (periodKey === 'allTime') {
        return true;
      }
      const date = new Date(instantMs);
      const dayKey = kolkataDateKey(date);
      const monthKey = kolkataYearMonth(date);
      if (periodKey === 'today') {
        return dayKey === todayKey;
      }
      if (periodKey === 'yesterday') {
        return dayKey === yesterdayKey;
      }
      if (periodKey === 'thisMonth') {
        return monthKey === thisMonthKey;
      }
      if (periodKey === 'lastMonth') {
        return monthKey === lastMonthKey;
      }
      return false;
    }
  };
}

function addToPeriods(state, periodKey, mutator) {
  const bucket = state.periods[periodKey];
  mutator(bucket);
}

function bumpReceived(state, matchers, receivedPaise, receivedAtMs) {
  PERIOD_KEYS.forEach((periodKey) => {
    if (!matchers.matches(periodKey, receivedAtMs)) {
      return;
    }
    addToPeriods(state, periodKey, (bucket) => {
      bucket.receivedPaise += receivedPaise;
      bucket.paidOrders += 1;
    });
  });
}

function bumpRefunded(state, matchers, refundPaise, sentAtMs) {
  PERIOD_KEYS.forEach((periodKey) => {
    if (!matchers.matches(periodKey, sentAtMs)) {
      return;
    }
    addToPeriods(state, periodKey, (bucket) => {
      bucket.refundedPaise += refundPaise;
    });
  });
}

function bumpRefundsSentCount(state, matchers, sentAtMs) {
  PERIOD_KEYS.forEach((periodKey) => {
    if (!matchers.matches(periodKey, sentAtMs)) {
      return;
    }
    addToPeriods(state, periodKey, (bucket) => {
      bucket.refundsSent += 1;
    });
  });
}

function refundSentPaise(refund) {
  if (!refund || typeof refund !== 'object') {
    return 0;
  }
  const status = refund.status;
  if (!REFUNDED_STATUSES.has(status)) {
    return 0;
  }
  if (refund.sentAmount != null && Number.isFinite(Number(refund.sentAmount))) {
    const paise = toPaise(refund.sentAmount);
    return paise > 0 ? paise : 0;
  }
  if (refund.amount != null && Number.isFinite(Number(refund.amount))) {
    const paise = toPaise(refund.amount);
    return paise > 0 ? paise : 0;
  }
  return 0;
}

function refundDuePaise(refund) {
  if (!refund || typeof refund !== 'object') {
    return 0;
  }
  if (!REFUND_DUE_STATUSES.has(refund.status)) {
    return 0;
  }
  if (refund.amount != null && Number.isFinite(Number(refund.amount))) {
    const paise = toPaise(refund.amount);
    return paise > 0 ? paise : 0;
  }
  return 0;
}

function presentPeriodBucket(bucket) {
  const received = bucket.receivedPaise;
  const refunded = bucket.refundedPaise;
  return {
    received: formatRupees(received),
    refunded: formatRupees(refunded),
    net: formatRupees(received - refunded),
    paidOrders: bucket.paidOrders,
    completedOrders: bucket.completedOrders,
    cancelledOrders: bucket.cancelledOrders,
    refundsSent: bucket.refundsSent
  };
}

function presentAggregate(state, now) {
  const periods = {};
  PERIOD_KEYS.forEach((key) => {
    periods[key] = presentPeriodBucket(state.periods[key]);
  });
  return {
    currency: 'INR',
    timezone: TIMEZONE,
    asOf: now.toISOString(),
    periods,
    refundsDue: {
      count: state.refundsDueCount,
      amount: formatRupees(state.refundsDuePaise)
    }
  };
}

/**
 * @param {Array<{ order: object, refunds: object[] }>} orderEntries
 */
function aggregateEarnings(orderEntries, now = new Date()) {
  const state = emptyPeriodsState();
  const matchers = periodMatchers(now);

  orderEntries.forEach(({ order, refunds }) => {
    const receivedPaise = moneyReceivedPaise(order);
    const receivedAtMs = moneyReceivedAtMs(order);
    if (receivedPaise > 0 && Number.isFinite(receivedAtMs)) {
      bumpReceived(state, matchers, receivedPaise, receivedAtMs);
    }

    if (order.orderStatus === 'completed') {
      const at = completedAtMs(order);
      PERIOD_KEYS.forEach((periodKey) => {
        if (matchers.matches(periodKey, at)) {
          addToPeriods(state, periodKey, (bucket) => {
            bucket.completedOrders += 1;
          });
        }
      });
    }

    if (order.orderStatus === 'cancelled') {
      const at = cancelledAtMs(order);
      PERIOD_KEYS.forEach((periodKey) => {
        if (matchers.matches(periodKey, at)) {
          addToPeriods(state, periodKey, (bucket) => {
            bucket.cancelledOrders += 1;
          });
        }
      });
    }

    (refunds || []).forEach((refund) => {
      const duePaise = refundDuePaise(refund);
      if (duePaise > 0) {
        state.refundsDuePaise += duePaise;
        state.refundsDueCount += 1;
      }
      const sentPaise = refundSentPaise(refund);
      const sentAtMs = millisOf(refund.sentAt);
      if (sentPaise > 0 && Number.isFinite(sentAtMs)) {
        bumpRefunded(state, matchers, sentPaise, sentAtMs);
        bumpRefundsSentCount(state, matchers, sentAtMs);
      }
    });
  });

  return state;
}

async function loadRefundsForOrderDoc(doc) {
  if (!shouldLoadRefunds(doc.data())) {
    return [];
  }
  return loadRefundDocs(doc.ref);
}

async function buildOrderEntriesFromSnapshot(snapshot) {
  const docs = snapshot.docs || [];
  const refundsList = await Promise.all(docs.map((doc) => loadRefundsForOrderDoc(doc)));
  return docs.map((doc, index) => ({
    order: { id: doc.id, ...(doc.data() || {}) },
    refunds: refundsList[index] || []
  }));
}

async function loadShopOrderEntries(shopId) {
  const db = getFirestore();
  const snapshot = await db.collection('marketplaceOrders')
    .where('shopId', '==', shopId)
    .orderBy('createdAt', 'desc')
    .get();
  return buildOrderEntriesFromSnapshot(snapshot);
}

async function loadAllMarketplaceOrderEntries() {
  const db = getFirestore();
  const snapshot = await db.collection('marketplaceOrders')
    .orderBy('createdAt', 'desc')
    .get();
  return buildOrderEntriesFromSnapshot(snapshot);
}

async function computeShopEarnings(shopId, { now = new Date() } = {}) {
  const entries = await loadShopOrderEntries(shopId);
  const filtered = entries.filter(({ order }) => order.shopId === shopId);
  const state = aggregateEarnings(filtered, now);
  return presentAggregate(state, now);
}

function groupEntriesByShopId(entries) {
  const map = new Map();
  entries.forEach((entry) => {
    const shopId = entry.order && entry.order.shopId;
    if (!shopId) {
      return;
    }
    if (!map.has(shopId)) {
      map.set(shopId, []);
    }
    map.get(shopId).push(entry);
  });
  return map;
}

function resolveShopApprovalStatus(userData = {}) {
  if (userData.isActive === false || userData.suspendedAt) {
    return 'suspended';
  }
  const shop = userData.shop && typeof userData.shop === 'object' ? userData.shop : {};
  const status = shop.approvalStatus;
  if (status === 'approved' || status === 'rejected' || status === 'pending') {
    return status;
  }
  return 'pending';
}

async function listAdminShopEarnings(period, { now = new Date() } = {}) {
  const periodKey = period || 'today';
  if (!PERIOD_KEYS.includes(periodKey)) {
    const error = new Error('period must be today, yesterday, thisMonth, lastMonth, or allTime');
    error.status = 400;
    error.code = 'VALIDATION';
    throw error;
  }

  const db = getFirestore();
  const [entries, shopsSnap] = await Promise.all([
    loadAllMarketplaceOrderEntries(),
    db.collection('users').where('userType', '==', 'shop').get()
  ]);

  const byShop = groupEntriesByShopId(entries);
  const rows = [];

  shopsSnap.docs.forEach((doc) => {
    const userData = doc.data() || {};
    const shop = userData.shop && typeof userData.shop === 'object' ? userData.shop : {};
    const shopEntries = byShop.get(doc.id) || [];
    const state = aggregateEarnings(shopEntries, now);
    const slice = presentPeriodBucket(state.periods[periodKey]);
    rows.push({
      shopId: doc.id,
      shopName: shop.shopName || userData.name || '',
      approvalStatus: resolveShopApprovalStatus(userData),
      received: slice.received,
      refunded: slice.refunded,
      net: slice.net,
      paidOrders: slice.paidOrders,
      refundsDue: {
        count: state.refundsDueCount,
        amount: formatRupees(state.refundsDuePaise)
      }
    });
  });

  rows.sort((a, b) => b.net - a.net || String(a.shopName).localeCompare(String(b.shopName)));

  return {
    period: periodKey,
    asOf: now.toISOString(),
    shops: rows
  };
}

module.exports = {
  TIMEZONE,
  PERIOD_KEYS,
  aggregateEarnings,
  shouldLoadRefunds,
  moneyReceivedPaise,
  moneyReceivedAtMs,
  cancelledAtMs,
  completedAtMs,
  hasMoneyReceived,
  formatRupees,
  periodMatchers,
  buildOrderEntriesFromSnapshot,
  loadShopOrderEntries,
  loadAllMarketplaceOrderEntries,
  computeShopEarnings,
  listAdminShopEarnings,
  presentAggregate,
  resolveShopApprovalStatus
};
