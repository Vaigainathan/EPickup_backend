const { last4 } = require('../src/services/receiptService');

describe('shop order receipt UTR display', () => {
  it('uses last 4 digits only for official UTR', () => {
    expect(last4('310000000212')).toBe('0212');
    expect(last4('310000000212')).not.toBe('310000000212');
  });
});
