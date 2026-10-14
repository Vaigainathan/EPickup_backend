const {
  photoSourceFromPathAndUrl,
  photoSourceForProduct,
  photoSourceForShop,
  pathHashPrefix,
  isHttpUrl
} = require('../../../src/utils/cataloguePhotoKey');

const CLASSES = [
  'PATH_OK',
  'PATH_MISSING_OBJECT',
  'URL_ONLY_SIGNED',
  'URL_ONLY_OTHER',
  'NO_PHOTO'
];

function isSignedStorageUrl(url) {
  if (!isHttpUrl(url)) {
    return false;
  }
  const text = url.trim();
  if (/X-Goog-Signature=/i.test(text)) {
    return true;
  }
  if (/[?&]Expires=/i.test(text) && /[?&]Signature=/i.test(text)) {
    return true;
  }
  return false;
}

function classifyFromSource(source, objectExists) {
  if (!source) {
    return 'NO_PHOTO';
  }
  if (source.kind === 'path') {
    return objectExists === true ? 'PATH_OK' : 'PATH_MISSING_OBJECT';
  }
  if (source.kind === 'url') {
    return isSignedStorageUrl(source.value) ? 'URL_ONLY_SIGNED' : 'URL_ONLY_OTHER';
  }
  return 'NO_PHOTO';
}

function classifyProductPhoto({ photoFilePath, photoUrl }, objectExists = null) {
  const source = photoSourceFromPathAndUrl(photoFilePath, photoUrl);
  if (source && source.kind === 'path' && objectExists === null) {
    throw new Error('objectExists required for path classification');
  }
  if (source && source.kind === 'path') {
    return classifyFromSource(source, objectExists);
  }
  return classifyFromSource(source, null);
}

function classifyShopPhoto({ photoPath, photoUrl }, objectExists = null) {
  const source = photoSourceFromPathAndUrl(photoPath, photoUrl);
  if (source && source.kind === 'path' && objectExists === null) {
    throw new Error('objectExists required for path classification');
  }
  if (source && source.kind === 'path') {
    return classifyFromSource(source, objectExists);
  }
  return classifyFromSource(source, null);
}

function classifyWithExistence(source, exists) {
  return classifyFromSource(source, exists);
}

module.exports = {
  CLASSES,
  isSignedStorageUrl,
  classifyFromSource,
  classifyProductPhoto,
  classifyShopPhoto,
  classifyWithExistence,
  pathHashPrefix,
  photoSourceForProduct,
  photoSourceForShop
};
