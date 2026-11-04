/**
 * B-FIX-1 — getSocketIO, bookingStateMachine eventTimestamp, photoVerifications index.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

process.env.FIREBASE_PROJECT_ID = 'unit-test';
process.env.JWT_SECRET = 'unit-test-jwt-secret';

const mockUpdateStatus = jest.fn();
const mockPickupVerificationSet = jest.fn().mockResolvedValue(undefined);
const mockTripTrackingSet = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/middleware/auth', () => ({
  requireDriver: (req, res, next) => {
    req.user = { uid: 'driver-1', userType: 'driver' };
    next();
  }
}));

jest.mock('../src/middleware/rateLimit', () => ({
  speedLimiter: (req, res, next) => next(),
  bookingStatusLimiter: (req, res, next) => next()
}));

jest.mock('../src/middleware/rateLimiter', () => ({
  documentStatusRateLimit: (req, res, next) => next()
}));

jest.mock('../src/services/notificationService', () => ({
  sendToUser: jest.fn(async () => ({ success: true }))
}));

jest.mock('../src/services/liveTrackingService', () => ({
  updateBookingStatus: jest.fn(async () => ({}))
}));

jest.mock('../src/services/socket', () => ({
  getSocketIO: jest.fn(() => {
    throw new TypeError('require(...).getIO is not a function');
  })
}));

jest.mock('../src/services/driverStatusWorkflowService', () => {
  class DriverStatusError extends Error {
    constructor(statusCode, code, message, details = {}) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
      this.details = details;
    }
  }
  return {
    DriverStatusError,
    driverStatusWorkflowService: {
      updateStatus: (...args) => mockUpdateStatus(...args)
    }
  };
});

jest.mock('firebase-admin', () => ({
  apps: [{ name: '[DEFAULT]' }],
  initializeApp: jest.fn(),
  firestore: {
    Timestamp: {
      now: jest.fn(() => ({ __ts: true }))
    }
  }
}));

const emptyQuerySnapshot = {
  empty: true,
  docs: [],
  forEach: () => {}
};

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn((name) => {
      if (name === 'bookings') {
        return {
          doc: jest.fn(() => ({
            get: jest.fn(async () => ({
              exists: true,
              data: () => ({
                driverId: 'driver-1',
                customerId: 'customer-1',
                status: 'photo_captured',
                sourceType: 'parcel'
              })
            }))
          }))
        };
      }
      if (name === 'photoVerifications') {
        return {
          where: jest.fn(function () {
            return this;
          }),
          orderBy: jest.fn(function () {
            return this;
          }),
          limit: jest.fn(function () {
            return this;
          }),
          get: jest.fn(async () => emptyQuerySnapshot)
        };
      }
      if (name === 'pickupVerifications') {
        return {
          doc: jest.fn(() => ({
            set: mockPickupVerificationSet
          }))
        };
      }
      if (name === 'tripTracking') {
        return {
          doc: jest.fn(() => ({
            set: mockTripTrackingSet
          }))
        };
      }
      return { doc: jest.fn(() => ({ set: jest.fn(), get: jest.fn() })) };
    })
  }))
}));

describe('B-FIX-1', () => {
  beforeEach(() => {
    mockUpdateStatus.mockReset();
    mockPickupVerificationSet.mockClear();
    mockTripTrackingSet.mockClear();
    const eventTs = new Date('2026-11-04T11:30:00.000Z');
    mockUpdateStatus
      .mockResolvedValueOnce({
        status: 'picked_up',
        previousStatus: 'photo_captured',
        booking: { customerId: 'customer-1', driverId: 'driver-1' },
        eventTimestamp: eventTs,
        broadcastPayload: { location: { latitude: 1, longitude: 2 } },
        sequence: 2
      })
      .mockResolvedValueOnce({
        status: 'in_transit',
        previousStatus: 'picked_up',
        booking: { customerId: 'customer-1', driverId: 'driver-1' },
        eventTimestamp: eventTs,
        sequence: 3
      });
  });

  test('POST confirm-pickup returns 200 and in_transit when socket getSocketIO throws', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/driver', require('../src/routes/driver'));

    const res = await request(app)
      .post('/api/driver/confirm-pickup')
      .send({
        bookingId: 'booking-1',
        location: { latitude: 12.97, longitude: 77.59 },
        notes: 'Pickup confirmed ok'
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('in_transit');
    expect(mockUpdateStatus).toHaveBeenCalledTimes(2);
    expect(mockUpdateStatus.mock.calls[1][0].requestedStatus).toBe('in_transit');
    expect(mockPickupVerificationSet).toHaveBeenCalled();
    expect(mockTripTrackingSet).toHaveBeenCalled();
  });

  describe('bookingStateMachine transitionBooking eventTimestamp', () => {
    let capturedTransition;

    beforeEach(() => {
      jest.resetModules();
      capturedTransition = null;

      jest.doMock('../src/services/firebase', () => ({
        getFirestore: jest.fn(() => ({
          runTransaction: jest.fn(async (fn) => {
            const transaction = {
              get: jest.fn(async () => ({
                exists: true,
                data: () => ({
                  status: 'driver_arrived',
                  driverId: 'driver-1'
                })
              })),
              update: jest.fn(),
              set: jest.fn((_ref, data) => {
                capturedTransition = data;
              })
            };
            return fn(transaction);
          }),
          collection: jest.fn(() => ({ doc: jest.fn(() => ({})) }))
        }))
      }));

      jest.doMock('../src/services/errorHandlingService', () => ({
        executeTransactionWithRetry: jest.fn(async (transactionFn) => {
          const db = require('../src/services/firebase').getFirestore();
          return db.runTransaction(transactionFn);
        })
      }));
    });

    test('normalizes Firestore Timestamp context.eventTimestamp', async () => {
      const bookingStateMachine = require('../src/services/bookingStateMachine');
      const ts = {
        toDate: () => new Date('2026-11-04T10:00:00.000Z')
      };

      await bookingStateMachine.transitionBooking(
        'booking-ts',
        'photo_captured',
        { driverId: 'driver-1' },
        {
          userId: 'driver-1',
          userType: 'driver',
          driverId: 'driver-1',
          eventTimestamp: ts
        }
      );

      expect(capturedTransition.eventTimestamp).toBeInstanceOf(Date);
      expect(capturedTransition.eventTimestamp.toISOString()).toBe('2026-11-04T10:00:00.000Z');
    });

    test('normalizes ISO string context.eventTimestamp', async () => {
      const bookingStateMachine = require('../src/services/bookingStateMachine');
      await bookingStateMachine.transitionBooking(
        'booking-iso',
        'photo_captured',
        { driverId: 'driver-1' },
        {
          userId: 'driver-1',
          userType: 'driver',
          driverId: 'driver-1',
          eventTimestamp: '2026-11-04T11:15:00.000Z'
        }
      );

      expect(capturedTransition.eventTimestamp.toISOString()).toBe('2026-11-04T11:15:00.000Z');
    });

    test('invalid context.eventTimestamp falls back to valid Date', async () => {
      const bookingStateMachine = require('../src/services/bookingStateMachine');
      await bookingStateMachine.transitionBooking(
        'booking-bad',
        'photo_captured',
        { driverId: 'driver-1' },
        {
          userId: 'driver-1',
          userType: 'driver',
          driverId: 'driver-1',
          eventTimestamp: 'not-a-date'
        }
      );

      expect(capturedTransition.eventTimestamp).toBeInstanceOf(Date);
      expect(Number.isNaN(capturedTransition.eventTimestamp.getTime())).toBe(false);
    });
  });

  test('src has no live getIO() calls (only getSocketIO)', () => {
    const srcRoot = path.join(__dirname, '..', 'src');
    const offenders = [];

    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.js')) {
          const lines = fs.readFileSync(full, 'utf8').split('\n');
          lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
              return;
            }
            if (/\.getIO\s*\(/.test(line) || /require\([^)]*socket[^)]*\)\.getIO\s*\(/.test(line)) {
              offenders.push(`${path.relative(srcRoot, full)}:${index + 1}`);
            }
          });
        }
      }
    }

    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
