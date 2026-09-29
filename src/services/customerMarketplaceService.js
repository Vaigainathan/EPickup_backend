const { getFirestore } = require('./firebase');
const locationService = require('./locationService');
const shopCatalogueService = require('./shopCatalogueService');
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
  if (value === undefined || value === null || String(value).trim() === '') {
    return 'distance';
  }
  const sort = String(value).trim();
  if (sort !== 'distance' && sort !== 'orders') {
    throw httpError(400, 'INVALID_SORT', 'sort must be distance or orders');
  }
  return sort;
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
    if (!parsed || parsed.sort !== sort || typeof parsed.id !== 'string') {
      throw new Error('mismatch');
    }
    if (typeof parsed.distanceKm !== 'number' || typeof parsed.orderCount !== 'number') {
      throw new Error('mismatch');
    }
    return parsed;
  } catch {
    throw httpError(400, 'INVALID_CURSOR', 'Invalid cursor');
  }
}

function compareDistance(a, b) {
  if (a.distanceKm !== b.distanceKm) {
    return a.distanceKm - b.distanceKm;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function compareOrders(a, b) {
  if (a.orderCount !== b.orderCount) {
    return b.orderCount - a.orderCount;
  }
  return compareDistance(a, b);
}

function pageShops(shops, sort, limit, cursor) {
  let start = 0;
  if (cursor) {
    const idx = shops.findIndex((shop) => (
      shop.id === cursor.id
      && shop.distanceKm === cursor.distanceKm
      && shop.orderCount === cursor.orderCount
    ));
    if (idx < 0) {
      throw httpError(400, 'INVALID_CURSOR', 'Cursor does not match the current result set');
    }
    start = idx + 1;
  }
  const slice = shops.slice(start, start + limit);
  const last = slice[slice.length - 1];
  const hasMore = start + slice.length < shops.length;
  return {
    shops: slice,
    nextCursor: hasMore && last
      ? encodeCursor({
        sort,
        id: last.id,
        distanceKm: last.distanceKm,
        orderCount: last.orderCount
      })
      : null
  };
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

  async loadEligibleShops(origin) {
    const db = this.getDb();
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

    const cards = [];
    for (const userDoc of users) {
      const userData = userDoc.data() || {};
      const identity = userData.shop || {};
      const shopSnap = shopById.get(userDoc.id);
      if (!shopSnap || !shopSnap.exists) {
        continue;
      }
      const profile = shopSnap.data() || {};
      const location = presentLocation(profile.location);
      if (!location) {
        continue;
      }
      const travel = this.travel(origin, location);
      const orderCount = Number.isFinite(Number(profile.orderCount))
        ? Math.max(0, Math.floor(Number(profile.orderCount)))
        : 0;
      cards.push({
        id: userDoc.id,
        shopName: typeof identity.shopName === 'string' ? identity.shopName : '',
        shopType: typeof identity.shopType === 'string' ? identity.shopType : '',
        address: typeof profile.address === 'string' ? profile.address : '',
        location,
        distanceKm: travel.distanceKm,
        etaMinutes: travel.etaMinutes,
        isOpen: identity.isOpen === true,
        orderCount
      });
    }
    return cards;
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
    if (!presentLocation(profile.location)) {
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

  async getShopOrThrow(shopId, origin) {
    const shops = await this.loadEligibleShops(origin);
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

    let shops = await this.loadEligibleShops(origin);
    if (category) {
      shops = shops.filter((shop) => shop.shopType === category);
    }
    if (openNow) {
      shops = shops.filter((shop) => shop.isOpen === true);
    }
    shops.sort(sort === 'orders' ? compareOrders : compareDistance);
    return pageShops(shops, sort, limit, cursor);
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

  async search(query) {
    const origin = parseOrigin(query);
    const q = typeof query.q === 'string' ? query.q.trim().toLowerCase() : '';
    if (q.length < MIN_SEARCH_LENGTH) {
      throw httpError(400, 'INVALID_QUERY', `q must be at least ${MIN_SEARCH_LENGTH} characters`);
    }

    const shops = await this.loadEligibleShops(origin);
    const shopHits = shops
      .filter((shop) => nameMatches(shop.shopName, q))
      .sort(compareDistance)
      .slice(0, SEARCH_CAP);

    const products = [];
    const shopNameById = new Map(shops.map((shop) => [shop.id, shop.shopName]));
    for (const ids of chunk(shops.map((shop) => shop.id), SHOP_ID_IN_LIMIT)) {
      if (ids.length === 0) {
        continue;
      }
      const snapshot = await this.getDb().collection('products').where('shopId', 'in', ids).get();
      for (const doc of snapshot.docs) {
        const data = doc.data() || {};
        if (data.isActive === false || !nameMatches(data.name, q)) {
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

module.exports = new CustomerMarketplaceService();
