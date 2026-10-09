const admin = require('firebase-admin');
const { getStorage } = require('./firebase');
const shopCatalogueService = require('./shopCatalogueService');
const shopOnboardingService = require('./shopOnboardingService');
const { validateOpeningHours } = require('../utils/shopOpeningHours');
const { imageExt, contentTypeFor } = require('./marketplace/paymentEvidence');

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function storefrontPhotoExt(buffer) {
  const ext = imageExt(buffer);
  if (!ext) {
    throw httpError(400, 'INVALID_FILE_TYPE', 'Photo must be a JPEG or PNG image');
  }
  return ext;
}

async function deleteStorageObject(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return;
  }
  try {
    await getStorage().bucket().file(filePath).delete();
  } catch (error) {
    console.error('❌ [SHOP_STOREFRONT] Failed to delete storage object:', error.message);
  }
}

class ShopStorefrontService {
  now() {
    return admin.firestore.FieldValue.serverTimestamp();
  }

  async presentStorefront(storefront = {}) {
    const photoUrl = await shopCatalogueService.resolvePhotoUrl(storefront.photoPath, null);
    return {
      tagline: typeof storefront.tagline === 'string' ? storefront.tagline : '',
      openingHours: storefront.openingHours !== undefined ? storefront.openingHours : null,
      photoUrl
    };
  }

  async getStorefront(shopId) {
    const ctx = await shopOnboardingService.loadShopContext(shopId);
    return this.presentStorefront(ctx.shopProfile.storefront || {});
  }

  async updateStorefront(shopId, payload) {
    const body = payload && typeof payload === 'object' ? payload : {};

    if (body.openingHours === undefined) {
      throw httpError(400, 'INVALID_OPENING_HOURS', 'openingHours is required');
    }

    let tagline = '';
    if (body.tagline !== undefined && body.tagline !== null) {
      if (typeof body.tagline !== 'string') {
        throw httpError(400, 'INVALID_TAGLINE', 'tagline must be a string');
      }
      tagline = body.tagline.trim();
      if (tagline.length > 60) {
        throw httpError(400, 'INVALID_TAGLINE', 'tagline must be at most 60 characters');
      }
    }

    const openingHours = validateOpeningHours(body.openingHours);
    const ctx = await shopOnboardingService.loadShopContext(shopId);
    const existing = ctx.shopProfile.storefront || {};

    const storefront = {
      tagline,
      openingHours,
      updatedAt: this.now()
    };
    if (typeof existing.photoPath === 'string' && existing.photoPath.trim() !== '') {
      storefront.photoPath = existing.photoPath;
    }

    await ctx.shopRef.set({
      storefront,
      updatedAt: this.now()
    }, { merge: true });

    return this.presentStorefront({
      ...storefront,
      photoPath: storefront.photoPath
    });
  }

  async uploadStorefrontPhoto(shopId, file) {
    if (!file || !file.buffer) {
      throw httpError(400, 'MISSING_FILE', 'No photo file provided');
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw httpError(400, 'FILE_TOO_LARGE', 'Photo must be 5MB or smaller');
    }

    const ext = storefrontPhotoExt(file.buffer);
    const filePath = `shops/${shopId}/storefront/${Date.now()}.${ext}`;
    const fileRef = getStorage().bucket().file(filePath);

    await fileRef.save(file.buffer, {
      metadata: {
        contentType: contentTypeFor(ext),
        customMetadata: {
          shopId,
          uploadedAt: new Date().toISOString(),
          uploadedBy: 'backend_proxy',
          originalFileName: file.originalname || `photo.${ext}`
        }
      }
    });

    const ctx = await shopOnboardingService.loadShopContext(shopId);
    const existing = ctx.shopProfile.storefront || {};
    const previousPath = typeof existing.photoPath === 'string' ? existing.photoPath : null;

    const storefront = {
      ...existing,
      photoPath: filePath,
      updatedAt: this.now()
    };

    await ctx.shopRef.set({
      storefront,
      updatedAt: this.now()
    }, { merge: true });

    if (previousPath && previousPath !== filePath) {
      await deleteStorageObject(previousPath);
    }

    return this.presentStorefront(storefront);
  }

  async deleteStorefrontPhoto(shopId) {
    const ctx = await shopOnboardingService.loadShopContext(shopId);
    const existing = ctx.shopProfile.storefront || {};
    const previousPath = typeof existing.photoPath === 'string' ? existing.photoPath : null;

    const { photoPath, ...rest } = existing; // eslint-disable-line no-unused-vars
    const storefront = {
      ...rest,
      updatedAt: this.now()
    };

    await ctx.shopRef.set({
      storefront,
      updatedAt: this.now()
    }, { merge: true });

    if (previousPath) {
      await deleteStorageObject(previousPath);
    }

    return this.presentStorefront(storefront);
  }
}

module.exports = new ShopStorefrontService();
module.exports.storefrontPhotoExt = storefrontPhotoExt;
module.exports.MAX_STOREFRONT_PHOTO_BYTES = MAX_PHOTO_BYTES;
