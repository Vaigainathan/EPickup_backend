const {
  HELD_KEYS,
  MARKETPLACE_DEFAULTS,
  planMarketplaceSettingsMerge
} = require('../src/config/marketplaceDefaults');

function actionFor(plan, key) {
  return plan.actions.find((entry) => entry.key === key);
}

describe('planMarketplaceSettingsMerge', () => {
  test('a missing document adds every non-held key and holds PAYMENT_TIMEOUT_MS', () => {
    const plan = planMarketplaceSettingsMerge(null);
    expect(plan.docExists).toBe(false);
    const held = actionFor(plan, 'PAYMENT_TIMEOUT_MS');
    expect(held.action).toBe('held');
    expect(held.line).toBe('held');
    expect(plan.payload).not.toHaveProperty('PAYMENT_TIMEOUT_MS');
    expect(Object.keys(plan.payload).sort()).toEqual(
      Object.keys(MARKETPLACE_DEFAULTS).filter((key) => !HELD_KEYS.includes(key)).sort()
    );
    expect(plan.payload.PAYMENT_GRACE_MINUTES).toBe(5);
    expect(plan.payload.REMINDER_MINUTES).toEqual([5, 10]);
  });

  test('a partial document keeps present keys and adds the rest', () => {
    const plan = planMarketplaceSettingsMerge({
      PAYMENT_GRACE_MINUTES: 9,
      RANKING_WEIGHTS: { rating: 1, popularity: 0, nearness: 0 }
    });
    expect(plan.docExists).toBe(true);
    expect(actionFor(plan, 'PAYMENT_GRACE_MINUTES')).toMatchObject({
      action: 'keep',
      line: 'kept (existing value: 9, default: 5)'
    });
    expect(actionFor(plan, 'UTR_NUDGE_MINUTES').action).toBe('add');
    expect(plan.payload).not.toHaveProperty('PAYMENT_GRACE_MINUTES');
    expect(plan.payload).not.toHaveProperty('RANKING_WEIGHTS');
    expect(plan.payload.UTR_NUDGE_MINUTES).toBe(3);
  });

  test('a full document keeps every key and adds none', () => {
    const existing = {
      ...MARKETPLACE_DEFAULTS,
      PAYMENT_GRACE_MINUTES: 1
    };
    const plan = planMarketplaceSettingsMerge(existing);
    expect(plan.payload).toEqual({});
    expect(actionFor(plan, 'PAYMENT_GRACE_MINUTES').line).toBe(
      'kept (existing value: 1, default: 5)'
    );
    expect(actionFor(plan, 'HELP_WINDOW_HOURS_A').line).toBe('kept (existing value: 2)');
    expect(plan.actions.filter((entry) => entry.action === 'add')).toEqual([]);
  });

  test('a missing held key is held and is not in the payload', () => {
    const plan = planMarketplaceSettingsMerge({});
    expect(actionFor(plan, 'PAYMENT_TIMEOUT_MS')).toMatchObject({
      action: 'held',
      line: 'held'
    });
    expect(Object.keys(plan.payload)).not.toContain('PAYMENT_TIMEOUT_MS');
  });

  test('a present held key reports held (exists) and is not in the payload', () => {
    const plan = planMarketplaceSettingsMerge({
      PAYMENT_TIMEOUT_MS: 900000
    });
    expect(actionFor(plan, 'PAYMENT_TIMEOUT_MS')).toMatchObject({
      action: 'held',
      line: 'held (exists: 900000)'
    });
    expect(plan.payload).not.toHaveProperty('PAYMENT_TIMEOUT_MS');
  });
});
