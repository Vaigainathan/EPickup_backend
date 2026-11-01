const {
  buildDriverOfferNotificationRecord,
  logDriverNewBookingOfferPushResults,
  buildPushContextsForDrivers
} = require('../src/services/driverOfferPushNotificationLog');

describe('driverOfferPushNotificationLog', () => {
  test('buildPushContextsForDrivers maps each driver id', () => {
    expect(buildPushContextsForDrivers(['d1', 'd2'])).toEqual([
      { userId: 'd1', notificationType: 'new_booking' },
      { userId: 'd2', notificationType: 'new_booking' }
    ]);
  });

  test('offer to 2 drivers writes 2 notification docs', async () => {
    const added = [];
    const db = {
      collection(name) {
        expect(name).toBe('notifications');
        return {
          add: jest.fn(async (doc) => {
            added.push(doc);
          })
        };
      }
    };

    const result = await logDriverNewBookingOfferPushResults(db, {
      driverIds: ['driver-a', 'driver-b'],
      tickets: [{ status: 'ok', id: 't1' }, { status: 'ok', id: 't2' }],
      bookingId: 'book-99',
      title: 'New order',
      body: 'Pickup nearby'
    });

    expect(result.logged).toBe(2);
    expect(added).toHaveLength(2);
    expect(added[0].userId).toBe('driver-a');
    expect(added[1].userId).toBe('driver-b');
    expect(added[0].type).toBe('new_booking');
    expect(added[0].status).toBe('sent');
    expect(added[0].bookingId).toBe('book-99');
    expect(added[0].data.bookingId).toBe('book-99');
    expect(added[0].sentAt).toBeInstanceOf(Date);
    expect(added[0].errorMessage).toBeNull();
  });

  test('failed Expo ticket persists status failed with errorMessage', async () => {
    const record = buildDriverOfferNotificationRecord({
      userId: 'driver-x',
      bookingId: 'book-1',
      title: 'New order',
      body: 'Body',
      ticket: { status: 'error', message: 'DeviceNotRegistered' }
    });

    expect(record.status).toBe('failed');
    expect(record.errorMessage).toBe('DeviceNotRegistered');
    expect(record.type).toBe('new_booking');
  });

  test('log errors on individual docs do not throw', async () => {
    const db = {
      collection() {
        return {
          add: jest.fn(async () => {
            throw new Error('firestore down');
          })
        };
      }
    };

    await expect(logDriverNewBookingOfferPushResults(db, {
      driverIds: ['d1'],
      tickets: [{ status: 'ok' }],
      bookingId: 'b1',
      title: 't',
      body: 'b'
    })).resolves.toEqual({ logged: 0 });
  });
});

describe('expoPushService pushContexts failure logging', () => {
  test('uses per-token pushContexts userId on failure', async () => {
    const ExpoPushService = require('../src/services/expoPushService');
    const service = new ExpoPushService.constructor();
    service.expo = {
      sendPushNotificationsAsync: jest.fn(async () => ([
        { status: 'ok' },
        { status: 'error', message: 'DeviceNotRegistered' }
      ]))
    };
    service.chunkArray = (arr) => [arr];
    service.removeUndefinedValues = (obj) => obj;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const tokens = [
      'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]',
      'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]'
    ];

    await service.sendToTokens(tokens, { type: 'new_booking', bookingId: 'b1' }, {
      pushContexts: [
        { userId: 'driver-1', notificationType: 'new_booking' },
        { userId: 'driver-2', notificationType: 'new_booking' }
      ]
    });

    const failureLog = warnSpy.mock.calls.find(
      (call) => call[0] === '[ExpoPushService] Push failure:'
    );
    expect(failureLog).toBeDefined();
    expect(failureLog[1].userId).toBe('driver-2');
    expect(failureLog[1].notificationType).toBe('new_booking');
    expect(failureLog[1].tokenIndex).toBe(1);

    warnSpy.mockRestore();
  });
});
