const SHOP_TAGS = new Set([
  'Good quality',
  'Accurate order',
  'Well packed',
  'Good value',
  'Needs improvement'
]);

const DRIVER_TAGS = new Set([
  'On time',
  'Polite',
  'Followed instructions',
  'Handled with care'
]);

function stripControlCharacters(text) {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 32 && code !== 127) {
      out += text[index];
    }
  }
  return out;
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function isIntegerStars(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

function parseTags(raw, allowed) {
  if (!Array.isArray(raw)) {
    throw httpError(400, 'VALIDATION', 'tags must be an array');
  }
  const seen = new Set();
  const tags = [];
  for (let index = 0; index < raw.length; index += 1) {
    const tag = raw[index];
    if (typeof tag !== 'string' || !allowed.has(tag)) {
      throw httpError(400, 'VALIDATION', 'Invalid tag');
    }
    if (seen.has(tag)) {
      throw httpError(400, 'VALIDATION', 'Duplicate tag');
    }
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function sanitizeComment(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return '';
  }
  if (typeof raw !== 'string') {
    throw httpError(400, 'VALIDATION', 'comment must be a string');
  }
  const stripped = stripControlCharacters(raw);
  if (stripped.length > 500) {
    throw httpError(400, 'VALIDATION', 'comment must be 500 characters or fewer');
  }
  return stripped;
}

function parsePart(raw, kind) {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw httpError(400, 'VALIDATION', `${kind} must be an object`);
  }
  if (!isIntegerStars(raw.stars)) {
    throw httpError(400, 'VALIDATION', 'stars must be an integer from 1 to 5');
  }
  const allowed = kind === 'shop' ? SHOP_TAGS : DRIVER_TAGS;
  const tags = parseTags(raw.tags, allowed);
  const comment = kind === 'shop' ? sanitizeComment(raw.comment) : '';
  return {
    stars: raw.stars,
    tags,
    comment
  };
}

function parseMarketplaceRatingBody(body) {
  const source = body && typeof body === 'object' ? body : {};
  const shop = parsePart(source.shop, 'shop');
  const driver = parsePart(source.driver, 'driver');
  if (!shop && !driver) {
    throw httpError(400, 'VALIDATION', 'At least one of shop or driver rating is required');
  }
  return { shop, driver };
}

module.exports = {
  SHOP_TAGS,
  DRIVER_TAGS,
  parseMarketplaceRatingBody
};
