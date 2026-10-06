const {
  planCustomerActiveCancel,
  activeCancelHttp,
  customerCancelRefusal
} = require('../src/constants/bookingStatuses');

describe('planCustomerActiveCancel', () => {
  test('pending is cancelled', () => {
    expect(planCustomerActiveCancel('pending')).toEqual({ action: 'cancel' });
  });

  test('driver_enroute is cancelled', () => {
    expect(planCustomerActiveCancel('driver_enroute')).toEqual({ action: 'cancel' });
  });

  test('picked_up is refused with the shared cancel body', () => {
    const plan = planCustomerActiveCancel('picked_up');
    expect(plan.action).toBe('refuse');
    expect(activeCancelHttp({ success: false, outcome: 'refuse', refusal: plan.refusal })).toEqual({
      status: 400,
      body: customerCancelRefusal('picked_up').body
    });
    expect(plan.refusal.body).toEqual({
      success: false,
      error: 'Cannot cancel this booking',
      code: 'CANCELLATION_NOT_ALLOWED',
      message: 'Cancellation is not allowed once the driver has picked up your order. Please contact support if you have an issue.'
    });
  });

  test('delivered is not a blocking status and the route returns 404', () => {
    expect(planCustomerActiveCancel('delivered')).toEqual({ action: 'not_blocking' });
    expect(activeCancelHttp({ success: false, outcome: 'not_blocking' })).toEqual({
      status: 404,
      body: {
        success: false,
        error: 'No parcel booking to cancel',
        code: 'NO_BLOCKING_BOOKING'
      }
    });
  });
});
