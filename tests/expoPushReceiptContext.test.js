const receiptQueue = require('../src/services/expoPushReceiptQueue');

const {
  registerExpoTickets,
  processPendingReceipts,
  resetReceiptQueueForTests,
  getPendingTicketsForTests
} = receiptQueue;

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TOKEN_B = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

const mockGetPushNotificationReceiptsAsync = jest.fn();

jest.mock('expo-server-sdk', () => {
  const MockExpo = jest.fn().mockImplementation(() => ({
    chunkPushNotificationReceiptIds: (ids) => [ids],
    getPushNotificationReceiptsAsync: (...args) => mockGetPushNotificationReceiptsAsync(...args)
  }));
  MockExpo.isExpoPushToken = (token) =>
    typeof token === 'string' && token.startsWith('ExponentPushToken[');
  return { Expo: MockExpo };
});

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

describe('expoPushReceiptContext', () => {
  let scheduleSpy;

  beforeEach(() => {
    resetReceiptQueueForTests();
    jest.clearAllMocks();
    scheduleSpy = jest.spyOn(receiptQueue, 'scheduleReceiptFetch').mockImplementation(() => {});
  });

  afterEach(() => {
    scheduleSpy.mockRestore();
  });

  test('registerExpoTickets stores per-driver userId from pushContexts array', () => {
    registerExpoTickets(
      [{ status: 'ok', id: 'ticket-a' }, { status: 'ok', id: 'ticket-b' }],
      [TOKEN_A, TOKEN_B],
      [
        { userId: 'driver-a', notificationType: 'new_booking' },
        { userId: 'driver-b', notificationType: 'new_booking' }
      ]
    );

    const pending = getPendingTicketsForTests();
    expect(pending.get('ticket-a')).toEqual({
      userId: 'driver-a',
      notificationType: 'new_booking',
      tokenSuffix: TOKEN_A.slice(-6)
    });
    expect(pending.get('ticket-b')).toEqual({
      userId: 'driver-b',
      notificationType: 'new_booking',
      tokenSuffix: TOKEN_B.slice(-6)
    });
  });

  test('DeviceNotRegistered receipt for driver offer clears that driver expoPushToken', async () => {
    const setCalls = [];
    const { getFirestore } = require('../src/services/firebase');
    getFirestore.mockReturnValue({
      collection: () => ({
        doc: (id) => ({
          set: (data, opts) => {
            setCalls.push({ id, data, opts });
            return Promise.resolve();
          }
        })
      })
    });

    mockGetPushNotificationReceiptsAsync.mockResolvedValue({
      'offer-ticket-1': {
        status: 'error',
        message: 'Device not registered',
        details: { error: 'DeviceNotRegistered' }
      }
    });

    registerExpoTickets(
      [{ status: 'ok', id: 'offer-ticket-1' }],
      [TOKEN_A],
      [{ userId: 'driver-offer-1', notificationType: 'new_booking' }]
    );

    await processPendingReceipts();

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].id).toBe('driver-offer-1');
    expect(setCalls[0].data.expoPushToken).toBeNull();
    expect(setCalls[0].opts).toEqual({ merge: true });
  });

  test('single pushContext object applies same userId to every ticket in batch', () => {
    registerExpoTickets(
      [{ status: 'ok', id: 't1' }, { status: 'ok', id: 't2' }],
      [TOKEN_A, TOKEN_B],
      { userId: 'customer-1', notificationType: 'order_update' }
    );

    const pending = getPendingTicketsForTests();
    expect(pending.get('t1').userId).toBe('customer-1');
    expect(pending.get('t2').userId).toBe('customer-1');
  });

  test('sendToTokens does not put pushContexts on Expo message payloads', async () => {
    const ExpoPushService = require('../src/services/expoPushService');
    const service = new ExpoPushService.constructor();
    const sentChunks = [];
    service.expo = {
      sendPushNotificationsAsync: jest.fn(async (chunk) => {
        sentChunks.push(chunk);
        return chunk.map(() => ({ status: 'ok', id: 'ticket-x' }));
      })
    };
    service.chunkArray = (arr) => [arr];
    service.removeUndefinedValues = (obj) => obj;

    await service.sendToTokens(
      [TOKEN_A],
      { title: 'T', body: 'B', type: 'new_booking_display', bookingId: 'b1' },
      {
        priority: 'high',
        sound: 'new_order.wav',
        channelId: 'new_order_v5',
        pushContexts: [{ userId: 'driver-a', notificationType: 'new_booking' }]
      }
    );

    expect(sentChunks).toHaveLength(1);
    const message = sentChunks[0][0];
    expect(message).not.toHaveProperty('pushContexts');
    expect(message).not.toHaveProperty('pushContext');
    expect(message.android.channelId).toBe('new_order_v5');
    expect(message.sound).toBe('new_order.wav');
    expect(message.title).toBe('T');
    expect(message.body).toBe('B');
  });
});