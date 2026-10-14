const sharp = require('sharp');

const INVALID_IMAGE_MESSAGE = 'This photo could not be read. Please choose another.';

function invalidImageError() {
  const error = new Error(INVALID_IMAGE_MESSAGE);
  error.status = 400;
  error.code = 'INVALID_IMAGE';
  return error;
}

async function generateCatalogueThumbBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw invalidImageError();
  }
  try {
    return await sharp(buffer)
      .rotate()
      .resize({ width: 600, withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 75 })
      .toBuffer();
  } catch {
    throw invalidImageError();
  }
}

module.exports = {
  INVALID_IMAGE_MESSAGE,
  invalidImageError,
  generateCatalogueThumbBuffer
};
