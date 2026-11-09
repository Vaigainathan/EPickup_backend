const {
  driverStatusWorkflowService,
  DriverStatusError
} = require('../src/services/driverStatusWorkflowService');

describe('driverStatusWorkflowService radius rejection details', () => {
  test('OUTSIDE_CONFIRMATION_RADIUS attaches distanceMeters in details', () => {
    const booking = {
      pickup: { coordinates: { latitude: 12.9716, longitude: 77.5946 } }
    };
  const location = { latitude: 12.98, longitude: 77.5946 };

    expect(() => {
      driverStatusWorkflowService.ensureLocationRequirement('driver_arrived', booking, location);
    }).toThrow(DriverStatusError);

    try {
      driverStatusWorkflowService.ensureLocationRequirement('driver_arrived', booking, location);
    } catch (error) {
      expect(error.code).toBe('OUTSIDE_CONFIRMATION_RADIUS');
      expect(error.details).toEqual(
        expect.objectContaining({
          distanceMeters: expect.any(Number),
          limitMeters: 100,
          target: 'pickup'
        })
      );
    }
  });
});
