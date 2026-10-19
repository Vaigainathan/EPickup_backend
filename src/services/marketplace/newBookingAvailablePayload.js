function buildNewBookingSocketFields(bookingData) {
  const data = bookingData && typeof bookingData === 'object' ? bookingData : {};
  return {
    sourceType: data.sourceType ?? 'parcel',
    marketplaceOrderId: data.marketplaceOrderId ?? null,
    displayId: data.displayId ?? null
  };
}

module.exports = {
  buildNewBookingSocketFields
};
