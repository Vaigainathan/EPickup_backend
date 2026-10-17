const { formatMoney } = require('../src/services/receiptService');

describe('formatMoney (shop order receipt)', () => {
  const currency = '₹';

  test('formats en-IN grouping with two decimal places', () => {
    expect(formatMoney(currency, 1540)).toBe('₹1,540.00');
    expect(formatMoney(currency, 1540.5)).toBe('₹1,540.50');
    expect(formatMoney(currency, 0)).toBe('₹0.00');
    expect(formatMoney(currency, 100000)).toBe('₹1,00,000.00');
  });

  test('preserves em dash for missing amounts', () => {
    expect(formatMoney(currency, null)).toBe('—');
    expect(formatMoney(currency, '—')).toBe('—');
  });
});
