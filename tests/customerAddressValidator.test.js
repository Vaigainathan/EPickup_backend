const {
  parseCustomerAddressBody,
  mapLegacyAddressAliases,
  applySingleDefault,
  addressLimitExceeded,
  validateIndianMobile,
  MAX_SAVED_ADDRESSES
} = require('../src/validators/customerAddress');

describe('customerAddress validator', () => {
  test('keeps allowed keys and drops unknown keys', () => {
    const result = parseCustomerAddressBody({
      address: '12 Main Street, Tirupattur',
      name: 'Home',
      type: 'home',
      extraField: 'ignored',
      hacker: true
    }, { mode: 'create' });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      address: '12 Main Street, Tirupattur',
      name: 'Home',
      type: 'home'
    });
    expect(result.value.extraField).toBeUndefined();
  });

  test('maps legacy text alias to address on create', () => {
    const mapped = mapLegacyAddressAliases({ text: 'Legacy line' });
    expect(mapped.address).toBe('Legacy line');
    const result = parseCustomerAddressBody({ text: 'Legacy line' }, { mode: 'create' });
    expect(result.ok).toBe(true);
    expect(result.value.address).toBe('Legacy line');
  });

  test('landmark is optional on create', () => {
    const result = parseCustomerAddressBody({
      address: 'Somewhere valid enough'
    }, { mode: 'create' });
    expect(result.ok).toBe(true);
    expect(result.value.landmark).toBeUndefined();
  });

  test('rejects invalid phone with field receiverPhone', () => {
    const result = parseCustomerAddressBody({
      address: 'Addr',
      receiverPhone: '12345'
    }, { mode: 'create' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('VALIDATION');
    expect(result.field).toBe('receiverPhone');
  });

  test('normalizes valid phone to +91 format', () => {
    const result = parseCustomerAddressBody({
      address: 'Addr',
      receiverPhone: '9876543210'
    }, { mode: 'create' });
    expect(result.ok).toBe(true);
    expect(result.value.receiverPhone).toBe('+919876543210');
    const direct = validateIndianMobile('9876543210');
    expect(direct.ok).toBe(true);
    expect(direct.value).toBe('+919876543210');
  });

  test('enforces length limits', () => {
    const result = parseCustomerAddressBody({
      address: 'x'.repeat(301)
    }, { mode: 'create' });
    expect(result.ok).toBe(false);
    expect(result.field).toBe('address');
  });

  test('validates coordinates when present', () => {
    const bad = parseCustomerAddressBody({
      address: 'Addr',
      coordinates: { latitude: 100, longitude: 0 }
    }, { mode: 'create' });
    expect(bad.ok).toBe(false);
    expect(bad.field).toBe('coordinates');

    const good = parseCustomerAddressBody({
      address: 'Addr',
      coordinates: { latitude: 12.49, longitude: 78.56 }
    }, { mode: 'create' });
    expect(good.ok).toBe(true);
    expect(good.value.coordinates).toEqual({ latitude: 12.49, longitude: 78.56 });
  });

  test('update allows isDefault-only partial body', () => {
    const result = parseCustomerAddressBody({ isDefault: true }, { mode: 'update' });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ isDefault: true });
  });

  test('applySingleDefault clears other defaults', () => {
    const rows = [
      { id: 'a', isDefault: true },
      { id: 'b', isDefault: false },
      { id: 'c', isDefault: true }
    ];
    const updated = applySingleDefault(rows, 2);
    expect(updated[0].isDefault).toBe(false);
    expect(updated[1].isDefault).toBe(false);
    expect(updated[2].isDefault).toBe(true);
  });

  test('address limit at max saved addresses', () => {
    const rows = Array.from({ length: MAX_SAVED_ADDRESSES }, (_, i) => ({ id: `addr_${i}` }));
    expect(addressLimitExceeded(rows)).toBe(true);
    expect(addressLimitExceeded(rows.slice(0, -1))).toBe(false);
  });
});
