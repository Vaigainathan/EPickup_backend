const mockWhereFilters = [];

function mockChainableQuery(getResult) {
  const query = {
    where(field, op, value) {
      mockWhereFilters.push({ field, op, value });
      return query;
    },
    get: async () => getResult()
  };
  return query;
}

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => ({
    collection: (name) => {
      if (name !== 'marketplaceOrders') {
        return mockChainableQuery(async () => ({ docs: [] }));
      }
      return mockChainableQuery(async () => ({
        docs: [{
          id: 'order-abc',
          data: () => ({
            displayId: 'DISP-99',
            customerSnapshot: { name: 'List Buyer', payerUpiName: null },
            hasOpenRefund: true
          }),
          ref: {
            collection: () => ({
              get: async () => ({
                docs: [{
                  id: 'refund-1',
                  data: () => ({
                    status: 'due',
                    amount: 50,
                    customerUpiId: 'buyer@upi'
                  })
                }]
              })
            })
          }
        }]
      }));
    }
  })
}));

const { listShopRefunds, presentShopRefund } = require('../src/services/marketplace/refunds');

describe('shop refunds list enrichment', () => {
  beforeEach(() => {
    mockWhereFilters.length = 0;
  });

  test('listShopRefunds adds displayId and customerName from parent order', async () => {
    const rows = await listShopRefunds('shop-1');
    expect(mockWhereFilters).toEqual([
      { field: 'shopId', op: '==', value: 'shop-1' },
      { field: 'hasOpenRefund', op: '==', value: true }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].displayId).toBe('DISP-99');
    expect(rows[0].customerName).toBe('List Buyer');
    expect(rows[0].orderId).toBe('order-abc');
  });

  test('presentShopRefund without order data leaves display fields null', () => {
    const row = presentShopRefund({ id: 'r1', status: 'due' }, 'order-1');
    expect(row.displayId).toBeNull();
    expect(row.customerName).toBeNull();
  });
});
