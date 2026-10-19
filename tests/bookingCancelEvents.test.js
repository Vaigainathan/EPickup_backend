const {
  emitBookingCancelled,
  emitMarketplaceHandoverConfirmed
} = require('../src/services/bookingCancelEvents');

describe('bookingCancelEvents', () => {
  test('emitBookingCancelled targets driver user room and booking room', () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const io = { to };

    emitBookingCancelled(io, {
      driverId: 'driver-1',
      bookingId: 'booking-1',
      reason: 'test',
      cancelledBy: 'support'
    });

    expect(to).toHaveBeenCalledWith('user:driver-1');
    expect(to).toHaveBeenCalledWith('booking:booking-1');
    expect(emit).toHaveBeenCalledWith(
      'booking_cancelled',
      expect.objectContaining({
        bookingId: 'booking-1',
        cancelledBy: 'support'
      })
    );
  });

  test('emitMarketplaceHandoverConfirmed sends payload to driver room', () => {
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    const io = { to };

    emitMarketplaceHandoverConfirmed(io, {
      driverId: 'driver-1',
      bookingId: 'booking-1',
      marketplaceOrderId: 'order-1',
      displayId: 55
    });

    expect(to).toHaveBeenCalledWith('user:driver-1');
    expect(emit).toHaveBeenCalledWith('marketplace_handover_confirmed', {
      bookingId: 'booking-1',
      marketplaceOrderId: 'order-1',
      displayId: 55
    });
  });
});
