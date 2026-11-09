const SIGNATURES = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46], webpHint: true }
];

function bufferStartsWith(buf, prefix) {
  if (!buf || buf.length < prefix.length) {
    return false;
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (buf[i] !== prefix[i]) {
      return false;
    }
  }
  return true;
}

function isWebp(buf) {
  if (!bufferStartsWith(buf, [0x52, 0x49, 0x46, 0x46]) || buf.length < 12) {
    return false;
  }
  return buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
}

/**
 * Detect image type from magic bytes. Client Content-Type is ignored.
 * JPEG may be sent as application/octet-stream (accepted when bytes match).
 */
function validateImageUploadBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return {
      ok: false,
      code: 'EMPTY_BUFFER',
      message: 'Upload buffer is empty'
    };
  }

  if (bufferStartsWith(buffer, SIGNATURES[0].bytes)) {
    return { ok: true, mime: 'image/jpeg', contentType: 'image/jpeg' };
  }
  if (bufferStartsWith(buffer, SIGNATURES[1].bytes)) {
    return { ok: true, mime: 'image/png', contentType: 'image/png' };
  }
  if (isWebp(buffer)) {
    return { ok: true, mime: 'image/webp', contentType: 'image/webp' };
  }

  return {
    ok: false,
    code: 'UNSUPPORTED_IMAGE',
    message: 'File content is not a supported image (JPEG, PNG, or WebP)'
  };
}

module.exports = {
  validateImageUploadBuffer
};
