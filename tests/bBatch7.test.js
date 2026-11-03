/**
 * B-BATCH-7 — revenue trends, admin booking statusUpdates, tracking auth, support redaction.
 */

jest.mock('sanitize-html', () => jest.fn((value) => value));

jest.mock('firebase-admin', () => {
  const FieldValue = {
    serverTimestamp: jest.fn(() => ({ __ts: true })),
    increment: jest.fn((n) => n),
    delete: jest.fn(() => ({ __delete: true }))
  };
  return {
    apps: [{ name: '[DEFAULT]' }],
    initializeApp: jest.fn(),
    app: jest.fn(),
    auth: jest.fn(() => ({})),
    messaging: jest.fn(() => ({})),
    credential: { cert: jest.fn() },
    firestore: Object.assign(jest.fn(), { FieldValue })
  };
});

const REAL_FIRESTORE_GUARD = process.env.JEST_ALLOW_REAL_FIRESTORE === '1';

function assertNoRealFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!REAL_FIRESTORE_GUARD && projectId && projectId !== 'unit-test') {
    throw new Error(
      `Refusing tests: FIREBASE_PROJECT_ID=${projectId}. Set JEST_ALLOW_REAL_FIRESTORE=1 to override.`
    );
  }
}

process.env.FIREBASE_PROJECT_ID = 'unit-test';
assertNoRealFirestore();

describe('B-BATCH-7 getRevenueTrends', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.dontMock('../src/services/firebase');
  });

  afterEach(() => {
    jest.resetModules();
  });

  it('maps driverTopUps buckets to dashboard { date, value } series', async () => {
    const createdAt = new Date('2026-06-15T10:00:00.000Z');
    const docs = [
      {
        id: 't1',
        data: () => ({ status: 'completed', amount: 100, createdAt })
      },
      {
        id: 't2',
        data: () => ({ status: 'completed', realMoneyAmount: 50, createdAt })
      }
    ];
    const snapshot = {
      forEach: (cb) => {
        docs.forEach((d) => cb(d));
      }
    };
    const get = jest.fn().mockResolvedValue(snapshot);
    const chain = { where: jest.fn(() => chain), get };
    const collection = jest.fn(() => chain);

    jest.doMock('../src/services/firebase', () => ({
      getFirestore: jest.fn(() => ({ collection })),
      getFirebaseApp: jest.fn(() => ({}))
    }));

    const revenueService = require('../src/services/revenueService');
    const result = await revenueService.getRevenueTrends({
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      period: 'daily'
    });

    expect(result.success).toBe(true);
    expect(result.revenueSource).toBe('driverTopUps');
    expect(result.trends).toEqual([
      {
        date: '2026-06-15',
        value: 150,
        transactionCount: 2
      }
    ]);
  });
});

describe('B-BATCH-7 adminShopService support redaction', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/services/notificationService', () => ({}));
    jest.doMock('../src/services/firebase', () => ({
      getFirestore: jest.fn(() => ({
        collection: jest.fn((name) => ({
          doc: jest.fn(() => ({
            get: jest.fn(async () => {
              if (name === 'users') {
                return {
                  exists: true,
                  data: () => ({
                    userType: 'shop',
                    name: 'Test Shop',
                    shop: { shopName: 'Test Shop', approvalStatus: 'approved' }
                  })
                };
              }
              if (name === 'shops') {
                return {
                  exists: true,
                  data: () => ({
                    bank: { upiId: 'secret@upi', accountNumber: '1234567890' },
                    shopName: 'Test Shop'
                  })
                };
              }
              return { exists: false };
            })
          }))
        }))
      }))
    }));
    jest.doMock('../src/services/shopOnboardingService', () => ({
      getStatus: jest.fn().mockResolvedValue({ submitted: true })
    }));
  });

  it('getShopDetail omits profile.bank for support viewer', async () => {
    const adminShopService = require('../src/services/admin/adminShopService');
    const detail = await adminShopService.getShopDetail('shop-1', { viewerRole: 'support' });

    expect(detail.profile).toBeDefined();
    expect(detail.profile.bank).toBeUndefined();
    expect(detail.profile.accountNumber).toBeUndefined();
    expect(detail.upiVerified).toBe(false);
  });
});

describe('B-BATCH-7 admin driver wallet role gate', () => {
  const express = require('express');
  const request = require('supertest');

  function appForRole(role) {
    jest.resetModules();
    jest.doMock('../src/services/firebase', () => ({
      getFirestore: jest.fn(() => ({
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            get: jest.fn(async () => ({ exists: false }))
          }))
        }))
      }))
    }));
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { uid: 'admin-1', userType: 'admin', role };
      next();
    });
    app.use('/', require('../src/routes/admin'));
    return app;
  }

  it('returns 403 for support on GET /drivers/:id/wallet', async () => {
    const res = await request(appForRole('support')).get('/drivers/driver-1/wallet');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ADMIN_ROLE');
  });
});

describe('B-BATCH-7 POST /api/driver/tracking/update', () => {
  const express = require('express');
  const request = require('supertest');

  const mockBookingGet = jest.fn();
  const mockTripGet = jest.fn();
  const mockTripSet = jest.fn().mockResolvedValue(undefined);
  const mockTripUpdate = jest.fn().mockResolvedValue(undefined);
  const mockDriverLocSet = jest.fn().mockResolvedValue(undefined);
  const mockBookingUpdate = jest.fn().mockResolvedValue(undefined);

  const bookingRef = {
    get: mockBookingGet,
    update: mockBookingUpdate
  };

  const tripRef = {
    get: mockTripGet,
    set: mockTripSet,
    update: mockTripUpdate
  };

  const mockDb = {
    collection: jest.fn((name) => {
      if (name === 'bookings') {
        return { doc: jest.fn(() => bookingRef) };
      }
      if (name === 'tripTracking') {
        return { doc: jest.fn(() => tripRef) };
      }
      if (name === 'driverLocations') {
        return {
          doc: jest.fn(() => ({
            set: mockDriverLocSet
          }))
        };
      }
      return { doc: jest.fn() };
    })
  };

  function trackingApp(driverUid = 'driver-1') {
    jest.resetModules();
    jest.doMock('../src/middleware/auth', () => ({
      requireDriver: (req, _res, next) => next()
    }));
    jest.doMock('../src/services/firebase', () => ({
      getFirestore: jest.fn(() => mockDb),
      getStorage: jest.fn()
    }));
    jest.doMock('../src/services/socket', () => ({
      getSocketIO: jest.fn(() => null)
    }));
    jest.doMock('../src/services/bookingStateMachine', () => ({
      transitionBooking: jest.fn()
    }));
    jest.doMock('../src/services/driverStatusWorkflowService', () => ({
      driverStatusWorkflowService: { updateStatus: jest.fn() },
      DriverStatusError: class DriverStatusError extends Error {}
    }));
    jest.doMock('../src/services/bookingLockService', () => {
      return jest.fn().mockImplementation(() => ({}));
    });
    jest.doMock('../src/middleware/rateLimiter', () => ({
      documentStatusRateLimit: (_req, _res, next) => next()
    }));
    jest.doMock('../src/middleware/rateLimit', () => ({
      speedLimiter: (_req, _res, next) => next(),
      bookingStatusLimiter: (_req, _res, next) => next()
    }));
    jest.doMock('../src/middleware/cache', () => ({
      documentStatusCache: (_req, _res, next) => next(),
      invalidateUserCache: jest.fn()
    }));
    jest.doMock('../src/services/driverKycDocumentUrlService', () => ({
      listLatestDriverKycDocumentsFromStorage: jest.fn(),
      resolveDriverKycReadUrl: jest.fn(),
      presentDriverKycDocumentMap: jest.fn(),
      signDriverKycPath: jest.fn()
    }));
    jest.doMock('../src/middleware/idempotencyMiddleware', () => ({
      idempotencyKeyMiddleware: (_req, _res, next) => next()
    }));
    jest.doMock('../src/services/marketplace/driverMarketplaceAssignment', () => ({
      loadAssignedMarketplaceContext: jest.fn(),
      attachMarketplaceToDriverBooking: jest.fn()
    }));

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { uid: driverUid };
      next();
    });
    app.use('/api/driver', require('../src/routes/driver'));
    return app;
  }

  beforeEach(() => {
    mockBookingGet.mockReset();
    mockTripGet.mockReset();
    mockTripSet.mockReset();
    mockTripUpdate.mockReset();
    mockDriverLocSet.mockReset();
    mockBookingUpdate.mockReset();
    mockDb.collection.mockClear();
  });

  const locationBody = {
    bookingId: 'booking-1',
    location: { latitude: 12.97, longitude: 77.59, accuracy: 5 }
  };

  it('returns 403 when updating another driver booking', async () => {
    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({ driverId: 'other-driver', status: 'driver_assigned', customerId: 'cust-1' })
    });

    const res = await request(trackingApp('driver-1'))
      .post('/api/driver/tracking/update')
      .send(locationBody);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCESS_DENIED');
    expect(mockDriverLocSet).not.toHaveBeenCalled();
  });

  it('returns 200 for own active booking and writes tracking', async () => {
    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({
        driverId: 'driver-1',
        status: 'driver_assigned',
        customerId: 'cust-1',
        pickup: { coordinates: { lat: 1, lng: 2 } },
        dropoff: { coordinates: { lat: 3, lng: 4 } }
      })
    });
    mockTripGet.mockResolvedValue({ exists: false });

    const res = await request(trackingApp('driver-1'))
      .post('/api/driver/tracking/update')
      .send(locationBody);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockDriverLocSet).toHaveBeenCalled();
    expect(mockTripSet).toHaveBeenCalled();
    expect(mockBookingUpdate).toHaveBeenCalled();
  });

  it('returns 200 location-only for terminal booking without tripTracking patch', async () => {
    mockBookingGet.mockResolvedValue({
      exists: true,
      data: () => ({
        driverId: 'driver-1',
        status: 'completed',
        customerId: 'cust-1'
      })
    });

    const res = await request(trackingApp('driver-1'))
      .post('/api/driver/tracking/update')
      .send(locationBody);

    expect(res.status).toBe(200);
    expect(mockDriverLocSet).toHaveBeenCalled();
    expect(mockTripSet).not.toHaveBeenCalled();
    expect(mockTripUpdate).not.toHaveBeenCalled();
    expect(mockBookingUpdate).not.toHaveBeenCalled();
  });
});

describe('B-BATCH-7 marketplace driver location freshness', () => {
  const {
    locationFromFix,
    MARKETPLACE_DRIVER_LOCATION_MAX_AGE_MS
  } = require('../src/services/marketplace/customerDriverLocation');

  const linkedBookingId = 'booking-linked-1';
  const now = Date.parse('2026-06-01T12:00:00.000Z');

  const baseFix = {
    bookingId: linkedBookingId,
    latitude: 12.97,
    longitude: 77.59,
    lastUpdated: new Date(now - 3 * 60 * 1000)
  };

  it('uses a 5 minute max age window', () => {
    expect(MARKETPLACE_DRIVER_LOCATION_MAX_AGE_MS).toBe(5 * 60 * 1000);
  });

  it('returns location with updatedAt ISO when fix is 3 minutes old', () => {
    const location = locationFromFix(baseFix, linkedBookingId, now);
    expect(location).toEqual({
      lat: 12.97,
      lng: 77.59,
      updatedAt: new Date(now - 3 * 60 * 1000).toISOString()
    });
  });

  it('returns null when fix is 6 minutes old', () => {
    const location = locationFromFix(
      {
        ...baseFix,
        lastUpdated: new Date(now - 6 * 60 * 1000)
      },
      linkedBookingId,
      now
    );
    expect(location).toBeNull();
  });
});

describe('B-BATCH-7 admin booking statusUpdates', () => {
  const express = require('express');
  const request = require('supertest');

  it('returns statusUpdates sorted by timestamp with metadata notes', async () => {
    jest.resetModules();
    const statusDocs = [
      {
        id: 'late',
        data: () => ({
          bookingId: 'booking-1',
          status: 'driver_arrived',
          timestamp: '2026-02-02T12:00:00.000Z',
          metadata: { notes: 'arrived_unverified' }
        })
      },
      {
        id: 'early',
        data: () => ({
          bookingId: 'booking-1',
          status: 'driver_assigned',
          timestamp: '2026-02-01T08:00:00.000Z'
        })
      }
    ];

    jest.doMock('firebase-admin/firestore', () => ({
      getFirestore: jest.fn(() => ({
        collection: jest.fn((name) => {
          if (name === 'bookings') {
            return {
              doc: jest.fn(() => ({
                get: jest.fn(async () => ({
                  exists: true,
                  id: 'booking-1',
                  data: () => ({
                    customerId: 'cust-1',
                    status: 'driver_arrived'
                  })
                }))
              }))
            };
          }
          if (name === 'booking_status_updates') {
            return {
              where: jest.fn(() => ({
                limit: jest.fn(() => ({
                  get: jest.fn(async () => ({
                    docs: statusDocs
                  }))
                }))
              }))
            };
          }
          return { doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })) };
        })
      }))
    }));
    jest.doMock('../src/middleware/auth', () => jest.requireActual('../src/middleware/auth'));
    jest.doMock('../src/services/bookingStateMachine', () => ({
      getAllowedTransitions: jest.fn(() => [])
    }));

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { uid: 'admin-1', userType: 'admin', role: 'super_admin' };
      next();
    });
    app.use('/', require('../src/routes/admin'));

    const res = await request(app).get('/bookings/booking-1');
    expect(res.status).toBe(200);
    expect(res.body.data.statusUpdates).toHaveLength(2);
    expect(res.body.data.statusUpdates[0].status).toBe('driver_assigned');
    expect(res.body.data.statusUpdates[1].status).toBe('driver_arrived');
    expect(res.body.data.statusUpdates[1].notes).toBe('arrived_unverified');
  });
});
