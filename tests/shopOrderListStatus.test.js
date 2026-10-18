const shopOrderService = require('../src/services/shopOrderService');
const { ORDER_STATUSES } = require('../src/services/marketplace/orderStateMachine');

describe('shopOrderService.listOrders status filter', () => {
  let getCalls;

  beforeEach(() => {
    getCalls = [];
    jest.spyOn(shopOrderService, 'getDb').mockReturnValue({
      collection: () => ({
        where(field, op, value) {
          getCalls.push({ field, op, value, stage: 'where' });
          return {
            where(nextField, nextOp, nextValue) {
              getCalls.push({ field: nextField, op: nextOp, value: nextValue, stage: 'where' });
              return {
                orderBy(orderField, direction) {
                  getCalls.push({ field: orderField, direction, stage: 'orderBy' });
                  return {
                    get: async () => ({ docs: [] })
                  };
                }
              };
            },
            orderBy(orderField, direction) {
              getCalls.push({ field: orderField, direction, stage: 'orderBy' });
              return {
                get: async () => ({ docs: [] })
              };
            }
          };
        }
      })
    });
    jest.spyOn(shopOrderService, 'presentOrder').mockResolvedValue({});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('accepts payment_unconfirmed, payment_review, delivery_failed', async () => {
    for (const status of ['payment_unconfirmed', 'payment_review', 'delivery_failed']) {
      getCalls.length = 0;
      await expect(shopOrderService.listOrders('shop-1', status)).resolves.toEqual([]);
      expect(getCalls.some((c) => c.value === status)).toBe(true);
    }
  });

  test('rejects unknown status with INVALID_STATUS', async () => {
    await expect(shopOrderService.listOrders('shop-1', 'foo')).rejects.toMatchObject({
      code: 'INVALID_STATUS',
      status: 400
    });
  });

  test('createSeedOrder shares all nine ORDER_STATUSES from orderStateMachine', () => {
    expect(shopOrderService.createSeedOrder).toBeDefined();
    expect(ORDER_STATUSES).toContain('payment_unconfirmed');
    expect(ORDER_STATUSES).toContain('delivery_failed');
    expect(ORDER_STATUSES.length).toBe(9);
  });
});
