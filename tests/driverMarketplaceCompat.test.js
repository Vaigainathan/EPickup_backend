const {
  bookingStatusAllowsCompatHandedOver,
  DRIVER_ASSIGNED_COMPAT_STATUSES
} = require('../src/services/marketplace/marketplaceHandoverCompat');

describe('Driver 82 handedOver compat flag', () => {
  test('pending booking is not compat handed over', () => {
    expect(bookingStatusAllowsCompatHandedOver('pending')).toBe(false);
  });

  test('driver_assigned and later statuses are compat handed over', () => {
    expect(bookingStatusAllowsCompatHandedOver('driver_assigned')).toBe(true);
    expect(bookingStatusAllowsCompatHandedOver('driver_arrived')).toBe(true);
    expect(bookingStatusAllowsCompatHandedOver('photo_captured')).toBe(true);
    expect(DRIVER_ASSIGNED_COMPAT_STATUSES.has('in_transit')).toBe(true);
  });
});
