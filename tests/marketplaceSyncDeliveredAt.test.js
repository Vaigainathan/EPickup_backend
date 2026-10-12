const marketplaceSyncService = require('../src/services/marketplaceSyncService');

describe('marketplaceSyncService delivery timestamps', () => {
  it('sets deliveredAt when stage advances to delivered', () => {
    const booking = {
      status: 'delivered',
      timing: { deliveredAt: new Date('2026-10-01T10:00:00.000Z') }
    };
    const order = {
      orderStatus: 'handed_over',
      delivery: { stage: 'on_the_way' }
    };
    const plan = marketplaceSyncService.planDeliverySync(order, booking);
    expect(plan.stage).toBe('delivered');
    expect(plan.deliveredAt).toBeTruthy();
    expect(plan.complete).toBe(true);
    expect(plan.completedAt).toBeTruthy();
  });

  it('does not overwrite an existing delivery.deliveredAt', () => {
    const existing = new Date('2026-09-01T08:00:00.000Z');
    const booking = { status: 'delivered', timing: { deliveredAt: new Date('2026-10-01T10:00:00.000Z') } };
    const order = {
      orderStatus: 'handed_over',
      delivery: { stage: 'on_the_way', deliveredAt: existing }
    };
    const plan = marketplaceSyncService.planDeliverySync(order, booking);
    expect(plan.deliveredAt).toBeNull();
  });
});
