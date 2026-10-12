const { MARKETPLACE_DEFAULTS } = require('../../config/marketplaceDefaults');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function ratioNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : fallback;
}

function readMp17Settings(source) {
  const data = source && typeof source === 'object' ? source : null;
  return {
    driverSlowMs: positiveNumber(
      data && data.DRIVER_SLOW_MINUTES,
      MARKETPLACE_DEFAULTS.DRIVER_SLOW_MINUTES
    ) * 60 * 1000,
    evidenceRetentionMs: positiveNumber(
      data && data.EVIDENCE_RETENTION_DAYS,
      MARKETPLACE_DEFAULTS.EVIDENCE_RETENTION_DAYS
    ) * DAY_MS,
    unattachedMaxAgeMs: DAY_MS,
    orderNumberAlertRatio: ratioNumber(
      data && data.ORDER_NUMBER_ALERT_RATIO,
      MARKETPLACE_DEFAULTS.ORDER_NUMBER_ALERT_RATIO
    )
  };
}

module.exports = {
  DAY_MS,
  HOUR_MS,
  readMp17Settings
};
