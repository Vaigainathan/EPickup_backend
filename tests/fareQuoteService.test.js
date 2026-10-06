const {
  COORD_TOLERANCE,
  validateQuoteForBooking,
  quoteFailureBody,
  parseFareQuoteRequest,
  fareFieldsFromCalculation,
  FareQuoteTransactionError
} = require('../src/services/fareQuoteService');
const fareCalculationService = require('../src/services/fareCalculationService');

const now = Date.parse('2026-10-06T10:00:00.000Z');
const later = now + 60 * 1000;

function activeQuote(overrides = {}) {
  return {
    customerId: 'customer-1',
    pickup: { latitude: 12.9716, longitude: 77.5946 },
    dropoff: { latitude: 13.0827, longitude: 80.2707 },
    status: 'active',
    expiresAt: later,
    usedByBookingId: null,
    usedByIdempotencyKey: null,
    ...overrides
  };
}

function requestFor(overrides = {}) {
  return {
    customerId: 'customer-1',
    pickup: { latitude: 12.9716, longitude: 77.5946 },
    dropoff: { latitude: 13.0827, longitude: 80.2707 },
    idempotencyKey: 'key-1',
    now,
    ...overrides
  };
}

describe('validateQuoteForBooking', () => {
  test('missing quote is 400', () => {
    expect(validateQuoteForBooking(null, requestFor())).toEqual({
      ok: false,
      status: 400,
      code: 'FARE_QUOTE_INVALID',
      reason: 'missing'
    });
  });

  test('another customer is 400', () => {
    expect(validateQuoteForBooking(activeQuote(), requestFor({ customerId: 'other' })).reason)
      .toBe('customer_mismatch');
  });

  test('coordinate mismatch just past tolerance is 400', () => {
    const quote = activeQuote({
      pickup: { latitude: 13 + (COORD_TOLERANCE * 2), longitude: 77.5946 }
    });
    expect(validateQuoteForBooking(quote, requestFor({
      pickup: { latitude: 13, longitude: 77.5946 }
    })).reason).toBe('coordinate_mismatch');
  });

  test('coordinate delta equal to tolerance is accepted', () => {
    const quote = activeQuote({
      dropoff: { latitude: 13 + COORD_TOLERANCE, longitude: 80 }
    });
    expect(validateQuoteForBooking(quote, requestFor({
      dropoff: { latitude: 13, longitude: 80 }
    }))).toEqual({ ok: true });
  });

  test('used quote with the same key is a reuse even when expired', () => {
    const quote = activeQuote({
      status: 'used',
      expiresAt: now - 1,
      usedByBookingId: 'booking-9',
      usedByIdempotencyKey: 'key-1'
    });
    expect(validateQuoteForBooking(quote, requestFor())).toEqual({
      ok: true,
      reuse: true,
      bookingId: 'booking-9'
    });
  });

  test('used quote with no request key is already_used', () => {
    const quote = activeQuote({
      status: 'used',
      usedByBookingId: 'booking-9',
      usedByIdempotencyKey: 'key-1'
    });
    expect(validateQuoteForBooking(quote, requestFor({ idempotencyKey: undefined })).reason)
      .toBe('already_used');
  });

  test('used quote with both keys absent is already_used', () => {
    const quote = activeQuote({
      status: 'used',
      usedByBookingId: 'booking-9',
      usedByIdempotencyKey: null
    });
    expect(validateQuoteForBooking(quote, requestFor({ idempotencyKey: undefined })).reason)
      .toBe('already_used');
  });

  test('used quote with a different key is already_used', () => {
    const quote = activeQuote({
      status: 'used',
      usedByBookingId: 'booking-9',
      usedByIdempotencyKey: 'other-key'
    });
    expect(validateQuoteForBooking(quote, requestFor()).reason).toBe('already_used');
  });

  test('now equal to expiresAt is 410', () => {
    const quote = activeQuote({ expiresAt: now });
    expect(validateQuoteForBooking(quote, requestFor())).toEqual({
      ok: false,
      status: 410,
      code: 'FARE_QUOTE_EXPIRED'
    });
  });

  test('an active quote before expiry is ok', () => {
    expect(validateQuoteForBooking(activeQuote(), requestFor())).toEqual({ ok: true });
  });

  test('a Firestore-like timestamp is comparable', () => {
    const quote = activeQuote({
      expiresAt: { toMillis: () => later }
    });
    expect(validateQuoteForBooking(quote, requestFor())).toEqual({ ok: true });
  });
});

describe('quoteFailureBody', () => {
  test('maps expiry and invalid reasons to the flat body', () => {
    expect(quoteFailureBody({ status: 410, code: 'FARE_QUOTE_EXPIRED' })).toEqual({
      status: 410,
      body: {
        success: false,
        error: 'Fare quote expired',
        details: 'This fare quote has expired. Request a new price and try again.',
        code: 'FARE_QUOTE_EXPIRED'
      }
    });
    expect(quoteFailureBody({ status: 400, code: 'FARE_QUOTE_INVALID', reason: 'already_used' }).body)
      .toMatchObject({
        success: false,
        error: 'Fare quote invalid',
        code: 'FARE_QUOTE_INVALID'
      });
  });

  test('FareQuoteTransactionError carries the mapped body', () => {
    const error = new FareQuoteTransactionError({
      ok: false,
      status: 400,
      code: 'FARE_QUOTE_INVALID',
      reason: 'already_used'
    });
    expect(error.status).toBe(400);
    expect(error.body.code).toBe('FARE_QUOTE_INVALID');
    expect(error.body.error).toBe('Fare quote invalid');
  });
});

describe('parseFareQuoteRequest', () => {
  const valid = {
    pickup: { coordinates: { latitude: 12.9716, longitude: 77.5946 } },
    dropoff: { coordinates: { latitude: 0, longitude: 80.2707 } },
    package: { weight: 0.1 },
    vehicle: { type: '2_wheeler' },
    ignored: true
  };

  test('accepts finite coordinates including zero and ignores unknown keys', () => {
    const result = parseFareQuoteRequest(valid);
    expect(result.ok).toBe(true);
    expect(result.data.pickup).toEqual({ latitude: 12.9716, longitude: 77.5946 });
    expect(result.data.dropoff.latitude).toBe(0);
    expect(result.data.weight).toBe(0.1);
    expect(result.data.ignored).toBeUndefined();
  });

  test('rejects numeric strings, out of range values, and a bad vehicle', () => {
    const result = parseFareQuoteRequest({
      pickup: { coordinates: { latitude: '12.9', longitude: 77 } },
      dropoff: { coordinates: { latitude: 91, longitude: 80 } },
      package: { weight: 0 },
      vehicle: { type: '4_wheeler' }
    });
    expect(result.ok).toBe(false);
    expect(result.details).toContain('pickup.coordinates.latitude');
    expect(result.details).toContain('dropoff.coordinates.latitude');
    expect(result.details).toContain('package.weight');
    expect(result.details).toContain('vehicle.type must be 2_wheeler');
  });
});

describe('fareFieldsFromCalculation', () => {
  test('maps the calculateFare object the same way booking create does', () => {
    const fare = fareCalculationService.calculateFare(8.46);
    expect(fareFieldsFromCalculation(fare, 8.46)).toEqual({
      fare: {
        baseFare: fare.baseFare,
        distanceFare: fare.baseFare,
        totalFare: fare.totalFare,
        currency: 'INR',
        commission: fare.commission,
        driverNet: fare.driverEarnings,
        companyRevenue: fare.commission
      },
      pricing: {
        baseFare: fare.baseFare,
        distanceFare: fare.baseFare,
        totalFare: fare.totalFare,
        currency: 'INR',
        commission: fare.commission,
        driverNet: fare.driverEarnings,
        companyRevenue: fare.commission
      },
      distance: 8.46,
      exactDistance: fare.exactDistanceKm,
      roundedDistance: fare.roundedDistanceKm,
      fareBreakdown: fare.breakdown
    });
  });
});
