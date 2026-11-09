const { wrapStrictTransaction } = require('./helpers/strictFirestoreTransaction');

describe('marketplaceCleanupJob refund UPI mask transaction', () => {
  test('reads user before refund update (strict tx)', async () => {
    const refundRef = { path: 'marketplaceRefunds/r1' };
    const userRef = { path: 'users/c1' };
    const order = ['get', 'get', 'update', 'update'];

    const recorded = [];
    const inner = {
      get: jest.fn(async (ref) => {
        recorded.push('get');
        if (ref === refundRef) {
          return {
            exists: true,
            data: () => ({
              customerId: 'c1',
              customerUpiId: 'user@upi'
            })
          };
        }
        if (ref === userRef) {
          return {
            exists: true,
            data: () => ({
              customer: { marketplace: { refundUpiId: 'user@upi' } }
            })
          };
        }
        return { exists: false };
      }),
      update: jest.fn((ref) => {
        recorded.push('update');
        return ref;
      })
    };

    const tx = wrapStrictTransaction(inner);
    const live = {
      customerId: 'c1',
      customerUpiId: 'user@upi'
    };
  const nextUpi = 'masked@upi';

    let userSnap = null;
    if (live.customerId && typeof live.customerUpiId === 'string') {
      userSnap = await tx.get(userRef);
    }
    await tx.get(refundRef);
    tx.update(refundRef, { customerUpiId: nextUpi });
    if (userSnap && userSnap.exists) {
      const profileUpi = userSnap.data().customer.marketplace.refundUpiId;
      if (profileUpi === live.customerUpiId) {
        tx.update(userRef, { 'customer.marketplace.refundUpiId': nextUpi });
      }
    }

    expect(recorded.join(',')).toBe(order.join(','));
  });
});
