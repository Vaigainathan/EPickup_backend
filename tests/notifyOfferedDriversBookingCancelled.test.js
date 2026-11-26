const mockEmit = jest.fn();
const mockSendToTokens = jest.fn(async () => ({ successCount: 1, failureCount: 0 }));

jest.mock('../src/services/socket', () => ({
  getSocketIO: jest.fn(() => ({ to: jest.fn(() => ({ emit: mockEmit })) }))
}));

jest.mock('../src/services/expoPushService', () => ({
  sendToTokens: (...args) => mockSendToTokens(...args)
}));

const mockUserDocs = new Map();

function mockBuildUserDb() {
  return {
    collection(name) {
      return {
        doc(id) {
          return {
            id,
            async get() {
              const key = `${name}/${id}`;
              const data = mockUserDocs.get(key);
              return {
                exists: data !== undefined,
                data: () => data
              };
            }
          };
        }
      };
    }
  };
}

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => mockBuildUserDb())
}));

const { notifyOfferedDriversBookingCancelled } = require('../src/services/notifyOfferedDriversBookingCancelled');

describe('notifyOfferedDriversBookingCancelled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserDocs.clear();
    mockUserDocs.set('users/driver-a', { expoPushToken: 'ExponentPushToken[aaa]' });
    mockUserDocs.set('users/driver-b', { expoPushToken: 'ExponentPushToken[bbb]' });
  });

  test('sends socket and data-only push with stop_ringtone payload', async () => {
    await notifyOfferedDriversBookingCancelled(
      'book-1',
      ['driver-a', 'driver-b'],
      'changed mind',
      'customer-1',
      { db: mockBuildUserDb() }
    );

    expect(mockEmit).toHaveBeenCalledTimes(2);
    expect(mockEmit).toHaveBeenCalledWith(
      'booking_cancelled',
      expect.objectContaining({
        bookingId: 'book-1',
        reason: 'changed mind',
        cancelledBy: 'customer-1',
        timestamp: expect.any(String)
      })
    );

    expect(mockSendToTokens).toHaveBeenCalledTimes(1);
    const [tokens, notification, options] = mockSendToTokens.mock.calls[0];
    expect(tokens).toEqual(['ExponentPushToken[aaa]', 'ExponentPushToken[bbb]']);
    expect(notification).toEqual({
      type: 'booking_cancelled',
      bookingId: 'book-1',
      data: {
        type: 'booking_cancelled',
        bookingId: 'book-1',
        action: 'stop_ringtone'
      }
    });
    expect(options).toEqual(
      expect.objectContaining({
        priority: 'high',
        dataOnly: true,
        pushContexts: [
          { userId: 'driver-a', notificationType: 'booking_cancelled' },
          { userId: 'driver-b', notificationType: 'booking_cancelled' }
        ]
      })
    );
  });

  test('skips skipDriverId (accepted driver)', async () => {
    await notifyOfferedDriversBookingCancelled(
      'book-1',
      ['driver-a', 'driver-b'],
      'reason',
      'customer-1',
      { db: mockBuildUserDb(), skipDriverId: 'driver-a' }
    );

    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockSendToTokens).toHaveBeenCalledTimes(1);
    const [tokens] = mockSendToTokens.mock.calls[0];
    expect(tokens).toEqual(['ExponentPushToken[bbb]']);
  });

  test('no-op for empty notifiedDrivers', async () => {
    await notifyOfferedDriversBookingCancelled('book-1', [], 'reason', 'cust');
    expect(mockEmit).not.toHaveBeenCalled();
    expect(mockSendToTokens).not.toHaveBeenCalled();
  });

  test('push failure does not throw', async () => {
    mockSendToTokens.mockRejectedValueOnce(new Error('expo down'));
    await expect(
      notifyOfferedDriversBookingCancelled('book-1', ['driver-a'], 'reason', 'cust', { db: mockBuildUserDb() })
    ).resolves.toBeUndefined();
  });
});