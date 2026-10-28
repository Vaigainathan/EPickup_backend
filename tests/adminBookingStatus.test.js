const mockBookingGet = jest.fn();
const mockTransition = jest.fn(async () => ({ success: true }));
const mockAdminLogSet = jest.fn(async () => {});

jest.mock('../src/services/bookingStateMachine', () => ({
  getAllowedTransitions: jest.fn((status) => {
    if (status === 'driver_assigned') {
      return ['driver_enroute', 'cancelled'];
    }
    return [];
  }),
  transitionBooking: (...args) => mockTransition(...args)
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true }))
}));

jest.mock('../src/services/socket', () => ({
  getSocketIO: jest.fn(() => null)
}));

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn((name) => {
      if (name === 'bookings') {
        return {
          doc: jest.fn(() => ({
            get: mockBookingGet
          }))
        };
      }
      if (name === 'adminLogs') {
        return {
          doc: jest.fn(() => ({
            set: mockAdminLogSet
          }))
        };
      }
      return { doc: jest.fn() };
    })
  }))
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => ({ __ts: true }))
    }
  }
}));

const {
  getAllowedAdminTransitions,
  adminUpdateBookingStatus,
  AdminInterventionError
} = require('../src/services/admin/adminBookingInterventionService');

describe('adminUpdateBookingStatus', () => {
  beforeEach(() => {
    mockBookingGet.mockReset();
    mockTransition.mockClear();
    mockAdminLogSet.mockClear();
  });

  test('getAllowedAdminTransitions excludes completion statuses', () => {
    const bookingStateMachine = require('../src/services/bookingStateMachine');
    bookingStateMachine.getAllowedTransitions.mockReturnValueOnce([
      'cancelled',
      'delivered',
      'money_collection',
      'completed'
    ]);
    expect(getAllowedAdminTransitions('driver_assigned')).toEqual(['cancelled']);
  });

  test('marketplace booking returns USE_ORDER_ACTIONS', async () => {
    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'pending', sourceType: 'marketplace', marketplaceOrderId: 'o1' })
    });
    await expect(adminUpdateBookingStatus({
      bookingId: 'b1',
      status: 'cancelled',
      adminId: 'admin-1'
    })).rejects.toMatchObject({ code: 'USE_ORDER_ACTIONS', status: 409 });
  });

  test('blocked completion target returns USE_COMPLETION_FLOW', async () => {
    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'money_collection', sourceType: 'parcel' })
    });
    await expect(adminUpdateBookingStatus({
      bookingId: 'b1',
      status: 'completed',
      adminId: 'admin-1'
    })).rejects.toMatchObject({ code: 'USE_COMPLETION_FLOW', status: 409 });
  });

  test('parcel transition writes adminLogs and calls state machine', async () => {
    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({
        status: 'driver_assigned',
        sourceType: 'parcel',
        customerId: 'c1',
        driverId: 'd1'
      })
    });
    const result = await adminUpdateBookingStatus({
      bookingId: 'b1',
      status: 'cancelled',
      adminId: 'admin-1',
      reason: 'test'
    });
    expect(result.status).toBe('cancelled');
    expect(mockTransition).toHaveBeenCalledWith(
      'b1',
      'cancelled',
      expect.objectContaining({ cancellationReason: 'test' }),
      expect.objectContaining({ userType: 'admin', driverId: 'd1' })
    );
    expect(mockAdminLogSet).toHaveBeenCalled();
  });

  test('invalid transition throws INVALID_TRANSITION', async () => {
    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({ status: 'completed', sourceType: 'parcel' })
    });
    await expect(adminUpdateBookingStatus({
      bookingId: 'b1',
      status: 'cancelled',
      adminId: 'admin-1'
    })).rejects.toBeInstanceOf(AdminInterventionError);
  });
});
