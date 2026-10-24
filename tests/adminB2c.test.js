/**
 * ADMIN-B2c — marketplace help index query shape, onboarding rejected fields, admin staff guard.
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

describe('shopOnboardingService.getStatus rejected fields', () => {
  const shopOnboardingService = require('../src/services/shopOnboardingService');

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  function mockContext({ approvalStatus, rejectedSections, rejectedSection }) {
    return {
      userRef: { update: jest.fn().mockResolvedValue(undefined) },
      shop: {
        approvalStatus,
        submitted: false,
        rejectedSections,
        rejectedSection
      },
      shopProfile: {},
      shopExists: true,
      userData: { userType: 'shop' }
    };
  }

  it('pending shop returns empty rejectedSections and null rejectedSection', async () => {
    jest.spyOn(shopOnboardingService, 'loadShopContext').mockResolvedValue(
      mockContext({ approvalStatus: 'pending' })
    );
    jest.spyOn(shopOnboardingService, 'resolveDocumentUrl').mockResolvedValue(null);

    const status = await shopOnboardingService.getStatus('shop-pending');
    expect(status.approvalStatus).toBe('pending');
    expect(status.rejectedSections).toEqual([]);
    expect(status.rejectedSection).toBeNull();
  });

  it('approved shop returns empty rejectedSections and null rejectedSection', async () => {
    jest.spyOn(shopOnboardingService, 'loadShopContext').mockResolvedValue(
      mockContext({ approvalStatus: 'approved' })
    );
    jest.spyOn(shopOnboardingService, 'resolveDocumentUrl').mockResolvedValue(null);

    const status = await shopOnboardingService.getStatus('shop-approved');
    expect(status.rejectedSections).toEqual([]);
    expect(status.rejectedSection).toBeNull();
  });

  it('rejected shop returns normalized rejected sections', async () => {
    jest.spyOn(shopOnboardingService, 'loadShopContext').mockResolvedValue(
      mockContext({
        approvalStatus: 'rejected',
        rejectedSections: ['documents']
      })
    );
    jest.spyOn(shopOnboardingService, 'resolveDocumentUrl').mockResolvedValue(null);

    const status = await shopOnboardingService.getStatus('shop-rejected');
    expect(status.rejectedSections).toEqual(['documents']);
    expect(status.rejectedSection).toBe('documents');
  });
});
