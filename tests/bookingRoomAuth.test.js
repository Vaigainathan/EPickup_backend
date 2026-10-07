const { applyJoinBookingRoom, applyJoinBooking } = require('../src/services/bookingRoomAuth');
const WebSocketEventHandler = require('../src/services/websocketEventHandler');

function fakeSocket(user) {
  const events = [];
  const joined = [];
  return {
    id: 'sock-1',
    userId: user.userId,
    userType: user.userType,
    userRole: user.userRole || user.userType,
    userRooms: new Set(),
    join(room) {
      joined.push(room);
    },
    emit(name, payload) {
      events.push({ name, payload });
    },
    events,
    joined
  };
}

function fakeDb(bookings) {
  const rooms = new Map();
  return {
    rooms,
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              const data = name === 'bookings' ? bookings[id] : undefined;
              return {
                exists: data !== undefined,
                data: () => data
              };
            },
            async set(value) {
              rooms.set(`${name}/${id}`, value);
            }
          };
        }
      };
    }
  };
}

function joinedEvent(socket) {
  return socket.events.find((event) => event.name === 'booking-room-joined');
}

function errorEvent(socket) {
  return socket.events.find((event) => event.name === 'error');
}

describe('booking room membership', () => {
  const pending = {
    'book-1': { customerId: 'cust-1', status: 'pending' }
  };

  test('the customer joins their pending booking before a driver is assigned', async () => {
    const db = fakeDb(pending);
    const socket = fakeSocket({ userId: 'cust-1', userType: 'customer' });
    await applyJoinBookingRoom(socket, { bookingId: 'book-1' }, db);
    expect(socket.joined).toEqual(['booking:book-1']);
    expect(joinedEvent(socket).payload).toMatchObject({
      success: true,
      bookingId: 'book-1',
      room: 'booking:book-1'
    });
    expect(joinedEvent(socket).payload.timestamp).toEqual(expect.any(String));

    const other = fakeSocket({ userId: 'cust-1', userType: 'customer' });
    await applyJoinBooking(other, 'book-1', db);
    expect(other.joined).toEqual(['booking:book-1']);
    expect(joinedEvent(other).payload).toEqual({
      success: true,
      bookingId: 'book-1',
      room: 'booking:book-1'
    });
    expect(db.rooms.has('websocket_rooms/book-1:cust-1')).toBe(true);
  });

  test('the assigned driver and an admin join, and other callers do not', async () => {
    const db = fakeDb({
      'book-1': { customerId: 'cust-1', driverId: 'drv-1', status: 'driver_assigned' }
    });

    const driver = fakeSocket({ userId: 'drv-1', userType: 'driver' });
    await applyJoinBooking(driver, 'book-1', db);
    expect(driver.joined).toEqual(['booking:book-1']);

    const admin = fakeSocket({ userId: 'adm-1', userType: 'admin' });
    await applyJoinBookingRoom(admin, 'book-1', db);
    expect(admin.joined).toEqual(['booking:book-1']);

    const stranger = fakeSocket({ userId: 'cust-2', userType: 'customer' });
    await applyJoinBookingRoom(stranger, { bookingId: 'book-1' }, db);
    await applyJoinBooking(stranger, 'book-1', db);
    expect(stranger.joined).toEqual([]);
    expect(stranger.events.filter((event) => event.name === 'booking-room-joined')).toHaveLength(0);
    expect(stranger.events.map((event) => event.payload.code)).toEqual([
      'PERMISSION_DENIED',
      'PERMISSION_DENIED'
    ]);
    expect(stranger.events[0].payload.timestamp).toEqual(expect.any(String));
    expect(stranger.events[1].payload.timestamp).toBeUndefined();

    const shop = fakeSocket({ userId: 'shop-1', userType: 'shop' });
    await applyJoinBooking(shop, 'book-1', db);
    expect(shop.joined).toEqual([]);
    expect(errorEvent(shop).payload.code).toBe('PERMISSION_DENIED');
  });

  test('a missing booking and a terminal booking are refused on both events', async () => {
    const missingDb = fakeDb({});
    const missing = fakeSocket({ userId: 'cust-1', userType: 'customer' });
    await applyJoinBookingRoom(missing, 'missing', missingDb);
    await applyJoinBooking(missing, 'missing', missingDb);
    expect(missing.joined).toEqual([]);
    expect(missing.events.map((event) => event.payload.code)).toEqual([
      'BOOKING_NOT_FOUND',
      'BOOKING_NOT_FOUND'
    ]);

    const doneDb = fakeDb({
      'book-1': { customerId: 'cust-1', status: 'completed' }
    });
    const owner = fakeSocket({ userId: 'cust-1', userType: 'customer' });
    await applyJoinBookingRoom(owner, 'book-1', doneDb);
    await applyJoinBooking(owner, 'book-1', doneDb);
    expect(owner.joined).toEqual([]);
    expect(owner.events.map((event) => event.payload.code)).toEqual([
      'BOOKING_NOT_ACTIVE',
      'BOOKING_NOT_ACTIVE'
    ]);
    expect(owner.events[0].payload.message).toBe('Booking is in terminal state: completed');
  });
});

describe('trip tracking and other room prefixes', () => {
  function handlerWith(bookings) {
    const handler = new WebSocketEventHandler();
    handler.db = fakeDb(bookings);
    handler.firestoreSessionService = { setCache: async () => {} };
    handler.realTimeService = { getRealTimeTripData: async () => null };
    return handler;
  }

  const trip = {
    'trip-1': { customerId: 'cust-1', driverId: 'drv-1', status: 'driver_assigned' }
  };

  test('subscribe_tracking uses the socket user and ignores the payload user id', async () => {
    const handler = handlerWith(trip);
    const customer = fakeSocket({ userId: 'cust-1', userType: 'customer' });
    await handler.handleTrackingSubscription(customer, { tripId: 'trip-1', userId: 'someone-else' });
    expect(customer.joined).toEqual(['trip:trip-1']);
    expect(customer.events.some((event) => event.name === 'tracking_subscribed')).toBe(true);

    const driver = fakeSocket({ userId: 'drv-1', userType: 'driver' });
    await handler.handleTrackingSubscription(driver, { tripId: 'trip-1', userId: 'cust-1' });
    expect(driver.joined).toEqual(['trip:trip-1']);

    const admin = fakeSocket({ userId: 'adm-1', userType: 'admin' });
    await handler.handleTrackingSubscription(admin, { tripId: 'trip-1', userId: 'cust-1' });
    expect(admin.joined).toEqual(['trip:trip-1']);

    const outsider = fakeSocket({ userId: 'cust-2', userType: 'customer' });
    await handler.handleTrackingSubscription(outsider, { tripId: 'trip-1', userId: 'cust-1' });
    expect(outsider.joined).toEqual([]);
    expect(errorEvent(outsider).payload.code).toBe('ACCESS_DENIED');
  });

  test('join_room booking rooms use the booking check', async () => {
    const handler = handlerWith({
      'book-1': { customerId: 'cust-1', status: 'pending' }
    });
    const stranger = fakeSocket({ userId: 'cust-2', userType: 'customer' });
    await handler.handleRoomJoin(stranger, { room: 'booking:book-1' });
    expect(stranger.joined).toEqual([]);
    expect(errorEvent(stranger).payload.code).toBe('PERMISSION_DENIED');
    expect(stranger.events.some((event) => event.name === 'room_joined')).toBe(false);
  });

  test('user, customer, driver, and location rooms must name this socket user', async () => {
    const handler = new WebSocketEventHandler();
    const customer = fakeSocket({ userId: 'cust-1', userType: 'customer' });
    const driver = fakeSocket({ userId: 'drv-1', userType: 'driver' });
    const admin = fakeSocket({ userId: 'adm-1', userType: 'admin' });

    expect(handler.checkRoomPermission('customer', 'customer', 'user:cust-1', 'cust-1')).toBe(true);
    expect(handler.checkRoomPermission('customer', 'customer', 'customer_cust-1', 'cust-1')).toBe(true);
    expect(handler.checkRoomPermission('customer', 'customer', 'user:other', 'cust-1')).toBe(false);
    expect(handler.checkRoomPermission('customer', 'customer', 'customer_other', 'cust-1')).toBe(false);
    expect(handler.checkRoomPermission('customer', 'customer', 'location_cust-1', 'cust-1')).toBe(false);

    expect(handler.checkRoomPermission('driver', 'driver', 'user:drv-1', 'drv-1')).toBe(true);
    expect(handler.checkRoomPermission('driver', 'driver', 'driver_drv-1', 'drv-1')).toBe(true);
    expect(handler.checkRoomPermission('driver', 'driver', 'location_drv-1', 'drv-1')).toBe(true);
    expect(handler.checkRoomPermission('driver', 'driver', 'user:other', 'drv-1')).toBe(false);
    expect(handler.checkRoomPermission('driver', 'driver', 'driver_other', 'drv-1')).toBe(false);
    expect(handler.checkRoomPermission('driver', 'driver', 'location_other', 'drv-1')).toBe(false);

    expect(handler.checkRoomPermission('admin', 'admin', 'user:other', 'adm-1')).toBe(true);

    await handler.handleRoomJoin(customer, { room: 'user:other' });
    expect(customer.joined).toEqual([]);
    expect(errorEvent(customer).payload.code).toBe('ROOM_ACCESS_DENIED');

    await handler.handleRoomJoin(driver, { room: 'location_drv-1' });
    expect(driver.joined).toEqual(['location_drv-1']);

    await handler.handleRoomJoin(admin, { room: 'user:other' });
    expect(admin.joined).toEqual(['user:other']);
  });
});
