/**
 * ADMIN-B1b — shops, marketplace admin wrappers, bookings sourceType, revenue single-source.
 */

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

jest.mock('../src/services/admin/adminShopService', () => ({
  listShops: jest.fn().mockResolvedValue({ shops: [], pagination: { total: 0 } }),
  getShopDetail: jest.fn(),
  verifyUpi: jest.fn(),
  approve: jest.fn(),
  reject: jest.fn(),
  suspend: jest.fn(),
  unsuspend: jest.fn()
}));

jest.mock('../src/services/shopOrderService', () => ({
  supportCancelBeforeHandover: jest.fn().mockResolvedValue({ cancelled: true }),
  resolveReview: jest.fn().mockResolvedValue({ resolved: true })
}));

jest.mock('../src/services/marketplace/shopPaymentVerification', () => ({
  resolvePaidCheckSupport: jest.fn().mockResolvedValue({ ok: true })
}));

jest.mock('../src/services/marketplace/refunds', () => ({
  markRefundSent: jest.fn().mockResolvedValue({ sent: true }),
  resolveRefundDispute: jest.fn().mockResolvedValue({ disputeResolved: true })
}));

jest.mock('../src/services/marketplace/helpRequests', () => ({
  resolveMarketplaceHelp: jest.fn().mockResolvedValue({ ticketClosed: true })
}));

describe('bookingSourceType', () => {
  const {
    resolveBookingSourceType,
    matchesSourceTypeFilter,
    resolveBookingFareTotal
  } = require('../src/utils/bookingSourceType');

  it('defaults missing sourceType to parcel', () => {
    expect(resolveBookingSourceType({})).toBe('parcel');
    expect(resolveBookingSourceType({ sourceType: 'marketplace' })).toBe('marketplace');
  });

  it('filters parcel vs marketplace', () => {
    expect(matchesSourceTypeFilter({}, 'parcel')).toBe(true);
    expect(matchesSourceTypeFilter({ sourceType: 'marketplace' }, 'parcel')).toBe(false);
  });

  it('resolves fare object totals (avoids NaN)', () => {
    expect(resolveBookingFareTotal({ fare: { totalFare: 120 } })).toBe(120);
    expect(resolveBookingFareTotal({ fare: { total: 50 } })).toBe(50);
    expect(resolveBookingFareTotal({ fare: {} })).toBe(0);
  });
});

describe('shopApprovalPlan + push templates', () => {
  const { planShopApproval } = require('../src/services/admin/shopApprovalPlan');
  const {
    findShopTemplate,
    safeGetShopTemplate,
    SHOP_ONBOARDING_PUSH_CANDIDATES
  } = require('../src/services/admin/adminShopPush');

  it('blocks approval without verified UPI name', () => {
    const plan = planShopApproval({ approvalStatus: 'pending', bank: {} });
    expect(plan.ok).toBe(false);
  });

  it('noop when already approved', () => {
    const plan = planShopApproval({
      approvalStatus: 'approved',
      bank: { upiNameVerification: { verifiedName: 'Acme' } }
    });
    expect(plan.ok).toBe(true);
    expect(plan.noop).toBe(true);
  });

  it('findShopTemplate never throws; missing keys return null', () => {
    expect(() => findShopTemplate('approve')).not.toThrow();
    expect(() => findShopTemplate('reject')).not.toThrow();
    expect(safeGetShopTemplate('NOT_A_REAL_TEMPLATE')).toBeNull();
    const approved = findShopTemplate('approve');
    expect(approved).not.toBeNull();
    expect(approved.key).toBe('ONBOARDING_APPROVED');
    expect(SHOP_ONBOARDING_PUSH_CANDIDATES.approve).toContain('ONBOARDING_APPROVED');
  });
});

describe('admin shop routes role gate', () => {
  const express = require('express');
  const request = require('supertest');
  const shopRoutes = require('../src/routes/adminShops');
  const adminShopService = require('../src/services/admin/adminShopService');

  function appForRole(role) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { uid: 'admin-1', userType: 'admin', role };
      next();
    });
    app.use('/shops', shopRoutes);
    return app;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows support to GET list', async () => {
    const res = await request(appForRole('support')).get('/shops');
    expect(res.status).toBe(200);
    expect(adminShopService.listShops).toHaveBeenCalled();
  });

  it('returns 403 for support on POST approve', async () => {
    const res = await request(appForRole('support')).post('/shops/shop-1/approve').send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('INSUFFICIENT_ADMIN_ROLE');
    expect(adminShopService.approve).not.toHaveBeenCalled();
  });

  it('returns 200 for super_admin POST approve when service succeeds', async () => {
    adminShopService.approve.mockResolvedValue({
      shopId: 'shop-1',
      approvalStatus: 'approved',
      push: { sent: true, templateKey: 'ONBOARDING_APPROVED' }
    });
    const res = await request(appForRole('super_admin')).post('/shops/shop-1/approve').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(adminShopService.approve).toHaveBeenCalled();
  });

  it('returns 200 for super_admin POST reject when service succeeds', async () => {
    adminShopService.reject.mockResolvedValue({
      shopId: 'shop-1',
      approvalStatus: 'rejected',
      push: { sent: true, templateKey: 'ONBOARDING_REJECTED' }
    });
    const res = await request(appForRole('super_admin'))
      .post('/shops/shop-1/reject')
      .send({ reason: 'fix bank', sections: ['bank-details'] });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('adminMarketplaceService delegates', () => {
  const shopOrderService = require('../src/services/shopOrderService');
  const { resolvePaidCheckSupport } = require('../src/services/marketplace/shopPaymentVerification');
  const { markRefundSent, resolveRefundDispute } = require('../src/services/marketplace/refunds');
  const { resolveMarketplaceHelp } = require('../src/services/marketplace/helpRequests');
  const adminMarketplaceService = require('../src/services/admin/adminMarketplaceService');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('cancelOrder delegates to shopOrderService', async () => {
    await adminMarketplaceService.cancelOrder({ orderId: 'o1', operator: 'op', note: 'n' });
    expect(shopOrderService.supportCancelBeforeHandover).toHaveBeenCalledWith({
      orderId: 'o1',
      operator: 'op',
      note: 'n'
    });
  });

  it('resolvePaidCheck delegates', async () => {
    await adminMarketplaceService.resolvePaidCheck({
      orderId: 'o1',
      received: true,
      operator: 'op',
      body: {}
    });
    expect(resolvePaidCheckSupport).toHaveBeenCalled();
  });

  it('refund + help delegates', async () => {
    await adminMarketplaceService.recordRefundSent({ orderId: 'o1', refundId: 'r1' });
    await adminMarketplaceService.resolveRefundDispute({ orderId: 'o1', refundId: 'r1' });
    await adminMarketplaceService.resolveHelpTicket({ ticketId: 't1' });
    expect(markRefundSent).toHaveBeenCalled();
    expect(resolveRefundDispute).toHaveBeenCalled();
    expect(resolveMarketplaceHelp).toHaveBeenCalled();
  });
});

describe('revenueService money-in (driverTopUps only)', () => {
  beforeEach(() => {
    // Clear firebase cached by earlier describes (e.g. adminMarketplaceService) so doMock applies.
    jest.resetModules();
  });

  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../src/services/firebase');
  });

  it('topUpAmountFromDoc prefers realMoneyAmount', () => {
    jest.doMock('../src/services/firebase', () => ({
      getFirestore: jest.fn(),
      getFirebaseApp: jest.fn(() => ({}))
    }));
    const revenueService = require('../src/services/revenueService');
    expect(revenueService.topUpAmountFromDoc({ realMoneyAmount: 99, amount: 1 })).toBe(99);
    expect(revenueService.topUpAmountFromDoc({ amount: 50 })).toBe(50);
  });

  it('getTotalRevenue sums completed driverTopUps once', async () => {
    const docs = [
      { id: 't1', data: () => ({ status: 'completed', amount: 100 }) },
      { id: 't2', data: () => ({ status: 'completed', realMoneyAmount: 200 }) }
    ];
    const snapshot = {
      forEach: (cb) => {
        docs.forEach((d) => cb(d));
      }
    };
    const get = jest.fn().mockResolvedValue(snapshot);
    const where = jest.fn(() => ({ get }));
    const collection = jest.fn(() => ({ where }));

    jest.doMock('../src/services/firebase', () => ({
      getFirestore: jest.fn(() => ({ collection })),
      getFirebaseApp: jest.fn(() => ({}))
    }));
    const revenueService = require('../src/services/revenueService');

    const result = await revenueService.getTotalRevenue({});
    if (!result.success) {
      throw new Error(`getTotalRevenue failed: ${JSON.stringify(result)}`);
    }
    expect(result.success).toBe(true);
    expect(result.totalRevenue).toBe(300);
    expect(result.revenueSource).toBe('driverTopUps');
    expect(collection).toHaveBeenCalledWith('driverTopUps');
    expect(where).toHaveBeenCalledWith('status', '==', 'completed');
    expect(get).toHaveBeenCalled();
  });
});

describe('shopOnboardingService adminReject (mocked Firestore)', () => {
  const mockUpdate = jest.fn().mockResolvedValue(undefined);
  const userSnap = {
    exists: true,
    data: () => ({ shop: { approvalStatus: 'pending', shopName: 'S' }, name: 'S' })
  };
  const shopSnap = { exists: true, data: () => ({}) };

  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../src/services/firebase', () => ({
      getFirestore: jest.fn(() => {
        const get = jest.fn()
          .mockResolvedValueOnce(userSnap)
          .mockResolvedValueOnce(shopSnap);
        const doc = jest.fn(() => ({ get, update: mockUpdate }));
        return { collection: jest.fn(() => ({ doc })) };
      })
    }));
    jest.doMock('../src/services/admin/adminShopPush', () => ({
      trySendShopOnboardingPush: jest.fn().mockResolvedValue({
        sent: true,
        templateKey: 'ONBOARDING_REJECTED'
      })
    }));
    mockUpdate.mockClear();
  });

  it('writes rejectedSections array with valid section keys', async () => {
    const shopOnboardingService = require('../src/services/shopOnboardingService');
    const result = await shopOnboardingService.adminReject('shop-1', {
      reason: 'bad docs',
      sections: ['bank-details', 'documents'],
      operator: 'admin'
    });
    expect(result.rejectedSections).toEqual(['bank-details', 'documents']);
    expect(result.rejectedSection).toBe('bank-details');
    expect(result.push.templateKey).toBe('ONBOARDING_REJECTED');
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('throws INVALID_SECTION for unknown section keys', async () => {
    const shopOnboardingService = require('../src/services/shopOnboardingService');
    await expect(
      shopOnboardingService.adminReject('shop-1', {
        reason: 'bad docs',
        sections: ['identity'],
        operator: 'admin'
      })
    ).rejects.toMatchObject({ code: 'INVALID_SECTION', status: 400 });
  });
});
