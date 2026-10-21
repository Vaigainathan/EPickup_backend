const { getStorage } = require('./firebase');

const DRIVER_KYC_SIGNED_URL_TTL_SEC = 3600;
const DRIVER_KYC_SIGNED_URL_TTL_MS = DRIVER_KYC_SIGNED_URL_TTL_SEC * 1000;

/** @type {Map<string, { url: string, expiresAt: number }>} */
const signCache = new Map();
const SIGN_CACHE_BUFFER_MS = 60 * 1000;

let signUrlImpl = null;

function setSignUrlImplForTests(impl) {
  signUrlImpl = impl;
}

function clearSignCacheForTests() {
  signCache.clear();
}

function decodeURIComponentSafe(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Parse a stored reference into a storage path, bucket, or legacy URL.
 * @param {string} value
 * @returns {{ bucket?: string|null, path?: string, legacyUrl?: string }|null}
 */
function parseDriverKycStorageReference(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('gs://')) {
    const withoutScheme = trimmed.slice(5);
    const firstSlash = withoutScheme.indexOf('/');
    if (firstSlash === -1) {
      return null;
    }
    const bucket = withoutScheme.slice(0, firstSlash);
    const pathWithQuery = withoutScheme.slice(firstSlash + 1);
    const [path] = pathWithQuery.split('?');
    return { bucket, path };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const storageGoogle = trimmed.match(
      /^https?:\/\/storage\.googleapis\.com\/([^/]+)\/(.+?)(?:\?|$)/i
    );
    if (storageGoogle) {
      const bucket = storageGoogle[1];
      const path = decodeURIComponentSafe(storageGoogle[2].split('?')[0]);
      return { bucket, path };
    }

    const firebaseStorage = trimmed.match(
      /^https?:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/i
    );
    if (firebaseStorage) {
      const bucket = firebaseStorage[1];
      const path = decodeURIComponentSafe(firebaseStorage[2]);
      return { bucket, path };
    }

    return { legacyUrl: trimmed };
  }

  const sanitized = trimmed.replace(/^\/+/, '');
  if (!sanitized) {
    return null;
  }

  const [path] = sanitized.split('?');
  return { bucket: null, path };
}

function storagePathFromDriverKycFields({ filePath, url, downloadURL }) {
  if (filePath && typeof filePath === 'string' && filePath.trim()) {
    return filePath.trim();
  }
  for (const candidate of [url, downloadURL]) {
    const ref = parseDriverKycStorageReference(candidate);
    if (ref?.path) {
      return ref.path;
    }
  }
  return null;
}

async function defaultSignDriverKycPath(filePath, options = {}) {
  const path = typeof filePath === 'string' ? filePath.trim() : '';
  if (!path) {
    throw new Error('filePath is required to sign driver KYC document');
  }

  const storage = getStorage();
  const bucketInstance = options.bucket
    ? storage.bucket(options.bucket)
    : storage.bucket();
  const cacheKey = `${bucketInstance.name}/${path}`;

  const now = Date.now();
  const cached = signCache.get(cacheKey);
  if (cached && cached.expiresAt > now + SIGN_CACHE_BUFFER_MS) {
    return {
      url: cached.url,
      signedUrlExpiresAt: new Date(cached.expiresAt).toISOString(),
      bucket: bucketInstance.name,
      path
    };
  }

  const expiresAtMs = now + DRIVER_KYC_SIGNED_URL_TTL_MS;
  const file = bucketInstance.file(path);
  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: new Date(expiresAtMs)
  });

  signCache.set(cacheKey, { url: signedUrl, expiresAt: expiresAtMs });

  return {
    url: signedUrl,
    signedUrlExpiresAt: new Date(expiresAtMs).toISOString(),
    bucket: bucketInstance.name,
    path
  };
}

async function signDriverKycPath(filePath, options = {}) {
  if (signUrlImpl) {
    return signUrlImpl(filePath, options);
  }
  return defaultSignDriverKycPath(filePath, options);
}

/**
 * Resolve a read URL for driver KYC (sign path; legacy unparseable https returned as-is).
 */
async function resolveDriverKycReadUrl({ filePath, url, downloadURL, bucket } = {}) {
  const path = storagePathFromDriverKycFields({ filePath, url, downloadURL });
  if (path) {
    try {
      const signed = await signDriverKycPath(path, { bucket });
      return {
        url: signed.url,
        signedUrlExpiresAt: signed.signedUrlExpiresAt,
        source: 'signed'
      };
    } catch (error) {
      console.warn('⚠️ [DRIVER_KYC_URL] Failed to sign path:', {
        path,
        error: error.message
      });
      const legacy = [url, downloadURL].find((v) => typeof v === 'string' && v.trim());
      if (legacy) {
        return { url: legacy.trim(), signedUrlExpiresAt: null, source: 'legacy_fallback' };
      }
      return { url: null, signedUrlExpiresAt: null, source: 'error', error: error.message };
    }
  }

  const legacy = [url, downloadURL].find((v) => typeof v === 'string' && v.trim());
  if (legacy) {
    return { url: legacy.trim(), signedUrlExpiresAt: null, source: 'legacy' };
  }

  return { url: null, signedUrlExpiresAt: null, source: 'missing' };
}

async function presentDriverKycFileRecord(record) {
  if (!record || typeof record !== 'object') {
    return record;
  }

  const resolved = await resolveDriverKycReadUrl({
    filePath: record.filePath,
    url: record.url,
    downloadURL: record.downloadURL
  });

  const next = { ...record };
  if (resolved.url) {
    next.downloadURL = resolved.url;
    next.url = resolved.url;
  }
  if (resolved.signedUrlExpiresAt) {
    next.signedUrlExpiresAt = resolved.signedUrlExpiresAt;
  }
  return next;
}

/**
 * List latest object per folder under drivers/{driverId}/documents/
 * @returns {Promise<Record<string, object>>} snake_case document type -> file record
 */
async function listLatestDriverKycDocumentsFromStorage(driverId, bucketOverride = null) {
  const storage = getStorage();
  const bucket = bucketOverride || storage.bucket();
  const [files] = await bucket.getFiles({
    prefix: `drivers/${driverId}/documents/`
  });

  const documentFiles = {};

  for (const file of files) {
    const pathParts = file.name.split('/');
    const documentType = pathParts[pathParts.length - 2];
    if (!documentType) {
      continue;
    }

    if (!documentFiles[documentType]) {
      documentFiles[documentType] = [];
    }

    let metadata = file.metadata;
    try {
      const [meta] = await file.getMetadata();
      metadata = meta;
    } catch {
      // use listing metadata when available
    }

    documentFiles[documentType].push({
      fileName: file.name.split('/').pop(),
      filePath: file.name,
      size: metadata?.size,
      uploadedAt: metadata?.timeCreated,
      contentType: metadata?.contentType,
      customMetadata: metadata?.customMetadata || {}
    });
  }

  const documents = {};
  for (const [documentType, typeFiles] of Object.entries(documentFiles)) {
    if (typeFiles.length === 0) {
      continue;
    }
    const sortedFiles = typeFiles.sort(
      (a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)
    );
    const latest = sortedFiles[0];
    documents[documentType] = await presentDriverKycFileRecord(latest);
    if (typeFiles.length > 1) {
      console.warn(
        `⚠️ [DRIVER_KYC] Multiple files for ${documentType}: ${typeFiles.length}, using latest ${latest.fileName}`
      );
    }
  }

  return documents;
}

async function presentDriverKycDocumentMap(documentsMap) {
  if (!documentsMap || typeof documentsMap !== 'object') {
    return documentsMap;
  }

  const out = {};
  for (const [key, doc] of Object.entries(documentsMap)) {
    if (!doc || typeof doc !== 'object') {
      out[key] = doc;
      continue;
    }
    out[key] = await presentDriverKycDocumentMapEntry(doc);
  }
  return out;
}

async function presentDriverKycDocumentMapEntry(doc) {
  const resolved = await resolveDriverKycReadUrl({
    filePath: doc.filePath,
    url: doc.url,
    downloadURL: doc.downloadURL
  });

  const next = { ...doc };
  if (resolved.url) {
    next.url = resolved.url;
    next.downloadURL = resolved.url;
  }
  if (resolved.signedUrlExpiresAt) {
    next.signedUrlExpiresAt = resolved.signedUrlExpiresAt;
  }
  return next;
}

function isDriverKycDocumentPresent(doc) {
  if (!doc || typeof doc !== 'object') {
    return false;
  }
  const filePath = doc.filePath;
  if (typeof filePath === 'string' && filePath.trim() !== '') {
    return true;
  }
  const url = doc.url || doc.downloadURL;
  if (typeof url === 'string' && url.trim() !== '') {
    return true;
  }
  const isVerified = doc.verified === true
    || doc.status === 'verified'
    || doc.verificationStatus === 'verified'
    || doc.verificationStatus === 'approved';
  return isVerified;
}

module.exports = {
  DRIVER_KYC_SIGNED_URL_TTL_SEC,
  DRIVER_KYC_SIGNED_URL_TTL_MS,
  parseDriverKycStorageReference,
  storagePathFromDriverKycFields,
  signDriverKycPath,
  resolveDriverKycReadUrl,
  presentDriverKycFileRecord,
  listLatestDriverKycDocumentsFromStorage,
  presentDriverKycDocumentMap,
  presentDriverKycDocumentMapEntry,
  isDriverKycDocumentPresent,
  setSignUrlImplForTests,
  clearSignCacheForTests
};
