const { classifyBookingSourceType } = require('../scripts/backfill-booking-sourcetype');

describe('classifyBookingSourceType', () => {
  test('parcel is unchanged', () => {
    expect(classifyBookingSourceType({ sourceType: 'parcel' })).toBe('parcel');
  });

  test('marketplace is unchanged', () => {
    expect(classifyBookingSourceType({ sourceType: 'marketplace' })).toBe('marketplace');
  });

  test('absent field is missing', () => {
    expect(classifyBookingSourceType({})).toBe('missing');
    expect(classifyBookingSourceType(undefined)).toBe('missing');
  });

  test('null is missing', () => {
    expect(classifyBookingSourceType({ sourceType: null })).toBe('missing');
  });

  test('empty string is missing', () => {
    expect(classifyBookingSourceType({ sourceType: '' })).toBe('missing');
  });

  test('any other value is other', () => {
    expect(classifyBookingSourceType({ sourceType: 'razorpay_payment' })).toBe('other');
    expect(classifyBookingSourceType({ sourceType: ' parcel' })).toBe('other');
  });
});
