const crypto = require('crypto');
const admin = require('firebase-admin');
const { getFirestore, getStorage } = require('./firebase');

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const SIGNED_URL_MS = 6 * 24 * 60 * 60 * 1000;
const PRODUCT_UNIT_TYPES = ['Piece', 'Kg', 'Gram', 'Litre', 'ml', 'Pack', 'Plate'];
const PRODUCT_UNIT_TYPE_BY_KEY = new Map(
  PRODUCT_UNIT_TYPES.map((unit) => [unit.toLowerCase(), unit])
);
const DEFAULT_UNIT_TYPE = 'Piece';

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function isFilled(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAllowedPhotoType(contentType, originalName = '') {
  const mime = (contentType || '').toLowerCase();
  const name = (originalName || '').toLowerCase();
  if (mime.startsWith('image/')) {
    return true;
  }
  return /\.(jpe?g|png|webp|gif|heic|heif)$/.test(name);
}

function photoExtension(contentType, originalName = '') {
  const mime = (contentType || '').toLowerCase();
  const name = (originalName || '').toLowerCase();
  if (mime.includes('png') || name.endsWith('.png')) {
    return 'png';
  }
  if (mime.includes('webp') || name.endsWith('.webp')) {
    return 'webp';
  }
  return 'jpg';
}

function toNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = 0) {
  const n = toNumber(value, fallback);
  if (n === null) {
    return fallback;
  }
  return Math.max(0, Math.floor(n));
}

function toBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return Boolean(value);
}

function parseUnitType(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const key = String(value).trim().toLowerCase();
  if (!key) {
    if (fallback !== null) {
      return fallback;
    }
    throw httpError(
      400,
      'INVALID_UNIT_TYPE',
      `unitType must be one of: ${PRODUCT_UNIT_TYPES.join(', ')}`
    );
  }
  const canonical = PRODUCT_UNIT_TYPE_BY_KEY.get(key);
  if (!canonical) {
    throw httpError(
      400,
      'INVALID_UNIT_TYPE',
      `unitType must be one of: ${PRODUCT_UNIT_TYPES.join(', ')}`
    );
  }
  return canonical;
}

function presentUnitType(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_UNIT_TYPE;
  }
  return PRODUCT_UNIT_TYPE_BY_KEY.get(String(value).trim().toLowerCase()) || DEFAULT_UNIT_TYPE;
}

function normalizeVariants(raw, hasVariants, productUnitType) {
  if (!hasVariants) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  const fallbackUnitType = parseUnitType(productUnitType, DEFAULT_UNIT_TYPE);
  return raw.map((item) => {
    const row = item && typeof item === 'object' ? item : {};
    return {
      id: isFilled(row.id) ? String(row.id).trim() : crypto.randomUUID(),
      attributeLabel: isFilled(row.attributeLabel) ? String(row.attributeLabel).trim() : '',
      value: isFilled(row.value) ? String(row.value).trim() : '',
      stock: toInt(row.stock, 0),
      priceOverride: row.priceOverride === null || row.priceOverride === undefined || row.priceOverride === ''
        ? null
        : toNumber(row.priceOverride, null),
      unitType: parseUnitType(row.unitType, fallbackUnitType)
    };
  }).filter((row) => row.attributeLabel && row.value);
}

class ShopCatalogueService {
  getDb() {
    return getFirestore();
  }

  now() {
    return admin.firestore.FieldValue.serverTimestamp();
  }

  /**
   * shopId is always the authenticated shop uid — never taken from the client body.
   */
  async requireShopId(userId) {
    if (!userId) {
      throw httpError(401, 'UNAUTHORIZED', 'Access token required');
    }

    const userDoc = await this.getDb().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      throw httpError(404, 'USER_NOT_FOUND', 'User not found');
    }
    if (userDoc.data().userType !== 'shop') {
      throw httpError(403, 'FORBIDDEN', 'This resource requires shop role');
    }
    return userId;
  }

  async signReadUrl(filePath) {
    const [url] = await getStorage().bucket().file(filePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + SIGNED_URL_MS,
      version: 'v4'
    });
    return url;
  }

  async resolvePhotoUrl(filePath, fallbackUrl) {
    if (isFilled(filePath)) {
      try {
        return await this.signReadUrl(filePath);
      } catch (error) {
        console.error('❌ [SHOP_CATALOGUE] Failed to sign product photo URL:', error.message);
      }
    }
    if (isFilled(fallbackUrl) && /^https?:\/\//i.test(fallbackUrl)) {
      return fallbackUrl;
    }
    return null;
  }

  async presentProduct(data, id) {
    const photoUrl = await this.resolvePhotoUrl(data.photoFilePath, data.photoUrl);
    return {
      id,
      shopId: data.shopId,
      categoryId: data.categoryId,
      name: data.name,
      description: data.description ?? null,
      price: data.price,
      unitType: presentUnitType(data.unitType),
      taxClass: data.taxClass ?? null,
      weight: data.weight ?? null,
      barcode: data.barcode ?? null,
      photoUrl,
      isActive: data.isActive !== false,
      stock: data.stock ?? 0,
      lowStockThreshold: data.lowStockThreshold ?? 0,
      hasVariants: data.hasVariants === true,
      variants: Array.isArray(data.variants) ? data.variants : [],
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null
    };
  }

  async getOwnedCategory(shopId, categoryId) {
    const snap = await this.getDb().collection('categories').doc(categoryId).get();
    if (!snap.exists || snap.data().shopId !== shopId) {
      throw httpError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
    }
    return { id: snap.id, ...snap.data() };
  }

  async getOwnedProduct(shopId, productId) {
    const snap = await this.getDb().collection('products').doc(productId).get();
    if (!snap.exists || snap.data().shopId !== shopId) {
      throw httpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }
    return { ref: snap.ref, id: snap.id, data: snap.data() };
  }

  async listCategories(shopId) {
    const snapshot = await this.getDb()
      .collection('categories')
      .where('shopId', '==', shopId)
      .get();

    return snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          shopId: data.shopId,
          name: data.name,
          createdAt: data.createdAt || null
        };
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  async createCategory(shopId, payload) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) {
      throw httpError(400, 'INVALID_CATEGORY', 'Category name is required');
    }

    const ref = this.getDb().collection('categories').doc();
    const createdAt = this.now();
    await ref.set({
      shopId,
      name,
      createdAt
    });

    return {
      id: ref.id,
      shopId,
      name,
      createdAt
    };
  }

  async updateCategory(shopId, categoryId, payload) {
    const owned = await this.getOwnedCategory(shopId, categoryId);
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!name) {
      throw httpError(400, 'INVALID_CATEGORY', 'Category name is required');
    }

    await this.getDb().collection('categories').doc(categoryId).update({ name });

    return {
      id: categoryId,
      shopId,
      name,
      createdAt: owned.createdAt || null
    };
  }

  async deleteCategory(shopId, categoryId) {
    await this.getOwnedCategory(shopId, categoryId);

    const assigned = await this.getDb()
      .collection('products')
      .where('categoryId', '==', categoryId)
      .limit(25)
      .get();

    const ownedAssigned = assigned.docs.filter((doc) => doc.data().shopId === shopId);
    if (ownedAssigned.length > 0) {
      throw httpError(
        409,
        'CATEGORY_IN_USE',
        'Cannot delete this category while products are still assigned to it. Move or delete those products first.'
      );
    }

    await this.getDb().collection('categories').doc(categoryId).delete();
    return { id: categoryId, deleted: true };
  }

  async listProducts(shopId, categoryId) {
    let query = this.getDb().collection('products').where('shopId', '==', shopId);
    if (isFilled(categoryId)) {
      query = query.where('categoryId', '==', categoryId);
    }
    const snapshot = await query.get();
    const products = await Promise.all(
      snapshot.docs.map((doc) => this.presentProduct(doc.data(), doc.id))
    );
    return products.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  async getProduct(shopId, productId) {
    const owned = await this.getOwnedProduct(shopId, productId);
    return this.presentProduct(owned.data, owned.id);
  }

  async uploadProductPhoto(shopId, productId, file) {
    if (!file || !file.buffer) {
      throw httpError(400, 'MISSING_FILE', 'No photo file provided');
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw httpError(400, 'FILE_TOO_LARGE', 'Photo must be 5MB or smaller');
    }
    if (!isAllowedPhotoType(file.mimetype, file.originalname)) {
      throw httpError(400, 'INVALID_FILE_TYPE', 'Photo must be an image');
    }

    const ext = photoExtension(file.mimetype, file.originalname);
    const filePath = `shops/${shopId}/products/${productId}/${Date.now()}_photo.${ext}`;
    const contentType = (file.mimetype || '').startsWith('image/')
      ? file.mimetype
      : 'image/jpeg';
    const fileRef = getStorage().bucket().file(filePath);

    await fileRef.save(file.buffer, {
      metadata: {
        contentType,
        customMetadata: {
          shopId,
          productId,
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'backend_proxy',
          originalFileName: file.originalname || `photo.${ext}`
        }
      }
    });

    return filePath;
  }

  buildProductFields(shopId, payload, existing = {}) {
    const name = typeof payload.name === 'string' ? payload.name.trim() : (existing.name || '');
    const categoryId = typeof payload.categoryId === 'string'
      ? payload.categoryId.trim()
      : (existing.categoryId || '');

    if (!name) {
      throw httpError(400, 'INVALID_PRODUCT', 'Product name is required');
    }
    if (!categoryId) {
      throw httpError(400, 'INVALID_PRODUCT', 'categoryId is required');
    }

    const price = toNumber(payload.price, existing.price);
    if (price === null || price < 0) {
      throw httpError(400, 'INVALID_PRODUCT', 'A valid price is required');
    }

    const hasVariants = toBool(payload.hasVariants, existing.hasVariants === true);
    const unitType = payload.unitType !== undefined
      ? parseUnitType(payload.unitType, null)
      : parseUnitType(existing.unitType, DEFAULT_UNIT_TYPE);
    const variants = payload.variants !== undefined
      ? normalizeVariants(payload.variants, hasVariants, unitType)
      : normalizeVariants(existing.variants, hasVariants, unitType);

    return {
      shopId,
      categoryId,
      name,
      description: payload.description !== undefined
        ? (isFilled(payload.description) ? String(payload.description).trim() : null)
        : (existing.description ?? null),
      price,
      unitType,
      taxClass: payload.taxClass !== undefined
        ? (isFilled(payload.taxClass) ? String(payload.taxClass).trim() : null)
        : (existing.taxClass ?? null),
      weight: payload.weight !== undefined
        ? toNumber(payload.weight, null)
        : (existing.weight ?? null),
      barcode: payload.barcode !== undefined
        ? (isFilled(payload.barcode) ? String(payload.barcode).trim() : null)
        : (existing.barcode ?? null),
      isActive: payload.isActive !== undefined
        ? toBool(payload.isActive, true)
        : (existing.isActive !== false),
      stock: hasVariants ? 0 : toInt(payload.stock, existing.stock ?? 0),
      lowStockThreshold: toInt(payload.lowStockThreshold, existing.lowStockThreshold ?? 0),
      hasVariants,
      variants
    };
  }

  async createProduct(shopId, payload, photoFile) {
    await this.getOwnedCategory(shopId, String(payload.categoryId || '').trim());

    const ref = this.getDb().collection('products').doc();
    const fields = this.buildProductFields(shopId, payload, {});
    let photoFilePath = null;
    if (photoFile) {
      photoFilePath = await this.uploadProductPhoto(shopId, ref.id, photoFile);
    }

    const now = this.now();
    await ref.set({
      ...fields,
      photoUrl: photoFilePath,
      photoFilePath,
      createdAt: now,
      updatedAt: now
    });

    const saved = await ref.get();
    return this.presentProduct(saved.data(), ref.id);
  }

  async updateProduct(shopId, productId, payload, photoFile) {
    const owned = await this.getOwnedProduct(shopId, productId);
    if (payload.categoryId) {
      await this.getOwnedCategory(shopId, String(payload.categoryId).trim());
    }

    const fields = this.buildProductFields(shopId, { ...owned.data, ...payload }, owned.data);
    let photoFilePath = owned.data.photoFilePath || null;
    let photoUrl = owned.data.photoUrl || null;

    if (photoFile) {
      photoFilePath = await this.uploadProductPhoto(shopId, productId, photoFile);
      photoUrl = photoFilePath;
    }

    await owned.ref.update({
      ...fields,
      photoFilePath,
      photoUrl,
      updatedAt: this.now()
    });

    const saved = await owned.ref.get();
    return this.presentProduct(saved.data(), productId);
  }

  async deleteProduct(shopId, productId) {
    const owned = await this.getOwnedProduct(shopId, productId);
    await owned.ref.delete();
    return { id: productId, deleted: true };
  }

  async updateStock(shopId, productId, payload) {
    const owned = await this.getOwnedProduct(shopId, productId);
    const data = owned.data;
    const updates = { updatedAt: this.now() };

    if (data.hasVariants === true) {
      const variants = Array.isArray(data.variants) ? [...data.variants] : [];
      if (isFilled(payload.variantId) && payload.stock !== undefined) {
        const idx = variants.findIndex((row) => row.id === payload.variantId);
        if (idx < 0) {
          throw httpError(404, 'VARIANT_NOT_FOUND', 'Variant not found');
        }
        variants[idx] = { ...variants[idx], stock: toInt(payload.stock, 0) };
        updates.variants = variants;
      } else if (Array.isArray(payload.variants)) {
        updates.variants = normalizeVariants(
          payload.variants,
          true,
          parseUnitType(data.unitType, DEFAULT_UNIT_TYPE)
        );
      } else {
        throw httpError(400, 'INVALID_STOCK', 'Provide variantId and stock, or variants[]');
      }
    } else {
      if (payload.stock === undefined) {
        throw httpError(400, 'INVALID_STOCK', 'stock is required');
      }
      updates.stock = toInt(payload.stock, 0);
    }

    await owned.ref.update(updates);
    const saved = await owned.ref.get();
    return this.presentProduct(saved.data(), productId);
  }
}

module.exports = new ShopCatalogueService();
