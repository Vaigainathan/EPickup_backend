const {
  formatLineOptionLabel,
  formatReceiptPhone,
  UUID_LIKE
} = require('../src/services/receiptService');
const {
  enrichReceiptItems,
  mergeVariantFieldsOntoLine
} = require('../src/services/marketplace/shopOrderReceipt');
const {
  classifyOrderLines,
  storedOrderItems
} = require('../src/services/marketplace/createCustomerOrder');

describe('formatLineOptionLabel', () => {
  const variantUuid = '3f0a9f01-954e-401d-964d-ef3146dc225c';

  it('builds label from variantLabel and variantValue', () => {
    expect(formatLineOptionLabel({ variantLabel: 'Size', variantValue: 'M' })).toBe('Size: M');
  });

  it('does not expose variantId or other UUIDs', () => {
    expect(formatLineOptionLabel({ variantId: variantUuid })).toBe('');
    expect(UUID_LIKE.test(variantUuid)).toBe(true);
    expect(formatLineOptionLabel({ variantName: variantUuid })).toBe('');
  });
});

describe('formatReceiptPhone', () => {
  it('formats Indian numbers as +91 XXXXX XXXXX', () => {
    expect(formatReceiptPhone('+919876543210')).toBe('+91 98765 43210');
    expect(formatReceiptPhone('9876543210')).toBe('+91 98765 43210');
  });
});

describe('storedOrderItems at create time', () => {
  it('persists variantLabel and variantValue from the product variant', () => {
    const product = {
      shopId: 'shop1',
      isActive: true,
      name: 'Balaji statue',
      hasVariants: true,
      price: 100,
      stock: 0,
      variants: [{
        id: 'v-m',
        attributeLabel: 'Size',
        value: 'M',
        stock: 3,
        priceOverride: 1540
      }]
    };
    const productsById = new Map([['prod1', product]]);
    const { goodLines } = classifyOrderLines(
      [{ productId: 'prod1', variantId: 'v-m', qty: 1, price: 1540 }],
      productsById,
      'shop1'
    );
    const items = storedOrderItems(goodLines);
    expect(items).toHaveLength(1);
    expect(items[0].variantLabel).toBe('Size');
    expect(items[0].variantValue).toBe('M');
    expect(formatLineOptionLabel(items[0])).toBe('Size: M');
    expect(formatLineOptionLabel(items[0])).not.toMatch(UUID_LIKE);
  });
});

describe('enrichReceiptItems fallback for legacy orders', () => {
  function mockDb(productData) {
    return {
      collection() {
        return {
          doc() {
            return {
              get: async () => ({
                exists: Boolean(productData),
                data: () => productData
              })
            };
          }
        };
      }
    };
  }

  it('fills variant labels from the product when the order line has only variantId', async () => {
    const db = mockDb({
      variants: [{ id: 'legacy-v', attributeLabel: 'Size', value: 'L' }]
    });
    const lines = await enrichReceiptItems(db, [{
      productId: 'prod1',
      variantId: 'legacy-v',
      name: 'Balaji statue'
    }]);
    expect(formatLineOptionLabel(lines[0])).toBe('Size: L');
    expect(formatLineOptionLabel(lines[0])).not.toMatch(UUID_LIKE);
  });

  it('keeps stored variantLabel and variantValue over catalogue fallback', async () => {
    const db = mockDb({
      variants: [{ id: 'legacy-v', attributeLabel: 'Size', value: 'L' }]
    });
    const stored = {
      productId: 'prod1',
      variantId: 'legacy-v',
      variantLabel: 'Size',
      variantValue: 'M',
      name: 'Balaji statue'
    };
    const merged = mergeVariantFieldsOntoLine(stored, 'Size', 'L');
    expect(merged.variantValue).toBe('M');
    const lines = await enrichReceiptItems(db, [stored]);
    expect(formatLineOptionLabel(lines[0])).toBe('Size: M');
  });
});
