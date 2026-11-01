const {
  evaluateAdminMarketplaceCancel,
  canAdminCancelMarketplaceOrder
} = require('../src/services/marketplace/marketplaceAdminCancelPolicy');

describe('marketplaceAdminCancelPolicy', () => {
  test('allows handed_over when linked booking is pre-pickup', () => {
    const result = evaluateAdminMarketplaceCancel(
      { orderStatus: 'handed_over' },
      { status: 'driver_assigned', driverId: 'd1' }
    );
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
    expect(canAdminCancelMarketplaceOrder(
      { orderStatus: 'handed_over' },
      { status: 'driver_assigned' }
    )).toBe(true);
  });

  test('refuses when booking is past pickup', () => {
    const result = evaluateAdminMarketplaceCancel(
      { orderStatus: 'handed_over' },
      { status: 'picked_up', driverId: 'd1' }
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/pickup/i);
  });

  test('refuses completed orders', () => {
    const result = evaluateAdminMarketplaceCancel({ orderStatus: 'completed' }, null);
    expect(result.allowed).toBe(false);
  });
});
