const fs = require('fs');
const path = require('path');
const {
  parcelFilename,
  shopOrderFilename,
  receiptCurrencySymbol
} = require('../src/services/receiptService');

const NOTO_PATH = path.join(__dirname, '../assets/fonts/NotoSans-Regular.ttf');

describe('receipt filenames', () => {
  it('formats shop order filename', () => {
    expect(shopOrderFilename(48213)).toBe('ePickup-Shop-order-48213.pdf');
  });

  it('formats parcel filename', () => {
    expect(parcelFilename(15567)).toBe('ePickup-Parcel-15567.pdf');
  });

  it('uses rupee when Noto font is present', () => {
    if (fs.existsSync(NOTO_PATH)) {
      expect(receiptCurrencySymbol()).toBe('₹');
    } else {
      expect(receiptCurrencySymbol()).toBe('Rs.');
    }
  });
});
