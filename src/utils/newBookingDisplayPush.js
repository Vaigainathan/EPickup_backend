function buildNewBookingDisplayPush(bookingData) {
  const isMarketplace = bookingData && bookingData.sourceType === 'marketplace';
  if (isMarketplace) {
    const shopName = bookingData.pickup?.name || 'Shop';
    const fee = bookingData.fare?.totalFare ?? bookingData.pricing?.totalFare ?? 0;
    return {
      title: 'New shop order',
      body: `Pickup at ${shopName} · Delivery fee ₹${fee}`
    };
  }
  return {
    title: '🚗 New Booking Available!',
    body: `Pickup: ${bookingData.pickup?.address || 'Location'}`
  };
}

module.exports = {
  buildNewBookingDisplayPush
};
