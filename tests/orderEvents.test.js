const { EVENT_TYPES, appendEvent, touchOrderSignal } = require('../src/services/marketplace/orderEvents');

const BLUEPRINT_TYPES = [
  'created',
  'payment_details_issued',
  'utr_submitted',
  'utr_nudge',
  'reminder_sent',
  'shop_confirm',
  'utr_corrected',
  'amount_differs',
  'balance_utr',
  'balance_confirmed',
  'payment_confirmed_late',
  'unpaid_cancelled',
  'customer_cancel',
  'paid_check',
  'timed_out',
  'review_opened',
  'shop_response',
  'review_resolved',
  'review_escalated',
  'rejected',
  'cancelled',
  'items_unavailable',
  'stock_deducted',
  'stock_short',
  'stock_restored',
  'refund_created',
  'refund_upi',
  'refund_sent',
  'refund_ack',
  'refund_disputed',
  'refund_auto_closed',
  'refund_reminder',
  'refund_resent',
  'marked_ready',
  'delivery_stage',
  'handed_over',
  'completed',
  'delivered',
  'payment_refunded',
  'rated',
  'help_request',
  'help_resolved',
  'evidence_deleted'
];

describe('appendEvent', () => {
  test('EVENT_TYPES is the blueprint list', () => {
    expect(EVENT_TYPES).toEqual(BLUEPRINT_TYPES);
  });

  test('unknown type throws before a write', () => {
    const transaction = { set: jest.fn() };
    expect(() => appendEvent(transaction, {}, { type: 'payment_confirmed' })).toThrow(/Unknown marketplace event type/);
    expect(transaction.set).not.toHaveBeenCalled();
  });

  function orderRefFor() {
    const eventRef = { id: 'evt-1', path: 'marketplaceOrders/ord-1/events/evt-1' };
    const signalRef = { id: 'latest', path: 'marketplaceOrders/ord-1/signal/latest' };
    return {
      id: 'ord-1',
      path: 'marketplaceOrders/ord-1',
      collection: jest.fn((name) => ({
        doc: jest.fn(() => (name === 'signal' ? signalRef : eventRef))
      })),
      eventRef,
      signalRef
    };
  }

  test('a known type writes the event and a three-field signal', () => {
    const orderRef = orderRefFor();
    const transaction = { set: jest.fn() };

    const id = appendEvent(transaction, orderRef, {
      type: 'created',
      actor: { type: 'customer', id: 'cust-1', operator: 'app' },
      data: { orderId: 'ord-1' },
      reason: 'placed'
    }, 'cust-1');

    expect(id).toBe('evt-1');
    expect(orderRef.collection).toHaveBeenCalledWith('events');
    expect(orderRef.collection).toHaveBeenCalledWith('signal');
    expect(transaction.set).toHaveBeenCalledWith(orderRef.eventRef, expect.objectContaining({
      type: 'created',
      actor: { type: 'customer', id: 'cust-1', operator: 'app' },
      data: { orderId: 'ord-1' },
      reason: 'placed'
    }));
    const signal = transaction.set.mock.calls[1][1];
    expect(Object.keys(signal).sort()).toEqual(['customerId', 'type', 'updatedAt']);
    expect(signal).toMatchObject({ customerId: 'cust-1', type: 'created' });
    expect(signal.updatedAt).toBeDefined();
  });

  test('a second event in the same transaction does not write the signal again', () => {
    const orderRef = orderRefFor();
    const transaction = { set: jest.fn() };
    appendEvent(transaction, orderRef, {
      type: 'created',
      actor: { type: 'customer', id: 'cust-1' }
    }, 'cust-1');
    appendEvent(transaction, orderRef, {
      type: 'payment_details_issued',
      actor: { type: 'system', id: 'marketplace' }
    }, 'cust-1');
    const signalWrites = transaction.set.mock.calls.filter((call) => call[0] === orderRef.signalRef);
    expect(signalWrites).toHaveLength(1);
    expect(signalWrites[0][1].type).toBe('created');
    expect(transaction.set).toHaveBeenCalledTimes(3);
  });

  test('a missing customer id throws before a write', () => {
    const orderRef = orderRefFor();
    const transaction = { set: jest.fn() };
    expect(() => appendEvent(transaction, orderRef, { type: 'created' }, '  ')).toThrow(/customerId/);
    expect(transaction.set).not.toHaveBeenCalled();
  });

  test('touchOrderSignal writes only the three signal fields', () => {
    const orderRef = orderRefFor();
    const transaction = { set: jest.fn() };
    expect(touchOrderSignal(transaction, orderRef, 'cust-1', 'delivery_fare')).toBe(true);
    expect(touchOrderSignal(transaction, orderRef, 'cust-1', 'delivery_driver')).toBe(false);
    expect(transaction.set).toHaveBeenCalledTimes(1);
    expect(Object.keys(transaction.set.mock.calls[0][1]).sort()).toEqual(['customerId', 'type', 'updatedAt']);
    expect(transaction.set.mock.calls[0][1].type).toBe('delivery_fare');
  });
});
