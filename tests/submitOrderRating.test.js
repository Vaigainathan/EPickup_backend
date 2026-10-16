const { getFirestore } = require('../src/services/firebase');
const { submitOrderRating } = require('../src/services/marketplace/submitOrderRating');
const { recomputeDriverRating } = require('../src/services/bookingDriverRating');
const { wrapStrictTransaction } = require('./helpers/strictFirestoreTransaction');

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

jest.mock('../src/services/bookingDriverRating', () => {
  const actual = jest.requireActual('../src/services/bookingDriverRating');
  return {
    ...actual,
    recomputeDriverRating: jest.fn().mockResolvedValue({ averageRating: 4, totalRatings: 1 })
  };
});

const ORDER_ID = 'order-1';
const CUSTOMER_ID = 'customer-1';
const BOOKING_ID = 'H4XlfU7L3oYABjWCOAc6';
const DRIVER_ID = 'stage2testdriver00000000000001';
const SHOP_ID = 'shop-1';

function queryRef(collectionName, filters) {
  return {
    __collection: collectionName,
    __filters: filters,
    path: `${collectionName}?query`
  };
}

function makeDocRef(path) {
  const id = path.split('/').pop();
  return {
    path,
    id,
    collection(subName) {
      return makeCollectionRef(`${path}/${subName}`);
    }
  };
}

function makeCollectionRef(collectionPath) {
  let generatedId = 0;
  const collectionName = collectionPath.split('/').pop();

  function doc(id) {
    const docId = id || `generated-${generatedId += 1}`;
    return makeDocRef(`${collectionPath}/${docId}`);
  }

  return {
    doc,
    where(field, op, value) {
      const filters = [{ field, op, value }];
      const chain = {
        where(field2, op2, value2) {
          filters.push({ field: field2, op: op2, value: value2 });
          return chain;
        },
        limit() {
          return queryRef(collectionName, filters);
        }
      };
      return chain;
    }
  };
}

function isSetWrite(row) {
  return row && (row.op === 'set' || row.type === 'set');
}

function expectRatedEventAndSignalWrites(writes) {
  const eventsPathPrefix = `marketplaceOrders/${ORDER_ID}/events/`;
  const signalPath = `marketplaceOrders/${ORDER_ID}/signal/latest`;
  const eventWrite = writes.find((row) => isSetWrite(row) && row.path.startsWith(eventsPathPrefix));
  const signalWrite = writes.find((row) => isSetWrite(row) && row.path === signalPath);

  expect(eventWrite).toBeDefined();
  expect(eventWrite.data).toMatchObject({
    type: 'rated',
    actor: { type: 'customer', id: CUSTOMER_ID },
    data: null
  });
  expect(signalWrite).toBeDefined();
  expect(signalWrite.data).toMatchObject({
    type: 'rated',
    customerId: CUSTOMER_ID
  });
}

function createMockDb({ existingBookingRating = false } = {}) {
  const writes = [];

  const docStore = {
    [`marketplaceOrders/${ORDER_ID}`]: {
      customerId: CUSTOMER_ID,
      orderStatus: 'completed',
      shopId: SHOP_ID,
      linkedBookingId: BOOKING_ID
    },
    [`bookings/${BOOKING_ID}`]: { driverId: DRIVER_ID },
    [`shops/${SHOP_ID}`]: { rating: { sum: 8, count: 2, average: 4 } }
  };

  const shopRatingExists = false;

  const ratingsQueryDocs = existingBookingRating
    ? [{
      id: 'rating-existing',
      data: {
        bookingId: BOOKING_ID,
        customerId: CUSTOMER_ID,
        driverId: DRIVER_ID,
        rating: 5
      }
    }]
    : [];

  function documentSnapshot(path) {
    if (path.startsWith('shopRatings/')) {
      return { exists: shopRatingExists, data: () => ({}) };
    }
    const data = docStore[path];
    if (!data) {
      return { exists: false, data: () => ({}) };
    }
    return { exists: true, data: () => data };
  }

  function resolveGet(ref) {
    if (ref && ref.__collection === 'ratings') {
      return {
        empty: ratingsQueryDocs.length === 0,
        docs: ratingsQueryDocs.map((row) => ({
          id: row.id,
          data: () => row.data
        }))
      };
    }
    return documentSnapshot(ref.path);
  }

  function documentPath(ref) {
    if (!ref) {
      return '';
    }
    if (typeof ref.path === 'string') {
      return ref.path;
    }
    if (typeof ref.id === 'string') {
      return ref.id;
    }
    return '';
  }

  const baseTx = {
    async get(ref) {
      return resolveGet(ref);
    },
    set(ref, data, options) {
      writes.push({ op: 'set', path: documentPath(ref), data, options });
    },
    update(ref, data) {
      writes.push({ op: 'update', path: documentPath(ref), data });
    }
  };

  const db = {
    writes,
    runTransaction(fn) {
      const tx = wrapStrictTransaction(baseTx);
      return fn(tx);
    },
    collection(name) {
      return makeCollectionRef(name);
    }
  };

  return db;
}

describe('submitOrderRating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getFirestore.mockReset();
  });

  test('shop and driver together returns 200 without read-after-write', async () => {
    const db = createMockDb();
    getFirestore.mockReturnValue(db);
    const result = await submitOrderRating({
      customerId: CUSTOMER_ID,
      orderId: ORDER_ID,
      body: {
        shop: { stars: 4, tags: ['Good value'] },
        driver: { stars: 4, tags: ['On time', 'Polite', 'Followed instructions'] }
      }
    });
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.data.order.rating).toEqual({
      shopStars: 4,
      driverStars: 4,
      ratedAt: expect.any(String)
    });
    expectRatedEventAndSignalWrites(db.writes);
    expect(recomputeDriverRating).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
    expect(recomputeDriverRating).toHaveBeenCalledWith(expect.anything(), DRIVER_ID);
  });

  test('shop only returns 200 without read-after-write', async () => {
    const db = createMockDb();
    getFirestore.mockReturnValue(db);
    const result = await submitOrderRating({
      customerId: CUSTOMER_ID,
      orderId: ORDER_ID,
      body: {
        shop: { stars: 5, tags: ['Good quality'] }
      }
    });
    expect(result.status).toBe(200);
    expect(result.body.data.order.rating).toEqual({
      shopStars: 5,
      driverStars: null,
      ratedAt: expect.any(String)
    });
    expectRatedEventAndSignalWrites(db.writes);
    expect(recomputeDriverRating).not.toHaveBeenCalled();
  });

  test('driver only returns 200 without read-after-write', async () => {
    const db = createMockDb();
    getFirestore.mockReturnValue(db);
    const result = await submitOrderRating({
      customerId: CUSTOMER_ID,
      orderId: ORDER_ID,
      body: {
        driver: { stars: 3, tags: ['On time'] }
      }
    });
    expect(result.status).toBe(200);
    expect(result.body.data.order.rating).toEqual({
      shopStars: null,
      driverStars: 3,
      ratedAt: expect.any(String)
    });
    expectRatedEventAndSignalWrites(db.writes);
    await new Promise((resolve) => setImmediate(resolve));
    expect(recomputeDriverRating).toHaveBeenCalled();
  });

  test('existing booking driver rating returns 409 ALREADY_RATED', async () => {
    const db = createMockDb({ existingBookingRating: true });
    getFirestore.mockReturnValue(db);
    await expect(submitOrderRating({
      customerId: CUSTOMER_ID,
      orderId: ORDER_ID,
      body: {
        driver: { stars: 4, tags: ['On time'] }
      }
    })).rejects.toMatchObject({
      status: 409,
      code: 'ALREADY_RATED'
    });
    const eventWrite = db.writes.find((row) => isSetWrite(row)
      && row.path.startsWith(`marketplaceOrders/${ORDER_ID}/events/`));
    const signalWrite = db.writes.find((row) => isSetWrite(row)
      && row.path === `marketplaceOrders/${ORDER_ID}/signal/latest`);
    expect(eventWrite).toBeUndefined();
    expect(signalWrite).toBeUndefined();
  });
});
