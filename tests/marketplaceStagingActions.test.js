const {
  confirmRequestBody,
  shortCancelRefundPreview,
  refundStubAmount
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
