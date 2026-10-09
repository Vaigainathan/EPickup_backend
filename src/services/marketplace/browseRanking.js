/**
 * Marketplace browse relevance (MP-14).
 *
 * platformAverage = Σ rating.sum ÷ Σ rating.count over eligible shops (0 if no ratings).
 * fair = (priorWeight × platformAverage + ratingSum) ÷ (priorWeight + ratingCount)
 * ratingNorm = fair / 5
 * nearNorm = 1 / (1 + distanceKm / 5)
 * popNorm = log1p(orderCount) / log1p(maxOrderCount)  (max over all eligible; 0 if max is 0)
 * base = w.rating×ratingNorm + w.popularity×popNorm + w.nearness×nearNorm
 * boost = BOOST_MAX × (1 − ageDays/NEW_SHOP_BOOST_DAYS) when approvedAt within window (else 0)
 * relevanceScore = base + boost
 */

const BOOST_MAX = 0.1;
const NEARNESS_KM_SCALE = 5;

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function ratingFromProfile(profile) {
  const rating = profile && profile.rating && typeof profile.rating === 'object' ? profile.rating : {};
  const sum = Number(rating.sum);
  const count = Number(rating.count);
  const average = Number(rating.average);
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const safeSum = Number.isFinite(sum) ? sum : 0;
  let safeAverage = 0;
  if (safeCount > 0) {
    safeAverage = Number.isFinite(average) ? average : safeSum / safeCount;
  }
  return {
    sum: safeSum,
    count: safeCount,
    average: safeAverage
  };
}

function computePlatformAverage(shops) {
  let totalSum = 0;
  let totalCount = 0;
  for (let i = 0; i < shops.length; i += 1) {
    const row = shops[i];
    totalSum += row.ratingSum || 0;
    totalCount += row.ratingCount || 0;
  }
  if (totalCount <= 0) {
    return 0;
  }
  return totalSum / totalCount;
}

function maxOrderCount(shops) {
  let max = 0;
  for (let i = 0; i < shops.length; i += 1) {
    const n = shops[i].orderCount || 0;
    if (n > max) {
      max = n;
    }
  }
  return max;
}

function fairRating({ ratingSum, ratingCount }, platformAverage, priorWeight) {
  const prior = Number.isFinite(priorWeight) && priorWeight > 0 ? priorWeight : 5;
  const count = ratingCount || 0;
  const sum = ratingSum || 0;
  const platform = Number.isFinite(platformAverage) ? platformAverage : 0;
  if (count <= 0 && platform <= 0) {
    return 0;
  }
  return (prior * platform + sum) / (prior + count);
}

function nearNorm(distanceKm) {
  const d = Number.isFinite(distanceKm) ? Math.max(0, distanceKm) : 0;
  return 1 / (1 + d / NEARNESS_KM_SCALE);
}

function popNorm(orderCount, maxOrders) {
  const max = Number.isFinite(maxOrders) ? Math.max(0, maxOrders) : 0;
  if (max <= 0) {
    return 0;
  }
  const n = Number.isFinite(orderCount) ? Math.max(0, orderCount) : 0;
  return Math.log1p(n) / Math.log1p(max);
}

function newShopBoost(approvedAt, now, boostDays) {
  if (!approvedAt || !boostDays || boostDays <= 0) {
    return 0;
  }
  const approvedMs = approvedAt instanceof Date ? approvedAt.getTime() : Date.parse(approvedAt);
  if (!Number.isFinite(approvedMs)) {
    return 0;
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const ageMs = nowMs - approvedMs;
  if (ageMs < 0) {
    return BOOST_MAX;
  }
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays >= boostDays) {
    return 0;
  }
  return BOOST_MAX * (1 - ageDays / boostDays);
}

function relevanceScoreForShop(shop, {
  platformAverage,
  priorWeight,
  weights,
  maxOrders,
  boostDays,
  now
}) {
  const fair = fairRating(shop, platformAverage, priorWeight);
  const ratingNorm = clamp01(fair / 5);
  const w = weights || { rating: 0.4, popularity: 0.3, nearness: 0.3 };
  const base = (w.rating * ratingNorm)
    + (w.popularity * popNorm(shop.orderCount, maxOrders))
    + (w.nearness * nearNorm(shop.distanceKm));
  const boost = newShopBoost(shop.approvedAt, now, boostDays);
  return {
    fairRating: fair,
    relevanceScore: base + boost
  };
}

function compareId(a, b) {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareDistanceSort(a, b) {
  if (a.distanceKm !== b.distanceKm) {
    return a.distanceKm - b.distanceKm;
  }
  return compareId(a, b);
}

function compareRatingSort(a, b) {
  if (a.fairRating !== b.fairRating) {
    return b.fairRating - a.fairRating;
  }
  return compareDistanceSort(a, b);
}

function compareRelevanceSort(a, b) {
  if (a.relevanceScore !== b.relevanceScore) {
    return b.relevanceScore - a.relevanceScore;
  }
  return compareDistanceSort(a, b);
}

function compareOpenPartition(a, b) {
  if (a.isOpenNow === b.isOpenNow) {
    return 0;
  }
  return a.isOpenNow ? -1 : 1;
}

function sortShops(shops, sort) {
  const mode = sort === 'distance' || sort === 'rating' ? sort : 'relevance';
  const list = [...shops];
  list.sort((a, b) => {
    const openOrder = compareOpenPartition(a, b);
    if (openOrder !== 0) {
      return openOrder;
    }
    if (mode === 'distance') {
      return compareDistanceSort(a, b);
    }
    if (mode === 'rating') {
      return compareRatingSort(a, b);
    }
    return compareRelevanceSort(a, b);
  });
  return list;
}

function applyRankingMetrics(shops, settings, now, options = {}) {
  const basis = options.globalShops || shops;
  const platformAverage = computePlatformAverage(basis);
  const maxOrders = maxOrderCount(basis);
  const priorWeight = settings.priorWeight;
  const weights = settings.weights;
  const boostDays = settings.boostDays;
  return shops.map((shop) => {
    const scores = relevanceScoreForShop(shop, {
      platformAverage,
      priorWeight,
      weights,
      maxOrders,
      boostDays,
      now
    });
    return {
      ...shop,
      fairRating: scores.fairRating,
      relevanceScore: scores.relevanceScore
    };
  });
}

function parseSortParam(value) {
  const sort = value === undefined || value === null ? '' : String(value).trim();
  if (sort === 'distance' || sort === 'rating') {
    return sort;
  }
  return 'relevance';
}

module.exports = {
  BOOST_MAX,
  NEARNESS_KM_SCALE,
  ratingFromProfile,
  computePlatformAverage,
  maxOrderCount,
  fairRating,
  nearNorm,
  popNorm,
  newShopBoost,
  relevanceScoreForShop,
  applyRankingMetrics,
  sortShops,
  parseSortParam,
  compareRelevanceSort,
  compareDistanceSort,
  compareRatingSort
};
