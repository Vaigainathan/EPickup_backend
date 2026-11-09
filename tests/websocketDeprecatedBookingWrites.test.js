jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

const logSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

jest.mock('../src/services/firestoreSessionService', () => ({}));
jest.mock('../src/services/expoPushService', () => ({}));

const { getFirestore } = require('../src/services/firebase');
const WebSocketEventHandler = require('../src/services/websocketEventHandler');

describe('deprecated socket booking writes', () => {
  afterAll(() => {
    logSpy.mockRestore();
  });

  let handler;
  let collectionMock;
  let runTransactionMock;

  beforeEach(() => {
    collectionMock = jest.fn();
    runTransactionMock = jest.fn();
    getFirestore.mockReturnValue({
      collection: collectionMock,
      runTransaction: runTransactionMock
    });

    handler = new WebSocketEventHandler();
    handler.db = getFirestore();
    handler.io = { to: jest.fn(() => ({ emit: jest.fn() })) };
  });

  test('accept_booking emits USE_REST_ACCEPT without Firestore', async () => {
    const socketEmit = jest.fn();
    const socket = { userId: 'd1', userType: 'driver', emit: socketEmit };

    await handler.handleBookingAcceptance(socket, { bookingId: 'b1' });

    expect(socketEmit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ code: 'USE_REST_ACCEPT' })
    );
    expect(collectionMock).not.toHaveBeenCalled();
    expect(runTransactionMock).not.toHaveBeenCalled();
  });

  test('update_booking_status emits USE_REST_STATUS_API without Firestore', async () => {
    const socketEmit = jest.fn();
    const socket = { userId: 'd1', userType: 'driver', emit: socketEmit };

    await handler.handleBookingStatusUpdate(socket, {
      bookingId: 'b1',
      status: 'driver_enroute'
    });

    expect(socketEmit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ code: 'USE_REST_STATUS_API' })
    );
    expect(collectionMock).not.toHaveBeenCalled();
  });

  test('payment_event emits USE_REST_PAYMENT without Firestore', async () => {
    const socketEmit = jest.fn();
    const socket = {
      userId: 'd1',
      userType: 'driver',
      emit: socketEmit,
      handshake: { headers: { 'x-app-version': '4.0.0' } }
    };

    await handler.handlePaymentEvent(socket, {
      eventType: 'payment_completed',
      transactionId: 'tx-1',
      appVersion: '4.0.0'
    });

    expect(socketEmit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ code: 'USE_REST_PAYMENT' })
    );
    expect(collectionMock).not.toHaveBeenCalled();
    const payLog = logSpy.mock.calls
      .filter((call) => String(call[0]).includes('SOCKET_DEPRECATED_EVENT_BLOCKED'))
      .map((call) => JSON.parse(call[1]))
      .find((payload) => payload.event === 'payment_event');
    expect(payLog).toMatchObject({
      event: 'payment_event',
      userId: 'd1',
      appVersion: '4.0.0'
    });
  });
});
