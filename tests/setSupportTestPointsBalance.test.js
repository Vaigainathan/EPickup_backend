const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchCommit = jest.fn(async () => {});

const mockBatch = {
  update: (...args) => mockBatchUpdate(...args),
  set: (...args) => mockBatchSet(...args),
  commit: (...args) => mockBatchCommit(...args)
};

const mockWalletGet = jest.fn();
const mockPointsTransactionsCollection = jest.fn();
const mockDriverWalletsCollection = jest.fn();

const mockDb = {
  batch: jest.fn(() => mockBatch),
  collection: jest.fn((name) => {
    if (name === 'driverPointsWallets') {
      return mockDriverWalletsCollection();
    }
    if (name === 'pointsTransactions') {
      return mockPointsTransactionsCollection();
    }
    if (name === 'companyRevenue') {
      throw new Error('companyRevenue must not be written in support test top-up');
    }
    return { doc: jest.fn() };
  })
};

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => mockDb)
}));

jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(() => mockDb)
}));

const mockStagingApp = { options: { projectId: 'epickup-app-staging' } };
const mockProductionApp = { options: { projectId: 'epickup-app' } };
let mockApp = mockStagingApp;

jest.mock('firebase-admin', () => {
  const blockRealFirestore = () => {
    throw new Error('REAL FIRESTORE IN TEST');
  };
  return {
    apps: [{ name: '[DEFAULT]' }],
    initializeApp: jest.fn(blockRealFirestore),
    app: jest.fn(() => mockApp),
    credential: { cert: jest.fn() },
    firestore: blockRealFirestore
  };
});

jest.mock('../src/services/cachingService', () => ({
  delete: jest.fn(async () => {}),
  invalidatePattern: jest.fn(async () => {})
}));

const walletService = require('../src/services/walletService');

describe('setSupportTestPointsBalance', () => {
  let service;

  beforeEach(() => {
    mockApp = mockStagingApp;
    process.env.FIREBASE_PROJECT_ID = 'epickup-app-staging';
    mockBatchSet.mockReset();
    mockBatchUpdate.mockReset();
    mockBatchCommit.mockReset();
    mockDb.batch.mockClear();
    mockDb.collection.mockClear();
    mockWalletGet.mockReset();
    mockDriverWalletsCollection.mockReset();
    mockPointsTransactionsCollection.mockReset();

    mockDriverWalletsCollection.mockImplementation(() => ({
      doc: jest.fn(() => ({
        get: mockWalletGet,
        set: jest.fn(async () => {}),
        update: jest.fn(async () => {})
      }))
    }));

    mockPointsTransactionsCollection.mockImplementation(() => ({
      doc: jest.fn(() => ({}))
    }));

    service = walletService;
  });

  test('sets balance to n and writes pointsTransactions with support_test_topup', async () => {
    mockWalletGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          driverId: 'driver-1',
          pointsBalance: 100,
          totalPointsEarned: 100,
          totalPointsSpent: 0
        })
      });

    const result = await service.setSupportTestPointsBalance('driver-1', 500, {
      reason: 'support/test top-up'
    });

    expect(result.success).toBe(true);
    expect(result.noop).toBe(false);
    expect(result.newBalance).toBe(500);
    expect(mockBatchUpdate).toHaveBeenCalled();
    expect(mockBatchSet).toHaveBeenCalled();
    const transactionPayload = mockBatchSet.mock.calls[0][1];
    expect(transactionPayload.paymentMethod).toBe('support_test_topup');
    expect(transactionPayload.paymentDetails.reason).toBe('support/test top-up');
    expect(mockDb.collection).not.toHaveBeenCalledWith('companyRevenue');
  });

  test('no-op when balance already n', async () => {
    mockWalletGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        pointsBalance: 500,
        totalPointsEarned: 500,
        totalPointsSpent: 0
      })
    });

    const result = await service.setSupportTestPointsBalance('driver-1', 500);
    expect(result.success).toBe(true);
    expect(result.noop).toBe(true);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('throws on non-staging project', async () => {
    mockApp = mockProductionApp;
    process.env.FIREBASE_PROJECT_ID = 'epickup-app';

    await expect(
      service.setSupportTestPointsBalance('driver-1', 500)
    ).rejects.toThrow(/Refusing support wallet adjustment/i);
  });
});
