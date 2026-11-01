const {
  runCloseActiveTestOrdersReport,
  runCloseActiveTestOrders,
  planCloseActiveTestOrdersApply,
  applyCloseActiveTestOrders,
  planDriverReleaseAfterCleanup,
  isTerminalBookingStatus,
  isTerminalOrderStatus
} = require('../scripts/support/lib/closeActiveTestOrdersActions');
const {
  loadReleaseContext,
  planReleaseStuckDriver
} = require('../scripts/support/lib/releaseStuckDriverActions');

function snap(exists, data) {
  return { exists, data: () => data, id: data && data.id };
}

describe('closeActiveTestOrdersActions', () => {
  test('terminal helpers exclude completed marketplace and booking docs from apply plan', () => {
    expect(isTerminalOrderStatus('cancelled')).toBe(true);
    expect(isTerminalOrderStatus('preparing')).toBe(false);
    expect(isTerminalBookingStatus('completed')).toBe(true);
    expect(isTerminalBookingStatus('driver_enroute')).toBe(false);

    const plan = planCloseActiveTestOrdersApply({
      ongoingOrders: [
        {
          orderId: 'o-done',
          orderStatus: 'cancelled',
          linkedBookingId: 'b1',
          linkedBookingStatus: 'cancelled'
        },
        {
          orderId: 'o-live',
          orderStatus: 'preparing',
          linkedBookingId: 'b2',
          linkedBookingStatus: 'driver_assigned'
        }
      ],
      activeBookings: [
        { bookingId: 'b-done', status: 'completed', driverId: 'd0' },
        { bookingId: 'b3', status: 'pending', driverId: null }
      ],
      customerParcelLocks: []
    });

    expect(plan.orderUpdates.map((row) => row.orderId)).toEqual(['o-live']);
    expect(plan.bookingUpdates.map((row) => row.bookingId).sort()).toEqual(['b2', 'b3'].sort());
  });

  test('runCloseActiveTestOrdersReport performs no Firestore writes', async () => {
    const writeMethods = ['set', 'update', 'delete', 'create', 'add'];
    const db = {
      collection(name) {
        const chain = {
          where() {
            return chain;
          },
          limit() {
            return chain;
          },
          doc(id) {
            return {
              get: async () => {
                if (name === 'appSettings' && id === 'marketplace') {
                  return snap(true, {
                    MARKETPLACE_ENFORCEMENT: { newStatuses: true },
                    PAYMENT_TIMEOUT_MS: 900000
                  });
                }
                if (name === 'driverLocations') {
                  return snap(false, null);
                }
                return snap(false, null);
              }
            };
          },
          get: async () => {
            if (name === 'marketplaceOrders') {
              return {
                docs: [{
                  id: 'order-1',
                  data: () => ({
                    displayId: 1001,
                    shopId: 'shop-1',
                    orderStatus: 'preparing',
                    payment: { status: 'confirmed' },
                    linkedBookingId: 'book-1'
                  })
                }]
              };
            }
            if (name === 'bookings') {
              return { docs: [] };
            }
            if (name === 'users') {
              return { docs: [] };
            }
            if (name === 'customerParcelLocks') {
              return { docs: [] };
            }
            return { docs: [] };
          }
        };
        return chain;
      }
    };

    writeMethods.forEach((method) => {
      db[method] = () => {
        throw new Error(`Unexpected write: ${method}`);
      };
    });
    db.batch = () => {
      const batch = {};
      writeMethods.forEach((m) => {
        batch[m] = () => {
          throw new Error(`Unexpected batch.${m}`);
        };
      });
      batch.commit = () => {
        throw new Error('Unexpected batch.commit');
      };
      return batch;
    };

    const report = await runCloseActiveTestOrdersReport(db, {});
    expect(report.settings.paymentTimeoutConfigured).toBe(true);
    expect(report.settings.MARKETPLACE_ENFORCEMENT.newStatuses).toBe(true);
    expect(report.ongoingOrders).toHaveLength(1);
    expect(report.ongoingOrders[0].linkedBookingStatus).toBe('missing');
  });

  test('--apply cancels order, linked booking, clears parcel lock, and releases driver', async () => {
    const store = {
      'marketplaceOrders/order-1': {
        orderStatus: 'ready',
        linkedBookingId: 'book-1',
        payment: { status: 'confirmed' }
      },
      'bookings/book-1': {
        status: 'driver_assigned',
        driverId: 'driver-1'
      },
      'users/driver-1': {
        userType: 'driver',
        driver: {
          currentBookingId: 'book-1',
          status: 'busy',
          isAvailable: false,
          activeBookings: 1
        }
      },
      'driverLocations/driver-1': {
        currentTripId: 'book-1',
        bookingId: 'book-1',
        isAvailable: false
      },
      'tripTracking/book-1': { isActive: true },
      'booking_locks/book-1': { locked: true },
      'customerParcelLocks/cust-1': { bookingId: 'book-1' }
    };

    const batchOps = [];
    const db = {
      batch() {
        const batch = {
          update(ref, patch) {
            batchOps.push({ type: 'update', path: ref.path, patch });
          },
          set(ref, patch, opts) {
            batchOps.push({ type: 'set', path: ref.path, patch, opts });
          },
          delete(ref) {
            batchOps.push({ type: 'delete', path: ref.path });
          },
          commit: jest.fn(async () => {})
        };
        return batch;
      },
      collection(name) {
        return {
          where(field, op, value) {
            this._query = { field, op, value };
            return this;
          },
          limit() {
            return this;
          },
          doc(id) {
            const path = `${name}/${id}`;
            return {
              path,
              get: async () => {
                const data = store[path];
                return {
                  exists: data !== undefined,
                  data: () => data,
                  id
                };
              }
            };
          },
          get: async function getCollection() {
            if (name === 'bookings' && this._query && this._query.field === 'status') {
              if (this._query.op === 'in') {
                return {
                  docs: Object.entries(store)
                    .filter(([key]) => key.startsWith('bookings/'))
                    .filter(([, data]) => data.status && data.status !== 'cancelled')
                    .map(([key, data]) => ({
                      id: key.split('/')[1],
                      data: () => data
                    }))
                };
              }
              if (this._query.value === 'pending') {
                return { docs: [] };
              }
            }
            if (name === 'bookings' && this._query && this._query.field === 'driverId') {
              return {
                docs: [{
                  id: 'book-1',
                  data: () => store['bookings/book-1']
                }]
              };
            }
            if (name === 'users' && this._query && this._query.value === 'driver') {
              return {
                docs: [{
                  id: 'driver-1',
                  data: () => store['users/driver-1']
                }]
              };
            }
            if (name === 'customerParcelLocks') {
              return {
                docs: [{
                  id: 'cust-1',
                  data: () => store['customerParcelLocks/cust-1']
                }]
              };
            }
            if (name === 'marketplaceOrders') {
              return {
                docs: [{
                  id: 'order-1',
                  data: () => store['marketplaceOrders/order-1']
                }]
              };
            }
            return { docs: [] };
          }
        };
      }
    };

    const report = await runCloseActiveTestOrdersReport(db, { orderId: 'order-1' });
    const result = await applyCloseActiveTestOrders(db, report);

    expect(result.ordersCancelled).toBe(1);
    expect(result.bookingsCancelled).toBe(1);
    expect(result.parcelLocksCleared).toBe(1);
    expect(result.driverResults).toEqual([{ driverId: 'driver-1', released: true }]);

    const orderCancel = batchOps.find((op) => op.path === 'marketplaceOrders/order-1');
    expect(orderCancel.patch.orderStatus).toBe('cancelled');
    expect(orderCancel.patch.cancellation.reason).toBe('support_test_cleanup');
    expect(orderCancel.patch.payment).toBeUndefined();

    const bookingCancel = batchOps.find((op) => op.path === 'bookings/book-1');
    expect(bookingCancel.patch.status).toBe('cancelled');
    expect(bookingCancel.patch.cancellationReason).toBe('support_test_cleanup');

    expect(batchOps.some((op) => op.type === 'delete' && op.path === 'customerParcelLocks/cust-1')).toBe(true);
    expect(batchOps.some((op) => op.type === 'delete' && op.path === 'booking_locks/book-1')).toBe(true);

    const driverUserUpdate = batchOps.find((op) => op.path === 'users/driver-1');
    expect(driverUserUpdate.patch['driver.currentBookingId']).toBeNull();
    expect(driverUserUpdate.patch.isOnline).toBeUndefined();
  });

  test('planDriverReleaseAfterCleanup allows release once targeted bookings are treated as cancelled', async () => {
    const context = {
      driverId: 'driver-1',
      userSnap: snap(true, {
        userType: 'driver',
        driver: { currentBookingId: 'book-1', status: 'busy', activeBookings: 1 }
      }),
      locationSnap: snap(true, { currentTripId: 'book-1', bookingId: 'book-1' }),
      candidateBookingIds: ['book-1'],
      bookingsById: {
        'book-1': { exists: true, data: { status: 'driver_assigned' } }
      },
      tripTrackingById: { 'book-1': { isActive: true } },
      locksById: { 'book-1': true },
      driverActiveBookings: [{ id: 'book-1', status: 'driver_assigned' }]
    };

    const refusedBefore = planReleaseStuckDriver(context);
    expect(refusedBefore.refused).toBe(true);

    const planned = planDriverReleaseAfterCleanup(context, ['book-1']);
    expect(planned.refused).toBe(false);
    expect(planned.cleanupBookingIds).toContain('book-1');
  });
});
