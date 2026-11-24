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
      return { doc: jest.fn(() => ({})) };
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

jest.mock('firebase-admin', () => ({
  apps: [{ name: '[DEFAULT]' }],
  app: jest.fn(() => ({ options: { projectId: 'epickup-app-staging' } })),
  initializeApp: jest.fn(),
  credential: { cert: jest.fn() },
  firestore: jest.fn()
}));

jest.mock('../src/services/cachingService', () => ({
  delete: jest.fn(async () => {}),
  invalidatePattern: jest.fn(async () => {})
}));

jest.mock('../src/services/socket', () => ({
  emitWalletUpdate: jest.fn(),
  emitTransactionEvent: jest.fn(),
  emitRevenueUpdate: jest.fn()
}));

const { roundMoney } = require('../src/utils/money');
const walletService = require('../src/services/walletService');

describe('roundMoney', () => {
  test('addition avoids binary float drift', () => {
    expect(roundMoney(10.1 + 0.2)).toBe(10.3);
  });

  test('subtraction yields exact two-decimal balances', () => {
    expect(roundMoney(100 - 0.1 - 0.2)).toBe(99.7);
  });

  test('repeated commission-style debits stay exact', () => {
    let balance = 3597.7;
    balance = roundMoney(balance - 4.6);
    balance = roundMoney(balance - 0);
    expect(balance).toBe(3593.1);
    expect(String(balance)).not.toMatch(/999999/);
  });
});

describe('walletService balance rounding', () => {
  beforeEach(() => {
    mockBatchSet.mockReset();
    mockBatchUpdate.mockReset();
    mockBatchCommit.mockReset();
    mockWalletGet.mockReset();
    mockDriverWalletsCollection.mockImplementation(() => ({
      doc: jest.fn(() => ({
        get: mockWalletGet
      }))
    }));
    mockPointsTransactionsCollection.mockImplementation(() => ({
      doc: jest.fn(() => ({}))
    }));
  });

  test('deductPoints stores rounded newBalance and transaction fields', async () => {
    mockWalletGet.mockResolvedValue({
      exists: true,
      data: () => ({
        pointsBalance: 3597.7,
        totalPointsSpent: 0
      })
    });

    const result = await walletService.deductPoints('driver-1', 'trip-1', 1, 4.6, {});

    expect(result.success).toBe(true);
    expect(result.data.newBalance).toBe(3593.1);

    const walletUpdate = mockBatchUpdate.mock.calls[0][1];
    expect(walletUpdate.pointsBalance).toBe(3593.1);

    const transactionPayload = mockBatchSet.mock.calls[0][1];
    expect(transactionPayload.previousBalance).toBe(3597.7);
    expect(transactionPayload.newBalance).toBe(3593.1);
    expect(transactionPayload.pointsAmount).toBe(4.6);
  });

  test('deductPoints rejects insufficient balance after rounding', async () => {
    mockWalletGet.mockResolvedValue({
      exists: true,
      data: () => ({
        pointsBalance: 4.59,
        totalPointsSpent: 0
      })
    });

    const result = await walletService.deductPoints('driver-1', 'trip-2', 1, 4.6, {});

    expect(result.success).toBe(false);
    expect(result.error).toBe('Insufficient points balance');
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  test('addPoints stores rounded balance after float-prone top-up', async () => {
    mockWalletGet.mockResolvedValue({
      exists: true,
      data: () => ({
        pointsBalance: 100,
        totalPointsEarned: 100
      })
    });

    const result = await walletService.addPoints('driver-1', 0.1 + 0.2, 'upi', {});

    expect(result.success).toBe(true);
    expect(result.data.newBalance).toBe(100.3);

    const walletUpdate = mockBatchUpdate.mock.calls[0][1];
    expect(walletUpdate.pointsBalance).toBe(100.3);
  });
});