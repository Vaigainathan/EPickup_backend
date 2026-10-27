const { collectSoldOutConflict, productSoldOut } = require('../src/services/marketplace/createCustomerOrder');

describe('collectSoldOutConflict', () => {
  const productsById = new Map([
    ['p-sold', { soldOut: true, price: 10, stock: 5 }],
    ['p-ok', { soldOut: false, price: 20, stock: 3 }]
  ]);

  it('returns empty when no sold-out products', () => {
    const result = collectSoldOutConflict(
      [{ productId: 'p-ok', qty: 1, price: 20 }],
      productsById
    );
    expect(result.productIds).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it('returns productIds and lines for sold-out items', () => {
    const result = collectSoldOutConflict(
      [
        { productId: 'p-sold', variantId: 'v1', qty: 1, price: 10 },
        { productId: 'p-ok', qty: 1, price: 20 }
      ],
      productsById
    );
    expect(result.productIds).toEqual(['p-sold']);
    expect(result.lines).toEqual([{ productId: 'p-sold', variantId: 'v1' }]);
  });

  it('dedupes productIds but keeps one line per cart row', () => {
    const result = collectSoldOutConflict(
      [
        { productId: 'p-sold', qty: 1, price: 10 },
        { productId: 'p-sold', variantId: null, qty: 2, price: 10 }
      ],
      productsById
    );
    expect(result.productIds).toEqual(['p-sold']);
    expect(result.lines).toEqual([
      { productId: 'p-sold', variantId: null },
      { productId: 'p-sold', variantId: null }
    ]);
  });

  it('treats absent soldOut as not sold out', () => {
    const map = new Map([['p1', { price: 1, stock: 1 }]]);
    expect(productSoldOut(map.get('p1'))).toBe(false);
    expect(collectSoldOutConflict([{ productId: 'p1', qty: 1, price: 1 }], map).lines).toEqual([]);
  });
});

describe('ITEM_SOLD_OUT error shape', () => {
  it('matches envelope fields used by customer order routes', () => {
    const productsById = new Map([['p-sold', { soldOut: true }]]);
    const conflict = collectSoldOutConflict(
      [{ productId: 'p-sold', variantId: null, qty: 1, price: 1 }],
      productsById
    );
    const errorBody = {
      code: 'ITEM_SOLD_OUT',
      message: 'One or more items are sold out',
      productIds: conflict.productIds,
      lines: conflict.lines
    };
    expect(errorBody).toEqual({
      code: 'ITEM_SOLD_OUT',
      message: 'One or more items are sold out',
      productIds: ['p-sold'],
      lines: [{ productId: 'p-sold', variantId: null }]
    });
  });
});
