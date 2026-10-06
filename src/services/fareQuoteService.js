const QUOTE_TTL_MS = 15 * 60 * 1000;
const COORD_TOLERANCE = 0.000001;

const QUOTE_INVALID_DETAILS = {
  missing: 'This fare quote could not be found. Request a new price and try again.',
  customer_mismatch: 'This fare quote does not belong to your account.',
  coordinate_mismatch: 'The pickup or drop-off no longer matches the quoted price. Request a new price.',
  already_used: 'This fare quote has already been used.'
};

const QUOTE_EXPIRED_DETAILS = 'This fare quote has expired. Request a new price and try again.';

class FareQuoteTransactionError extends Error {
  constructor(failure) {
    const mapped = quoteFailureBody(failure);
    super(mapped.body.details);
    this.name = 'FareQuoteTransactionError';
    this.status = mapped.status;
    this.code = mapped.body.code;
    this.details = mapped.body.details;
    this.body = mapped.body;
  }
}

function invalid(reason) {
  return { ok: false, status: 400, code: 'FARE_QUOTE_INVALID', reason };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function toEpochMs(value) {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (value && typeof value.toMillis === 'function') {
    return value.toMillis();
  }
  if (value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : NaN;
  }
  return NaN;
}

function coordinatesMatch(left, right) {
  if (!left || !right) {
    return false;
  }
  const latitudeDelta = Math.abs(Number(left.latitude) - Number(right.latitude));
  const longitudeDelta = Math.abs(Number(left.longitude) - Number(right.longitude));
  if (!Number.isFinite(latitudeDelta) || !Number.isFinite(longitudeDelta)) {
    return false;
  }
  return latitudeDelta <= COORD_TOLERANCE && longitudeDelta <= COORD_TOLERANCE;
}

function validateQuoteForBooking(quote, options) {
  const request = options || {};
  if (!quote || typeof quote !== 'object') {
    return invalid('missing');
  }
  if (quote.status !== 'active' && quote.status !== 'used') {
    return invalid('missing');
  }
  if (quote.customerId !== request.customerId) {
    return invalid('customer_mismatch');
  }
  if (!coordinatesMatch(quote.pickup, request.pickup) || !coordinatesMatch(quote.dropoff, request.dropoff)) {
    return invalid('coordinate_mismatch');
  }
  if (quote.status === 'used') {
    if (isNonEmptyString(request.idempotencyKey) && isNonEmptyString(quote.usedByIdempotencyKey)
      && request.idempotencyKey === quote.usedByIdempotencyKey) {
      return { ok: true, reuse: true, bookingId: quote.usedByBookingId };
    }
    return invalid('already_used');
  }
  const expiresAt = toEpochMs(quote.expiresAt);
  const now = toEpochMs(request.now);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now) || now >= expiresAt) {
    return { ok: false, status: 410, code: 'FARE_QUOTE_EXPIRED' };
  }
  return { ok: true };
}

function quoteFailureBody(failure) {
  if (failure && (failure.status === 410 || failure.code === 'FARE_QUOTE_EXPIRED')) {
    return {
      status: 410,
      body: {
        success: false,
        error: 'Fare quote expired',
        details: QUOTE_EXPIRED_DETAILS,
        code: 'FARE_QUOTE_EXPIRED'
      }
    };
  }
  const reason = failure && failure.reason;
  return {
    status: 400,
    body: {
      success: false,
      error: 'Fare quote invalid',
      details: QUOTE_INVALID_DETAILS[reason] || QUOTE_INVALID_DETAILS.missing,
      code: 'FARE_QUOTE_INVALID'
    }
  };
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function readCoordinate(source, side, axis, min, max, errors) {
  const coordinates = source && source.coordinates;
  const value = coordinates ? coordinates[axis] : undefined;
  if (!isFiniteNumber(value) || value < min || value > max) {
    errors.push(`${side}.coordinates.${axis} must be a finite number from ${min} to ${max}`);
    return undefined;
  }
  return value;
}

function readSide(source, side, errors) {
  const latitude = readCoordinate(source, side, 'latitude', -90, 90, errors);
  const longitude = readCoordinate(source, side, 'longitude', -180, 180, errors);
  if (latitude === undefined || longitude === undefined) {
    return null;
  }
  return { latitude, longitude };
}

function parseFareQuoteRequest(body) {
  const source = body && typeof body === 'object' ? body : {};
  const errors = [];
  const pickup = readSide(source.pickup, 'pickup', errors);
  const dropoff = readSide(source.dropoff, 'dropoff', errors);
  const weight = source.package ? source.package.weight : undefined;
  if (!isFiniteNumber(weight) || weight < 0.1 || weight > 50) {
    errors.push('package.weight must be a finite number from 0.1 to 50');
  }
  const vehicleType = source.vehicle ? source.vehicle.type : undefined;
  if (vehicleType !== '2_wheeler') {
    errors.push('vehicle.type must be 2_wheeler');
  }
  if (errors.length > 0) {
    return { ok: false, details: errors.join('; ') };
  }
  return {
    ok: true,
    data: {
      pickup,
      dropoff,
      weight,
      vehicleType
    }
  };
}

function fareFieldsFromCalculation(fareDetails, distanceKm) {
  const details = fareDetails || {};
  return {
    fare: {
      baseFare: details.baseFare,
      distanceFare: details.baseFare,
      totalFare: details.totalFare,
      currency: 'INR',
      commission: details.commission,
      driverNet: details.driverEarnings,
      companyRevenue: details.commission
    },
    pricing: {
      baseFare: details.baseFare,
      distanceFare: details.baseFare,
      totalFare: details.totalFare,
      currency: 'INR',
      commission: details.commission,
      driverNet: details.driverEarnings,
      companyRevenue: details.commission
    },
    distance: distanceKm,
    exactDistance: details.exactDistanceKm,
    roundedDistance: details.roundedDistanceKm || Math.ceil(distanceKm || 0),
    fareBreakdown: details.breakdown
  };
}

module.exports = {
  QUOTE_TTL_MS,
  COORD_TOLERANCE,
  FareQuoteTransactionError,
  validateQuoteForBooking,
  quoteFailureBody,
  parseFareQuoteRequest,
  fareFieldsFromCalculation
};
