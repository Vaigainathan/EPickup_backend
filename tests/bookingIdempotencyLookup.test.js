const { lookupCustomerBookingByIdempotencyKey } = require('../src/services/bookingIdempotencyLookup');

function fakeDb(rows, options = {}) {
  const state = { collectionCalls: 0 };
  const db = {
    collection(name) {
      state.collectionCalls += 1;
      state.collection = name;
      const filters = [];
      const query = {
        where(field, op, value) {
          filters.push({ field, op, value });
          return query;
        },
        limit(count) {
          state.limit = count;
          return query;
        },
        async get() {
          if (options.throwOnGet) {
            throw options.throwOnGet;
          }
          state.filters = filters;
          const matched = rows.filter((row) => filters.every((filter) => row.data[filter.field] === filter.value));
          return {
            empty: matched.length === 0,
            docs: matched.slice(0, 1).map((row) => ({
              id: row.id,
              data: () => row.data
            }))
          };
        }
      };
      return query;
    }
  };
  return { db, state };
}

describe('lookupCustomerBookingByIdempotencyKey', () => {
  test('returns the full booking and converts timestamps on a hit', async () => {
    const createdAt = new Date('2026-10-06T10:00:00.000Z');
    const updatedAt = new Date('2026-10-06T10:05:00.000Z');
    const { db } = fakeDb([{
      id: 'booking-1',
      data: {
        customerId: 'customer-1',
        idempotencyKey: 'key-1',
        status: 'pending',
        createdAt: { toDate: () => createdAt },
        updatedAt: { toDate: () => updatedAt }
      }
    }]);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    const result = await lookupCustomerBookingByIdempotencyKey(db, 'customer-1', 'key-1');

    expect(result.found).toBe(true);
    expect(result.booking.id).toBe('booking-1');
    expect(result.booking.status).toBe('pending');
    expect(result.booking.customerId).toBe('customer-1');
    expect(result.booking.createdAt).toBe(createdAt);
    expect(result.booking.updatedAt).toBe(updatedAt);
    expect(log).toHaveBeenCalledWith('[B63] idempotency hit bookingId=booking-1');
    log.mockRestore();
  });

  test('returns not found and logs a miss', async () => {
    const { db, state } = fakeDb([]);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    const result = await lookupCustomerBookingByIdempotencyKey(db, 'customer-1', 'key-1');

    expect(result).toEqual({ found: false });
    expect(state.filters).toEqual([
      { field: 'customerId', op: '==', value: 'customer-1' },
      { field: 'idempotencyKey', op: '==', value: 'key-1' }
    ]);
    expect(state.limit).toBe(1);
    expect(log).toHaveBeenCalledWith('[B63] idempotency miss');
    log.mockRestore();
  });

  test('does not query when the key is missing', async () => {
    const { db, state } = fakeDb([]);

    await expect(lookupCustomerBookingByIdempotencyKey(db, 'customer-1', undefined))
      .resolves.toEqual({ found: false });
    await expect(lookupCustomerBookingByIdempotencyKey(db, 'customer-1', ''))
      .resolves.toEqual({ found: false });
    expect(state.collectionCalls).toBe(0);
  });

  test('does not match another customer\'s key', async () => {
    const { db } = fakeDb([{
      id: 'booking-other',
      data: {
        customerId: 'customer-2',
        idempotencyKey: 'key-1'
      }
    }]);
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    const result = await lookupCustomerBookingByIdempotencyKey(db, 'customer-1', 'key-1');

    expect(result).toEqual({ found: false });
    expect(log).toHaveBeenCalledWith('[B63] idempotency miss');
    log.mockRestore();
  });

  test('logs the error message and code and continues when the query fails', async () => {
    const { db } = fakeDb([], {
      throwOnGet: Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index'), {
        code: 'FAILED_PRECONDITION'
      })
    });
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await lookupCustomerBookingByIdempotencyKey(db, 'customer-1', 'key-1');

    expect(result).toEqual({ found: false });
    expect(errorLog).toHaveBeenCalledWith('[B63] idempotency lookup failed', {
      message: '9 FAILED_PRECONDITION: The query requires an index',
      code: 'FAILED_PRECONDITION'
    });
    errorLog.mockRestore();
  });
});
