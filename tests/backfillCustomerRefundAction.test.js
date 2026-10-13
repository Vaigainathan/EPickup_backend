const {
  computeForOrder,
  processOrder,
  runBackfill
} = require('../scripts/backfill-customer-refund-action');

describe('backfill-customer-refund-action', () => {
  test('computeForOrder matches refund rows', () => {
    expect(computeForOrder([
      { id: 'r1', data: { status: 'upi_needed' } }
    ])).toBe('share_upi');
  });

  test('dry-run processOrder does not write', async () => {
    const updates = [];
    const db = {
      collection() {
        return {
          doc(orderId) {
            return {
              id: orderId,
              async get() {
                return {
                  exists: true,
                  data: () => ({ customerRefundAction: null })
                };
              },
              async update(patch) {
                updates.push(patch);
              },
              collection() {
                return {
                  async get() {
                    return {
                      docs: [{
                        id: 'r1',
                        data: () => ({ status: 'sent' })
                      }]
                    };
                  }
                };
              }
            };
          }
        };
      }
    };
    const result = await processOrder(db, 'order-1', false);
    expect(result.changed).toBe(true);
    expect(result.after).toBe('confirm_received');
    expect(updates).toEqual([]);
  });

  test('runBackfill apply=false never calls update', async () => {
    let updateCount = 0;
    const db = {
      collection() {
        return {
          orderBy() {
            return this;
          },
          limit() {
            return this;
          },
          async get() {
            return {
              empty: false,
              size: 1,
              docs: [{ id: 'order-x' }]
            };
          },
          doc(orderId) {
            return {
              async get() {
                return {
                  exists: true,
                  data: () => ({ customerRefundAction: 'share_upi' })
                };
              },
              async update() {
                updateCount += 1;
              },
              collection() {
                return {
                  async get() {
                    return {
                      docs: [{ id: 'r1', data: () => ({ status: 'due' }) }]
                    };
                  }
                };
              }
            };
          }
        };
      }
    };
    const summary = await runBackfill(db, { apply: false, orderId: 'order-x' });
    expect(summary.scanned).toBe(1);
    expect(updateCount).toBe(0);
  });
});
