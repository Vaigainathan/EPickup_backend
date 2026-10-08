const mockDocs = new Map();
const mockSets = [];
let mockEventSeq = 0;

function mockClone(value) {
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (typeof value.toMillis === 'function' || value instanceof Date) {
    return value;
  }
  if (value.constructor && value.constructor.name !== 'Object' && value.constructor.name !== 'Array') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(mockClone);
  }
  const copy = {};
  Object.keys(value).forEach((key) => {
    copy[key] = mockClone(value[key]);
  });
  return copy;
}

function isDelete(value) {
  return Boolean(value && value.constructor && value.constructor.name === 'DeleteTransform');
}

function mockApplyPatch(target, patch) {
  Object.keys(patch).forEach((key) => {
    if (isDelete(patch[key])) {
      if (!key.includes('.')) {
        delete target[key];
      }
      return;
    }
    if (!key.includes('.')) {
      target[key] = patch[key];
      return;
    }
    const parts = key.split('.');
    let cursor = target;
    for (let index = 0; index < parts.length - 1; index += 1) {
      if (!cursor[parts[index]] || typeof cursor[parts[index]] !== 'object') {
        cursor[parts[index]] = {};
      }
      cursor = cursor[parts[index]];
    }
    cursor[parts[parts.length - 1]] = patch[key];
  });
  return target;
}

function mockRef(path) {
  const id = path.split('/').pop();
  const ref = {
    id,
    path,
    collection(name) {
      const prefix = `${path}/${name}/`;
      return {
        doc(subId) {
          const child = subId || `auto-${mockEventSeq += 1}`;
          return mockRef(`${path}/${name}/${child}`);
        },
        async get() {
          const docs = [];
          mockDocs.forEach((data, docPath) => {
            if (!docPath.startsWith(prefix)) {
              return;
            }
            const rest = docPath.slice(prefix.length);
            if (!rest || rest.includes('/')) {
              return;
            }
            docs.push({
              id: rest,
              ref: mockRef(docPath),
              data: () => mockClone(data)
            });
          });
          return { docs, empty: docs.length === 0, size: docs.length };
        }
      };
    },
    async get() {
      const data = mockDocs.get(path);
      return {
        exists: data !== undefined,
        id,
        ref,
        data: () => (data === undefined ? undefined : mockClone(data))
      };
    }
  };
  ref.firestore = mockDb();
  return ref;
}

function mockDb() {
  return {
    collection(name) {
      return {
        doc(id) {
          const child = id || `auto-${mockEventSeq += 1}`;
          return mockRef(`${name}/${child}`);
        },
        where() {
          return this;
        },
        onSnapshot() {
          return () => {};
        }
      };
    },
    async runTransaction(fn) {
      const tx = {
        async get(ref) {
          return ref.get();
        },
        set(ref, data) {
          mockSets.push({ path: ref.path, data });
          mockDocs.set(ref.path, mockClone(data));
        },
        update(ref, patch) {
          const current = mockClone(mockDocs.get(ref.path) || {});
          mockDocs.set(ref.path, mockApplyPatch(current, patch));
        },
        delete(ref) {
          mockDocs.delete(ref.path);
        }
      };
      return fn(tx);
    }
  };
}

jest.mock('../src/services/firebase', () => ({
  getFirestore: () => mockDb()
}));

jest.mock('../src/services/notificationService', () => {
  const sendTemplateNotification = jest.fn(async () => ({ success: true }));
  return {
    sendTemplateNotification,
    sendToUser: jest.fn(async () => ({ success: true }))
  };
});

jest.mock('../src/services/fareCalculationService', () => {
  const calculateDistanceAndFare = jest.fn();
  return {
    calculateDistanceAndFare,
    isFareUnavailableError: (error) => Boolean(error && error.code === 'FARE_UNAVAILABLE'),
    FARE_UNAVAILABLE_DETAILS: 'unavailable'
  };
});

jest.mock('../src/services/websocketEventHandler', () => {
  const notifyDriversOfNewBooking = jest.fn(async () => {});
  function WebSocketEventHandler() {}
  WebSocketEventHandler.prototype.initialize = jest.fn(async () => {});
  WebSocketEventHandler.prototype.notifyDriversOfNewBooking = (...args) => notifyDriversOfNewBooking(...args);
  WebSocketEventHandler.notifyDriversOfNewBooking = notifyDriversOfNewBooking;
  return WebSocketEventHandler;
});

const fareCalculationService = require('../src/services/fareCalculationService');
const WebSocketEventHandler = require('../src/services/websocketEventHandler');
const notificationService = require('../src/services/notificationService');
const shopOrderService = require('../src/services/shopOrderService');
const marketplaceSyncService = require('../src/services/marketplaceSyncService');
const { NotificationTemplateProcessor } = require('../src/services/notificationTemplates');
const { fareFieldsFromCalculation } = require('../src/services/fareQuoteService');

const FARE = {
  distanceKm: 3.6,
  fare: {
    exactDistanceKm: 3.6,
    roundedDistanceKm: 4,
    totalFare: 40,
    baseFare: 40,
    commission: 4.6,
    driverEarnings: 35.4,
    breakdown: { pricingVersion: 2 }
  }
};

function order(id) {
  return mockDocs.get(`marketplaceOrders/${id}`);
}

function bookings() {
  const found = [];
  mockDocs.forEach((data, path) => {
    if (path.startsWith('bookings/') && path.split('/').length === 2) {
      found.push(data);
    }
  });
  return found;
}

function events(id) {
  const prefix = `marketplaceOrders/${id}/events/`;
  const found = [];
  mockDocs.forEach((data, path) => {
    if (path.startsWith(prefix) && path.split('/').length === 4) {
      found.push(data);
    }
  });
  return found;
}

function seedOrder(id, extra = {}) {
  mockDocs.set('users/shop-1', {
    name: 'Shop',
    phone: '9000000000',
    shop: { shopName: 'Vaigzz' }
  });
  mockDocs.set('shops/shop-1', {
    location: { latitude: 12.5, longitude: 78.6 },
    address: 'Shop street',
    orderCount: 3
  });
  mockDocs.set('users/cust-1', { name: 'Customer', phone: '9000000001' });
  mockDocs.set(`marketplaceOrders/${id}`, {
    customerId: 'cust-1',
    shopId: 'shop-1',
    displayId: 22036,
    orderStatus: 'preparing',
    shopSnapshot: { name: 'Vaigzz' },
    items: [{ id: 'line0', qty: 1, stockDeducted: 1, price: 10 }],
    itemsTotal: 10,
    deliveryAddress: {
      text: 'Home',
      coordinates: { latitude: 12.52, longitude: 78.62 }
    },
    riderNoteText: 'gate 2',
    payment: { status: 'confirmed', amount: 10 },
    ...extra
  });
}

beforeEach(() => {
  mockDocs.clear();
  mockSets.length = 0;
  mockEventSeq = 0;
  fareCalculationService.calculateDistanceAndFare.mockReset();
  fareCalculationService.calculateDistanceAndFare.mockResolvedValue(FARE);
  WebSocketEventHandler.notifyDriversOfNewBooking.mockClear();
  notificationService.sendTemplateNotification.mockClear();
});

describe('markReady', () => {
  test('stockShortOpen returns 409 and writes no booking', async () => {
    seedOrder('order-1', {
      items: [{ id: 'line0', qty: 2, stockDeducted: 1, price: 10 }]
    });
    await expect(shopOrderService.markReady('shop-1', 'order-1')).rejects.toMatchObject({
      status: 409,
      code: 'STOCK_SHORT_UNRESOLVED'
    });
    expect(bookings()).toHaveLength(0);
    expect(order('order-1').orderStatus).toBe('preparing');
    expect(WebSocketEventHandler.notifyDriversOfNewBooking).not.toHaveBeenCalled();
  });

  test('full stock writes one booking and a second call writes nothing', async () => {
    seedOrder('order-1');
    const first = await shopOrderService.markReady('shop-1', 'order-1');
    const booking = bookings()[0];
    const built = fareFieldsFromCalculation(FARE.fare, FARE.distanceKm);

    expect(first.alreadyProcessed).toBe(false);
    expect(first.order.orderStatus).toBe('ready');
    expect(first.order.delivery).toEqual({ stage: 'searching', fare: 40 });
    expect(first.order.deliveryFee).toBe(40);
    expect(bookings()).toHaveLength(1);
    expect(booking.displayId).toBe(22036);
    expect(booking.sourceType).toBe('marketplace');
    expect(booking.paymentMethod).toBe('cash');
    expect(booking.package.weight).toBe(1);
    expect(booking.dropoff.instructions).toBe('gate 2');
    expect(booking.dropoff.landmark).toBeUndefined();
    expect(booking.fare).toEqual(built.fare);
    expect(booking.pricing).toEqual(built.pricing);
    expect(booking.exactDistance).toBe(built.exactDistance);
    expect(typeof booking.distance).toBe('number');
    expect(booking.distance).toBe(built.distance);
    expect(order('order-1').deliveryFee).toBe(booking.fare.totalFare);
    expect(order('order-1').delivery.stage).toBe('searching');
    expect(order('order-1').readyAt.constructor.name).toBe('ServerTimestampTransform');
    expect(events('order-1').map((event) => event.type)).toEqual(['marked_ready']);
    expect(events('order-1')[0].data).toEqual({ bookingId: booking.id, stage: 'searching' });
    expect(WebSocketEventHandler.notifyDriversOfNewBooking).toHaveBeenCalledTimes(1);
    expect(notificationService.sendTemplateNotification).toHaveBeenCalledWith(
      'cust-1',
      'MARKETPLACE',
      'ORDER_PACKED',
      expect.objectContaining({ orderId: 'order-1', shopName: 'Vaigzz', deliveryFee: 40 })
    );

    const second = await shopOrderService.markReady('shop-1', 'order-1');
    expect(second.alreadyProcessed).toBe(true);
    expect(bookings()).toHaveLength(1);
    expect(events('order-1')).toHaveLength(1);
    expect(WebSocketEventHandler.notifyDriversOfNewBooking).toHaveBeenCalledTimes(1);
    expect(fareCalculationService.calculateDistanceAndFare).toHaveBeenCalledTimes(1);
  });

  test('a fare error writes nothing', async () => {
    seedOrder('order-1');
    fareCalculationService.calculateDistanceAndFare.mockRejectedValueOnce(
      Object.assign(new Error('down'), { code: 'FARE_UNAVAILABLE' })
    );
    await expect(shopOrderService.markReady('shop-1', 'order-1')).rejects.toMatchObject({
      status: 503,
      code: 'FARE_UNAVAILABLE'
    });
    expect(bookings()).toHaveLength(0);
    expect(order('order-1').orderStatus).toBe('preparing');
  });

  test('notifyDrivers false does not call notifyDriversOfNewBooking', async () => {
    seedOrder('order-1');
    await shopOrderService.markReady('shop-1', 'order-1', { notifyDrivers: false });
    expect(bookings()).toHaveLength(1);
    expect(WebSocketEventHandler.notifyDriversOfNewBooking).not.toHaveBeenCalled();
  });

  test('a driver notify failure leaves the ready order in place', async () => {
    seedOrder('order-1');
    WebSocketEventHandler.notifyDriversOfNewBooking.mockRejectedValueOnce(new Error('push down'));
    const result = await shopOrderService.markReady('shop-1', 'order-1');
    expect(result.order.orderStatus).toBe('ready');
    expect(bookings()).toHaveLength(1);
  });
});

describe('delivery sync', () => {
  const { planDeliverySync } = marketplaceSyncService;

  test('every status maps to its stage', () => {
    Object.entries(marketplaceSyncService.STATUS_TO_STAGE).forEach(([status, stage]) => {
      const plan = planDeliverySync({ orderStatus: 'ready' }, { status, fare: { totalFare: 40 } });
      expect(plan.stage).toBe(stage);
    });
  });

  test('money_collection after delivered stays delivered', () => {
    const plan = planDeliverySync({
      orderStatus: 'handed_over',
      delivery: { stage: 'delivered', fare: 40 },
      deliveryFee: 40
    }, { status: 'money_collection', fare: { totalFare: 40 } });
    expect(plan.stage).toBe('delivered');
    expect(plan.event).toBeNull();
    expect(plan.complete).toBe(false);
    expect(plan.push).toBeNull();
    expect(plan.fare).toBeUndefined();
  });

  test('pending before pickup returns to searching and pending after pickup keeps the stage', () => {
    const before = planDeliverySync({
      orderStatus: 'ready',
      delivery: { stage: 'assigned', fare: 40 },
      deliveryFee: 40,
      driverInfo: { name: 'Ravi', phone: '1', vehicle: 'TN01' }
    }, { status: 'pending' });
    expect(before.stage).toBe('searching');
    expect(before.clearDriverInfo).toBe(true);
    expect(before.event).toEqual({ stage: 'searching', bookingStatus: 'pending' });
    expect(before.supportAlert).toBeNull();
    expect(before.complete).toBe(false);

    const after = planDeliverySync({
      orderStatus: 'ready',
      delivery: { stage: 'picked_up', fare: 40 },
      deliveryFee: 40,
      driverInfo: { name: 'Ravi', phone: '1', vehicle: 'TN01' }
    }, { status: 'pending' });
    expect(after.stage).toBe('picked_up');
    expect(after.clearDriverInfo).toBe(false);
    expect(after.event).toEqual({ stage: 'picked_up', bookingStatus: 'pending', kept: true });
    expect(after.supportAlert).toBe('pending_after_pickup');
    expect(after.complete).toBe(false);
  });

  test('a cancelled booking sets the stage and leaves the order status', () => {
    const plan = planDeliverySync({
      orderStatus: 'ready',
      delivery: { stage: 'assigned' }
    }, { status: 'cancelled' });
    expect(plan.stage).toBe('cancelled');
    expect(plan.orderStatus).toBeNull();
    expect(plan.supportAlert).toBe('booking_cancelled');
    expect(plan.complete).toBe(false);
  });

  test('delivered while ready does not complete, and delivered while handed over completes once', async () => {
    seedOrder('order-ready', {
      orderStatus: 'ready',
      linkedBookingId: 'book-1',
      delivery: { stage: 'on_the_way', fare: 40 },
      deliveryFee: 40
    });
    mockDocs.set('bookings/book-1', { status: 'pending', fare: { totalFare: 40 } });
    const ready = await marketplaceSyncService.syncBooking({
      bookingId: 'book-1',
      booking: {
        status: 'delivered',
        marketplaceOrderId: 'order-ready',
        fare: { totalFare: 40 }
      }
    });
    expect(ready.plan.complete).toBe(false);
    expect(order('order-ready').orderStatus).toBe('ready');
    expect(order('order-ready').delivery.stage).toBe('delivered');
    expect(mockDocs.get('bookings/book-1').status).toBe('pending');
    expect(mockDocs.get('shops/shop-1').orderCount).toBe(3);

    seedOrder('order-hand', {
      orderStatus: 'handed_over',
      delivery: { stage: 'on_the_way', fare: 40 },
      deliveryFee: 40
    });
    const handed = await marketplaceSyncService.syncBooking({
      bookingId: 'book-2',
      booking: {
        status: 'delivered',
        marketplaceOrderId: 'order-hand',
        fare: { totalFare: 40 },
        driverInfo: { name: 'Ravi', phone: '1', vehicleNumber: 'TN01' }
      }
    });
    expect(handed.plan.complete).toBe(true);
    expect(order('order-hand').orderStatus).toBe('completed');
    expect(mockDocs.get('shops/shop-1').orderCount.constructor.name).toBe('NumericIncrementTransform');
    const pushes = notificationService.sendTemplateNotification.mock.calls.filter((call) => call[2] === 'ORDER_DELIVERED');
    expect(pushes).toHaveLength(2);

    notificationService.sendTemplateNotification.mockClear();
    const replay = await marketplaceSyncService.syncBooking({
      bookingId: 'book-2',
      booking: {
        status: 'delivered',
        marketplaceOrderId: 'order-hand',
        fare: { totalFare: 40 },
        driverInfo: { name: 'Ravi', phone: '1', vehicleNumber: 'TN01' }
      }
    });
    expect(replay.wrote).toBe(false);
    expect(notificationService.sendTemplateNotification).not.toHaveBeenCalled();
    expect(mockDocs.get('shops/shop-1').orderCount.constructor.name).toBe('NumericIncrementTransform');
  });

  test('a fare change updates deliveryFee and the same fare writes nothing', async () => {
    seedOrder('order-1', {
      orderStatus: 'ready',
      delivery: { stage: 'on_the_way', fare: 40 },
      deliveryFee: 40
    });
    const changed = await marketplaceSyncService.syncBooking({
      bookingId: 'book-1',
      booking: {
        status: 'in_transit',
        marketplaceOrderId: 'order-1',
        fare: { totalFare: 55 }
      }
    });
    expect(changed.wrote).toBe(true);
    expect(order('order-1').deliveryFee).toBe(55);
    expect(order('order-1').delivery.fare).toBe(55);
    expect(order('order-1').delivery.stage).toBe('on_the_way');
    expect(events('order-1')).toHaveLength(0);

    const same = await marketplaceSyncService.syncBooking({
      bookingId: 'book-1',
      booking: {
        status: 'in_transit',
        marketplaceOrderId: 'order-1',
        fare: { totalFare: 55 }
      }
    });
    expect(same.wrote).toBe(false);
  });

  test('the initial pending add and a removal are ignored', async () => {
    seedOrder('order-1', { orderStatus: 'ready', delivery: { stage: 'assigned' } });
    await marketplaceSyncService.handleChange({
      type: 'added',
      doc: {
        id: 'book-1',
        data: () => ({ status: 'pending', marketplaceOrderId: 'order-1' })
      }
    });
    expect(order('order-1').delivery.stage).toBe('assigned');
    const removed = await marketplaceSyncService.handleChange({ type: 'removed', doc: { id: 'book-1', data: () => ({}) } });
    expect(removed).toBeNull();
  });
});

describe('confirmHandover completion', () => {
  test('handover completes once when the stage is already delivered', async () => {
    seedOrder('order-1', {
      orderStatus: 'ready',
      displayId: 12,
      delivery: { stage: 'delivered', fare: 40 },
      deliveryFee: 40
    });
    mockDocs.set('marketplaceOrders/order-1/private/handover', { otp: '123456' });
    const result = await shopOrderService.confirmHandover('shop-1', 'order-1', {
      otp: '123456',
      displayId: 12
    });
    expect(result.order.orderStatus).toBe('completed');
    expect(mockDocs.get('shops/shop-1').orderCount.constructor.name).toBe('NumericIncrementTransform');

    await expect(shopOrderService.confirmHandover('shop-1', 'order-1', {
      otp: '123456',
      displayId: 12
    })).rejects.toMatchObject({ status: 409, code: 'INVALID_TRANSITION' });
  });
});

describe('marketplace push data', () => {
  test.each(['ORDER_PACKED', 'ORDER_ASSIGNED', 'DRIVER_AT_SHOP', 'ORDER_DELIVERED'])('%s data is the five ids', (name) => {
    const template = NotificationTemplateProcessor.getTemplate('MARKETPLACE', name);
    const notification = NotificationTemplateProcessor.process(template, {
      displayId: '#22036',
      orderId: 'order-1',
      shopName: 'Vaigzz',
      action: 'view_order',
      deliveryFee: 40
    });
    expect(Object.keys(notification.data).sort()).toEqual(['action', 'displayId', 'orderId', 'shopName', 'type']);
    expect(notification.data.variables).toBeUndefined();
    if (name === 'ORDER_PACKED') {
      expect(notification.body).toContain('₹40');
    }
  });
});
