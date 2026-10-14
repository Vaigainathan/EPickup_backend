const { planReconcileBooking } = require('../../scripts/support/lib/marketplaceStagingDriver');

describe('planReconcileBooking idempotent align (F2)', () => {
  test('aligned completed order + delivered booking → action none, no patch', () => {
    const plan = planReconcileBooking(
      { orderStatus: 'completed' },
      { status: 'delivered', timing: { deliveredAt: new Date('2026-01-01T00:00:00Z') } }
    );
    expect(plan.action).toBe('none');
    expect(plan.noWrite).toBe(true);
    expect(plan.bookingPatch).toBeNull();
  });

  test('aligned completed order + completed booking → action none, no patch', () => {
    const plan = planReconcileBooking(
      { orderStatus: 'completed' },
      { status: 'completed' }
    );
    expect(plan.action).toBe('none');
    expect(plan.noWrite).toBe(true);
    expect(plan.bookingPatch).toBeNull();
  });

  test('aligned cancelled order + cancelled booking → action none, no patch', () => {
    const plan = planReconcileBooking(
      { orderStatus: 'cancelled' },
      { status: 'cancelled', cancelledAt: new Date() }
    );
    expect(plan.action).toBe('none');
    expect(plan.noWrite).toBe(true);
    expect(plan.bookingPatch).toBeNull();
  });

  test('pending booking on completed order → delivered patch (unchanged)', () => {
    const plan = planReconcileBooking(
      { orderStatus: 'completed' },
      { status: 'pending', timing: {} }
    );
    expect(plan.action).toBe('delivered');
    expect(plan.noWrite).toBe(false);
    expect(plan.bookingPatch).not.toBeNull();
    expect(plan.bookingPatch.status).toBe('delivered');
    expect(plan.bookingPatch.timing).toHaveProperty('deliveredAt');
  });
});
