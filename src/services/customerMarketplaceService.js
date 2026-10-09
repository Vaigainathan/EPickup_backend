const { getFirestore } = require('./firebase');
const locationService = require('./locationService');
const shopCatalogueService = require('./shopCatalogueService');
const { MARKETPLACE_DEFAULTS } = require('../config/marketplaceDefaults');
const { policyGroupFor } = require('./marketplace/createCustomerOrder');
const {
  isShopOpenNow,
  shopOpenToggleIsOn,
  openingHoursFromShopProfile,
  nextOpensAt
} = require('../utils/shopOpeningHours');
const {
  ratingFromProfile,
  applyRankingMetrics,
  sortShops,
  parseSortParam
} = require('./marketplace/browseRanking');
const {
  MARKETPLACE_SHOP_TYPES,
  isMarketplaceShopType
} = require('../constants/marketplaceShopTypes');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SEARCH_CAP = 20;
const SHOP_ID_IN_LIMIT = 10;
const GET_ALL_LIMIT = 50;
const MIN_SEARCH_LENGTH = 2;
const MAX_SEARCH_LENGTH = 50;

const LEGACY_CARD_FIELDS = [
  'id',
  'shopName',
  'shopType',
  'address',
  'location',
  'distanceKm',
  'etaMinutes',
  'isOpen',
  'orderCount'
];

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function presentLocation(location) {
  if (!location) {
    return null;
  }
  const lat = location.latitude ?? location._latitude;
  const lng = location.longitude ?? location._longitude;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || typeof lng !== 'number' || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

function parseCoord(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw httpError(400, 'INVALID_LOCATION', `${name} is required`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw httpError(400, 'INVALID_LOCATION', `${name} must be a number`);
  }
  return n;
}

function parseOrigin(query) {
  const lat = parseCoord(query.lat, 'lat');
  const lng = parseCoord(query.lng, 'lng');
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw httpError(400, 'INVALID_LOCATION', 'Invalid coordinates');
  }
  return { lat, lng };
}

function parseLimit(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return DEFAULT_LIMIT;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw httpError(400, 'INVALID_LIMIT', `limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  return n;
}

function parseSort(value) {
  return parseSortParam(value);
}

function parseCategory(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const category = String(value).trim();
  if (!isMarketplaceShopType(category)) {
    throw httpError(400, 'INVALID_CATEGORY', 'category is not a marketplace shop type');
  }
  return category;
}

function parseSearchQuery(raw) {
  const q = typeof raw === 'string' ? raw.trim() : '';
  if (q.length < MIN_SEARCH_LENGTH || q.length > MAX_SEARCH_LENGTH) {
    throw httpError(
      400,
      'INVALID_QUERY',
      `q must be between ${MIN_SEARCH_LENGTH} and ${MAX_SEARCH_LENGTH} characters`
    );
  }
  return q.toLowerCase();
}

function parseMinRating(query) {
  const raw = query.minRating ?? query.ratingMin;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw httpError(400, 'INVALID_RATING_FILTER', 'minRating must be a number');
  }
  return n;
}

function nameMatches(name, q) {
  return String(name || '').toLowerCase().includes(q);
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function encodeCursor(payload) {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(value, sort) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('invalid');
    }
    if (parsed.sort !== sort) {
      return { sort, offset: 0, now: typeof parsed.now === 'string' ? parsed.now : new Date().toISOString() };
    }
    if (typeof parsed.offset !== 'number' || !Number.isInteger(parsed.offset) || parsed.offset < 0) {
      throw new Error('invalid');
    }
    if (typeof parsed.now !== 'string' || !parsed.now) {
      throw new Error('invalid');
    }
    return { sort, offset: parsed.offset, now: parsed.now };
  } catch {
    throw httpError(400, 'INVALID_CURSOR', 'Invalid cursor');
  }
}

function pageShops(shops, sort, limit, cursor, nowIso) {
  const offset = cursor ? cursor.offset : 0;
  const slice = shops.slice(offset, offset + limit);
  const nextOffset = offset + slice.length;
  const hasMore = nextOffset < shops.length;
  return {
    shops: slice,
    nextCursor: hasMore
      ? encodeCursor({ sort, offset: nextOffset, now: nowIso })
      : null
  };
}

function hasVerifiedUpiName(profile) {
  const bank = profile && profile.bank ? profile.bank : {};
  const verified = bank.upiNameVerification && typeof bank.upiNameVerification.verifiedName === 'string'
    ? bank.upiNameVerification.verifiedName.trim()
    : '';
  return verified.length > 0;
}

function toDate(value) {
  if (value == null) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date : null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

function readBrowseSettings(settingsData) {
  const source = settingsData && typeof settingsData === 'object' ? settingsData : {};
  function pick(key) {
    return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : MARKETPLACE_DEFAULTS[key];
  }
  const weights = pick('RANKING_WEIGHTS');
  return {
    weights: weights && typeof weights === 'object'
      ? weights
      : MARKETPLACE_DEFAULTS.RANKING_WEIGHTS,
    boostDays: Number(pick('NEW_SHOP_BOOST_DAYS')) || MARKETPLACE_DEFAULTS.NEW_SHOP_BOOST_DAYS,
    priorWeight: Number(pick('RATING_PRIOR_WEIGHT')) || MARKETPLACE_DEFAULTS.RATING_PRIOR_WEIGHT,
    policyGroupA: pick('POLICY_GROUP_A')
  };
}

function productCreatedMs(data) {
  const created = data.createdAt;
  if (created && typeof created.toDate === 'function') {
    return created.toDate().getTime();
  }
  if (created instanceof Date) {
    return created.getTime();
  }
  return 0;
}

function productHasPhoto(data) {
  const path = data.photoFilePath;
  const url = data.photoUrl;
  return (typeof path === 'string' && path.trim() !== '')
    || (typeof url === 'string' && url.trim() !== '');
}

function pickEarliestProductPhoto(docs) {
  let best = null;
  let bestMs = Infinity;
  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i];
    const data = doc.data || doc;
    if (data.isActive === false || !productHasPhoto(data)) {
      continue;
    }
    const ms = productCreatedMs(data);
    if (ms < bestMs) {
      bestMs = ms;
      best = data;
    }
  }
  if (!best) {
    return null;
  }
  return {
    photoFilePath: best.photoFilePath,
    photoUrl: best.photoUrl
  };
}

function buildCategoryTagline(names) {
  const sorted = [...names].sort((a, b) => String(a).localeCompare(String(b)));
  return sorted.slice(0, 3).join(', ');
}

function presentRatingDisplay(ratingCount, ratingAverage) {
  if (!ratingCount) {
    return { rating: null, isNew: true };
  }
  return {
    rating: { average: ratingAverage, count: ratingCount },
    isNew: false
  };
}

function stripInternalCardFields(card) {
  const out = { ...card };
  delete out.ratingSum;
  delete out.ratingCount;
  delete out.ratingAverage;
  delete out.fairRating;
  delete out.relevanceScore;
  delete out.approvedAt;
  delete out.openingHours;
  return out;
}

class CustomerMarketplaceService {
  getDb() {
    return getFirestore();
  }

  travel(origin, location) {
    const meters = locationService.calculateHaversineDistance(origin, location);
    const etaMinutes = Math.round(locationService.estimateDuration(meters) / 60);
    const distanceKm = Math.round((meters / 1000) * 10) / 10;
    return { distanceKm, etaMinutes };
  }

  async loadMarketplaceSettings() {
    const snap = await this.getDb().collection('appSettings').doc('marketplace').get();
    return readBrowseSettings(snap.exists ? snap.data() : null);
  }

  async loadFallbackMaps(shopIds) {
    const db = this.getDb();
    const productDocsByShop = new Map();
    const categoryNamesByShop = new Map();

    for (const ids of chunk(shopIds, SHOP_ID_IN_LIMIT)) {
      if (ids.length === 0) {
        continue;
      }
      const [productSnap, categorySnap] = await Promise.all([
        db.collection('products').where('shopId', 'in', ids).get(),
        db.collection('categories').where('shopId', 'in', ids).get()
      ]);
      productSnap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const shopId = data.shopId;
        if (!shopId) {
          return;
        }
        const list = productDocsByShop.get(shopId) || [];
        list.push({ id: doc.id, ...data });
        productDocsByShop.set(shopId, list);
      });
      categorySnap.docs.forEach((doc) => {
        const data = doc.data() || {};
        const shopId = data.shopId;
        if (!shopId || typeof data.name !== 'string') {
          return;
        }
        const list = categoryNamesByShop.get(shopId) || [];
        list.push(data.name);
        categoryNamesByShop.set(shopId, list);
      });
    }

    const productPhotoByShop = new Map();
    productDocsByShop.forEach((docs, shopId) => {
      const picked = pickEarliestProductPhoto(docs);
      if (picked) {
        productPhotoByShop.set(shopId, picked);
      }
    });

    const taglineByShop = new Map();
    categoryNamesByShop.forEach((names, shopId) => {
      const tagline = buildCategoryTagline(names);
      if (tagline) {
        taglineByShop.set(shopId, tagline);
      }
    });

    return { productPhotoByShop, taglineByShop };
  }

  async presentShopCard(row, { productPhotoByShop, taglineByShop, policyGroupA, now }) {
    const toggleOpen = row.isOpen;
    const openingHours = row.openingHours;
    const isOpenNow = isShopOpenNow({ isOpen: toggleOpen, openingHours, now });
    const opensAt = isOpenNow
      ? null
      : nextOpensAt({ openingHours, now });

    const storefront = row.storefront || {};
    let photoUrl = null;
    if (typeof storefront.photoPath === 'string' && storefront.photoPath.trim() !== '') {
      photoUrl = await shopCatalogueService.resolvePhotoUrl(storefront.photoPath, null);
    }
    if (!photoUrl) {
      const fallback = productPhotoByShop.get(row.id);
      if (fallback) {
        photoUrl = await shopCatalogueService.resolvePhotoUrl(fallback.photoFilePath, fallback.photoUrl);
      }
    }

    let tagline = typeof storefront.tagline === 'string' ? storefront.tagline.trim() : '';
    if (!tagline) {
      tagline = taglineByShop.get(row.id) || '';
    }

    const { rating, isNew } = presentRatingDisplay(row.ratingCount, row.ratingAverage);

    return {
      id: row.id,
      shopName: row.shopName,
      shopType: row.shopType,
      address: row.address,
      location: row.location,
      distanceKm: row.distanceKm,
      etaMinutes: row.etaMinutes,
      isOpen: toggleOpen,
      orderCount: row.orderCount,
      photoUrl,
      tagline,
      isOpenNow,
      opensAt,
      rating,
      isNew,
      policyGroup: policyGroupFor(row.shopType, policyGroupA),
      fairRating: row.fairRating,
      relevanceScore: row.relevanceScore
    };
  }

  async buildEligibleShopRows(origin, now) {
    const db = this.getDb();
    const settings = await this.loadMarketplaceSettings();
    const usersSnap = await db.collection('users').where('userType', '==', 'shop').get();
    const users = usersSnap.docs.filter((doc) => {
      const data = doc.data() || {};
      const shop = data.shop || {};
      return data.isActive !== false && shop.approvalStatus === 'approved';
    });

    const shopSnaps = [];
    for (const group of chunk(users, GET_ALL_LIMIT)) {
      const refs = group.map((doc) => db.collection('shops').doc(doc.id));
      const snaps = await db.getAll(...refs);
      shopSnaps.push(...snaps);
    }
    const shopById = new Map(shopSnaps.map((snap) => [snap.id, snap]));

    const rows = [];
    for (const userDoc of users) {
      const userData = userDoc.data() || {};
      const identity = userData.shop || {};
      const shopSnap = shopById.get(userDoc.id);
      if (!shopSnap || !shopSnap.exists) {
        continue;
      }
      const profile = shopSnap.data() || {};
      if (!hasVerifiedUpiName(profile)) {
        continue;
      }
      const location = presentLocation(profile.location);
      if (!location) {
        continue;
      }
      const travel = this.travel(origin, location);
      const orderCount = Number.isFinite(Number(profile.orderCount))
        ? Math.max(0, Math.floor(Number(profile.orderCount)))
        : 0;
      const ratingParts = ratingFromProfile(profile);
      const storefront = profile.storefront && typeof profile.storefront === 'object'
        ? profile.storefront
        : {};
      rows.push({
        id: userDoc.id,
        shopName: typeof identity.shopName === 'string' ? identity.shopName : '',
        shopType: typeof identity.shopType === 'string' ? identity.shopType : '',
        address: typeof profile.address === 'string' ? profile.address : '',
        location,
        distanceKm: travel.distanceKm,
        etaMinutes: travel.etaMinutes,
        isOpen: shopOpenToggleIsOn(identity),
        orderCount,
        ratingSum: ratingParts.sum,
        ratingCount: ratingParts.count,
        ratingAverage: ratingParts.count > 0 ? ratingParts.average : 0,
        approvedAt: toDate(profile.approvedAt),
        openingHours: openingHoursFromShopProfile(profile),
        storefront
      });
    }

    const shopIds = rows.map((row) => row.id);
    const { productPhotoByShop, taglineByShop } = await this.loadFallbackMaps(shopIds);

    const ranked = applyRankingMetrics(rows, settings, now, { globalShops: rows });
    const cards = await Promise.all(
      ranked.map((row) => this.presentShopCard(row, {
        productPhotoByShop,
        taglineByShop,
        policyGroupA: settings.policyGroupA,
        now
      }))
    );

    return { shops: cards, settings };
  }

  async loadEligibleShops(origin, now = new Date()) {
    const { shops } = await this.buildEligibleShopRows(origin, now);
    return shops.map((shop) => stripInternalCardFields(shop));
  }

  async loadShopRecord(shopId) {
    const db = this.getDb();
    const [userSnap, shopSnap] = await Promise.all([
      db.collection('users').doc(shopId).get(),
      db.collection('shops').doc(shopId).get()
    ]);
    if (!userSnap.exists || !shopSnap.exists) {
      return null;
    }
    const userData = userSnap.data() || {};
    const identity = userData.shop || {};
    if (userData.userType !== 'shop' || userData.isActive === false || identity.approvalStatus !== 'approved') {
      return null;
    }
    const profile = shopSnap.data() || {};
    if (!presentLocation(profile.location) || !hasVerifiedUpiName(profile)) {
      return null;
    }
    return { identity, profile };
  }

  async assertEligibleShop(shopId) {
    const record = await this.loadShopRecord(shopId);
    if (!record) {
      throw httpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
    }
    return record;
  }

  async getShopOrThrow(shopId, origin, now = new Date()) {
    const shops = await this.loadEligibleShops(origin, now);
    const shop = shops.find((row) => row.id === shopId);
    if (!shop) {
      throw httpError(404, 'SHOP_NOT_FOUND', 'Shop not found');
    }
    return shop;
  }

  async listCategories(query) {
    const origin = parseOrigin(query);
    const shops = await this.loadEligibleShops(origin);
    return {
      categories: MARKETPLACE_SHOP_TYPES.map((category) => {
        const matches = shops.filter((shop) => shop.shopType === category);
        if (matches.length === 0) {
          return {
            category,
            shopCount: 0,
            etaMinMinutes: null,
            etaMaxMinutes: null,
            comingSoon: true
          };
        }
        const etas = matches.map((shop) => shop.etaMinutes);
        return {
          category,
          shopCount: matches.length,
          etaMinMinutes: Math.min(...etas),
          etaMaxMinutes: Math.max(...etas),
          comingSoon: false
        };
      })
    };
  }

  async listShops(query) {
    const origin = parseOrigin(query);
    const category = parseCategory(query.category);
    const sort = parseSort(query.sort);
    const limit = parseLimit(query.limit);
    const cursor = decodeCursor(query.cursor, sort);
    const openNow = String(query.openNow || '').toLowerCase() === 'true';
    const minRating = parseMinRating(query);

    const nowIso = cursor ? cursor.now : new Date().toISOString();
    const now = new Date(nowIso);

    const { shops: eligible } = await this.buildEligibleShopRows(origin, now);

    let shops = eligible;
    if (category) {
      shops = shops.filter((shop) => shop.shopType === category);
    }
    if (openNow) {
      shops = shops.filter((shop) => shop.isOpenNow === true);
    }
    if (minRating != null) {
      shops = shops.filter((shop) => shop.rating && shop.rating.average >= minRating);
    }

    shops = sortShops(shops, sort);
    const paged = pageShops(shops, sort, limit, cursor, nowIso);
    return {
      shops: paged.shops.map((shop) => stripInternalCardFields(shop)),
      nextCursor: paged.nextCursor
    };
  }

  async getShop(shopId, query) {
    const origin = parseOrigin(query);
    const shop = await this.getShopOrThrow(shopId, origin);
    const categories = await shopCatalogueService.listCategories(shopId);
    return {
      shop,
      categories: categories.map((row) => ({ id: row.id, name: row.name }))
    };
  }

  async listProducts(shopId, query) {
    await this.assertEligibleShop(shopId);
    const categoryId = typeof query.category === 'string' ? query.category.trim() : '';
    const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';

    const snapshot = await this.getDb().collection('products').where('shopId', '==', shopId).get();
    const rows = snapshot.docs.filter((doc) => {
      const data = doc.data() || {};
      if (data.isActive === false) {
        return false;
      }
      if (categoryId && data.categoryId !== categoryId) {
        return false;
      }
      if (search && !nameMatches(data.name, search)) {
        return false;
      }
      return true;
    });
    const products = await Promise.all(
      rows.map((doc) => this.presentCustomerProduct(doc.data(), doc.id))
    );
    products.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    return { products };
  }

  async getProduct(productId) {
    const snap = await this.getDb().collection('products').doc(productId).get();
    if (!snap.exists) {
      throw httpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }
    const data = snap.data() || {};
    if (data.isActive === false) {
      throw httpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }
    await this.assertEligibleShop(data.shopId);
    return { product: await this.presentCustomerProduct(data, snap.id) };
  }

  async presentCustomerProduct(data, id) {
    const full = await shopCatalogueService.presentProduct(data, id);
    const variants = Array.isArray(full.variants) ? full.variants : [];
    return {
      id: full.id,
      shopId: full.shopId,
      categoryId: full.categoryId,
      name: full.name,
      description: full.description ?? null,
      price: full.price,
      unitType: full.unitType,
      weight: full.weight ?? null,
      photoUrl: full.photoUrl,
      stock: full.stock ?? 0,
      hasVariants: full.hasVariants === true,
      variants: variants.map((row) => ({
        id: row.id,
        attributeLabel: row.attributeLabel,
        value: row.value,
        stock: row.stock ?? 0,
        priceOverride: row.priceOverride ?? null,
        unitType: row.unitType
      }))
    };
  }

  async search(query) {
    const origin = parseOrigin(query);
    const q = parseSearchQuery(query.q);
    const now = new Date();

    const { shops: eligible } = await this.buildEligibleShopRows(origin, now);
    const eligibleIds = new Set(eligible.map((shop) => shop.id));

    const shopHits = sortShops(
      eligible.filter((shop) => nameMatches(shop.shopName, q)),
      'relevance'
    )
      .slice(0, SEARCH_CAP)
      .map((shop) => stripInternalCardFields(shop));

    const products = [];
    const shopNameById = new Map(eligible.map((shop) => [shop.id, shop.shopName]));
    for (const ids of chunk([...eligibleIds], SHOP_ID_IN_LIMIT)) {
      if (ids.length === 0) {
        continue;
      }
      const snapshot = await this.getDb().collection('products').where('shopId', 'in', ids).get();
      for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        if (!eligibleIds.has(data.shopId) || data.isActive === false || !nameMatches(data.name, q)) {
          continue;
        }
        const product = await this.presentCustomerProduct(data, doc.id);
        products.push({
          ...product,
          shopName: shopNameById.get(product.shopId) || ''
        });
      }
    }
    products.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')) || (a.id < b.id ? -1 : 1));

    return {
      shops: shopHits,
      products: products.slice(0, SEARCH_CAP)
    };
  }
}

const service = new CustomerMarketplaceService();

module.exports = service;
module.exports.CustomerMarketplaceService = CustomerMarketplaceService;
module.exports.LEGACY_CARD_FIELDS = LEGACY_CARD_FIELDS;
module.exports.parseSort = parseSort;
module.exports.decodeCursor = decodeCursor;
module.exports.encodeCursor = encodeCursor;
module.exports.pageShops = pageShops;
module.exports.hasVerifiedUpiName = hasVerifiedUpiName;
module.exports.stripInternalCardFields = stripInternalCardFields;
