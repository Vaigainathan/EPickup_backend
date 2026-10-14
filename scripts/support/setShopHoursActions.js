const {
  WEEKDAYS,
  validateOpeningHours,
  isShopOpenNow,
  nextOpensAt,
  currentClosesAt
} = require('../../src/utils/shopOpeningHours');
const { assertStagingShopId } = require('./approveShopActions');

const DELETE_FIELD = '__DELETE__';

const DAY_ABBREV = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday'
};

const USAGE = 'Usage: node scripts/support/set-shop-hours.js --shop <id> (--show | --clear | --all HH:MM-HH:MM | --day <abbr> <HH:MM-HH:MM|closed> [...]) [--apply]';

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  const next = argv[index + 1];
  if (!next || next.startsWith('--')) {
    return '';
  }
  return next;
}

function parseTimeWindow(raw) {
  const text = String(raw || '').trim();
  const match = /^([01]?\d|2[0-3]):([0-5]\d)-([01]?\d|2[0-3]):([0-5]\d)$/.exec(text);
  if (!match) {
    throw new Error(`Invalid time window "${raw}". Expected HH:MM-HH:MM`);
  }
  const open = `${String(match[1]).padStart(2, '0')}:${match[2]}`;
  const close = `${String(match[3]).padStart(2, '0')}:${match[4]}`;
  return { open, close };
}

function resolveDayAbbrev(raw) {
  const key = String(raw || '').trim().toLowerCase();
  const day = DAY_ABBREV[key];
  if (!day) {
    throw new Error(`Invalid day "${raw}". Use mon, tue, wed, thu, fri, sat, or sun.`);
  }
  return day;
}

function parseDayPatches(argv) {
  const patches = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--day') {
      continue;
    }
    const abbrev = argv[index + 1];
    const value = argv[index + 2];
    if (!abbrev || abbrev.startsWith('--')) {
      throw new Error('--day requires a day abbreviation and a window or "closed".');
    }
    if (!value || value.startsWith('--')) {
      throw new Error('--day requires a day abbreviation and a window or "closed".');
    }
    const day = resolveDayAbbrev(abbrev);
    if (String(value).trim().toLowerCase() === 'closed') {
      patches.push({ day, closed: true });
    } else {
      const window = parseTimeWindow(value);
      patches.push({ day, closed: false, open: window.open, close: window.close });
    }
    index += 2;
  }
  return patches;
}

function parseSetShopHoursArgv(argv) {
  const shopId = argValue(argv, '--shop');
  const show = argv.includes('--show');
  const clear = argv.includes('--clear');
  const apply = argv.includes('--apply');
  const allRaw = argValue(argv, '--all');
  const dayPatches = parseDayPatches(argv);
  let allWindow = null;
  if (allRaw) {
    allWindow = parseTimeWindow(allRaw);
  }
  return {
    shopId,
    show,
    clear,
    apply,
    allWindow,
    dayPatches
  };
}

function validateArgvPlan(parsed) {
  if (!parsed.shopId) {
    return { ok: false, message: USAGE };
  }
  const lock = assertStagingShopId(parsed.shopId);
  if (!lock.ok) {
    return lock;
  }

  const hasDay = parsed.dayPatches.length > 0;
  const hasAll = parsed.allWindow != null;
  const hasClear = parsed.clear === true;
  const hasShow = parsed.show === true;

  if (hasShow && (hasClear || hasAll || hasDay)) {
    return { ok: false, message: '--show cannot be combined with --clear, --all, or --day.' };
  }

  if (hasClear && (hasAll || hasDay)) {
    return { ok: false, message: '--clear cannot be combined with --all or --day.' };
  }

  if (hasAll && hasDay) {
    return { ok: false, message: 'Pass either --all or --day, not both.' };
  }

  if (!hasShow && !hasClear && !hasAll && !hasDay) {
    return { ok: false, message: USAGE };
  }

  return { ok: true };
}

function fullWeekClosed() {
  const hours = {};
  for (let index = 0; index < WEEKDAYS.length; index += 1) {
    const day = WEEKDAYS[index];
    hours[day] = { closed: true };
  }
  return hours;
}

function cloneOpeningHours(currentHours) {
  if (currentHours == null) {
    return null;
  }
  const clone = {};
  for (let index = 0; index < WEEKDAYS.length; index += 1) {
    const day = WEEKDAYS[index];
    const entry = currentHours[day];
    if (entry && typeof entry === 'object') {
      clone[day] = { ...entry };
    } else {
      clone[day] = { closed: true };
    }
  }
  return clone;
}

function seedWeekFromCurrent(currentHours) {
  if (currentHours == null) {
    return fullWeekClosed();
  }
  return cloneOpeningHours(currentHours);
}

function daysDefaultedToClosed(currentHours, dayPatches) {
  if (currentHours != null || dayPatches.length === 0) {
    return [];
  }
  const patched = new Set(dayPatches.map((row) => row.day));
  return WEEKDAYS.filter((day) => !patched.has(day));
}

function applyDayPatches(week, dayPatches) {
  for (let index = 0; index < dayPatches.length; index += 1) {
    const patch = dayPatches[index];
    if (patch.closed) {
      week[patch.day] = { closed: true };
    } else {
      week[patch.day] = {
        closed: false,
        open: patch.open,
        close: patch.close
      };
    }
  }
}

function buildPlannedOpeningHours(parsed, currentHours) {
  if (parsed.show) {
    const hoursAfter = currentHours == null ? null : validateOpeningHours(cloneOpeningHours(currentHours));
    return {
      clear: false,
      hoursAfter,
      daysDefaultedToClosed: []
    };
  }

  if (parsed.clear) {
    return {
      clear: true,
      hoursAfter: null,
      daysDefaultedToClosed: []
    };
  }

  if (parsed.allWindow) {
    const week = fullWeekClosed();
    for (let index = 0; index < WEEKDAYS.length; index += 1) {
      const day = WEEKDAYS[index];
      week[day] = {
        closed: false,
        open: parsed.allWindow.open,
        close: parsed.allWindow.close
      };
    }
    return {
      clear: false,
      hoursAfter: validateOpeningHours(week),
      daysDefaultedToClosed: []
    };
  }

  const defaulted = daysDefaultedToClosed(currentHours, parsed.dayPatches);
  const week = seedWeekFromCurrent(currentHours);
  applyDayPatches(week, parsed.dayPatches);
  return {
    clear: false,
    hoursAfter: validateOpeningHours(week),
    daysDefaultedToClosed: defaulted
  };
}

function buildFirestoreUpdate({ clear, hoursAfter }) {
  if (clear) {
    return { 'storefront.openingHours': DELETE_FIELD };
  }
  return { 'storefront.openingHours': hoursAfter };
}

function serializeWritePayload(update) {
  if (!update) {
    return null;
  }
  const value = update['storefront.openingHours'];
  if (value === DELETE_FIELD) {
    return { 'storefront.openingHours': '<FieldValue.delete()>' };
  }
  return update;
}

function computeMarketplacePreview({ shopIdentity, openingHours, now = new Date() }) {
  const toggleOpen = shopIdentity && shopIdentity.isOpen === true;
  const isOpenNow = isShopOpenNow({ isOpen: toggleOpen, openingHours, now });
  const opensAt = isOpenNow ? null : nextOpensAt({ openingHours, now });
  const closesAt = isOpenNow && openingHours != null
    ? currentClosesAt({ openingHours, now })
    : null;
  return { isOpenNow, opensAt, closesAt };
}

module.exports = {
  DELETE_FIELD,
  DAY_ABBREV,
  USAGE,
  parseTimeWindow,
  parseSetShopHoursArgv,
  validateArgvPlan,
  seedWeekFromCurrent,
  buildPlannedOpeningHours,
  buildFirestoreUpdate,
  serializeWritePayload,
  computeMarketplacePreview,
  daysDefaultedToClosed
};
