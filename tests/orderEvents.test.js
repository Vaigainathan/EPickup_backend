const { EVENT_TYPES, appendEvent } = require('../src/services/marketplace/orderEvents');

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
  'refund_created',
  'refund_upi',
  'refund_sent',
  'refund_ack',
  'refund_disputed',
  'refund_auto_closed',
  'refund_reminder',
  'marked_ready',
  'delivery_stage',
  'handed_over',
  'delivered',
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

  test('a known type writes events/{autoId}', () => {
    const eventRef = { id: 'evt-1' };
    const orderRef = {
      collection: jest.fn(() => ({
        doc: jest.fn(() => eventRef)
      }))
    };
    const transaction = { set: jest.fn() };

    const id = appendEvent(transaction, orderRef, {
      type: 'created',
      actor: { type: 'customer', id: 'cust-1', operator: 'app' },
      data: { orderId: 'ord-1' },
      reason: 'placed'
    });

    expect(id).toBe('evt-1');
    expect(orderRef.collection).toHaveBeenCalledWith('events');
    expect(transaction.set).toHaveBeenCalledWith(eventRef, expect.objectContaining({
      type: 'created',
      actor: { type: 'customer', id: 'cust-1', operator: 'app' },
      data: { orderId: 'ord-1' },
      reason: 'placed'
    }));
    expect(transaction.set.mock.calls[0][1].at).toBeDefined();
  });
});
