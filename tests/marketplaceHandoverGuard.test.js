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

  test('assertHandoverComplete is a no-op (pickup = handover)', async () => {
    await assertHandoverComplete(
      mockDb,
      { sourceType: 'marketplace', marketplaceOrderId: 'order-1' },
      'picked_up'
    );
    expect(mockOrderGet).not.toHaveBeenCalled();
  });
});
