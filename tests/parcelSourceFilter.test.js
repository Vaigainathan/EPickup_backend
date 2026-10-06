const {
  isParcelSourceFilterEnabled,
  withParcelSource,
  marketplaceBookingRejection
} = require('../src/services/parcelSourceFilter');

const MARKETPLACE_BODY = {
  success: false,
  error: 'Not a parcel booking',
  code: 'MARKETPLACE_BOOKING'
};

describe('isParcelSourceFilterEnabled', () => {
  const original = process.env.FEATURE_PARCEL_SOURCE_FILTER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FEATURE_PARCEL_SOURCE_FILTER;
    } else {
      process.env.FEATURE_PARCEL_SOURCE_FILTER = original;
    }
  });

  test('is on only when the env value is exactly true', () => {
    process.env.FEATURE_PARCEL_SOURCE_FILTER = 'true';
    expect(isParcelSourceFilterEnabled()).toBe(true);
    process.env.FEATURE_PARCEL_SOURCE_FILTER = 'TRUE';
    expect(isParcelSourceFilterEnabled()).toBe(false);
    process.env.FEATURE_PARCEL_SOURCE_FILTER = '1';
    expect(isParcelSourceFilterEnabled()).toBe(false);
    delete process.env.FEATURE_PARCEL_SOURCE_FILTER;
    expect(isParcelSourceFilterEnabled()).toBe(false);
  });
});

describe('marketplaceBookingRejection', () => {
  const original = process.env.FEATURE_PARCEL_SOURCE_FILTER;
  const context = {
    bookingId: 'booking-1',
    route: 'GET /api/customer/bookings/:id',
    customerId: 'customer-1'
  };

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FEATURE_PARCEL_SOURCE_FILTER;
    } else {
      process.env.FEATURE_PARCEL_SOURCE_FILTER = original;
    }
    jest.restoreAllMocks();
  });

  test('returns 409 for marketplace and passes parcel and legacy docs when on', () => {
    process.env.FEATURE_PARCEL_SOURCE_FILTER = 'true';
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(marketplaceBookingRejection({ sourceType: 'marketplace' }, context)).toEqual({
      status: 409,
      body: MARKETPLACE_BODY
    });
    expect(log).toHaveBeenCalledWith(
      '[ParcelFilter] rejected marketplace booking booking-1 on GET /api/customer/bookings/:id for customer customer-1'
    );
    expect(marketplaceBookingRejection({ sourceType: 'parcel' }, context)).toBeNull();
    expect(marketplaceBookingRejection({}, context)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });

  test('passes a marketplace doc when off', () => {
    delete process.env.FEATURE_PARCEL_SOURCE_FILTER;
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    expect(marketplaceBookingRejection({ sourceType: 'marketplace' }, context)).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });
});

describe('withParcelSource', () => {
  const original = process.env.FEATURE_PARCEL_SOURCE_FILTER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.FEATURE_PARCEL_SOURCE_FILTER;
    } else {
      process.env.FEATURE_PARCEL_SOURCE_FILTER = original;
    }
  });

  test('adds the parcel filter only when on', () => {
    const query = { where: jest.fn(() => 'filtered') };
    delete process.env.FEATURE_PARCEL_SOURCE_FILTER;
    expect(withParcelSource(query)).toBe(query);
    expect(query.where).not.toHaveBeenCalled();

    process.env.FEATURE_PARCEL_SOURCE_FILTER = 'true';
    expect(withParcelSource(query)).toBe('filtered');
    expect(query.where).toHaveBeenCalledWith('sourceType', '==', 'parcel');
  });
});
