const shopOrderService = require('../../src/services/shopOrderService');

describe('shopOrderService.presentOrder customerNote (B5)', () => {
  beforeEach(() => {
    jest.spyOn(shopOrderService, 'readHandoverOtp').mockResolvedValue('123456');
    jest.spyOn(shopOrderService, 'presentOrderHelp').mockResolvedValue({
      hasOpenHelp: false,
      status: null
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('includes top-level customerNote from order doc', async () => {
    const view = await shopOrderService.presentOrder(
      'order-1',
      {
        shopId: 'shop-1',
        customerNote: 'Extra spicy',
        items: [],
        payment: {}
      },
      []
    );
    expect(view.customerNote).toBe('Extra spicy');
    expect(view).not.toHaveProperty('riderNotes');
    expect(view).not.toHaveProperty('riderNoteText');
  });

  test('customerNote null when absent', async () => {
    const view = await shopOrderService.presentOrder(
      'order-1',
      { shopId: 'shop-1', items: [], payment: {} },
      []
    );
    expect(view.customerNote).toBeNull();
  });
});
