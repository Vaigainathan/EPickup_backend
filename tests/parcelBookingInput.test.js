const { sanitizeParcelBookingInput } = require('../src/validators/parcelBookingInput');

function coordinates(latitude, longitude) {
  return { latitude, longitude };
}

function requiredBody(extra = {}) {
  return {
    pickup: { coordinates: coordinates(12.9716, 77.5946), ...extra.pickup },
    dropoff: { coordinates: coordinates(13.0827, 80.2707), ...extra.dropoff },
    package: { ...(extra.package || {}) },
    ...extra.rest
  };
}

const fullBody = {
  pickup: {
    name: 'Anjuu',
    phone: '+919876543210',
    address: '12 Residency Road, Bengaluru',
    coordinates: coordinates(12.9716, 77.5946)
  },
  dropoff: {
    name: 'Ravi',
    phone: '+919148101698',
    address: '45 Cathedral Road, Chennai',
    coordinates: coordinates(13.0827, 80.2707)
  },
  package: {
    weight: 2.5,
    description: 'Documents',
    specialInstructions: 'Call on arrival'
  },
  vehicle: { type: '2_wheeler' },
  paymentMethod: 'cash',
  idempotencyKey: 'order-2026-10-06-001',
  estimatedPickupTime: '2026-10-06T10:30:00.000Z',
  estimatedDeliveryTime: '2026-10-06T11:15:00.000Z'
};

describe('sanitizeParcelBookingInput', () => {
  test('accepts the 18-field customer body', () => {
    const result = sanitizeParcelBookingInput(fullBody);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.droppedKeys).toEqual([]);
    expect(result.data).toEqual(fullBody);
  });

  test('drops listed top-level extras', () => {
    const result = sanitizeParcelBookingInput({
      ...fullBody,
      sourceType: 'marketplace',
      driverId: 'driver-1',
      customerId: 'customer-1',
      status: 'pending',
      fare: { total: 1 },
      pricing: { total: 1 },
      displayId: 13946,
      id: 'booking-1'
    });
    expect(result.ok).toBe(true);
    expect(result.droppedKeys).toEqual([
      'sourceType',
      'driverId',
      'customerId',
      'status',
      'fare',
      'pricing',
      'displayId',
      'id'
    ]);
    expect(result.data.sourceType).toBeUndefined();
    expect(result.data.driverId).toBeUndefined();
  });

  test('drops nested extras', () => {
    const result = sanitizeParcelBookingInput({
      ...fullBody,
      pickup: { ...fullBody.pickup, extra: 'nope' },
      package: { ...fullBody.package, value: 100 }
    });
    expect(result.ok).toBe(true);
    expect(result.droppedKeys).toEqual(['pickup.extra', 'package.value']);
    expect(result.data.pickup.extra).toBeUndefined();
    expect(result.data.package.value).toBeUndefined();
  });

  test('rejects a missing pickup, dropoff, or package', () => {
    expect(sanitizeParcelBookingInput({ dropoff: fullBody.dropoff, package: fullBody.package }).errors
      .some((entry) => entry.code === 'MISSING_REQUIRED' && entry.path === 'pickup')).toBe(true);
    expect(sanitizeParcelBookingInput({ pickup: fullBody.pickup, package: fullBody.package }).errors
      .some((entry) => entry.code === 'MISSING_REQUIRED' && entry.path === 'dropoff')).toBe(true);
    expect(sanitizeParcelBookingInput({ pickup: fullBody.pickup, dropoff: fullBody.dropoff }).errors
      .some((entry) => entry.code === 'MISSING_REQUIRED' && entry.path === 'package')).toBe(true);
  });

  test('rejects falsy, non-numeric, and out-of-range coordinates', () => {
    const cases = [0, NaN, '12.9abc', 91];
    cases.forEach((latitude) => {
      const result = sanitizeParcelBookingInput(requiredBody({
        pickup: { coordinates: coordinates(latitude, 77.5946) }
      }));
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
    const zero = sanitizeParcelBookingInput(requiredBody({
      pickup: { coordinates: coordinates(0, 77.5946) }
    }));
    expect(zero.errors.some((entry) => entry.code === 'INVALID_PICKUP_COORDINATES')).toBe(true);
    const text = sanitizeParcelBookingInput(requiredBody({
      pickup: { coordinates: coordinates('12.9abc', 77.5946) }
    }));
    expect(text.errors.some((entry) => entry.code === 'INVALID_FIELD')).toBe(true);
    const range = sanitizeParcelBookingInput(requiredBody({
      pickup: { coordinates: coordinates(91, 77.5946) }
    }));
    expect(range.errors.some((entry) => entry.code === 'INVALID_FIELD')).toBe(true);
  });

  test('rejects wrong types and over-length strings', () => {
    const wrongType = sanitizeParcelBookingInput({
      ...fullBody,
      pickup: { ...fullBody.pickup, name: 12 }
    });
    expect(wrongType.ok).toBe(false);
    expect(wrongType.errors.some((entry) => entry.path === 'pickup.name')).toBe(true);

    const tooLong = sanitizeParcelBookingInput({
      ...fullBody,
      pickup: { ...fullBody.pickup, name: 'a'.repeat(101) }
    });
    expect(tooLong.ok).toBe(false);
    expect(tooLong.errors.some((entry) => entry.path === 'pickup.name')).toBe(true);
  });

  test('rejects an invalid estimatedPickupTime', () => {
    const result = sanitizeParcelBookingInput({
      ...fullBody,
      estimatedPickupTime: 'tomorrow'
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some((entry) => entry.path === 'estimatedPickupTime')).toBe(true);
  });

  test('converts numeric-string coordinates to numbers', () => {
    const result = sanitizeParcelBookingInput(requiredBody({
      pickup: { coordinates: coordinates('12.9716', '77.5946') },
      dropoff: { coordinates: coordinates('13.0827', '80.2707') }
    }));
    expect(result.ok).toBe(true);
    expect(result.data.pickup.coordinates).toEqual({ latitude: 12.9716, longitude: 77.5946 });
    expect(result.data.dropoff.coordinates).toEqual({ latitude: 13.0827, longitude: 80.2707 });
    expect(result.stringCoordinates).toEqual([
      'pickup.coordinates.latitude',
      'pickup.coordinates.longitude',
      'dropoff.coordinates.latitude',
      'dropoff.coordinates.longitude'
    ]);
  });

  test('accepts only the required objects and coordinates', () => {
    const result = sanitizeParcelBookingInput({
      pickup: { coordinates: coordinates(12.9716, 77.5946) },
      dropoff: { coordinates: coordinates(13.0827, 80.2707) },
      package: {}
    });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      pickup: { coordinates: { latitude: 12.9716, longitude: 77.5946 } },
      dropoff: { coordinates: { latitude: 13.0827, longitude: 80.2707 } },
      package: {}
    });
  });

  test('keeps newlines in specialInstructions', () => {
    const result = sanitizeParcelBookingInput({
      ...fullBody,
      package: {
        ...fullBody.package,
        specialInstructions: 'Ring the bell\nLeave at the door'
      }
    });
    expect(result.ok).toBe(true);
    expect(result.data.package.specialInstructions).toBe('Ring the bell\nLeave at the door');
  });

  test('stores a valid Indian mobile as +91', () => {
    const accepted = [
      ['9876543210', '+919876543210'],
      ['919876543210', '+919876543210'],
      ['+919876543210', '+919876543210'],
      ['98765 43210', '+919876543210'],
      ['9148101698', '+919148101698']
    ];
    accepted.forEach(([input, stored]) => {
      const result = sanitizeParcelBookingInput(requiredBody({
        pickup: { phone: input, coordinates: coordinates(12.9716, 77.5946) }
      }));
      expect(result.ok).toBe(true);
      expect(result.data.pickup.phone).toBe(stored);
    });
  });

  test('rejects an invalid Indian mobile', () => {
    ['+9148101698', '48101698', '1234567890', '+9198765432100'].forEach((input) => {
      const result = sanitizeParcelBookingInput(requiredBody({
        pickup: { phone: input, coordinates: coordinates(12.9716, 77.5946) }
      }));
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        expect.objectContaining({
          code: 'INVALID_FIELD',
          path: 'pickup.phone',
          message: 'pickup.phone must be a valid 10-digit Indian mobile number'
        })
      ]);
    });
  });

  test('accepts a fareQuoteId and omits null', () => {
    const accepted = sanitizeParcelBookingInput({
      ...fullBody,
      fareQuoteId: 'quote-1'
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.data.fareQuoteId).toBe('quote-1');

    const omitted = sanitizeParcelBookingInput({
      ...requiredBody(),
      fareQuoteId: null
    });
    expect(omitted.ok).toBe(true);
    expect(omitted.data.fareQuoteId).toBeUndefined();
  });

  test('rejects an empty, over-long, or non-string fareQuoteId', () => {
    ['', '   ', 'x'.repeat(129), 12].forEach((fareQuoteId) => {
      const result = sanitizeParcelBookingInput({
        ...requiredBody(),
        fareQuoteId
      });
      expect(result.ok).toBe(false);
      expect(result.errors).toEqual([
        expect.objectContaining({
          code: 'INVALID_FIELD',
          path: 'fareQuoteId',
          message: 'fareQuoteId must be a non-empty string of at most 128 characters'
        })
      ]);
    });
  });

  test('treats null optional fields as absent', () => {
    const result = sanitizeParcelBookingInput({
      ...requiredBody({
        pickup: { phone: null, coordinates: coordinates(12.9716, 77.5946) }
      }),
      paymentMethod: null
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.data.paymentMethod).toBeUndefined();
    expect(result.data.pickup.phone).toBeUndefined();
  });
});
