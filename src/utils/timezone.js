const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MIN_OFFSET_MINUTES = -720; // UTC+12
const MAX_OFFSET_MINUTES = 840;  // UTC-14

/**
 * Normalizes and validates the timezone offset minutes.
 * Falls back to 0 (UTC) if the input is missing or invalid.
 * @param {number|string|undefined|null} value
 * @returns {number}
 */
function normalizeOffset(value) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return 0;
  }

  if (parsed < MIN_OFFSET_MINUTES || parsed > MAX_OFFSET_MINUTES) {
    return 0;
  }

  return parsed;
}

/**
 * Resolves a date input coming from the client into UTC start/end boundaries
 * that reflect the driver's local day.
 *
 * @param {Object} params
 * @param {string} [params.date] ISO date (legacy support)
 * @param {string} [params.dateKey] YYYY-MM-DD local date string
 * @param {number|string} [params.timezoneOffsetMinutes] Minutes offset (Date.getTimezoneOffset())
 * @returns {{
 *   dateKey: string,
 *   timezoneOffsetMinutes: number,
 *   localDateParts: { year: number, month: number, day: number },
 *   startOfDay: Date,
 *   endOfDay: Date,
 *   referenceDate: Date
 * }}
 */
function resolveLocalDateInput({
  date,
  dateKey,
  timezoneOffsetMinutes
} = {}) {
  const offset = normalizeOffset(timezoneOffsetMinutes);

  let year;
  let month;
  let day;
  let resolvedDateKey = dateKey;

  if (resolvedDateKey && DATE_KEY_REGEX.test(resolvedDateKey)) {
    const parts = resolvedDateKey.split('-').map(Number);
    [year, month, day] = parts;
  } else {
    const fallbackDate = date ? new Date(date) : new Date();

    if (Number.isNaN(fallbackDate.getTime())) {
      throw new Error('Invalid date provided');
    }

    year = fallbackDate.getUTCFullYear();
    month = fallbackDate.getUTCMonth() + 1;
    day = fallbackDate.getUTCDate();

    resolvedDateKey = [
      year.toString().padStart(4, '0'),
      month.toString().padStart(2, '0'),
      day.toString().padStart(2, '0')
    ].join('-');
  }

  const startUtcMs =
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) +
    offset * 60 * 1000;
  const endUtcMs =
    Date.UTC(year, month - 1, day, 23, 59, 59, 999) +
    offset * 60 * 1000;

  const startOfDay = new Date(startUtcMs);
  const endOfDay = new Date(endUtcMs);

  return {
    dateKey: resolvedDateKey,
    timezoneOffsetMinutes: offset,
    localDateParts: { year, month, day },
    startOfDay,
    endOfDay,
    referenceDate: startOfDay
  };
}

module.exports = {
  resolveLocalDateInput,
  DATE_KEY_REGEX,
  normalizeOffset
};

