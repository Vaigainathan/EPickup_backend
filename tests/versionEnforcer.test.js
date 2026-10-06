const { compareVersions, evaluateVersionPolicy } = require('../src/middleware/versionEnforcer');

describe('compareVersions', () => {
  test('compares patch numbers numerically', () => {
    expect(compareVersions('2.1.19', '2.1.9')).toBe(1);
    expect(compareVersions('2.1.9', '2.1.19')).toBe(-1);
  });

  test('compares minor numbers numerically', () => {
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1);
  });

  test('treats a missing patch as zero', () => {
    expect(compareVersions('2.1', '2.1.0')).toBe(0);
  });

  test('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  test('returns 0 when either side is empty, null, or undefined', () => {
    expect(compareVersions('', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '')).toBe(0);
    expect(compareVersions(null, '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', undefined)).toBe(0);
  });

  test('documents the current parser for non-numeric and extra segments', () => {
    expect(compareVersions('abc', '2.1.18')).toBe(-1);
    expect(compareVersions('2.1.x', '2.1.18')).toBe(-1);
    expect(compareVersions('2.1.19-beta', '2.1.18')).toBe(1);
    expect(compareVersions('2.1.18.1', '2.1.18')).toBe(0);
  });
});

describe('evaluateVersionPolicy', () => {
  const policy = {
    current: '2.0.0',
    minimum: '1.5.0',
    updateType: 'optional'
  };

  test('allows a policy that is missing current or minimum', () => {
    expect(evaluateVersionPolicy(null, '1.0.0')).toEqual({ action: 'allow' });
    expect(evaluateVersionPolicy({ minimum: '1.0.0' }, '1.0.0')).toEqual({ action: 'allow' });
    expect(evaluateVersionPolicy({ current: '1.0.0' }, '1.0.0')).toEqual({ action: 'allow' });
  });

  test('blocks a version below minimum', () => {
    expect(evaluateVersionPolicy(policy, '1.4.9')).toEqual({
      action: 'block',
      status: 426,
      code: 'VERSION_TOO_OLD'
    });
  });

  test('blocks a version below current when the update is mandatory', () => {
    expect(evaluateVersionPolicy({ ...policy, updateType: 'mandatory' }, '1.9.0')).toEqual({
      action: 'block',
      status: 426,
      code: 'UPDATE_REQUIRED'
    });
  });

  test('allows an optional update when the version is below current and at least the minimum', () => {
    expect(evaluateVersionPolicy(policy, '1.9.0')).toEqual({
      action: 'allow',
      reason: 'optional_update'
    });
  });

  test('allows a version equal to current', () => {
    expect(evaluateVersionPolicy(policy, '2.0.0')).toEqual({ action: 'allow' });
  });

  test('allows a version above current', () => {
    expect(evaluateVersionPolicy(policy, '2.1.0')).toEqual({ action: 'allow' });
  });

  test('allows a version equal to minimum and below current as an optional update', () => {
    expect(evaluateVersionPolicy(policy, '1.5.0')).toEqual({
      action: 'allow',
      reason: 'optional_update'
    });
  });

  test('allows a version below current when updateType is neither mandatory nor optional', () => {
    expect(evaluateVersionPolicy({ ...policy, updateType: 'suggested' }, '1.9.0')).toEqual({
      action: 'allow'
    });
  });

  test('blocks appVersion abc against minimum 2.1.18 because a non-numeric segment becomes 0', () => {
    expect(evaluateVersionPolicy({
      current: '2.1.18',
      minimum: '2.1.18',
      updateType: 'mandatory'
    }, 'abc')).toEqual({
      action: 'block',
      status: 426,
      code: 'VERSION_TOO_OLD'
    });
  });
});
