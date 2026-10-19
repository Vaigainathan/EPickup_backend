const mockOrderGet = jest.fn();

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true }))
}));

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'marketplaceOrders') {
      return {
        doc: jest.fn(() => ({
          get: mockOrderGet
        }))
      };
    }
    return { doc: jest.fn() };
  })
};

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => mockDb)
}));

jest.mock('firebase-admin', () => {
  const blockRealFirestore = () => {
    throw new Error('REAL FIRESTORE IN TEST');
  };
  return {
    apps: [{ name: '[DEFAULT]' }],
    initializeApp: jest.fn(blockRealFirestore),
    app: jest.fn(),
    credential: { cert: jest.fn() },
    firestore: blockRealFirestore
  };
});

const {
  assertHandoverComplete,
  isHandedOver,
  isHandoverGatedStatus
} = require('../src/services/marketplace/marketplaceHandoverGuard');
const { DriverStatusError } = require('../src/services/driverStatusWorkflowService');

describe('marketplaceHandoverGuard', () => {
  beforeEach(() => {
    mockOrderGet.mockReset();
    mockDb.collection.mockClear();
  });

  test('isHandedOver recognizes handed_over and completed', () => {
    expect(isHandedOver('handed_over')).toBe(true);
    expect(isHandedOver('completed')).toBe(true);
    expect(isHandedOver('ready')).toBe(false);
  });

  test('isHandoverGatedStatus includes pickup workflow statuses', () => {
    expect(isHandoverGatedStatus('photo_captured')).toBe(true);
    expect(isHandoverGatedStatus('driver_arrived')).toBe(false);
  });

  test('parcel booking skips order read', async () => {
    await assertHandoverComplete(mockDb, { sourceType: 'parcel' }, 'photo_captured');
    expect(mockOrderGet).not.toHaveBeenCalled();
  });

  test('marketplace booking with ready order throws HANDOVER_PENDING', async () => {
    mockOrderGet.mockResolvedValue({
      exists: true,
      data: () => ({ orderStatus: 'ready' })
    });

    await expect(
      assertHandoverComplete(
        mockDb,
        { sourceType: 'marketplace', marketplaceOrderId: 'order-1' },
        'picked_up'
      )
    ).rejects.toMatchObject({ code: 'HANDOVER_PENDING', statusCode: 409 });
    expect(mockOrderGet).toHaveBeenCalled();
  });

  test('marketplace booking proceeds when order handed_over', async () => {
    mockOrderGet.mockResolvedValue({
      exists: true,
      data: () => ({ orderStatus: 'handed_over' })
    });

    await expect(
      assertHandoverComplete(
        mockDb,
        { sourceType: 'marketplace', marketplaceOrderId: 'order-1' },
        'picked_up'
      )
    ).resolves.toBeUndefined();
  });

  test('throws DriverStatusError instance', async () => {
    mockOrderGet.mockResolvedValue({
      exists: true,
      data: () => ({ orderStatus: 'ready' })
    });

    try {
      await assertHandoverComplete(
        mockDb,
        { sourceType: 'marketplace', marketplaceOrderId: 'order-1' },
        'in_transit'
      );
    } catch (error) {
      expect(error).toBeInstanceOf(DriverStatusError);
    }
  });
});
