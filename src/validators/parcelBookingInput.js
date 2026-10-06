const TOP_LEVEL_KEYS = new Set([
  'pickup',
  'dropoff',
  'package',
  'vehicle',
  'paymentMethod',
  'idempotencyKey',
  'estimatedPickupTime',
  'estimatedDeliveryTime'
]);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isAbsent(value) {
  return value === null || value === undefined;
}

function cleanString(value, keepBreaks) {
  let cleaned = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isDel = code === 127;
    const isControl = code <= 31;
    const isKeptBreak = keepBreaks && (code === 9 || code === 10 || code === 13);
    if (!isDel && (!isControl || isKeptBreak)) {
      cleaned += value[index];
    }
  }
  return cleaned.trim();
}

function pushError(errors, code, path, message) {
  errors.push({ code, path, message });
}

function collectDropped(source, allowed, prefix, droppedKeys) {
  if (!isPlainObject(source)) {
    return;
  }
  Object.keys(source).forEach((key) => {
    if (!allowed.has(key)) {
      droppedKeys.push(prefix ? `${prefix}.${key}` : key);
    }
  });
}

function readIndianMobile(source, key, path, errors, target) {
  if (!Object.prototype.hasOwnProperty.call(source, key) || isAbsent(source[key])) {
    return;
  }
  const message = `${path} must be a valid 10-digit Indian mobile number`;
  const raw = source[key];
  if (typeof raw !== 'string') {
    pushError(errors, 'INVALID_FIELD', path, message);
    return;
  }
  const compact = raw.replace(/[\s()[\]-]/g, '');
  if (/^[6-9]\d{9}$/.test(compact)) {
    target[key] = `+91${compact}`;
    return;
  }
  if (/^91[6-9]\d{9}$/.test(compact)) {
    target[key] = `+${compact}`;
    return;
  }
  if (/^\+91[6-9]\d{9}$/.test(compact)) {
    target[key] = compact;
    return;
  }
  pushError(errors, 'INVALID_FIELD', path, message);
}

function readOptionalString(source, key, path, max, keepBreaks, errors, target) {
  if (!Object.prototype.hasOwnProperty.call(source, key) || isAbsent(source[key])) {
    return;
  }
  const raw = source[key];
  if (typeof raw !== 'string') {
    pushError(errors, 'INVALID_FIELD', path, `${path} must be a string of at most ${max} characters`);
    return;
  }
  const cleaned = cleanString(raw, keepBreaks);
  if (cleaned.length > max) {
    pushError(errors, 'INVALID_FIELD', path, `${path} must be a string of at most ${max} characters`);
    return;
  }
  target[key] = cleaned;
}

function readCoordinate(raw, path, min, max, coordCode, errors, stringCoordinates) {
  if (!raw || (typeof raw === 'number' && Number.isNaN(raw))) {
    pushError(errors, coordCode, path, `${path} is required`);
    return undefined;
  }

  let numeric;
  let fromString = false;
  if (typeof raw === 'number') {
    numeric = raw;
  } else if (typeof raw === 'string') {
    const cleaned = cleanString(raw, false);
    numeric = Number(cleaned);
    if (!Number.isFinite(numeric)) {
      pushError(errors, 'INVALID_FIELD', path, `${path} must be a finite number`);
      return undefined;
    }
    fromString = true;
  } else {
    pushError(errors, 'INVALID_FIELD', path, `${path} must be a finite number`);
    return undefined;
  }

  if (!Number.isFinite(numeric)) {
    pushError(errors, 'INVALID_FIELD', path, `${path} must be a finite number`);
    return undefined;
  }
  if (numeric === 0) {
    pushError(errors, coordCode, path, `${path} is required`);
    return undefined;
  }

  if (numeric < min || numeric > max) {
    pushError(errors, 'INVALID_FIELD', path, `${path} is out of range`);
    return undefined;
  }

  if (fromString) {
    stringCoordinates.push(path);
  }
  return numeric;
}

function readCoordinates(raw, sideName, coordCode, errors, droppedKeys, stringCoordinates) {
  if (!isPlainObject(raw)) {
    pushError(errors, coordCode, `${sideName}.coordinates`, `${sideName} coordinates are required`);
    return null;
  }

  collectDropped(raw, new Set(['latitude', 'longitude']), `${sideName}.coordinates`, droppedKeys);
  const latitude = readCoordinate(
    raw.latitude,
    `${sideName}.coordinates.latitude`,
    -90,
    90,
    coordCode,
    errors,
    stringCoordinates
  );
  const longitude = readCoordinate(
    raw.longitude,
    `${sideName}.coordinates.longitude`,
    -180,
    180,
    coordCode,
    errors,
    stringCoordinates
  );
  if (latitude === undefined || longitude === undefined) {
    return null;
  }
  return { latitude, longitude };
}

function readSide(raw, sideName, coordCode, errors, droppedKeys, stringCoordinates) {
  const out = {};
  collectDropped(raw, new Set(['name', 'phone', 'address', 'coordinates']), sideName, droppedKeys);
  readOptionalString(raw, 'name', `${sideName}.name`, 100, false, errors, out);
  readIndianMobile(raw, 'phone', `${sideName}.phone`, errors, out);
  readOptionalString(raw, 'address', `${sideName}.address`, 500, true, errors, out);
  const coordinates = readCoordinates(raw.coordinates, sideName, coordCode, errors, droppedKeys, stringCoordinates);
  if (coordinates) {
    out.coordinates = coordinates;
  }
  return out;
}

function readPackage(raw, errors, droppedKeys) {
  const out = {};
  collectDropped(raw, new Set(['weight', 'description', 'specialInstructions']), 'package', droppedKeys);
  if (Object.prototype.hasOwnProperty.call(raw, 'weight') && !isAbsent(raw.weight)) {
    const weight = raw.weight;
    if (typeof weight === 'number' && Number.isFinite(weight)) {
      out.weight = weight;
    } else if (typeof weight === 'string') {
      const cleaned = cleanString(weight, false);
      if (cleaned.length > 20) {
        pushError(errors, 'INVALID_FIELD', 'package.weight', 'package.weight must be a number or a string of at most 20 characters');
      } else {
        out.weight = cleaned;
      }
    } else {
      pushError(errors, 'INVALID_FIELD', 'package.weight', 'package.weight must be a number or a string of at most 20 characters');
    }
  }
  readOptionalString(raw, 'description', 'package.description', 500, true, errors, out);
  readOptionalString(raw, 'specialInstructions', 'package.specialInstructions', 500, true, errors, out);
  return out;
}

function readVehicle(raw, errors, droppedKeys) {
  if (isAbsent(raw)) {
    return undefined;
  }
  if (!isPlainObject(raw)) {
    pushError(errors, 'INVALID_FIELD', 'vehicle', 'vehicle must be an object');
    return undefined;
  }
  collectDropped(raw, new Set(['type']), 'vehicle', droppedKeys);
  if (!Object.prototype.hasOwnProperty.call(raw, 'type') || isAbsent(raw.type)) {
    return undefined;
  }
  const target = {};
  readOptionalString(raw, 'type', 'vehicle.type', 30, false, errors, target);
  return target.type === undefined ? undefined : target;
}

function readDate(source, key, errors, target) {
  if (!Object.prototype.hasOwnProperty.call(source, key) || isAbsent(source[key])) {
    return;
  }
  const raw = source[key];
  if (typeof raw !== 'string') {
    pushError(errors, 'INVALID_FIELD', key, `${key} must be a date string`);
    return;
  }
  const cleaned = cleanString(raw, false);
  if (cleaned.length > 40 || Number.isNaN(Date.parse(cleaned))) {
    pushError(errors, 'INVALID_FIELD', key, `${key} must be a date string`);
    return;
  }
  target[key] = cleaned;
}

function sanitizeParcelBookingInput(body) {
  const errors = [];
  const droppedKeys = [];
  const stringCoordinates = [];
  const source = isPlainObject(body) ? body : {};
  const data = {};

  if (isPlainObject(body)) {
    collectDropped(body, TOP_LEVEL_KEYS, '', droppedKeys);
  }

  if (!isPlainObject(source.pickup)) {
    pushError(errors, 'MISSING_REQUIRED', 'pickup', 'pickup is required');
  } else {
    data.pickup = readSide(
      source.pickup,
      'pickup',
      'INVALID_PICKUP_COORDINATES',
      errors,
      droppedKeys,
      stringCoordinates
    );
  }

  if (!isPlainObject(source.dropoff)) {
    pushError(errors, 'MISSING_REQUIRED', 'dropoff', 'dropoff is required');
  } else {
    data.dropoff = readSide(
      source.dropoff,
      'dropoff',
      'INVALID_DROPOFF_COORDINATES',
      errors,
      droppedKeys,
      stringCoordinates
    );
  }

  if (!isPlainObject(source.package)) {
    pushError(errors, 'MISSING_REQUIRED', 'package', 'package is required');
  } else {
    data.package = readPackage(source.package, errors, droppedKeys);
  }

  const vehicle = readVehicle(source.vehicle, errors, droppedKeys);
  if (vehicle) {
    data.vehicle = vehicle;
  }

  readOptionalString(source, 'paymentMethod', 'paymentMethod', 30, false, errors, data);
  readOptionalString(source, 'idempotencyKey', 'idempotencyKey', 200, false, errors, data);
  readDate(source, 'estimatedPickupTime', errors, data);
  readDate(source, 'estimatedDeliveryTime', errors, data);

  return {
    ok: errors.length === 0,
    data,
    errors,
    droppedKeys,
    stringCoordinates
  };
}

module.exports = {
  sanitizeParcelBookingInput
};
