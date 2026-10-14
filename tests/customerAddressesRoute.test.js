const {
  parseCustomerAddressBody,
  applySingleDefault,
  addressLimitExceeded,
  invalidateCustomerAddressCache,
  MAX_SAVED_ADDRESSES
} = require('../src/validators/customerAddress');

describe('customer address route helpers', () => {
  test('POST returns ADDRESS_LIMIT when at 20 addresses', () => {
    const addresses = Array.from({ length: MAX_SAVED_ADDRESSES }, (_, i) => ({
      id: `addr_${i}`,
      address: `Line ${i}`
    }));
    expect(addressLimitExceeded(addresses)).toBe(true);
  });

  test('single default after POST merge', () => {
    const existing = [
      { id: 'old', isDefault: true, address: 'Old' },
      { id: 'new', isDefault: true, address: 'New' }
    ];
    const updated = applySingleDefault(existing, 1);
    expect(updated[0].isDefault).toBe(false);
    expect(updated[1].isDefault).toBe(true);
  });

  test('isDefault-only PUT on legacy row', () => {
    const legacy = { id: 'legacy', text: 'Old text only', coordinates: { latitude: 1, longitude: 2 } };
    const patch = parseCustomerAddressBody({ isDefault: true }, { mode: 'update' });
    expect(patch.ok).toBe(true);
    const merged = { ...legacy, ...patch.value };
    expect(merged.text).toBe('Old text only');
    expect(merged.isDefault).toBe(true);
  });

  test('PUT cache invalidation helper calls cachingService.delete', async () => {
    const cachingService = {
      delete: jest.fn().mockResolvedValue(true)
    };
    await invalidateCustomerAddressCache('user-1', cachingService);
    expect(cachingService.delete).toHaveBeenCalledWith('addresses_user-1', 'memory');
  });
});
