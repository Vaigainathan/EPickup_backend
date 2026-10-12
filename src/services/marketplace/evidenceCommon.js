const { getStorage } = require('../firebase');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 5 * 1024 * 1024;

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function requireUuid(idempotencyKey) {
  if (typeof idempotencyKey !== 'string' || !UUID_PATTERN.test(idempotencyKey.trim())) {
    throw httpError(400, 'VALIDATION', 'Idempotency-Key must be a UUID');
  }
  return idempotencyKey.trim();
}

function millisOf(value) {
  if (value == null) {
    return null;
  }
  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : null;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function imageExt(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return null;
  }
  if (buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'jpg';
  }
  if (buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'png';
  }
  return null;
}

function contentTypeFor(ext) {
  return ext === 'png' ? 'image/png' : 'image/jpeg';
}

function ownedOrder(snapshot, customerId) {
  if (!snapshot.exists) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  const data = snapshot.data() || {};
  if (data.customerId !== customerId) {
    throw httpError(404, 'ORDER_NOT_FOUND', 'Order not found');
  }
  return data;
}

async function saveEvidenceObject(storagePath, buffer, ext, orderId, evidenceId, purpose) {
  const fileRef = getStorage().bucket().file(storagePath);
  await fileRef.save(buffer, {
    metadata: {
      contentType: contentTypeFor(ext),
      metadata: {
        orderId,
        evidenceId,
        purpose: purpose || 'payment'
      }
    }
  });
}

module.exports = {
  UUID_PATTERN,
  MAX_BYTES,
  httpError,
  requireUuid,
  millisOf,
  imageExt,
  contentTypeFor,
  ownedOrder,
  saveEvidenceObject
};
