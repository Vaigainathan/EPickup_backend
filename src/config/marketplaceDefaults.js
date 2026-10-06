const HELD_KEYS = ['PAYMENT_TIMEOUT_MS'];

const MARKETPLACE_DEFAULTS = {
  PAYMENT_TIMEOUT_MS: 900000,
  PAYMENT_GRACE_MINUTES: 5,
  UTR_NUDGE_MINUTES: 3,
  REMINDER_MINUTES: [5, 10],
  UTR_ACCEPT_HOURS: 24,
  UNCONFIRMED_AUTO_CLOSE_HOURS: 24,
  BALANCE_WINDOW_MINUTES: 15,
  PAID_CHECK_ESCALATE_HOURS: 24,
  REFUND_DUE_HOURS: 24,
  REFUND_ESCALATE_HOURS: 48,
  REFUND_ACK_REMINDER_HOURS: 24,
  REFUND_ACK_AUTO_CLOSE_HOURS: 48,
  POLICY_GROUP_A: ['Food & Restaurants', 'Meat & Seafood', 'Gifts, Flowers & Accessories'],
  HELP_WINDOW_HOURS_A: 2,
  HELP_ALERT_MINUTES: 30,
  DRIVER_SLOW_MINUTES: 15,
  EVIDENCE_RETENTION_DAYS: 90,
  MAX_UNPAID_ORDERS_PER_CUSTOMER: 2,
  MAX_ORDER_LINES: 30,
  MAX_QTY_PER_LINE: 50,
  LOW_STOCK_LABEL_MAX: 5,
  RANKING_WEIGHTS: { rating: 0.4, popularity: 0.3, nearness: 0.3 },
  NEW_SHOP_BOOST_DAYS: 30,
  RATING_PRIOR_WEIGHT: 5,
  ORDER_NUMBER_ALERT_RATIO: 0.8,
  MARKETPLACE_ENFORCEMENT: { newStatuses: false, utrBlocksReject: false }
};

function formatValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableValue(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(left, right) {
  return stableValue(left) === stableValue(right);
}

function planMarketplaceSettingsMerge(existingData) {
  const docExists = Boolean(existingData) && typeof existingData === 'object';
  const source = docExists ? existingData : {};
  const actions = [];
  const payload = {};

  Object.keys(MARKETPLACE_DEFAULTS).forEach((key) => {
    const defaultValue = MARKETPLACE_DEFAULTS[key];
    const present = Object.prototype.hasOwnProperty.call(source, key);

    if (HELD_KEYS.includes(key)) {
      if (present) {
        actions.push({
          key,
          action: 'held',
          exists: true,
          existingValue: source[key],
          line: `held (exists: ${formatValue(source[key])})`
        });
      } else {
        actions.push({
          key,
          action: 'held',
          exists: false,
          line: 'held'
        });
      }
      return;
    }

    if (present) {
      const differs = !valuesEqual(source[key], defaultValue);
      actions.push({
        key,
        action: 'keep',
        existingValue: source[key],
        defaultValue,
        differs,
        line: differs
          ? `kept (existing value: ${formatValue(source[key])}, default: ${formatValue(defaultValue)})`
          : `kept (existing value: ${formatValue(source[key])})`
      });
      return;
    }

    actions.push({
      key,
      action: 'add',
      defaultValue,
      line: `add ${formatValue(defaultValue)}`
    });
    payload[key] = defaultValue;
  });

  return { docExists, actions, payload };
}

module.exports = {
  HELD_KEYS,
  MARKETPLACE_DEFAULTS,
  planMarketplaceSettingsMerge,
  formatValue
};
