const { MARKETPLACE_DEFAULTS } = require('../src/config/marketplaceDefaults');
const {
  rupeesFromPaise,
  classifyOrderLines,
  storedOrderItems,
  sumItemsTotalPaise,
  chooseAmountAdjustment,
  occupiedExpectedPaise,
  blockingExpectedPaise,
  policyGroupFor,
  isShopOpenNow,
  paymentDetailsFromStored,
  validateCreateInput
} = require('../src/services/marketplace/createCustomerOrder');

const SHOP = 'shop-1';

function product(overrides) {
  return {
    shopId: SHOP,
    isActive: true,
    name: 'Rice',
    price: 150,
    stock: 5,
    hasVariants: false,
    variants: [],
    ...overrides
  };
}

describe('money conversion', () => {
  test('paise integers become rupees with two decimal places', () => {
    expect(rupeesFromPaise(15050)).toBe(150.5);
    expect(rupeesFromPaise(15050).toFixed(2)).toBe('150.50');
    expect(rupeesFromPaise(1).toFixed(2)).toBe('0.01');
    expect(rupeesFromPaise(100)).toBe(1);
    expect(Math.round(rupeesFromPaise(15050) * 100)).toBe(15050);
  });

  test('paymentDetails keeps rupees and paise side by side', () => {
    const details = paymentDetailsFromStored({
      expectedAmount: rupeesFromPaise(15001),
      expectedAmountPaise: 15001,
      verifiedPayeeName: 'Shop Name',
      window: { start: 's', end: 'e' },
      payment: { shopUpiId: 'shop@upi' }
    });
    expect(details).toEqual({
      upiId: 'shop@upi',
      expectedAmount: 150.01,
      expectedAmountPaise: 15001,
      verifiedPayeeName: 'Shop Name',
      window: { start: 's', end: 'e' }
    });
    expect(details.expectedAmount.toFixed(2)).toBe('150.01');
  });
});

describe('classifyOrderLines', () => {
  test('returns every bad line, not only the first', () => {
    const products = new Map([
      ['priced', product({ price: 200, stock: 4 })],
      ['short', product({ price: 10, stock: 1 })],
      ['gone', product({ isActive: false, price: 10, stock: 9 })],
      ['sized', product({
        hasVariants: true,
        stock: 0,
        variants: [{ id: 'v1', priceOverride: 80, stock: 3 }]
      })]
    ]);
    const result = classifyOrderLines([
      { productId: 'priced', qty: 1, price: 150 },
      { productId: 'short', qty: 2, price: 10 },
      { productId: 'gone', qty: 1, price: 10 },
      { productId: 'missing', qty: 1, price: 10 },
      { productId: 'sized', variantId: 'v1', qty: 1, price: 80 }
    ], products, SHOP);

    expect(result.badLines).toEqual([
      { productId: 'priced', variantId: null, reason: 'price', current: { price: 200, stock: 4 } },
      { productId: 'short', variantId: null, reason: 'stock', current: { price: 10, stock: 1 } },
      { productId: 'gone', variantId: null, reason: 'inactive', current: { price: 10, stock: 9 } },
      { productId: 'missing', variantId: null, reason: 'inactive', current: { price: null, stock: null } }
    ]);
    expect(result.goodLines).toHaveLength(1);
    expect(sumItemsTotalPaise(result.goodLines)).toBe(8000);
    expect(result.goodLines[0].price).toBe(80);
  });

  test('ids assigned at creation use the effective price', () => {
    const products = new Map([
      ['sized', product({
        hasVariants: true,
        stock: 0,
        name: 'Rice',
        variants: [{ id: 'v1', priceOverride: 80, stock: 3 }]
      })]
    ]);
    const result = classifyOrderLines([
      { productId: 'sized', variantId: 'v1', qty: 2, price: 80 }
    ], products, SHOP);
    expect(storedOrderItems(result.goodLines)).toEqual([{
      id: 'line0',
      productId: 'sized',
      variantId: 'v1',
      name: 'Rice',
      price: 80,
      qty: 2
    }]);
  });
});

describe('chooseAmountAdjustment', () => {
  test('reduces the amount by the smallest free paise offset and never goes above the items total', () => {
    const second = chooseAmountAdjustment(154000, [154000]);
    const third = chooseAmountAdjustment(154000, [154000, 153999]);
    expect(second).toEqual({
      amountAdjustmentPaise: 1,
      expectedAmountPaise: 153999,
      expectedAmount: 1539.99
    });
    expect(third).toEqual({
      amountAdjustmentPaise: 2,
      expectedAmountPaise: 153998,
      expectedAmount: 1539.98
    });
    expect(second.expectedAmountPaise).toBeLessThanOrEqual(154000);
    expect(third.expectedAmountPaise).toBeLessThanOrEqual(154000);
  });

  test('a new order at an existing reduced amount steps one paise lower', () => {
    const existing = {
      itemsTotalPaise: 154000,
      itemsTotal: 1540,
      expectedAmountPaise: 153999
    };
    expect(occupiedExpectedPaise(existing)).toBe(153999);
    expect(chooseAmountAdjustment(153999, [occupiedExpectedPaise(existing)])).toEqual({
      amountAdjustmentPaise: 1,
      expectedAmountPaise: 153998,
      expectedAmount: 1539.98
    });
  });

  test('avoids a payment_unconfirmed amount and ignores other statuses', () => {
    const occupied = blockingExpectedPaise([
      {
        orderStatus: 'payment_unconfirmed',
        itemsTotalPaise: 154001,
        expectedAmountPaise: 154000
      },
      {
        orderStatus: 'preparing',
        itemsTotalPaise: 154000,
        expectedAmountPaise: 153999
      }
    ]);
    expect(occupied).toEqual([154000]);
    expect(chooseAmountAdjustment(154000, occupied).expectedAmountPaise).toBe(153999);
  });

  test('returns null when every positive offset is taken', () => {
    const occupied = [];
    for (let offset = 0; offset <= 99; offset += 1) {
      occupied.push(154000 - offset);
    }
    expect(chooseAmountAdjustment(154000, occupied)).toBeNull();
  });

  test('a total of 50 paise is busy once 1..50 are taken', () => {
    const occupied = [];
    for (let paise = 1; paise <= 50; paise += 1) {
      occupied.push(paise);
    }
    expect(chooseAmountAdjustment(50, occupied)).toBeNull();
  });
});

describe('policyGroupFor', () => {
  test('uses POLICY_GROUP_A and treats every other type as B', () => {
    expect(policyGroupFor('Food & Restaurants', MARKETPLACE_DEFAULTS.POLICY_GROUP_A)).toBe('A');
    expect(policyGroupFor('Grocery & Supermarket', MARKETPLACE_DEFAULTS.POLICY_GROUP_A)).toBe('B');
  });
});

describe('isShopOpenNow', () => {
  const tenAmIst = new Date('2026-10-07T04:30:00.000Z');

  test('uses the toggle when hours are missing', () => {
    expect(isShopOpenNow({ isOpen: true, openingHours: null, now: tenAmIst })).toBe(true);
    expect(isShopOpenNow({ isOpen: false, openingHours: null, now: tenAmIst })).toBe(false);
  });

  test('requires the IST clock to fall inside today when hours exist', () => {
    const hours = { wednesday: { start: '09:00', end: '18:00' } };
    expect(isShopOpenNow({ isOpen: true, openingHours: hours, now: tenAmIst })).toBe(true);
    expect(isShopOpenNow({
      isOpen: true,
      openingHours: { wednesday: { start: '11:00', end: '18:00' } },
      now: tenAmIst
    })).toBe(false);
    expect(isShopOpenNow({ isOpen: false, openingHours: hours, now: tenAmIst })).toBe(false);
  });
});

describe('validateCreateInput', () => {
  test('rejects a missing address id before any order write', () => {
    const result = validateCreateInput('11111111-1111-4111-8111-111111111111', {
      shopId: 'shop-1',
      items: [{ productId: 'p1', qty: 1, price: 10 }]
    });
    expect(result.ok).toBe(false);
  });
});
