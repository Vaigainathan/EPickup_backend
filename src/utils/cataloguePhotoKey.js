const crypto = require('crypto');

function isFilled(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isHttpUrl(value) {
  return isFilled(value) && /^https?:\/\//i.test(value.trim());
}

/**
 * Same resolution order as shopCatalogueService.resolvePhotoUrl(filePath, fallbackUrl):
 * 1) non-empty filePath (photoFilePath)
 * 2) http(s) fallbackUrl (photoUrl)
 * 3) non-http non-empty fallbackUrl treated as storage path (legacy path in photoUrl)
 */
function photoSourceFromPathAndUrl(filePath, fallbackUrl) {
  if (isFilled(filePath)) {
    return { kind: 'path', value: filePath.trim() };
  }
  if (isHttpUrl(fallbackUrl)) {
    return { kind: 'url', value: fallbackUrl.trim() };
  }
  if (isFilled(fallbackUrl)) {
    return { kind: 'path', value: fallbackUrl.trim() };
  }
  return null;
}

function photoSourceForProduct(data) {
  const row = data && typeof data === 'object' ? data : {};
  return photoSourceFromPathAndUrl(row.photoFilePath, row.photoUrl);
}

function photoSourceForShop(storefront) {
  const row = storefront && typeof storefront === 'object' ? storefront : {};
  return photoSourceFromPathAndUrl(row.photoPath, row.photoUrl);
}

function photoSourceForProductThumb(data) {
  const row = data && typeof data === 'object' ? data : {};
  return photoSourceFromPathAndUrl(row.thumbFilePath, null);
}

function photoSourceForShopThumb(storefront) {
  const row = storefront && typeof storefront === 'object' ? storefront : {};
  return photoSourceFromPathAndUrl(row.thumbPath, null);
}

function computePhotoKeyFromSource(source) {
  if (!source || !source.value) {
    return null;
  }
  return crypto.createHash('sha256').update(source.value, 'utf8').digest('hex').slice(0, 16);
}

function computePhotoKey(source) {
  return computePhotoKeyFromSource(source);
}

function pathHashPrefix(path) {
  if (!isFilled(path)) {
    return null;
  }
  return crypto.createHash('sha256').update(path.trim(), 'utf8').digest('hex').slice(0, 8);
}

module.exports = {
  isFilled,
  isHttpUrl,
  photoSourceFromPathAndUrl,
  photoSourceForProduct,
  photoSourceForShop,
  photoSourceForProductThumb,
  photoSourceForShopThumb,
  computePhotoKeyFromSource,
  computePhotoKey,
  pathHashPrefix
};
