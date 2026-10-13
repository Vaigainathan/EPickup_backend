const {
  computeCustomerRefundAction,
  orderRefundDenormPatch
} = require('../src/services/marketplace/refunds');

describe('computeCustomerRefundAction', () => {
  test('maps refund statuses to customer actions with share_upi winning', () => {
    expect(computeCustomerRefundAction([
      { id: 'a', data: { status: 'due' } },
      { id: 'b', data: { status: 'sent' } }
    ])).toBe('confirm_received');
    expect(computeCustomerRefundAction([
      { id: 'a', data: { status: 'upi_needed' } },
      { id: 'b', data: { status: 'sent' } }
    ])).toBe('share_upi');
    expect(computeCustomerRefundAction([
      { id: 'a', data: { status: 'confirmed' } },
      { id: 'b', data: { status: 'closed' } }
    ])).toBeNull();
    expect(computeCustomerRefundAction([
      { id: 'a', data: { status: 'disputed' } }
    ])).toBeNull();
  });
});

describe('orderRefundDenormPatch', () => {
  test('writes customerRefundAction and hasOpenRefund together', () => {
    const patch = orderRefundDenormPatch(
      { orderStatus: 'cancelled' },
      [{ id: 'r1', data: { status: 'sent' } }]
    );
    expect(patch).toEqual({
      hasOpenRefund: true,
      customerRefundAction: 'confirm_received',
      'payment.status': 'refund_pending'
    });
    const closed = orderRefundDenormPatch(
      { orderStatus: 'cancelled' },
      [{ id: 'r1', data: { status: 'confirmed' } }]
    );
    expect(closed.hasOpenRefund).toBe(false);
    expect(closed.customerRefundAction).toBeNull();
    expect(closed['payment.status']).toBe('refunded');
  });
});
