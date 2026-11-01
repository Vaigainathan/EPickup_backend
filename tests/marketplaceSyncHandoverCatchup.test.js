jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true }))
}));

const marketplaceSyncService = require('../src/services/marketplaceSyncService');
const { orderNeedsHandoverCatchup } = require('../src/services/marketplace/marketplaceHandoverCompat');

describe('marketplace sync handover catchup plan', () => {
  test('orderNeedsHandoverCatchup when booking picked up but order ready', () => {
    expect(orderNeedsHandoverCatchup({ orderStatus: 'ready' }, 'picked_up')).toBe(true);
    expect(orderNeedsHandoverCatchup({ orderStatus: 'handed_over' }, 'picked_up')).toBe(false);
  });

  test('planDeliverySync sets catchupHandover', () => {
    const plan = marketplaceSyncService.planDeliverySync(
      { orderStatus: 'ready', delivery: { stage: 'at_shop' } },
      { status: 'in_transit', driverInfo: { name: 'D', phone: '1', vehicleNumber: 'X' } }
    );
    expect(plan.catchupHandover).toBe(true);
  });
});
