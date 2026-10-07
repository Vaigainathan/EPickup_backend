const {
  isValidUtr,
  isValidUpiId,
  toPaise,
  fromPaise,
  isPositiveIntQuantity
} = require('../src/validators/marketplace');

describe('marketplace validators', () => {
  test('isValidUtr accepts exactly 12 digits', () => {
    expect(isValidUtr('123456789012')).toBe(true);
    expect(isValidUtr('12345678901')).toBe(false);
    expect(isValidUtr('1234567890123')).toBe(false);
    expect(isValidUtr('12345678901a')).toBe(false);
    expect(isValidUtr(123456789012)).toBe(false);
  });

  test('isValidUpiId accepts name@handle within sane length', () => {
    expect(isValidUpiId('shop.name@okicici')).toBe(true);
    expect(isValidUpiId('ab@yz')).toBe(true);
    expect(isValidUpiId('a@yz')).toBe(false);
    expect(isValidUpiId('shop@a1')).toBe(false);
    expect(isValidUpiId('shop@@upi')).toBe(false);
    expect(isValidUpiId('noup')).toBe(false);
    expect(isValidUpiId(`${'a'.repeat(257)}@upi`)).toBe(false);
  });

  test('toPaise and fromPaise round to integer paise', () => {
    expect(toPaise(10)).toBe(1000);
    expect(toPaise(10.5)).toBe(1050);
    expect(toPaise(10.235)).toBe(Math.round(10.235 * 100));
    expect(fromPaise(1024)).toBe(10.24);
    expect(() => toPaise(Number.NaN)).toThrow(TypeError);
    expect(() => fromPaise('nope')).toThrow(TypeError);
  });

  test('isPositiveIntQuantity accepts integers of at least 1', () => {
    expect(isPositiveIntQuantity(1)).toBe(true);
    expect(isPositiveIntQuantity(50)).toBe(true);
    expect(isPositiveIntQuantity(0)).toBe(false);
    expect(isPositiveIntQuantity(1.5)).toBe(false);
    expect(isPositiveIntQuantity(-1)).toBe(false);
    expect(isPositiveIntQuantity('2')).toBe(false);
  });
});
