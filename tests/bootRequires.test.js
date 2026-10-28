/**
 * B-BATCH-2: every module touched in this batch must resolve at boot (mocked Firebase).
 */

jest.mock('../instrument.js', () => ({}));

jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn(() => ({
    collection: jest.fn(() => ({ doc: jest.fn(() => ({})) }))
  })),
  getStorage: jest.fn(() => ({})),
  initializeFirebase: jest.fn(() => ({ name: 'mock-app' }))
}));

jest.mock('../src/services/notificationService', () => ({
  sendTemplateNotification: jest.fn(async () => ({ success: true })),
  buildFcmDataPayload: jest.fn(() => ({}))
}));

jest.mock('../src/services/socket', () => ({
  getSocketIO: jest.fn(() => null)
}));

jest.mock('firebase-admin', () => {
  const FieldValue = {
    serverTimestamp: jest.fn(() => ({ __ts: true })),
    increment: jest.fn((n) => n),
    delete: jest.fn(() => ({ __delete: true }))
  };
  const Timestamp = {
    now: jest.fn(() => ({ __ts: true })),
    fromDate: jest.fn(() => ({ __ts: true }))
  };
  return {
    apps: [],
    initializeApp: jest.fn(),
    app: jest.fn(),
    auth: jest.fn(() => ({
      getUser: jest.fn(),
      getUserByPhoneNumber: jest.fn()
    })),
    messaging: jest.fn(() => ({})),
    credential: { cert: jest.fn() },
    firestore: Object.assign(jest.fn(), { FieldValue, Timestamp })
  };
});

const BATCH_MODULES = [
  '../src/utils/debugLog',
  '../src/middleware/appCheckAuth',
  '../src/middleware/auth',
  '../src/services/marketplace/marketplaceHandoverCompat',
  '../src/services/marketplace/marketplaceHandoverGuard',
  '../src/services/marketplace/presentMarketplaceDriverInfo',
  '../src/services/marketplace/marketplacePickupHandover',
  '../src/services/marketplace/driverMarketplaceAssignment',
  '../src/services/marketplace/orderStateMachine',
  '../src/services/marketplace/marketplacePush',
  '../src/services/marketplace/customerOrderView',
  '../src/services/marketplace/customerOrderActions',
  '../src/services/marketplace/createCustomerOrder',
  '../src/services/marketplaceSyncService',
  '../src/services/notificationTemplates',
  '../src/services/shopOrderService',
  '../src/routes/shopOrders',
  '../src/routes/driver'
];

describe('B-BATCH-2 boot requires', () => {
  test.each(BATCH_MODULES)('loads %s without throw', (modulePath) => {
    jest.isolateModules(() => {
      expect(() => require(modulePath)).not.toThrow();
    });
  });
});
