jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

jest.mock('../src/services/firestoreSessionService', () => ({}));
jest.mock('../src/services/expoPushService', () => ({}));

const { getFirestore } = require('../src/services/firebase');
const WebSocketEventHandler = require('../src/services/websocketEventHandler');

describe('handleDriverStatusUpdate guards', () => {
  let handler;
  let userUpdate;
  let bookingsWhereGet;

  beforeEach(() => {
    userUpdate = jest.fn().mockResolvedValue(undefined);
    bookingsWhereGet = jest.fn().mockResolvedValue({ empty: true, docs: [] });

    const bookingsCollection = {
      where: jest.fn(() => ({
        where: jest.fn(() => ({
          limit: jest.fn(() => ({
            get: bookingsWhereGet
          }))
        }))
      }))
    };

    getFirestore.mockReturnValue({
      collection: jest.fn((name) => {
        if (name === 'users') {
          return {
            doc: jest.fn(() => ({
              get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({ driver: { currentBookingId: 'trip-1' } })
              }),
              update: userUpdate
            }))
          };
        }
        if (name === 'bookings') {
          return bookingsCollection;
        }
        if (name === 'driver_status') {
          return { doc: jest.fn(() => ({ set: jest.fn().mockResolvedValue(undefined) })) };
        }
        if (name === 'driver_locations') {
          return { doc: jest.fn(() => ({ set: jest.fn().mockResolvedValue(undefined) })) };
        }
        return { doc: jest.fn() };
      })
    });

    handler = new WebSocketEventHandler();
    handler.db = getFirestore();
    handler.io = { to: jest.fn(() => ({ emit: jest.fn() })) };
  });

  test('rejects isOnline true (REST only)', async () => {
    const socketEmit = jest.fn();
    await handler.handleDriverStatusUpdate(
      { userId: 'd1', userType: 'driver', emit: socketEmit },
      { isOnline: true, isAvailable: false }
    );
    expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ code: 'USE_REST_DRIVER_STATUS' }));
    expect(userUpdate).not.toHaveBeenCalled();
  });

  test('rejects isAvailable true when currentBookingId set', async () => {
    const socketEmit = jest.fn();
    await handler.handleDriverStatusUpdate(
      { userId: 'd1', userType: 'driver', emit: socketEmit },
      { isAvailable: true }
    );
    expect(socketEmit).toHaveBeenCalledWith('error', expect.objectContaining({ code: 'ACTIVE_BOOKING' }));
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
