const {
  confirmRequestBody,
  shortCancelRefundPreview,
  refundStubAmount,
  reviewScriptWrites,
  buildOrderShow
} = require('../scripts/support/marketplaceStagingActions');

describe('staging confirm body', () => {
  test('a short order uses the last 4 of the balance UTR', () => {
    const result = confirmRequestBody({
      payment: {
        status: 'short',
        customerUtr: '123456789012',
        balance: { utr: '555555555555' }
      }
    });
    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ utrLast4: '5555', withinWindowAttested: true });
    expect(result.logBody.source).toBe('balance');
    expect(JSON.stringify(result.logBody)).not.toContain('555555555555');
  });

  test('a short order with no balance UTR requires --full-utr', () => {
    const missing = confirmRequestBody({
      payment: { status: 'short', customerUtr: '123456789012', balance: { utr: null } }
    });
    expect(missing.ok).toBe(false);

    const typed = confirmRequestBody({
      payment: { status: 'short', balance: { utr: null } },
      fullUtr: '999999999999'
    });
    expect(typed.body).toEqual({ fullUtr: '999999999999', withinWindowAttested: true });
    expect(typed.logBody).toEqual({ fullUtrLast4: '9999', withinWindowAttested: true });
    expect(JSON.stringify(typed.logBody)).not.toContain('999999999999');
  });

  test('a normal confirm still uses the customer UTR', () => {
    const result = confirmRequestBody({
      payment: { status: 'customer_claimed', customerUtr: '123456789012' }
    });
    expect(result.body.utrLast4).toBe('9012');
    expect(result.logBody.source).toBe('customer');
  });
});

describe('short cancel refund amount', () => {
  test('dry run shows the received amount and the stored stub is the printed amount', () => {
    expect(shortCancelRefundPreview({ status: 'short', receivedAmount: 40 })).toBe(40);
    expect(shortCancelRefundPreview({ status: 'pending', receivedAmount: 40 })).toBeNull();
    expect(refundStubAmount([
      { reason: 'overpaid', amount: 10 },
      { reason: 'amount_short_cancel', amount: 40 }
    ])).toBe(40);
    expect(refundStubAmount([])).toBeNull();
  });
});

describe('resolve-payment-review writes', () => {
  test('--list and a dry run write nothing', () => {
    expect(reviewScriptWrites({ list: true, apply: true })).toBe(false);
    expect(reviewScriptWrites({ list: true, apply: false })).toBe(false);
    expect(reviewScriptWrites({ list: false, apply: false })).toBe(false);
    expect(reviewScriptWrites({ list: false, apply: true })).toBe(true);
  });

  test('show payload keeps the UTR last 4 and omits the note, evidence ids, and storage path', () => {
    const shown = buildOrderShow({
      orderId: 'order-1',
      data: {
        displayId: 11,
        orderStatus: 'payment_review',
        payment: {
          status: 'under_review',
          customerUtr: '246813579024',
          review: {
            status: 'open',
            trigger: 'customer_report',
            note: 'slip-note-secret',
            evidenceIds: ['ev-secret']
          }
        },
        storagePath: 'marketplaceOrders/order-1/evidence/ev-secret.jpg'
      },
      events: [{
        type: 'utr_submitted',
        actor: { type: 'customer', id: 'cust-1' },
        data: { utr: '246813579024', path: 'marketplaceOrders/order-1/evidence/ev-secret.jpg' },
        at: null
      }, {
        type: 'review_opened',
        actor: { type: 'customer', id: 'cust-1' },
        data: { trigger: 'customer_report' },
        at: null
      }],
      lock: null,
      unpaidCount: 0
    });
    const json = JSON.stringify(shown);
    expect(shown.payment.customerUtrLast4).toBe('9024');
    expect(shown.payment.customerUtr).toBeUndefined();
    expect(shown.review.trigger).toBe('customer_report');
    expect(shown.review.status).toBe('open');
    expect(json).not.toContain('246813579024');
    expect(json).not.toContain('slip-note-secret');
    expect(json).not.toContain('evidenceIds');
    expect(json).not.toContain('ev-secret');
    expect(json).not.toContain('marketplaceOrders/');
  });
});
