const {
  paymentDetailsAllowed,
  getCustomerPaymentDetails
} = require('../src/services/marketplace/customerOrderRead');
const { paymentDetailsFromStored } = require('../src/services/marketplace/createCustomerOrder');

describe('paymentDetailsAllowed', () => {
  it('allows awaiting_payment', () => {
    expect(paymentDetailsAllowed({ orderStatus: 'awaiting_payment' })).toBe(true);
  });

  it('allows short payment status', () => {
    expect(paymentDetailsAllowed({
      orderStatus: 'preparing',
      payment: { status: 'short' }
    })).toBe(true);
  });

  it('denies preparing without short', () => {
    expect(paymentDetailsAllowed({
      orderStatus: 'preparing',
      payment: { status: 'confirmed' }
    })).toBe(false);
  });
});

describe('getCustomerPaymentDetails', () => {
  const orderId = 'ord-pay-1';
  const customerId = 'cust-1';

  function mockDb(data) {
    return {
      collection() {
        return {
          doc() {
            return {
              async get() {
                return {
                  exists: Boolean(data),
                  data: () => data
                };
              }
            };
          }
        };
      }
    };
  }

  it('returns paymentDetailsFromStored for awaiting_payment', async () => {
    const stored = {
      customerId,
      orderStatus: 'awaiting_payment',
      expectedAmount: 100,
      payment: { shopUpiId: 'shop@upi', status: 'pending' },
      window: { start: new Date(), end: new Date() }
    };
    const details = await getCustomerPaymentDetails(mockDb(stored), customerId, orderId);
    expect(details).toEqual(paymentDetailsFromStored(stored));
  });

  it('throws INVALID_STATE when not eligible', async () => {
    const stored = {
      customerId,
      orderStatus: 'completed',
      payment: { status: 'confirmed' }
    };
    await expect(getCustomerPaymentDetails(mockDb(stored), customerId, orderId))
      .rejects
      .toMatchObject({ code: 'INVALID_STATE', status: 409 });
  });
});
