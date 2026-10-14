const { normalizePhoneNumber } = require('../utils/phoneUtils');

const INDIAN_MOBILE_PATTERN = /^(\+91|91)?[\s]?[6-9]\d{4}[\s]?\d{5}$/;

const ALLOWED_ADDRESS_KEYS = [
  'name',
  'address',
  'type',
  'isDefault',
  'coordinates',
  'houseNo',
  'street',
  'landmark',
  'receiverName',
  'receiverPhone'
];

const MAX_SAVED_ADDRESSES = 20;

const LEGACY_ADDRESS_ALIAS_KEYS = ['text', 'formattedAddress', 'addressLine', 'fullAddress'];

const LENGTH_LIMITS = {
  name: 30,
  address: 300,
  houseNo: 60,
  street: 150,
  landmark: 100,
  receiverName: 60
};

const ADDRESS_TYPES = new Set(['home', 'work', 'other']);

function stripControlChars(value) {
  return value.replace(/[\x00-\x1F\x7F]/g, '');
}

function normalizeAddressStrings(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return stripControlChars(value.trim());
}

function mapLegacyAddressAliases(input) {
  const source = input && typeof input === 'object' ? { ...input } : {};
  if (typeof source.address === 'string' && source.address.trim() !== '') {
    return source;
  }
  for (const key of LEGACY_ADDRESS_ALIAS_KEYS) {
    if (typeof source[key] === 'string' && source[key].trim() !== '') {
      source.address = source[key].trim();
      break;
    }
  }
  return source;
}

function wasAddressKeySent(original) {
  if (!original || typeof original !== 'object') {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(original, 'address')) {
    return true;
  }
  return LEGACY_ADDRESS_ALIAS_KEYS.some(
    (key) => Object.prototype.hasOwnProperty.call(original, key)
  );
}

function validateIndianMobile(phone) {
  if (typeof phone !== 'string') {
    return { ok: false, field: 'receiverPhone', message: 'Please provide a valid Indian phone number' };
  }
  const trimmed = phone.trim();
  if (!INDIAN_MOBILE_PATTERN.test(trimmed)) {
    return { ok: false, field: 'receiverPhone', message: 'Please provide a valid Indian phone number' };
  }
  const normalized = normalizePhoneNumber(trimmed);
  if (!normalized) {
    return { ok: false, field: 'receiverPhone', message: 'Please provide a valid Indian phone number' };
  }
  return { ok: true, value: normalized };
}

function validateCoordinates(coords) {
  if (coords == null || typeof coords !== 'object') {
    return { ok: false, field: 'coordinates', message: 'coordinates must include latitude and longitude' };
  }
  const lat = Number(coords.latitude);
  const lng = Number(coords.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, field: 'coordinates', message: 'latitude must be between -90 and 90' };
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false, field: 'coordinates', message: 'longitude must be between -180 and 180' };
  }
  return {
    ok: true,
    value: { latitude: lat, longitude: lng }
  };
}

function validationError(field, message) {
  return { ok: false, code: 'VALIDATION', field, message };
}

function parseCustomerAddressBody(body, options = {}) {
  const mode = options.mode === 'update' ? 'update' : 'create';
  const original = body && typeof body === 'object' ? body : {};
  const mapped = mapLegacyAddressAliases(original);

  const value = {};
  const addressSent = wasAddressKeySent(original);

  for (const key of ALLOWED_ADDRESS_KEYS) {
    const keySent = key === 'address'
      ? addressSent
      : Object.prototype.hasOwnProperty.call(original, key);

    if (mode === 'update' && !keySent) {
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(mapped, key) && key !== 'address') {
      if (mode === 'create' && key === 'address') {
        return validationError('address', 'address is required');
      }
      continue;
    }

    if (key === 'address') {
      if (mode === 'create' && !addressSent) {
        return validationError('address', 'address is required');
      }
      if (!addressSent) {
        continue;
      }
      const normalized = normalizeAddressStrings(mapped.address);
      if (!normalized) {
        return validationError('address', 'address is required');
      }
      if (normalized.length > LENGTH_LIMITS.address) {
        return validationError('address', `address must be at most ${LENGTH_LIMITS.address} characters`);
      }
      value.address = normalized;
      continue;
    }

    if (key === 'isDefault') {
      if (typeof mapped.isDefault !== 'boolean') {
        return validationError('isDefault', 'isDefault must be a boolean');
      }
      value.isDefault = mapped.isDefault;
      continue;
    }

    if (key === 'coordinates') {
      const coordResult = validateCoordinates(mapped.coordinates);
      if (!coordResult.ok) {
        return validationError(coordResult.field, coordResult.message);
      }
      value.coordinates = coordResult.value;
      continue;
    }

    if (key === 'type') {
      if (typeof mapped.type !== 'string') {
        return validationError('type', "type must be 'home', 'work', or 'other'");
      }
      const lowered = mapped.type.trim().toLowerCase();
      if (!ADDRESS_TYPES.has(lowered)) {
        return validationError('type', "type must be 'home', 'work', or 'other'");
      }
      value.type = lowered;
      continue;
    }

    if (key === 'receiverPhone') {
      const phoneResult = validateIndianMobile(mapped.receiverPhone);
      if (!phoneResult.ok) {
        return validationError(phoneResult.field, phoneResult.message);
      }
      value.receiverPhone = phoneResult.value;
      continue;
    }

    const stringValue = normalizeAddressStrings(mapped[key]);
    if (typeof mapped[key] !== 'string') {
      return validationError(key, `${key} must be a string`);
    }
    const limit = LENGTH_LIMITS[key];
    if (limit && stringValue.length > limit) {
      return validationError(key, `${key} must be at most ${limit} characters`);
    }
    value[key] = stringValue;
  }

  if (mode === 'create' && !value.address) {
    return validationError('address', 'address is required');
  }

  return { ok: true, value };
}

function applySingleDefault(addresses, defaultIndex) {
  if (!Array.isArray(addresses) || defaultIndex < 0 || defaultIndex >= addresses.length) {
    return addresses;
  }
  if (addresses[defaultIndex].isDefault !== true) {
    return addresses;
  }
  return addresses.map((row, index) => ({
    ...row,
    isDefault: index === defaultIndex
  }));
}

function addressLimitExceeded(addresses) {
  return Array.isArray(addresses) && addresses.length >= MAX_SAVED_ADDRESSES;
}

function invalidateCustomerAddressCache(userId, cachingService) {
  const cacheKey = `addresses_${userId}`;
  return cachingService.delete(cacheKey, 'memory');
}

module.exports = {
  ALLOWED_ADDRESS_KEYS,
  MAX_SAVED_ADDRESSES,
  INDIAN_MOBILE_PATTERN,
  normalizeAddressStrings,
  mapLegacyAddressAliases,
  validateIndianMobile,
  validateCoordinates,
  parseCustomerAddressBody,
  applySingleDefault,
  addressLimitExceeded,
  invalidateCustomerAddressCache
};
