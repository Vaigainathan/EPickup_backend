const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'epickup-test' });
}

afterAll(async () => {
  await Promise.all(admin.apps.map((app) => app.delete()));
});

const fareCalculationService = require('../src/services/fareCalculationService');
const { fareFieldsFromCalculation } = require('../src/services/fareQuoteService');
const shopOrderService = require('../src/services/shopOrderService');

const DISTANCES_KM = [0.4, 1.0, 1.01, 1.4, 1.5, 1.6, 2.0, 2.5, 3.6, 10.3, 25.7, 176];
const PICKUP = { lat: 13.08, lng: 80.27 };
const DROPOFF = { lat: 13.09, lng: 80.28 };

function parcelQuoteFields(distanceAndFare) {
  return fareFieldsFromCalculation(distanceAndFare.fare, distanceAndFare.distanceKm);
}

function marketplaceFields(distanceAndFare) {
  return shopOrderService.marketplaceBookingFareFields(distanceAndFare.fare, distanceAndFare.distanceKm);
}

function resolveGrossOrderAmount(bookingData = {}) {
  const pricing = bookingData.pricing || {};
  const payment = bookingData.payment || {};
  const fare = bookingData.fare || {};
  const earnings = bookingData.earnings || {};
  const value = pricing.totalAmount
    ?? pricing.total
    ?? pricing.fare
    ?? pricing.grandTotal
    ?? pricing.totalFare
    ?? payment.amount
    ?? payment.total
    ?? fare.total
    ?? fare.grossFare
    ?? fare.amount
    ?? bookingData.driverEarnings
    ?? earnings.grossFare
    ?? earnings.totalCollected
    ?? bookingData.totalAmount
    ?? bookingData.amount
    ?? bookingData.price
    ?? 0;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

describe('marketplace fare parity with the parcel quote', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(DISTANCES_KM)('distance %s km matches the parcel quote fields', async (distanceKm) => {
    jest.spyOn(fareCalculationService, 'getDistanceFromGoogleMaps').mockResolvedValue(distanceKm);

    const quoted = await fareCalculationService.calculateDistanceAndFare(PICKUP, DROPOFF);
    const parcel = parcelQuoteFields(quoted);
    const marketplace = marketplaceFields(quoted);

    expect(marketplace).toEqual(parcel);
    expect(marketplace.fare.totalFare).toBe(parcel.fare.totalFare);
    expect(marketplace.fare.commission).toBe(parcel.fare.commission);
    expect(marketplace.fare.driverNet).toBe(parcel.fare.driverNet);
    expect(marketplace.fare.companyRevenue).toBe(parcel.fare.companyRevenue);
    expect(marketplace.pricing).toEqual(parcel.pricing);
    expect(marketplace.distance).toBe(parcel.distance);
    expect(marketplace.exactDistance).toBe(parcel.exactDistance);
    expect(marketplace.roundedDistance).toBe(parcel.roundedDistance);

    const deliveryFee = marketplace.fare.totalFare;
    const deliveryFare = marketplace.fare.totalFare;
    expect(deliveryFee).toBe(deliveryFare);
    expect(deliveryFare).toBe(marketplace.pricing.totalFare);
    expect(resolveGrossOrderAmount(marketplace)).toBe(marketplace.pricing.totalFare);
  });

  test('Google failure does not switch either path onto Haversine', async () => {
    const googleError = new Error('Routes API returned no distance');
    googleError.code = 'FARE_UNAVAILABLE';
    googleError.name = 'FareUnavailableError';
    const direct = jest.spyOn(fareCalculationService, 'calculateDirectDistance');
    jest.spyOn(fareCalculationService, 'getDistanceFromGoogleMaps').mockRejectedValue(googleError);

    await expect(fareCalculationService.calculateDistanceAndFare(PICKUP, DROPOFF)).rejects.toMatchObject({
      code: 'FARE_UNAVAILABLE'
    });
    await expect(fareCalculationService.calculateDistanceAndFare(PICKUP, DROPOFF)).rejects.toMatchObject({
      code: 'FARE_UNAVAILABLE'
    });
    expect(direct).not.toHaveBeenCalled();
  });

  test('a thrown calculation does not fall back to 5 km on the quote path', async () => {
    jest.spyOn(fareCalculationService, 'getDistanceFromGoogleMaps').mockRejectedValue(new Error('boom'));
    const fareSpy = jest.spyOn(fareCalculationService, 'calculateFare');

    await expect(fareCalculationService.calculateDistanceAndFare(PICKUP, DROPOFF)).rejects.toThrow('Failed to calculate fare');
    await expect(fareCalculationService.calculateDistanceAndFare(PICKUP, DROPOFF)).rejects.toThrow('Failed to calculate fare');
    expect(fareSpy).not.toHaveBeenCalledWith(5);
  });
});
