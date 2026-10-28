jest.mock('../src/services/shopOrderService', () => ({
  supportCancelBeforeHandover: jest.fn(async () => ({ wrote: true, alreadyProcessed: false }))
}));

const mockBookingGet = jest.fn();
const mockBookingUpdate = jest.fn(async () => {});
const mockTxUpdate = jest.fn();
const mockAdminLogSet = jest.fn(async () => {});

jest.mock('../src/services/bookingStateMachine', () => ({
  getAllowedTransitions: jest.fn(() => ['cancelled']),
  transitionBooking: jest.fn(async () => ({ success: true }))
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true }))
}));

jest.mock('../src/services/socket', () => ({
  getSocketIO: jest.fn(() => null)
}));

jest.mock('../src/services/marketplaceSyncService', () => ({
  syncBooking: jest.fn(async () => ({}))
}));

jest.mock('../src/services/websocketEventHandler', () => {
  return jest.fn().mockImplementation(() => ({
    initialize: jest.fn(async () => {}),
    notifyDriversOfNewBooking: jest.fn(async () => {})
  }));
});

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn((name) => {
      if (name === 'bookings') {
        return {
          doc: jest.fn(() => ({
            get: mockBookingGet,
            update: mockBookingUpdate
          }))
        };
      }
      if (name === 'adminLogs') {
        return { doc: jest.fn(() => ({ set: mockAdminLogSet })) };
      }
      if (name === 'users') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn(async () => ({
              exists: true,
              data: () => ({ driver: { activeBookings: 1 } })
            }))
          }))
        };
      }
      if (name === 'driverLocations') {
        return { doc: jest.fn(() => ({})) };
      }
      return { doc: jest.fn() };
    }),
    runTransaction: jest.fn(async (fn) => fn({
      get: mockBookingGet,
      update: mockTxUpdate,
      set: jest.fn()
    }))
  }))
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => ({ __ts: true })),
      delete: jest.fn(() => ({ __delete: true }))
    }
  }
}));

const shopOrderService = require('../src/services/shopOrderService');
const {
  adminIntervene,
  adminInterveneReassign
} = require('../src/services/admin/adminBookingInterventionService');

describe('adminIntervene', () => {
  beforeEach(() => {
    mockBookingGet.mockReset();
    mockAdminLogSet.mockClear();
    shopOrderService.supportCancelBeforeHandover.mockClear();
  });

  test('refund action returns NOT_SUPPORTED', async () => {
    await expect(adminIntervene({
      bookingId: 'b1',
      action: 'refund',
      adminId: 'admin-1'
    })).rejects.toMatchObject({ code: 'NOT_SUPPORTED', status: 400 });
  });

  test('cancel_booking alias routes marketplace to supportCancelBeforeHandover', async () => {
    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'driver_assigned',
        sourceType: 'marketplace',
        marketplaceOrderId: 'order-1'
      })
    });
    const result = await adminIntervene({
      bookingId: 'b1',
      action: 'cancel_booking',
      adminId: 'admin-1',
      reason: 'stuck'
    });
    expect(shopOrderService.supportCancelBeforeHandover).toHaveBeenCalledWith({
      orderId: 'order-1',
      operator: 'admin-1',
      note: 'stuck'
    });
    expect(result.action).toBe('cancel');
    expect(mockAdminLogSet).toHaveBeenCalled();
  });

  test('parcel cancel with prepaid payment returns REFUND_REQUIRED', async () => {
    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'driver_assigned',
        sourceType: 'parcel',
        paymentConfirmed: true
      })
    });
    await expect(adminIntervene({
      bookingId: 'b1',
      action: 'cancel',
      adminId: 'admin-1'
    })).rejects.toMatchObject({ code: 'REFUND_REQUIRED', status: 409 });
  });

  test('reassign after pickup is refused', async () => {
    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'picked_up',
        sourceType: 'parcel',
        customerId: 'c1'
      })
    });
    await expect(adminInterveneReassign({
      bookingId: 'b1',
      adminId: 'admin-1'
    })).rejects.toMatchObject({ code: 'REASSIGN_NOT_ALLOWED', status: 409 });
  });

  test('reassign_driver notifies removed driver and customer', async () => {
    const notificationService = require('../src/services/notificationService');
    let reads = 0;
    mockBookingGet.mockImplementation(async () => {
      reads += 1;
      if (reads === 1) {
        return {
          exists: true,
          data: () => ({
            status: 'driver_assigned',
            sourceType: 'parcel',
            customerId: 'c1',
            driverId: 'd-old'
          })
        };
      }
      return {
        exists: true,
        data: () => ({
          status: 'pending',
          sourceType: 'parcel',
          customerId: 'c1'
        })
      };
    });
    await adminInterveneReassign({
      bookingId: 'b1',
      adminId: 'admin-1',
      reason: 'swap'
    });
    expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
      'd-old',
      'DRIVER',
      'BOOKING_REASSIGNED',
      expect.any(Object)
    );
    expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
      'c1',
      'CUSTOMER',
      'FINDING_NEW_DRIVER',
      expect.any(Object)
    );
  });
});
