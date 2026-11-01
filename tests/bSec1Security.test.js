const crypto = require('crypto');

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({
    collection: () => ({
      doc: () => ({
        get: jest.fn()
      })
    })
  }))
}));

describe('B-SEC-1 security hardening', () => {
  beforeEach(() => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });

  describe('V14 verify-token admin block', () => {
    test('returns 403 ADMIN_LOGIN_NOT_ALLOWED for body userType admin', async () => {
      jest.doMock('../src/services/firebaseAuthService', () => ({
        verifyIdToken: jest.fn()
      }));
      jest.doMock('../src/middleware/smartRateLimit', () => ({
        firebaseTokenVerifyLimiter: (_req, _res, next) => next(),
        createProgressiveSlowDown: () => (_req, _res, next) => next()
      }));

      const express = require('express');
      const request = require('supertest');
      const authRouter = require('../src/routes/auth');
      const app = express();
      app.use(express.json());
      app.use('/api/auth', authRouter);

      const res = await request(app)
        .post('/api/auth/firebase/verify-token')
        .send({ idToken: 'x'.repeat(20), userType: 'admin' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('ADMIN_LOGIN_NOT_ALLOWED');
    });
  });

  describe('V1 wallet routes removed', () => {
    test('GET /api/wallet/balance/x returns 410 ENDPOINT_REMOVED', async () => {
      const express = require('express');
      const request = require('supertest');
      const walletRoutes = require('../src/routes/wallet');
      const app = express();
      app.use('/api/wallet', walletRoutes);

      const res = await request(app).get('/api/wallet/balance/driver-1');
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('ENDPOINT_REMOVED');
    });
  });

  describe('V8 fare complete-trip removed', () => {
    test('POST /api/fare/complete-trip returns 410', async () => {
      const actualAuth = jest.requireActual('../src/middleware/auth');
      jest.doMock('../src/middleware/auth', () => ({
        ...actualAuth,
        authenticateToken: (_req, _res, next) => next()
      }));

      let fareRoutes;
      jest.isolateModules(() => {
        fareRoutes = require('../src/routes/fareCalculation');
      });

      const express = require('express');
      const request = require('supertest');
      const app = express();
      app.use(express.json());
      app.use('/api/fare', fareRoutes);

      const res = await request(app).post('/api/fare/complete-trip').send({});
      expect(res.status).toBe(410);
      expect(res.body.error.code).toBe('ENDPOINT_REMOVED');
    });
  });

  describe('V4 Razorpay webhook paths and HMAC', () => {
    test('documents both webhook HTTP paths', () => {
      const { RAZORPAY_WEBHOOK_HTTP_PATHS } = require('../src/utils/razorpayWebhook');
      expect(RAZORPAY_WEBHOOK_HTTP_PATHS).toEqual([
        '/api/payments/razorpay/webhook',
        '/api/driver/webhooks/razorpay-payment'
      ]);
    });

    test('verifyWebhookSignature uses raw body bytes', () => {
      process.env.RAZORPAY_WEBHOOK_SECRET = 'test_secret';
      const razorpayService = require('../src/services/razorpayService');
      const raw = Buffer.from('{"event":"payment.captured"}', 'utf8');
      const signature = crypto.createHmac('sha256', 'test_secret').update(raw).digest('hex');
      expect(razorpayService.verifyWebhookSignature(raw, signature)).toBe(true);
      expect(razorpayService.verifyWebhookSignature(JSON.parse(raw.toString()), signature)).toBe(false);
    });

    test('missing webhook secret returns 500', async () => {
      const express = require('express');
      const request = require('supertest');
      const { handleRazorpayWebhookHttpRequest } = require('../src/utils/razorpayWebhook');
      const razorpayService = require('../src/services/razorpayService');
      const app = express();
      app.post('/hook', (req, res) => handleRazorpayWebhookHttpRequest(req, res, razorpayService));

      const res = await request(app).post('/hook').send({ event: 'test' });
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('WEBHOOK_SECRET_MISSING');
    });
  });

  describe('requireAdmin fail-closed', () => {
    test('Firestore read error returns 503 ADMIN_CHECK_UNAVAILABLE', async () => {
      const { getFirestore } = require('../src/services/firebase');
      getFirestore.mockReturnValue({
        collection: () => ({
          doc: () => ({
            get: () => Promise.reject(new Error('firestore down'))
          })
        })
      });

      const { requireAdmin } = jest.requireActual('../src/middleware/auth');

      const req = { user: { uid: 'admin-1', userType: 'admin', role: 'super_admin' } };
      const res = {
        status: jest.fn(function status() { return this; }),
        json: jest.fn()
      };
      const next = jest.fn();

      await requireAdmin(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: expect.objectContaining({ code: 'ADMIN_CHECK_UNAVAILABLE' })
      }));
    });
  });

  describe('top-up idempotent transaction', () => {
    test('second completion returns alreadyProcessed without double increment', async () => {
      const topupState = { status: 'pending', driverId: 'd1', amount: 100, id: 'tx1' };
      let walletBalance = 0;
      const writes = [];

      const runTransaction = async (fn) => {
        const transaction = {
          get: jest.fn(async (ref) => {
            const path = ref.path || ref.id;
            if (String(path).includes('driverTopUps')) {
              return { exists: true, id: 'tx1', data: () => ({ ...topupState }) };
            }
            if (String(path).includes('driverPointsWallets')) {
              return { exists: walletBalance > 0, data: () => ({ pointsBalance: walletBalance, totalPointsEarned: walletBalance }) };
            }
            return { exists: false, data: () => ({}) };
          }),
          set: jest.fn((ref, data) => {
            writes.push({ op: 'set', data });
            if (data.pointsBalance != null) {
              walletBalance = data.pointsBalance;
            }
          }),
          update: jest.fn((ref, data) => {
            writes.push({ op: 'update', data });
            if (data.status === 'completed') {
              topupState.status = 'completed';
              topupState.pointsAwarded = data.pointsAwarded;
              topupState.newPointsBalance = data.newPointsBalance;
            }
            if (data.pointsBalance != null) {
              walletBalance = data.pointsBalance;
            }
          })
        };
        transaction.get.path = '';
        return fn(transaction);
      };

      jest.doMock('../src/services/firebase', () => ({
        getFirestore: () => ({
          runTransaction,
          collection: (name) => ({
            doc: (id) => ({ path: `${name}/${id}`, id })
          })
        })
      }));

      jest.doMock('../src/services/cachingService', () => ({
        delete: jest.fn(),
        invalidatePattern: jest.fn()
      }));
      jest.doMock('../src/services/socket', () => ({
        emitWalletUpdate: jest.fn(),
        emitTransactionEvent: jest.fn(),
        emitRevenueUpdate: jest.fn()
      }));

      const RazorpayService = require('../src/services/razorpayService');
      const service = RazorpayService;
      service.db = {
        runTransaction,
        collection: (name) => ({
          doc: (id) => ({ path: `${name}/${id}`, id, ref: { path: `${name}/${id}`, id } })
        })
      };

      const ref = { path: 'driverTopUps/tx1', id: 'tx1' };
      const first = await service.completeWalletTopUpInTransaction(ref, {});
      const second = await service.completeWalletTopUpInTransaction(ref, {});

      expect(first.success).toBe(true);
      expect(first.idempotent).toBe(false);
      expect(second.success).toBe(true);
      expect(second.idempotent).toBe(true);
      expect(second.data.alreadyProcessed).toBe(true);
      expect(walletBalance).toBe(100);
    });
  });

  describe('marketplace sync skip', () => {
    test('missing order customerId skips with warn not throw', async () => {
      const { getFirestore } = require('../src/services/firebase');
      getFirestore.mockReturnValue({
        collection: () => ({
          doc: () => ({
            get: async () => ({ exists: true, data: () => ({}) }),
            id: 'order-1'
          })
        })
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      jest.doMock('../src/services/notificationService', () => ({}));

      let result;
      jest.isolateModules(() => {
        const marketplaceSyncService = require('../src/services/marketplaceSyncService');
        result = marketplaceSyncService.syncBooking({
          bookingId: 'b1',
          booking: { marketplaceOrderId: 'order-1', status: 'in_transit' }
        });
      });

      await expect(result).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
