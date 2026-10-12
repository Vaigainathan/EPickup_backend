const { assertMarketplaceProfileNotRestricted } = require('../src/services/marketplace/customerMarketplaceRestriction');

describe('assertMarketplaceProfileNotRestricted', () => {
  it('throws a real 403 ACCOUNT_RESTRICTED Error', () => {
    let caught;
    try {
      assertMarketplaceProfileNotRestricted({
        restriction: { active: true, reason: 'test' }
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.status).toBe(403);
    expect(caught.code).toBe('ACCOUNT_RESTRICTED');
    expect(caught.message).toBe('This account cannot place marketplace orders');
  });

  it('allows when restriction inactive', () => {
    expect(() => assertMarketplaceProfileNotRestricted({
      restriction: { active: false }
    })).not.toThrow();
  });
});

describe('restricted customer refund UPI submit', () => {
  it('submitCustomerUpi is not blocked by restriction (create-only rule)', async () => {
    const { submitCustomerUpi } = require('../src/services/marketplace/refunds');
    expect(typeof submitCustomerUpi).toBe('function');
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '../src/services/marketplace/refunds.js'),
      'utf8'
    );
    expect(source).not.toContain('assertMarketplaceProfileNotRestricted');
    expect(source).not.toContain('ACCOUNT_RESTRICTED');
  });
});
