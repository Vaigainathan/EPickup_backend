jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

jest.mock('../src/services/firestoreSessionService', () => ({}));
jest.mock('../src/services/expoPushService', () => ({}));

const { getFirestore } = require('../src/services/firebase');
const { installRealFirestoreGuard } = require('./helpers/realFirestoreGuard');
const WebSocketEventHandler = require('../src/services/websocketEventHandler');

describe('handleBookingRejection', () => {
  installRealFirestoreGuard(getFirestore);

  let handler;
  let socketEmit;
  let bookingUpdate;
  let rejectionsAdd;
  let runTransaction;

  const makeBookingDoc = (data) => ({
    exists: true,
    data: () => data,
  });

  beforeEach(() => {
    socketEmit = jest.fn();
    bookingUpdate = jest.fn().mockResolvedValue(undefined);
    rejectionsAdd = jest.fn().mockResolvedValue({ id: 'rej-1' });
    runTransaction = jest.fn(async (fn) => fn({
      update: bookingUpdate,
      get: jest.fn(async () => ({
        exists: true,
        data: () => ({ driver: { currentBookingId: 'book-1', isOnline: true } })
      }))
    }));

    const bookingRef = {
      get: jest.fn(),
      update: bookingUpdate
    };

    getFirestore.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'bookings') {
          return { doc: jest.fn(() => bookingRef) };
        }
        if (name === 'booking_rejections') {
          return { add: rejectionsAdd };
        }
        if (name === 'driverLocations') {
          return { doc: jest.fn(() => ({ set: jest.fn().mockResolvedValue(undefined) })) };
        }
        if (name === 'users') {
          return { doc: jest.fn(() => ({})) };
        }
        return { doc: jest.fn(), add: jest.fn() };
      }),
      runTransaction
    });

    handler = new WebSocketEventHandler();
    handler.db = getFirestore();
    handler.io = { to: jest.fn(() => ({ emit: jest.fn() })) };
    handler.notifyDriversOfNewBooking = jest.fn().mockResolvedValue(undefined);
    handler._bookingRef = bookingRef;
  });

  const runReject = async (bookingData) => {
    handler._bookingRef.get.mockResolvedValue(makeBookingDoc(bookingData));
    const socket = {
      userId: 'driver-1',
      userType: 'driver',
      emit: socketEmit
    };
    await handler.handleBookingRejection(socket, { bookingId: 'book-1', reason: 'Too far' });
  };

  test('pending offer: tracks rejection only', async () => {
    await runReject({ status: 'pending', driverId: null, customerId: 'cust-1' });
    expect(rejectionsAdd).toHaveBeenCalled();
    expect(runTransaction).not.toHaveBeenCalled();
    expect(handler.notifyDriversOfNewBooking).not.toHaveBeenCalled();
  });

  test('assigned to other driver: ACCESS_DENIED', async () => {
    await runReject({ status: 'driver_assigned', driverId: 'driver-other' });
    expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ code: 'ACCESS_DENIED' }));
    expect(rejectionsAdd).not.toHaveBeenCalled();
  });

  test('assigned to self: transaction + driver notify', async () => {
    await runReject({ status: 'driver_assigned', driverId: 'driver-1', customerId: 'cust-1' });
    expect(runTransaction).toHaveBeenCalled();
    expect(rejectionsAdd).toHaveBeenCalled();
    expect(handler.notifyDriversOfNewBooking).toHaveBeenCalled();
  });
});
