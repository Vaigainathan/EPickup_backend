const {
  CUSTOMER_PARCEL_HISTORY_KEYS,
  presentCustomerParcelBookingHistory
} = require('../src/services/customerParcelBookingHistory');

describe('presentCustomerParcelBookingHistory', () => {
  const richFixture = {
    id: 'booking-1',
    displayId: 12345,
    status: 'delivered',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    completedAt: new Date('2026-01-02T00:00:00.000Z'),
    amount: 120,
    totalFare: 120,
    sourceType: 'parcel',
    customerId: 'must-not-leak',
    fareQuoteId: 'quote-abc',
    fare: {
      total: 120,
      totalFare: 120,
      currency: 'INR',
      commission: 11.5,
      driverNet: 100,
      companyRevenue: 11.5
    },
    pricing: {
      totalFare: 120,
      currency: 'INR',
      commission: 11.5,
      driverNet: 100,
      companyRevenue: 11.5
    },
    driverInfo: {
      name: 'Driver',
      phone: '+919876543210'
    },
    payment: { status: 'paid' },
    pickup: { address: 'A' },
    package: { weight: 1 }
  };

  test('top-level keys match whitelist subset present on source', () => {
    const out = presentCustomerParcelBookingHistory(richFixture);
    const keys = Object.keys(out).sort();
    keys.forEach((key) => {
      expect(CUSTOMER_PARCEL_HISTORY_KEYS).toContain(key);
    });
    expect(keys).toEqual([
      'amount',
      'completedAt',
      'createdAt',
      'displayId',
      'driverInfo',
      'fare',
      'id',
      'package',
      'payment',
      'pickup',
      'pricing',
      'sourceType',
      'status',
      'totalFare',
      'updatedAt'
    ]);
  });

  test('strips commission, revenue internals, and fareQuoteId', () => {
    const out = presentCustomerParcelBookingHistory(richFixture);
    expect(out.customerId).toBeUndefined();
    expect(out.fareQuoteId).toBeUndefined();
    expect(out.fare.commission).toBeUndefined();
    expect(out.fare.driverNet).toBeUndefined();
    expect(out.fare.companyRevenue).toBeUndefined();
    expect(out.pricing.commission).toBeUndefined();
    expect(out.pricing.driverNet).toBeUndefined();
    expect(out.pricing.companyRevenue).toBeUndefined();
    expect(out.fare).toEqual({ total: 120, totalFare: 120, currency: 'INR' });
    expect(out.pricing).toEqual({ totalFare: 120, currency: 'INR' });
  });

  test('keeps driverInfo.phone', () => {
    const out = presentCustomerParcelBookingHistory(richFixture);
    expect(out.driverInfo.phone).toBe('+919876543210');
  });
});
