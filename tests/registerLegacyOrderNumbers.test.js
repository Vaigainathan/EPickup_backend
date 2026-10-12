const {
  normalizeDisplayId,
  planLegacyOrderNumberRegistration,
  registryMatches
} = require('../src/services/registerLegacyOrderNumbers');

describe('normalizeDisplayId', () => {
  test('accepts valid numbers and strings', () => {
    expect(normalizeDisplayId(48213)).toBe(48213);
    expect(normalizeDisplayId('#48213')).toBe(48213);
    expect(normalizeDisplayId('48213')).toBe(48213);
  });

  test('rejects out of range', () => {
    expect(normalizeDisplayId(9999)).toBeNull();
    expect(normalizeDisplayId(100000)).toBeNull();
  });
});

describe('planLegacyOrderNumberRegistration', () => {
  test('plans create for unregistered numbers', () => {
    const plan = planLegacyOrderNumberRegistration([
      { kind: 'parcel', refId: 'b1', number: 40011 },
      { kind: 'shop_order', refId: 'o1', number: 40012 }
    ], new Map());
    expect(plan.toCreate).toHaveLength(2);
    expect(plan.duplicates).toHaveLength(0);
    expect(plan.alreadyRegistered).toBe(0);
  });

  test('detects O15 duplicate claims', () => {
    const plan = planLegacyOrderNumberRegistration([
      { kind: 'parcel', refId: 'b1', number: 40011 },
      { kind: 'shop_order', refId: 'o1', number: 40011 }
    ], new Map());
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.toCreate).toHaveLength(0);
  });

  test('skips matching registry entries', () => {
    const registry = new Map([[40011, {
      kind: 'parcel',
      refId: 'b1',
      source: 'legacy'
    }]]);
    const plan = planLegacyOrderNumberRegistration([
      { kind: 'parcel', refId: 'b1', number: 40011 }
    ], registry);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.alreadyRegistered).toBe(1);
  });

  test('flags registry conflicts', () => {
    const registry = new Map([[40011, {
      kind: 'parcel',
      refId: 'other',
      source: 'legacy'
    }]]);
    const plan = planLegacyOrderNumberRegistration([
      { kind: 'parcel', refId: 'b1', number: 40011 }
    ], registry);
    expect(plan.conflicts).toHaveLength(1);
  });
});

describe('registryMatches', () => {
  test('matches legacy and pool sources when kind and refId align', () => {
    expect(registryMatches(
      { kind: 'parcel', refId: 'b1', source: 'pool' },
      { kind: 'parcel', refId: 'b1' }
    )).toBe(true);
  });
});
