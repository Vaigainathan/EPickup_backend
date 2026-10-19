const { locationFromFix } = require('../src/services/marketplace/customerDriverLocation');

describe('customerDriverLocation.locationFromFix', () => {
  const linkedBookingId = 'booking-1';
  const now = Date.now();

  test('reads flat latitude and longitude', () => {
    const result = locationFromFix(
      {
        bookingId: linkedBookingId,
        latitude: 12.5,
        longitude: 78.5,
        lastUpdated: new Date(now - 1000)
      },
      linkedBookingId,
      now
    );
    expect(result).toEqual({
      lat: 12.5,
      lng: 78.5,
      updatedAt: new Date(now - 1000).toISOString()
    });
  });

  test('reads currentLocation.latitude and currentLocation.longitude', () => {
    const result = locationFromFix(
      {
        bookingId: linkedBookingId,
        currentLocation: {
          latitude: 12.6,
          longitude: 78.6
        },
        lastUpdated: new Date(now - 500)
      },
      linkedBookingId,
      now
    );
    expect(result).toMatchObject({ lat: 12.6, lng: 78.6 });
  });

  test('returns null when bookingId mismatches', () => {
    const result = locationFromFix(
      {
        bookingId: 'other',
        currentLocation: { latitude: 1, longitude: 2 },
        lastUpdated: new Date(now)
      },
      linkedBookingId,
      now
    );
    expect(result).toBeNull();
  });
});
