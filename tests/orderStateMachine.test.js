jest.mock('../src/services/firebase', () => ({
  getFirestore: jest.fn()
}));

const { getFirestore } = require('../src/services/firebase');
const {
  assertTransition,
  InvalidStateError,
  getMarketplaceEnforcement,
  _resetEnforcementCache
} = require('../src/services/marketplace/orderStateMachine');

const ALLOWED = [
  ['awaiting_payment', 'preparing'],
  ['awaiting_payment', 'cancelled'],
  ['awaiting_payment', 'payment_review'],
  ['awaiting_payment', 'payment_unconfirmed'],
  ['awaiting_payment', 'awaiting_payment'],
  ['payment_unconfirmed', 'preparing'],
  ['payment_unconfirmed', 'payment_review'],
  ['payment_unconfirmed', 'cancelled'],
  ['payment_review', 'preparing'],
  ['payment_review', 'cancelled'],
  ['preparing', 'ready'],
  ['preparing', 'cancelled'],
  ['ready', 'handed_over'],
  ['ready', 'cancelled'],
  ['handed_over', 'completed'],
  ['handed_over', 'delivery_failed']
];

function settingsDoc(data, exists = true) {
  return {
    exists,
    data: () => data
  };
}

describe('assertTransition', () => {
  test.each(ALLOWED)('%s → %s is allowed', (from, to) => {
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  test('handed_over → cancelled is 409 INVALID_STATE', () => {
    expect.assertions(3);
    try {
      assertTransition('handed_over', 'cancelled');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStateError);
      expect(error.status).toBe(409);
      expect(error.code).toBe('INVALID_STATE');
    }
  });

  test('completed → cancelled is rejected', () => {
    expect(() => assertTransition('completed', 'cancelled')).toThrow(InvalidStateError);
  });

  test('preparing → preparing is rejected', () => {
    expect(() => assertTransition('preparing', 'preparing')).toThrow(InvalidStateError);
  });
});

describe('getMarketplaceEnforcement', () => {
  beforeEach(() => {
    _resetEnforcementCache();
    getFirestore.mockReset();
  });

  test('missing document defaults both flags to false and caches the read', async () => {
    const get = jest.fn().mockResolvedValue(settingsDoc(null, false));
    getFirestore.mockReturnValue({
      collection: () => ({ doc: () => ({ get }) })
    });

    await expect(getMarketplaceEnforcement()).resolves.toEqual({
      newStatuses: false,
      utrBlocksReject: false
    });
    await getMarketplaceEnforcement();
    expect(get).toHaveBeenCalledTimes(1);
  });

  test('only boolean true enables a flag', async () => {
    const get = jest.fn().mockResolvedValue(settingsDoc({
      MARKETPLACE_ENFORCEMENT: { newStatuses: true, utrBlocksReject: 'true' }
    }));
    getFirestore.mockReturnValue({
      collection: () => ({ doc: () => ({ get }) })
    });

    await expect(getMarketplaceEnforcement()).resolves.toEqual({
      newStatuses: true,
      utrBlocksReject: false
    });
  });

  test('a thrown read is not cached', async () => {
    const get = jest.fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(settingsDoc({
        MARKETPLACE_ENFORCEMENT: { newStatuses: true, utrBlocksReject: true }
      }));
    getFirestore.mockReturnValue({
      collection: () => ({ doc: () => ({ get }) })
    });

    await expect(getMarketplaceEnforcement()).resolves.toEqual({
      newStatuses: false,
      utrBlocksReject: false
    });
    await expect(getMarketplaceEnforcement()).resolves.toEqual({
      newStatuses: true,
      utrBlocksReject: true
    });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
