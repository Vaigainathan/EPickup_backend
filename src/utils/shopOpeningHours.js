const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
];

const DAY_KEY_SET = new Set(WEEKDAYS);

function openingHoursError(message, code = 'INVALID_OPENING_HOURS') {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}

function parseClock(value) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  if (!match) {
    return null;
  }
  return (Number(match[1]) * 60) + Number(match[2]);
}

function formatClock(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function validateOpeningHours(input) {
  if (input === null || input === undefined) {
    throw openingHoursError('openingHours is required');
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw openingHoursError('openingHours must be an object');
  }

  const keys = Object.keys(input);
  if (keys.length !== WEEKDAYS.length) {
    throw openingHoursError('openingHours must include monday through sunday');
  }

  for (let index = 0; index < WEEKDAYS.length; index += 1) {
    const day = WEEKDAYS[index];
    if (!Object.prototype.hasOwnProperty.call(input, day)) {
      throw openingHoursError(`openingHours missing ${day}`);
    }
  }

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    if (!DAY_KEY_SET.has(key)) {
      throw openingHoursError(`openingHours has invalid key: ${key}`);
    }
  }

  const normalized = {};
  for (let index = 0; index < WEEKDAYS.length; index += 1) {
    const day = WEEKDAYS[index];
    const entry = input[day];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw openingHoursError(`${day} must be an object`);
    }

    const entryKeys = Object.keys(entry);
    if (entry.closed === true) {
      for (let keyIndex = 0; keyIndex < entryKeys.length; keyIndex += 1) {
        const key = entryKeys[keyIndex];
        if (key !== 'closed') {
          throw openingHoursError(`${day} must only include closed when closed is true`);
        }
      }
      normalized[day] = { closed: true };
      continue;
    }

    if (entry.closed !== false && entry.closed !== undefined) {
      throw openingHoursError(`${day}.closed must be a boolean`);
    }

    const allowed = new Set(['closed', 'open', 'close']);
    for (let keyIndex = 0; keyIndex < entryKeys.length; keyIndex += 1) {
      const key = entryKeys[keyIndex];
      if (!allowed.has(key)) {
        throw openingHoursError(`${day} has invalid field: ${key}`);
      }
    }

    const open = parseClock(entry.open);
    const close = parseClock(entry.close);
    if (open == null || close == null) {
      throw openingHoursError(`${day} requires open and close when not closed`);
    }
    if (close <= open) {
      throw openingHoursError(`${day} close must be after open on the same day`);
    }

    normalized[day] = {
      closed: false,
      open: formatClock(open),
      close: formatClock(close)
    };
  }

  return normalized;
}

function istParts(now) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const parts = {};
  formatter.formatToParts(now).forEach((part) => {
    parts[part.type] = part.value;
  });
  let hour = Number(parts.hour);
  if (hour === 24) {
    hour = 0;
  }
  const minute = Number(parts.minute);
  return {
    weekday: String(parts.weekday || '').toLowerCase(),
    minutes: (hour * 60) + minute
  };
}

/**
 * Open toggle on users/{shopId}.shop — written by PUT /api/shop/status (shop.isOpen).
 * Not shops/{id}.isOpen (that field is not used by the backend).
 */
function shopOpenToggleIsOn(shopIdentity) {
  if (!shopIdentity || typeof shopIdentity !== 'object') {
    return false;
  }
  return shopIdentity.isOpen === true;
}

function openingHoursFromShopProfile(shopProfile) {
  if (!shopProfile || typeof shopProfile !== 'object') {
    return null;
  }
  const storefront = shopProfile.storefront;
  if (!storefront || typeof storefront !== 'object') {
    return null;
  }
  return storefront.openingHours !== undefined ? storefront.openingHours : null;
}

function isShopOpenForMarketplaceOrder({ shopIdentity, shopProfile, now = new Date() }) {
  return isShopOpenNow({
    isOpen: shopOpenToggleIsOn(shopIdentity),
    openingHours: openingHoursFromShopProfile(shopProfile),
    now
  });
}

function isShopOpenNow({ isOpen, openingHours, now = new Date() }) {
  if (isOpen !== true) {
    return false;
  }
  if (openingHours == null) {
    return true;
  }
  if (typeof openingHours !== 'object' || Array.isArray(openingHours)) {
    return false;
  }
  const clock = istParts(now);
  const today = openingHours[clock.weekday];
  if (!today || typeof today !== 'object') {
    return false;
  }

  // Legacy start/end shape fallback (same-day only, no overnight)
  const hasLegacy = today.start != null || today.end != null;
  const hasNew = today.closed != null || today.open != null || today.close != null;

  if (hasLegacy && !hasNew) {
    const start = parseClock(today.start);
    const end = parseClock(today.end);
    if (start == null || end == null) {
      return false;
    }
    if (end >= start) {
      return clock.minutes >= start && clock.minutes < end;
    }
    return false;
  }

  if (today.closed === true) {
    return false;
  }
  const open = parseClock(today.open);
  const close = parseClock(today.close);
  if (open == null || close == null) {
    return false;
  }
  if (close <= open) {
    return false;
  }
  return clock.minutes >= open && clock.minutes < close;
}

function dayOpenMinutes(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  if (entry.closed === true) {
    return null;
  }
  const hasLegacy = entry.start != null || entry.end != null;
  const hasNew = entry.closed != null || entry.open != null || entry.close != null;
  if (hasLegacy && !hasNew) {
    return parseClock(entry.start);
  }
  return parseClock(entry.open);
}

function istYmdFromDate(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const text = formatter.format(date);
  const [year, month, day] = text.split('-').map((part) => Number(part));
  return { year, month, day };
}

function istOpenIso(date, dayOffset, openMinutes) {
  const shifted = new Date(date.getTime() + dayOffset * 24 * 60 * 60 * 1000);
  const { year, month, day } = istYmdFromDate(shifted);
  const hour = Math.floor(openMinutes / 60);
  const minute = openMinutes % 60;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const min = String(minute).padStart(2, '0');
  return `${year}-${mm}-${dd}T${hh}:${min}:00+05:30`;
}

/**
 * Next scheduled opening from openingHours within 7 IST calendar days, or null.
 * Returns full ISO-8601 with +05:30 offset.
 */
function nextOpensAt({ openingHours, now = new Date() }) {
  if (openingHours == null || typeof openingHours !== 'object' || Array.isArray(openingHours)) {
    return null;
  }
  const nowMs = now.getTime();
  for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
    const shifted = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    const clock = istParts(shifted);
    const entry = openingHours[clock.weekday];
    const openMinutes = dayOpenMinutes(entry);
    if (openMinutes == null) {
      continue;
    }
    const candidate = istOpenIso(now, dayOffset, openMinutes);
    const candidateMs = Date.parse(candidate);
    if (Number.isFinite(candidateMs) && candidateMs > nowMs) {
      return candidate;
    }
  }
  return null;
}

module.exports = {
  WEEKDAYS,
  parseClock,
  formatClock,
  validateOpeningHours,
  istParts,
  shopOpenToggleIsOn,
  openingHoursFromShopProfile,
  isShopOpenForMarketplaceOrder,
  isShopOpenNow,
  nextOpensAt
};
