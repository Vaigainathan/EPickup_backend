const { createStrictFirestoreTransaction } = require('./helpers/strictFirestoreTransaction');
const {
  applyDriverReleaseInTransaction
} = require('../src/services/releaseDriverOnBookingCancel');

const bookingRef = { path: 'bookings/b1' };
const cancellationRef = { path: 'cancellations/c1' };
const driverRef = { path: 'users/driver-1' };

/** Mirror: driver.js cancel-at-pickup transaction (reads before writes). */
async function runCancelAtPickupTransaction(transaction, ctx) {
  const driverSnap = await transaction.get(ctx.driverRef);
  transaction.update(ctx.bookingRef, ctx.bookingPatch);
  transaction.set(ctx.cancellationRef, ctx.cancellationRecord);
  applyDriverReleaseInTransaction(
    transaction,
    ctx.driverRef,
    driverSnap,
    ctx.bookingId
  );
}

/** Mirror: driver.js + websocket assigned reject transaction. */
async function runAssignedRejectTransaction(transaction, ctx) {
  const driverSnap = await transaction.get(ctx.driverRef);
  transaction.update(ctx.bookingRef, ctx.bookingPatch);
  applyDriverReleaseInTransaction(
    transaction,
    ctx.driverRef,
    driverSnap,
    ctx.bookingId
  );
}

/** Mirror: activeBookingService.cancelActiveBooking driver release leg (after query get). */
async function runActiveBookingCancelReleaseTransaction(transaction, ctx) {
  const driverSnap = await transaction.get(ctx.driverRef);
  transaction.update(ctx.bookingRef, ctx.bookingPatch);
  applyDriverReleaseInTransaction(
    transaction,
    ctx.driverRef,
    driverSnap,
    ctx.bookingId
  );
}

describe('S7 Firestore transaction read-before-write order', () => {
  const driverSnap = {
    exists: true,
    data: () => ({ driver: { currentBookingId: 'b1', isOnline: true } })
  };

  const baseCtx = {
    bookingRef,
    driverRef,
    bookingId: 'b1',
    bookingPatch: { status: 'pending', driverId: null, updatedAt: new Date() }
  };

  test('cancel-at-pickup: all gets before writes', async () => {
    const tx = createStrictFirestoreTransaction({ getImpl: async () => driverSnap });
    await expect(
      runCancelAtPickupTransaction(tx, {
        ...baseCtx,
        cancellationRef,
        cancellationRecord: { bookingId: 'b1' }
      })
    ).resolves.toBeUndefined();
    expect(tx.__inner.get).toHaveBeenCalledTimes(1);
    expect(tx.__inner.update).toHaveBeenCalled();
    expect(tx.__inner.set).toHaveBeenCalled();
  });

  test('REST assigned reject: driver get before booking update', async () => {
    const tx = createStrictFirestoreTransaction({ getImpl: async () => driverSnap });
    await expect(runAssignedRejectTransaction(tx, baseCtx)).resolves.toBeUndefined();
    expect(tx.__inner.get).toHaveBeenCalledWith(driverRef);
  });

  test('socket assigned reject: same order as REST', async () => {
    const tx = createStrictFirestoreTransaction({ getImpl: async () => driverSnap });
    await expect(runAssignedRejectTransaction(tx, baseCtx)).resolves.toBeUndefined();
  });

  test('activeBookingService: driver get before booking update', async () => {
    const tx = createStrictFirestoreTransaction({ getImpl: async () => driverSnap });
    await expect(
      runActiveBookingCancelReleaseTransaction(tx, {
        ...baseCtx,
        bookingPatch: { status: 'cancelled', updatedAt: new Date() }
      })
    ).resolves.toBeUndefined();
    const getOrder = tx.__inner.get.mock.invocationCallOrder[0];
    const updateOrder = tx.__inner.update.mock.invocationCallOrder[0];
    expect(getOrder).toBeLessThan(updateOrder);
  });

  test('strict tx throws if get follows write (regression guard)', async () => {
    const tx = createStrictFirestoreTransaction({ getImpl: async () => driverSnap });
    tx.update(bookingRef, { status: 'x' });
    await expect(tx.get(driverRef)).rejects.toThrow(/Transaction read after write/);
  });
});

describe('activeBookingService.cancelActiveBooking transaction (strict)', () => {
  test('query get then driver get then booking update', async () => {
    const { createStrictFirestoreTransaction } = require('./helpers/strictFirestoreTransaction');
    const ActiveBookingService = require('../src/services/activeBookingService');

    const bookingDoc = {
      id: 'b1',
      ref: bookingRef,
      data: () => ({
        status: 'driver_assigned',
        driverId: 'driver-1'
      })
    };

    const querySnap = {
      empty: false,
      docs: [bookingDoc]
    };

    const invocationOrder = [];

    const innerGet = jest.fn(async (ref) => {
      invocationOrder.push({ type: 'get', ref });
      if (ref && ref.path && ref.path.startsWith('users/')) {
        return {
          exists: true,
          data: () => ({ driver: { currentBookingId: 'b1', isOnline: true } })
        };
      }
      return querySnap;
    });
    const innerUpdate = jest.fn((ref, data) => {
      invocationOrder.push({ type: 'update', ref });
      return { ref, data };
    });
    const { wrapStrictTransaction } = require('./helpers/strictFirestoreTransaction');
    const tx = wrapStrictTransaction({
      get: innerGet,
      update: innerUpdate,
      set: jest.fn()
    });

    const db = {
      collection: jest.fn((name) => {
        if (name === 'bookings') {
          return {
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            doc: jest.fn(() => bookingRef)
          };
        }
        if (name === 'users') {
          return { doc: jest.fn(() => driverRef) };
        }
        return { doc: jest.fn() };
      }),
      runTransaction: jest.fn(async (fn) => fn(tx))
    };

    const service = new ActiveBookingService();
    service.getDb = () => db;
    service.db = db;

    const result = await service.cancelActiveBooking('customer-1', 'test');
    expect(result.success).toBe(true);

    const firstUpdateIdx = invocationOrder.findIndex((e) => e.type === 'update');
    const driverGetIdx = invocationOrder.findIndex(
      (e) => e.type === 'get' && e.ref === driverRef
    );
    expect(driverGetIdx).toBeGreaterThanOrEqual(0);
    expect(driverGetIdx).toBeLessThan(firstUpdateIdx);
  });
});
