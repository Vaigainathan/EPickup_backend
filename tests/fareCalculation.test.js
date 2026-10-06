const fareCalculationService = require('../src/services/fareCalculationService');

describe('calculateFare totalFare', () => {
  test.each([
    [0.4, 10],
    [1.0, 10],
    [1.2, 15],
    [1.6, 20],
    [2.0, 20],
    [8.46, 85],
    [8.5, 90],
    [10.0, 100]
  ])('%s km → ₹%s', (km, totalFare) => {
    expect(fareCalculationService.calculateFare(km).totalFare).toBe(totalFare);
  });
});
