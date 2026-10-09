const {
  fairRating,
  nearNorm,
  popNorm,
  newShopBoost,
  computePlatformAverage,
  applyRankingMetrics,
  sortShops,
  parseSortParam,
  BOOST_MAX
} = require('../src/services/marketplace/browseRanking');

describe('browseRanking', () => {
  const settings = {
    weights: { rating: 0.4, popularity: 0.3, nearness: 0.3 },
    priorWeight: 5,
    boostDays: 30
  };

  test('fairRating uses platform average and prior', () => {
    const fair = fairRating({ ratingSum: 10, ratingCount: 2 }, 4, 5);
    expect(fair).toBeCloseTo((5 * 4 + 10) / 7, 5);
  });

  test('fairRating is zero when no ratings and platform average is zero', () => {
    expect(fairRating({ ratingSum: 0, ratingCount: 0 }, 0, 5)).toBe(0);
  });

  test('nearNorm uses fixed distance scale', () => {
    expect(nearNorm(0)).toBe(1);
    expect(nearNorm(5)).toBeCloseTo(0.5, 5);
  });

  test('popNorm is zero when max order count is zero', () => {
    expect(popNorm(10, 0)).toBe(0);
  });

  test('popNorm reaches one at max orders', () => {
    expect(popNorm(100, 100)).toBeCloseTo(1, 5);
  });

  test('newShopBoost linear decay within window', () => {
    const approvedAt = new Date('2026-01-01T00:00:00+05:30');
    const now = new Date('2026-01-16T00:00:00+05:30');
    expect(newShopBoost(approvedAt, now, 30)).toBeCloseTo(BOOST_MAX / 2, 5);
  });

  test('computePlatformAverage sums across shops', () => {
    const avg = computePlatformAverage([
      { ratingSum: 8, ratingCount: 2 },
      { ratingSum: 5, ratingCount: 1 }
    ]);
    expect(avg).toBeCloseTo(13 / 3, 5);
  });

  test('open shops sort before closed for relevance', () => {
    const now = new Date('2026-06-01T12:00:00+05:30');
    const shops = applyRankingMetrics([
      {
        id: 'a',
        distanceKm: 1,
        orderCount: 0,
        ratingSum: 0,
        ratingCount: 0,
        isOpenNow: false,
        approvedAt: null
      },
      {
        id: 'b',
        distanceKm: 2,
        orderCount: 0,
        ratingSum: 0,
        ratingCount: 0,
        isOpenNow: true,
        approvedAt: null
      }
    ], settings, now);
    const sorted = sortShops(shops, 'relevance');
    expect(sorted[0].id).toBe('b');
    expect(sorted[1].id).toBe('a');
  });

  test('boost lifts newer approved shop in relevance sort', () => {
    const now = new Date('2026-06-15T12:00:00+05:30');
    const shops = applyRankingMetrics([
      {
        id: 'old',
        distanceKm: 1,
        orderCount: 0,
        ratingSum: 0,
        ratingCount: 0,
        isOpenNow: true,
        approvedAt: new Date('2025-01-01T00:00:00+05:30')
      },
      {
        id: 'new',
        distanceKm: 1,
        orderCount: 0,
        ratingSum: 0,
        ratingCount: 0,
        isOpenNow: true,
        approvedAt: new Date('2026-06-01T00:00:00+05:30')
      }
    ], settings, now);
    const sorted = sortShops(shops, 'relevance');
    expect(sorted[0].id).toBe('new');
  });

  test('rating sort uses fair rating not raw average', () => {
    const now = new Date('2026-06-01T12:00:00+05:30');
    const shops = applyRankingMetrics([
      {
        id: 'few',
        distanceKm: 1,
        orderCount: 0,
        ratingSum: 10,
        ratingCount: 2,
        isOpenNow: true,
        approvedAt: null
      },
      {
        id: 'many',
        distanceKm: 1,
        orderCount: 0,
        ratingSum: 45,
        ratingCount: 10,
        isOpenNow: true,
        approvedAt: null
      }
    ], settings, now, {
      globalShops: [
        { ratingSum: 55, ratingCount: 12 }
      ]
    });
    const sorted = sortShops(shops, 'rating');
    expect(sorted[0].fairRating).toBeGreaterThanOrEqual(sorted[1].fairRating);
  });

  test('parseSortParam maps orders and unknown to relevance', () => {
    expect(parseSortParam('orders')).toBe('relevance');
    expect(parseSortParam('bogus')).toBe('relevance');
    expect(parseSortParam('distance')).toBe('distance');
    expect(parseSortParam(undefined)).toBe('relevance');
  });
});
