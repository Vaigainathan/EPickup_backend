const admin = require('firebase-admin');
const { getStorage } = require('./firebase');
const shopCatalogueService = require('./shopCatalogueService');
const shopOnboardingService = require('./shopOnboardingService');
const { validateOpeningHours } = require('../utils/shopOpeningHours');
const { imageExt, contentTypeFor } = require('./marketplace/evidenceCommon');
const { thumbPathForOriginal } = require('../utils/catalogueThumbPath');
const { generateCatalogueThumbBuffer } = require('./catalogueThumbnail');
const {
  photoSourceForShopThumb,
  computePhotoKeyFromSource
} = require('../utils/cataloguePhotoKey');

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

function isStorageNotFound(error) {
  if (!error) {
    return false;
  }
  const code = error.code;
  if (code === 404 || code === '404') {
    return true;
  }
  const message = String(error.message || '');
  return /not found/i.test(message);
}

async function deleteStorageObject(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return;
  }
  try {
    await getStorage().bucket().file(filePath).delete();
  } catch (error) {
    if (isStorageNotFound(error)) {
      return;
    }
    console.error('❌ [SHOP_STOREFRONT] Failed to delete storage object:', error.message);
  }
}

class ShopStorefrontService {
  now() {
    return admin.firestore.FieldValue.serverTimestamp();
  }

  async presentStorefront(storefront = {}) {
    const photoUrl = await shopCatalogueService.resolvePhotoUrl(storefront.photoPath, null);
    const thumbSource = photoSourceForShopThumb(storefront);
    let thumbUrl = null;
    let thumbKey = null;
    if (thumbSource) {
      thumbKey = computePhotoKeyFromSource(thumbSource);
      thumbUrl = await shopCatalogueService.resolvePhotoFromSource(thumbSource);
    }
    return {
      tagline: typeof storefront.tagline === 'string' ? storefront.tagline : '',
      openingHours: storefront.openingHours !== undefined ? storefront.openingHours : null,
      photoUrl,
      thumbUrl,
      thumbKey
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
    const photoPath = typeof existing.photoPath === 'string' && existing.photoPath.trim() !== ''
      ? existing.photoPath
      : null;

    const updatedAt = this.now();
    const updatePayload = {
      'storefront.tagline': tagline,
      'storefront.openingHours': openingHours,
      'storefront.updatedAt': updatedAt,
      updatedAt
    };
    if (photoPath) {
      updatePayload['storefront.photoPath'] = photoPath;
    }
    if (typeof existing.thumbPath === 'string' && existing.thumbPath.trim() !== '') {
      updatePayload['storefront.thumbPath'] = existing.thumbPath;
    }

    await ctx.shopRef.update(updatePayload);

    return this.presentStorefront({
      tagline,
      openingHours,
      photoPath,
      thumbPath: existing.thumbPath
    });
  }

  async uploadStorefrontPhoto(shopId, file) {
    if (!file || !file.buffer) {
      throw httpError(400, 'MISSING_FILE', 'No photo file provided');
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw httpError(400, 'FILE_TOO_LARGE', 'Photo must be 5MB or smaller');
    }

    const thumbBuffer = await generateCatalogueThumbBuffer(file.buffer);

    const ext = storefrontPhotoExt(file.buffer);
    const filePath = `shops/${shopId}/storefront/${Date.now()}.${ext}`;
    const thumbPath = thumbPathForOriginal(filePath);
    const customMetadata = {
      shopId,
      uploadedAt: new Date().toISOString(),
      uploadedBy: 'backend_proxy',
      originalFileName: file.originalname || `photo.${ext}`
    };
    const bucket = getStorage().bucket();
    const fileRef = bucket.file(filePath);
    const thumbRef = bucket.file(thumbPath);

    await fileRef.save(file.buffer, {
      metadata: {
        contentType: contentTypeFor(ext),
        customMetadata
      }
    });

    try {
      await thumbRef.save(thumbBuffer, {
        metadata: {
          contentType: 'image/jpeg',
          customMetadata
        }
      });
    } catch (error) {
      await deleteStorageObject(filePath);
      throw error;
    }

    const ctx = await shopOnboardingService.loadShopContext(shopId);
    const existing = ctx.shopProfile.storefront || {};
    const previousPath = typeof existing.photoPath === 'string' ? existing.photoPath : null;
    const previousThumb = typeof existing.thumbPath === 'string' ? existing.thumbPath : null;

    const storefront = {
      ...existing,
      photoPath: filePath,
      thumbPath,
      updatedAt: this.now()
    };

    await ctx.shopRef.set({
      storefront,
      updatedAt: this.now()
    }, { merge: true });

    if (previousPath && previousPath !== filePath) {
      await deleteStorageObject(previousPath);
    }
    if (previousThumb && previousThumb !== thumbPath) {
      await deleteStorageObject(previousThumb);
    }

    return this.presentStorefront(storefront);
  }

  async deleteStorefrontPhoto(shopId) {
    const ctx = await shopOnboardingService.loadShopContext(shopId);
    const existing = ctx.shopProfile.storefront || {};
    const previousPath = typeof existing.photoPath === 'string' ? existing.photoPath : null;
    const previousThumb = typeof existing.thumbPath === 'string' ? existing.thumbPath : null;

    await ctx.shopRef.update({
      'storefront.photoPath': admin.firestore.FieldValue.delete(),
      'storefront.thumbPath': admin.firestore.FieldValue.delete(),
      'storefront.updatedAt': this.now(),
      updatedAt: this.now()
    });

    if (previousPath) {
      await deleteStorageObject(previousPath);
    }
    if (previousThumb) {
      await deleteStorageObject(previousThumb);
    }

    const refreshed = await shopOnboardingService.loadShopContext(shopId);
    return this.presentStorefront(refreshed.shopProfile.storefront || {});
  }
}

module.exports = new ShopStorefrontService();
module.exports.storefrontPhotoExt = storefrontPhotoExt;
module.exports.MAX_STOREFRONT_PHOTO_BYTES = MAX_PHOTO_BYTES;
